import { MU0, T_AMBIENT_K } from './constants.ts';
import { PHYSICS_CONFIG } from './config.ts';
import { MATERIALS } from './materials.ts';
import { gaussian, mulberry32 } from './prng.ts';
import { Rk4 } from './rk4.ts';
import { TraceRecorder } from './trace.ts';
import { PeakTracker, allFinite, closureResidual } from './sim-common.ts';
import { physicsVersion } from './version.ts';
import {
  demagFactorProlate,
  effectivePermeability,
  lncosh,
  makeOverlap,
  overlap,
  overlapDerivative,
  slugMass_kg,
  tanhAndLncosh,
  wheelerInductance_H,
  windingGeometry,
  type OverlapProfile,
  type SlugSpec,
  type Winding,
} from './coilgun-magnetics.ts';
import type { CapacitorRatings, SwitchRatings } from './railgun.ts';
import type { Failure, ShotResult, SimOptions, ValidationIssue } from './results.ts';

export type CoilTrigger =
  | { readonly kind: 'position'; /** Slug centre passes z + offset. */ readonly offset_m: number }
  | { readonly kind: 'delay'; readonly t_s: number };

export interface CoilStageDesign {
  /** Axial position of the coil centre, m. */
  readonly z_m: number;
  readonly turns: number;
  readonly awg: number;
  /** Winding length, m. */
  readonly length_m: number;
  readonly innerRadius_m: number;
  readonly C_F: number;
  readonly V0_V: number;
  /** Capacitor ESR plus cabling, ohm (added to the coil's own resistance). */
  readonly R_series_ohm: number;
  /** Capacitor ESL plus cabling, H (added to the coil's own inductance). */
  readonly L_series_H: number;
  readonly Vf_V: number;
  /** Freewheel diode: clamps the capacitor at zero volts. */
  readonly freewheel: boolean;
  readonly trigger: CoilTrigger;
  readonly capacitor: CapacitorRatings;
  readonly switch: SwitchRatings;
  /** Rated pulsed current density of the winding, A/m^2. */
  readonly J_max_A_m2: number;
}

export interface CoilgunDesign {
  readonly slug: SlugSpec;
  /** Initial slug centre position, m. */
  readonly x0_m: number;
  readonly v0_m_s: number;
  /** The shot ends when the slug centre reaches this position, m. */
  readonly x_exit_m: number;
  readonly friction_kinetic_N: number;
  readonly friction_static_N: number;
  readonly trigger_jitter_s: number;
  readonly stages: readonly CoilStageDesign[];
}

export interface CoilStageElectrics {
  readonly winding: Winding;
  /** Air-core inductance of the winding alone (Wheeler), H. */
  readonly L_coil_H: number;
  /** Air-core inductance of the circuit: winding plus series inductance, H. */
  readonly L0_H: number;
  readonly Rcoil20_ohm: number;
  readonly wireMass_kg: number;
  readonly Nd: number;
  readonly muEff: number;
  readonly fillFactor: number;
  /** Extra inductance with the slug fully inside, H. */
  readonly dLmax_H: number;
  readonly Isat_A: number;
  readonly overlap: OverlapProfile;
  readonly outerDiameter_m: number;
}

/** Derived electrical and magnetic values of one stage (brief section 4.4). */
export function coilStageElectrics(stage: CoilStageDesign, slug: SlugSpec): CoilStageElectrics {
  const cu = MATERIALS.copper;
  const iron = MATERIALS[slug.material];
  const winding = windingGeometry(stage.turns, stage.awg, stage.length_m, stage.innerRadius_m);
  const L_coil_H = wheelerInductance_H(winding.meanRadius_m, stage.length_m, stage.turns);
  const Nd = demagFactorProlate(slug.length_m / slug.diameter_m);
  const muEff = effectivePermeability(iron.mu_r, Nd);
  const ratio = slug.diameter_m / (2 * winding.meanRadius_m);
  const fillFactor = Math.min(1, ratio * ratio);
  return {
    winding,
    L_coil_H,
    L0_H: L_coil_H + stage.L_series_H,
    Rcoil20_ohm: (cu.resistivity20_ohm_m * winding.wireLength_m) / winding.wireArea_m2,
    wireMass_kg: cu.density_kg_m3 * winding.wireArea_m2 * winding.wireLength_m,
    Nd,
    muEff,
    fillFactor,
    dLmax_H: (muEff - 1) * L_coil_H * fillFactor,
    Isat_A: (iron.Bsat_T * stage.length_m) / (MU0 * muEff * stage.turns),
    overlap: makeOverlap(stage.length_m, slug.length_m),
    outerDiameter_m: 2 * winding.outerRadius_m,
  };
}

function anyActive(active: Uint8Array): boolean {
  for (let j = 0; j < active.length; j++) if (active[j]) return true;
  return false;
}

function positive(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

function nonNegative(v: number): boolean {
  return Number.isFinite(v) && v >= 0;
}

export function validateCoilgunDesign(d: CoilgunDesign): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const bad = (field: string, message: string) => out.push({ field, message });
  const s = d.slug;
  if (s.material !== 'iron') bad('slug.material', 'A coilgun slug must be ferromagnetic (iron).');
  if (!positive(s.length_m) || !positive(s.diameter_m)) bad('slug', 'Slug length and diameter must be positive.');
  else if (s.length_m < s.diameter_m) bad('slug.length_m', 'Slug must be at least as long as it is wide for this model.');
  if (!Number.isFinite(d.x0_m) || !Number.isFinite(d.x_exit_m) || d.x_exit_m <= d.x0_m) {
    bad('x_exit_m', 'The exit position must lie beyond the starting position.');
  }
  if (!Number.isFinite(d.v0_m_s)) bad('v0_m_s', 'Starting speed must be a number.');
  if (!nonNegative(d.friction_kinetic_N) || !nonNegative(d.friction_static_N) || d.friction_static_N < d.friction_kinetic_N) {
    bad('friction_static_N', 'Static friction must be at least the kinetic friction, and neither can be negative.');
  }
  if (!nonNegative(d.trigger_jitter_s)) bad('trigger_jitter_s', 'Trigger jitter cannot be negative.');
  if (d.stages.length < 1 || d.stages.length > PHYSICS_CONFIG.MAX_COIL_STAGES) {
    bad('stages', `A coilgun needs between 1 and ${PHYSICS_CONFIG.MAX_COIL_STAGES} stages.`);
  }
  if (out.length > 0) return out;
  let prevZ = -Infinity;
  let prevD = 0;
  d.stages.forEach((st, j) => {
    const p = `stages[${j}]`;
    if (!Number.isInteger(st.turns) || st.turns < 1) bad(`${p}.turns`, 'Turns must be a whole number of at least 1.');
    if (!Number.isFinite(st.awg) || st.awg < 4 || st.awg > 40) bad(`${p}.awg`, 'Wire gauge must be between AWG 4 and AWG 40.');
    if (!positive(st.length_m) || !positive(st.innerRadius_m)) bad(p, 'Coil length and inner radius must be positive.');
    else if (st.innerRadius_m * 2 <= s.diameter_m) bad(`${p}.innerRadius_m`, 'The coil bore must be wider than the slug.');
    if (!positive(st.C_F)) bad(`${p}.C_F`, 'Capacitance must be positive.');
    if (!nonNegative(st.V0_V)) bad(`${p}.V0_V`, 'Charge voltage cannot be negative.');
    if (!nonNegative(st.R_series_ohm)) bad(`${p}.R_series_ohm`, 'Series resistance cannot be negative.');
    if (!nonNegative(st.L_series_H)) bad(`${p}.L_series_H`, 'Series inductance cannot be negative.');
    if (!nonNegative(st.Vf_V)) bad(`${p}.Vf_V`, 'Switch forward drop cannot be negative.');
    if (st.trigger.kind === 'delay' ? !nonNegative(st.trigger.t_s) : !Number.isFinite(st.trigger.offset_m)) {
      bad(`${p}.trigger`, 'Trigger timing must be a finite number.');
    }
    if (!positive(st.capacitor.V_rated_V) || !positive(st.capacitor.I_peak_A) || !nonNegative(st.capacitor.reversalFraction)) {
      bad(`${p}.capacitor`, 'Capacitor ratings must be positive.');
    }
    if (!positive(st.switch.I_peak_A) || !positive(st.switch.I2t_A2s) || !positive(st.switch.dIdt_A_per_s)) {
      bad(`${p}.switch`, 'Switch ratings must be positive.');
    }
    if (!positive(st.J_max_A_m2)) bad(`${p}.J_max_A_m2`, 'Current density rating must be positive.');
    if (!Number.isFinite(st.z_m)) bad(`${p}.z_m`, 'Coil position must be a number.');
    if (out.length === 0) {
      const dia = 2 * windingGeometry(st.turns, st.awg, st.length_m, st.innerRadius_m).outerRadius_m;
      if (j > 0 && st.z_m - prevZ < PHYSICS_CONFIG.MIN_STAGE_SPACING_DIAMETERS * Math.max(dia, prevD)) {
        bad(`${p}.z_m`, 'Stages must be at least one coil diameter apart, in increasing order along the barrel.');
      }
      prevZ = st.z_m;
      prevD = dia;
    }
  });
  return out;
}

const X = 0;
const V = 1;
const E_OHM = 2;
const E_DROP = 3;
const E_FRIC = 4;
const J_EM = 5;
const J_FRIC = 6;
const FIXED = 7;

const WAIT = 0;
const ACTIVE = 1;
const DONE = 2;
const FAILED = 3;

/** Solve one coilgun shot with RK4 (brief section 4.4), locating events by step shortening. */
export function simulateCoilgun(design: CoilgunDesign, opts: SimOptions = {}): ShotResult {
  const issues = validateCoilgunDesign(design);
  if (issues.length > 0) return { ok: false, kind: 'InvalidDesign', message: issues[0].message, issues };

  const cfg = PHYSICS_CONFIG;
  const cu = MATERIALS.copper;
  const stages = design.stages;
  const n = stages.length;
  const m_kg = slugMass_kg(design.slug);
  const F_kin = design.friction_kinetic_N;
  const F_stat = design.friction_static_N;
  const IV = FIXED;
  const II = FIXED + n;
  const IT = FIXED + 2 * n;
  const IQ = FIXED + 3 * n;
  const N = FIXED + 4 * n;

  const Z = new Float64Array(n);
  const L0 = new Float64Array(n);
  const Rser = new Float64Array(n);
  const wireLen = new Float64Array(n);
  const wireArea = new Float64Array(n);
  const wireMassCp = new Float64Array(n);
  const dLmax = new Float64Array(n);
  const Isat = new Float64Array(n);
  const C = new Float64Array(n);
  const Vf = new Float64Array(n);
  const V0 = new Float64Array(n);
  const trigT = new Float64Array(n);
  const trigX = new Float64Array(n);
  const isPos = new Uint8Array(n);
  const freewheel = new Uint8Array(n);
  const state = new Int8Array(n);
  const active = new Uint8Array(n);
  const profiles: OverlapProfile[] = [];
  const rng = mulberry32(opts.seed ?? 1);
  const y = new Float64Array(N);
  let E_cap0 = 0;
  let C_min = Infinity;
  let L_min = Infinity;
  let R_max = 0;
  for (let j = 0; j < n; j++) {
    const st = stages[j];
    const el = coilStageElectrics(st, design.slug);
    Z[j] = st.z_m;
    L0[j] = el.L0_H;
    Rser[j] = st.R_series_ohm;
    wireLen[j] = el.winding.wireLength_m;
    wireArea[j] = el.winding.wireArea_m2;
    wireMassCp[j] = el.wireMass_kg * cu.cp_J_kg_K;
    dLmax[j] = el.dLmax_H;
    Isat[j] = el.Isat_A;
    C[j] = st.C_F;
    Vf[j] = st.Vf_V;
    V0[j] = st.V0_V;
    freewheel[j] = st.freewheel ? 1 : 0;
    profiles.push(el.overlap);
    const jitter = design.trigger_jitter_s > 0 ? design.trigger_jitter_s * gaussian(rng) : 0;
    if (st.trigger.kind === 'delay') trigT[j] = Math.max(0, st.trigger.t_s + jitter);
    else {
      isPos[j] = 1;
      trigX[j] = st.z_m + st.trigger.offset_m + jitter * Math.max(design.v0_m_s, 0);
    }
    y[IV + j] = st.V0_V;
    y[IT + j] = opts.initialCoilTemps_K?.[j] ?? T_AMBIENT_K;
    E_cap0 += 0.5 * st.C_F * st.V0_V * st.V0_V;
    C_min = Math.min(C_min, st.C_F);
    L_min = Math.min(L_min, el.L0_H);
    R_max = Math.max(R_max, el.Rcoil20_ohm + st.R_series_ohm);
  }
  y[X] = design.x0_m;
  y[V] = design.v0_m_s;
  const KE0 = 0.5 * m_kg * design.v0_m_s * design.v0_m_s;
  const E_total0 = E_cap0 + KE0;
  const T_char = Math.min(2 * Math.PI * Math.sqrt(L_min * C_min), R_max > 0 ? L_min / R_max : Infinity);
  const dt = Math.min(cfg.COIL_DT_MAX_S, T_char / cfg.COIL_STEPS_PER_CHAR_TIME) * (opts.dtScale ?? 1);

  const verify = opts.verifyClosure === true;
  const failures: Failure[] = [];
  let E_fail = 0;

  const cuRho = (T: number): number => Math.max(cu.resistivity20_ohm_m * (1 + cu.alpha_per_K * (T - T_AMBIENT_K)), 0.1 * cu.resistivity20_ohm_m);

  const stageMagnetic = (j: number): number => {
    const I = y[II + j];
    const a = I / Isat[j];
    const dL = dLmax[j] * overlap(profiles[j], y[X] - Z[j]);
    return 0.5 * L0[j] * I * I + dL * Isat[j] * (I * Math.tanh(a) - Isat[j] * lncosh(a));
  };
  const magneticEnergy = (): number => {
    let e = 0;
    for (let j = 0; j < n; j++) if (active[j]) e += stageMagnetic(j);
    return e;
  };
  const capEnergy = (): number => {
    let e = 0;
    for (let j = 0; j < n; j++) {
      const v = freewheel[j] && y[IV + j] < 0 ? 0 : y[IV + j];
      e += 0.5 * C[j] * v * v;
    }
    return e;
  };
  const ledgerSum = (): number =>
    capEnergy() + magneticEnergy() + 0.5 * m_kg * y[V] * y[V] + y[E_OHM] + y[E_DROP] + y[E_FRIC] + E_fail;

  const removeStage = (j: number, finalState: number, toFail: boolean): void => {
    const before = stageMagnetic(j);
    y[II + j] = 0;
    active[j] = 0;
    state[j] = finalState;
    if (toFail) E_fail += before;
    else y[E_DROP] += before;
  };

  for (let j = 0; j < n; j++) {
    const rated = stages[j].capacitor.V_rated_V;
    if (V0[j] > rated) {
      E_fail += 0.5 * C[j] * V0[j] * V0[j];
      y[IV + j] = 0;
      state[j] = FAILED;
      failures.push({
        kind: 'capacitor_overvoltage',
        consequence: 'module_lost',
        index: j,
        t_s: 0,
        limit: rated,
        value: V0[j],
        unit: 'V',
        message: `Stage ${j + 1} capacitor was charged to ${V0[j].toFixed(0)} V, above its ${rated.toFixed(0)} V rating. The module is lost.`,
      });
    }
  }

  const sat = new Float64Array(2);
  const rhs = (_t: number, s: Float64Array, d: Float64Array): void => {
    const x = s[X];
    const v = s[V];
    let Ftot = 0;
    let ohm = 0;
    let drop = 0;
    for (let j = 0; j < n; j++) {
      if (!active[j]) {
        d[II + j] = 0;
        d[IV + j] = 0;
        d[IT + j] = 0;
        d[IQ + j] = 0;
        continue;
      }
      const I = s[II + j];
      const Vj = s[IV + j];
      const clamped = freewheel[j] === 1 && Vj <= 0;
      const Ve = clamped ? 0 : Vj;
      tanhAndLncosh(I / Isat[j], sat);
      const th = sat[0];
      const prof = profiles[j];
      const zr = x - Z[j];
      const dL = dLmax[j] * overlap(prof, zr);
      const dLp = dLmax[j] * overlapDerivative(prof, zr);
      const dlamdI = L0[j] + dL * (1 - th * th);
      const dlamdz = dLp * Isat[j] * th;
      const Rc = (cuRho(s[IT + j]) * wireLen[j]) / wireArea[j];
      const Rj = Rc + Rser[j];
      d[II + j] = (Ve - Rj * I - Vf[j] - dlamdz * v) / dlamdI;
      d[IV + j] = clamped ? 0 : -I / C[j];
      d[IT + j] = (I * I * Rc) / wireMassCp[j];
      d[IQ + j] = I * I;
      Ftot += dLp * Isat[j] * Isat[j] * sat[1];
      ohm += Rj * I * I;
      drop += Vf[j] * I;
    }
    let fric = 0;
    let dv = 0;
    if (v > 0) {
      fric = F_kin;
      dv = (Ftot - fric) / m_kg;
    } else if (v < 0) {
      fric = -F_kin;
      dv = (Ftot - fric) / m_kg;
    } else if (Math.abs(Ftot) > F_stat) {
      fric = Ftot > 0 ? F_kin : -F_kin;
      dv = (Ftot - fric) / m_kg;
    }
    d[X] = v;
    d[V] = dv;
    d[E_OHM] = ohm;
    d[E_DROP] = drop;
    d[E_FRIC] = fric * v;
    d[J_EM] = Ftot;
    d[J_FRIC] = Math.abs(fric);
  };

  const rk = new Rk4(N);
  const k1 = new Float64Array(N);
  const trace = new TraceRecorder(cfg.TRACE_MAX_POINTS);
  const peak = new PeakTracker();
  let t = 0;
  let steps = 0;
  let residualMax = 0;
  let status: 'MUZZLE_EXIT' | 'FIZZLE' | 'ABORTED_BY_FAILURE' = 'FIZZLE';

  const totalCurrent = (): number => {
    let I = 0;
    for (let j = 0; j < n; j++) if (active[j]) I += y[II + j];
    return I;
  };
  const diverged = (why: string): ShotResult => ({
    ok: false,
    kind: 'SimulationDiverged',
    message: `The shot solver diverged (${why}) at ${(t * 1e3).toFixed(3)} ms. Check for extreme values in the design.`,
    issues: [],
  });

  const stageFailure = (
    j: number,
    kind: Failure['kind'],
    consequence: Failure['consequence'],
    limit: number,
    value: number,
    unit: string,
    what: string,
    outcome: string,
  ): void => {
    if (consequence === 'module_lost') {
      E_fail += 0.5 * C[j] * y[IV + j] * y[IV + j];
      y[IV + j] = 0;
    }
    removeStage(j, FAILED, true);
    failures.push({
      kind,
      consequence,
      index: j,
      t_s: t,
      limit,
      value,
      unit,
      message: `Stage ${j + 1} reached ${value.toPrecision(4)} ${unit} ${what} against a ${limit.toPrecision(4)} ${unit} limit at ${(t * 1e3).toFixed(3)} ms. ${outcome}`,
    });
  };

  for (;;) {
    if (steps >= cfg.MAX_STEPS) {
      return {
        ok: false,
        kind: 'StepCapExceeded',
        message: `The shot needs more than ${cfg.MAX_STEPS} steps. Reduce the design's fastest time constant or lengthen its inductance.`,
        issues: [],
      };
    }
    for (let j = 0; j < n; j++) {
      if (state[j] !== WAIT) continue;
      const due = isPos[j] ? y[X] >= trigX[j] - 1e-12 : t >= trigT[j] - 1e-15;
      if (due) {
        state[j] = ACTIVE;
        active[j] = 1;
      }
    }
    rhs(t, y, k1);
    let changed = false;
    for (let j = 0; j < n; j++) {
      if (active[j] && y[II + j] <= cfg.CURRENT_ZERO_EPS_A && k1[II + j] <= 0) {
        removeStage(j, DONE, false);
        changed = true;
      }
    }
    if (changed) rhs(t, y, k1);
    for (let j = 0; j < n; j++) {
      if (!active[j]) continue;
      const didt = Math.abs(k1[II + j]);
      const lim = stages[j].switch.dIdt_A_per_s;
      if (didt > lim) {
        stageFailure(j, 'switch_didt', 'switch_open', lim, didt, 'A/s', 'rate of current rise', 'The switch failed open and the bank keeps its remaining charge.');
        changed = true;
      }
    }
    if (changed) rhs(t, y, k1);

    let h = dt;
    let blocksFizzle = false;
    for (let j = 0; j < n; j++) {
      if (state[j] === WAIT) {
        if (isPos[j]) {
          if (y[V] > 0 && y[X] < trigX[j]) {
            blocksFizzle = blocksFizzle || y[V] >= cfg.FIZZLE_SPEED_M_S;
            const tp = (trigX[j] - y[X]) / y[V];
            if (tp < h) h = Math.max(tp, cfg.MIN_EVENT_STEP_S);
          }
        } else {
          blocksFizzle = true;
          const gap = trigT[j] - t;
          if (gap > 0 && gap < h) h = Math.max(gap, cfg.MIN_EVENT_STEP_S);
        }
      } else if (active[j]) {
        const Ij = y[II + j];
        const dI = k1[II + j];
        if (Ij > 0 && dI < 0) {
          const tz = Ij / -dI;
          if (tz < h) h = Math.max(tz, cfg.MIN_EVENT_STEP_S);
        }
      }
    }
    if (y[V] > 0) {
      const tm = (design.x_exit_m - y[X]) / y[V];
      if (tm < h) h = Math.max(tm, cfg.MIN_EVENT_STEP_S);
    }
    if (!anyActive(active) && y[V] > 0) {
      // Nothing is energized, so the slug coasts under constant friction. That motion is a
      // quadratic in time, which RK4 integrates exactly, so one step can span the whole gap
      // to the next trigger or the muzzle. The step stays short of the friction stop.
      let hCoast = (design.x_exit_m - y[X]) / y[V];
      for (let j = 0; j < n; j++) {
        if (state[j] !== WAIT) continue;
        const gap = isPos[j] ? (trigX[j] - y[X]) / y[V] : trigT[j] - t;
        if (gap > 0 && gap < hCoast) hCoast = gap;
      }
      if (F_kin > 0) hCoast = Math.min(hCoast, (0.9 * m_kg * y[V]) / F_kin);
      if (hCoast > h) h = hCoast;
    }
    if (t + h > cfg.MAX_SHOT_TIME_S) h = Math.max(cfg.MAX_SHOT_TIME_S - t, cfg.MIN_EVENT_STEP_S);

    const vBefore = y[V];
    rk.step(rhs, t, y, h, k1);
    t += h;
    steps++;
    if (!allFinite(y)) return diverged('non-finite state');

    if (F_kin > 0 && vBefore !== 0 && vBefore * y[V] < 0) {
      y[E_FRIC] += 0.5 * m_kg * y[V] * y[V];
      y[V] = 0;
    }
    for (let j = 0; j < n; j++) {
      if (active[j] && y[II + j] <= cfg.CURRENT_ZERO_EPS_A) removeStage(j, DONE, false);
      if (freewheel[j] && y[IV + j] < 0) {
        y[E_DROP] += 0.5 * C[j] * y[IV + j] * y[IV + j];
        y[IV + j] = 0;
      }
    }
    const I = totalCurrent();
    if (!(Math.abs(I) < 1e10)) return diverged('current out of range');
    peak.add(t, I);

    for (let j = 0; j < n; j++) {
      if (!active[j]) continue;
      const Ij = y[II + j];
      const cap = stages[j].capacitor;
      const sw = stages[j].switch;
      const Vj = y[IV + j];
      if (Ij > cap.I_peak_A) {
        stageFailure(j, 'capacitor_peak_current', 'module_lost', cap.I_peak_A, Ij, 'A', 'discharge current', 'The capacitor is lost and stays discharged until replaced.');
      } else if (!freewheel[j] && Vj < 0 && -Vj > cap.reversalFraction * V0[j]) {
        stageFailure(j, 'capacitor_reversal', 'module_lost', cap.reversalFraction * V0[j], -Vj, 'V', 'reverse voltage', 'The capacitor is lost and stays discharged until replaced. A freewheel diode prevents this.');
      } else if (Ij > sw.I_peak_A) {
        stageFailure(j, 'switch_peak_current', 'switch_open', sw.I_peak_A, Ij, 'A', 'peak current', 'The switch failed open and the bank keeps its remaining charge.');
      } else if (y[IQ + j] > sw.I2t_A2s) {
        stageFailure(j, 'switch_i2t', 'switch_open', sw.I2t_A2s, y[IQ + j], 'A^2 s', 'I^2 t', 'The switch failed open and the bank keeps its remaining charge.');
      } else if (y[IT + j] >= cfg.COIL_INSULATION_LIMIT_K) {
        stageFailure(j, 'coil_overtemperature', 'stage_lost', cfg.COIL_INSULATION_LIMIT_K, y[IT + j], 'K', 'winding temperature', 'The insulation failed and the stage is lost.');
      } else if (Ij / wireArea[j] > stages[j].J_max_A_m2) {
        stageFailure(j, 'coil_current_density', 'stage_lost', stages[j].J_max_A_m2, Ij / wireArea[j], 'A/m^2', 'current density', 'The winding failed and the stage is lost.');
      }
    }
    if (verify) residualMax = Math.max(residualMax, closureResidual(ledgerSum(), E_total0));
    trace.push(t, I, y[V], y[X]);

    if (y[X] >= design.x_exit_m - 1e-12) {
      status = 'MUZZLE_EXIT';
      break;
    }
    if (t >= cfg.MAX_SHOT_TIME_S - 1e-15) {
      status = 'FIZZLE';
      break;
    }
    if (
      t >= cfg.FIZZLE_MIN_TIME_S &&
      !blocksFizzle &&
      Math.abs(I) <= cfg.FIZZLE_CURRENT_FRACTION * peak.peak &&
      Math.abs(y[V]) < cfg.FIZZLE_SPEED_M_S
    ) {
      status = 'FIZZLE';
      break;
    }
  }

  const Iend = totalCurrent();
  const E_mag = magneticEnergy();
  const E_cap = capEnergy();
  const KE = 0.5 * m_kg * y[V] * y[V];
  const exited = status === 'MUZZLE_EXIT';
  let action = 0;
  const Vend: number[] = [];
  const Tend: number[] = [];
  for (let j = 0; j < n; j++) {
    action += y[IQ + j];
    Vend.push(y[IV + j]);
    Tend.push(y[IT + j]);
  }
  if (!allFinite(y)) return diverged('non-finite result');
  const peakCurrent = Math.max(peak.peak, Math.abs(Iend));

  return {
    ok: true,
    kind: 'coilgun',
    status,
    physicsVersion,
    muzzleSpeed_m_s: exited ? y[V] : 0,
    muzzleEnergy_J: exited ? KE : 0,
    muzzleMomentum_Ns: exited ? m_kg * y[V] : 0,
    recoilImpulse_Ns: exited ? m_kg * y[V] : 0,
    efficiency: exited && E_cap0 > 0 ? (KE - KE0) / E_cap0 : 0,
    t_end_s: t,
    I_peak_A: peakCurrent,
    I_peak_t_s: peak.peakT,
    actionIntegral_A2s: action,
    peakSeparationLoad_N_per_m: 0,
    T_breech_end_K: 0,
    railsDamaged: false,
    railHeat_J: 0,
    coilTemps_K: Tend,
    V_end_V: Vend,
    impulseEm_Ns: y[J_EM],
    impulseFric_Ns: y[J_FRIC],
    steps,
    dt_s: dt,
    ledger: {
      E_cap0_J: E_cap0,
      KE0_J: KE0,
      E_cap_end_J: E_cap,
      E_mag_end_J: E_mag,
      KE_J: KE,
      E_ohm_J: y[E_OHM],
      E_drop_J: y[E_DROP],
      E_fric_J: y[E_FRIC],
      E_fail_J: E_fail,
      E_muzzle_dump_J: 0,
      residual_max_rel: Math.max(residualMax, closureResidual(ledgerSum(), E_total0)),
      residual_end_rel: closureResidual(ledgerSum(), E_total0),
    },
    failures,
    trace: trace.finish(t, Iend, y[V], y[X]),
  };
}
