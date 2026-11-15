import { MU0, T_AMBIENT_K } from './constants.ts';
import { PHYSICS_CONFIG } from './config.ts';
import { MATERIALS, resistivity_ohm_m } from './materials.ts';
import { gaussian, mulberry32 } from './prng.ts';
import { Rk4 } from './rk4.ts';
import { TraceRecorder } from './trace.ts';
import { PeakTracker, allFinite, closureResidual } from './sim-common.ts';
import { physicsVersion } from './version.ts';
import type { ProjectileSpec } from './projectile.ts';
import type { Failure, ShotResult, SimOptions, ValidationIssue } from './results.ts';

export interface RailGeometrySpec {
  readonly w_m: number;
  readonly h_m: number;
  /** Inner separation of the rails. */
  readonly s_m: number;
  /** Bore length. */
  readonly ell_m: number;
  readonly material: 'copper' | 'aluminum6061';
}

export interface CapacitorRatings {
  readonly V_rated_V: number;
  /** Largest tolerated reverse voltage as a fraction of the starting voltage. */
  readonly reversalFraction: number;
  /** Largest tolerated discharge current of the module, A. */
  readonly I_peak_A: number;
}

export interface SwitchRatings {
  readonly I_peak_A: number;
  readonly I2t_A2s: number;
  readonly dIdt_A_per_s: number;
}

export interface RailModule {
  readonly C_F: number;
  readonly V0_V: number;
  /** Series resistance (ESR plus cabling), ohm. */
  readonly R_ohm: number;
  /** Series inductance (ESL plus cabling), H. */
  readonly L_H: number;
  /** Thyristor forward drop, V. */
  readonly Vf_V: number;
  readonly trigger_delay_s: number;
  /** Crowbar diode across the module (clamps the capacitor at zero volts). */
  readonly crowbar: boolean;
  readonly capacitor: CapacitorRatings;
  readonly switch: SwitchRatings;
}

export interface RailgunDesign {
  readonly rails: RailGeometrySpec;
  /** Breech and busbar inductance, H. */
  readonly L_b_H: number;
  /** Breech and busbar resistance, ohm. */
  readonly R_b_ohm: number;
  /** Armature contact resistance, ohm. */
  readonly R_arm_ohm: number;
  readonly armature: {
    readonly mass_kg: number;
    readonly mu_k: number;
    readonly mu_s: number;
    readonly preload_N: number;
  };
  readonly projectile: ProjectileSpec;
  readonly mount: { readonly f_sep_max_N_per_m: number };
  /** Standard deviation of trigger timing jitter, s (seeded, never used for failures). */
  readonly trigger_jitter_s: number;
  readonly modules: readonly RailModule[];
}

export interface RailGeometry {
  readonly d_m: number;
  readonly GMR_m: number;
  readonly spacingRatio: number;
  readonly Lprime_H_m: number;
  readonly f_eff_Hz: number;
  readonly delta_m: number;
  readonly A_eff_m2: number;
  readonly Rprime_ohm_m: number;
  readonly railMass_kg: number;
}

/** Inductance and resistance gradients and effective area (brief section 4.3). */
export function railGeometry(design: RailgunDesign, T_K: number): RailGeometry {
  const { w_m, h_m, s_m, ell_m, material } = design.rails;
  const d_m = s_m + w_m;
  const GMR_m = PHYSICS_CONFIG.RECT_GMR_FACTOR * (w_m + h_m);
  const spacingRatio = d_m / GMR_m;
  const Lprime_H_m = (MU0 / Math.PI) * Math.log(spacingRatio);
  const rho = resistivity_ohm_m(material, T_K);
  let C_tot = 0;
  for (const m of design.modules) C_tot += m.C_F;
  const L_tot_est = design.L_b_H + (Lprime_H_m * ell_m) / 2;
  const f_eff_Hz = 1 / (2 * Math.PI * Math.sqrt(L_tot_est * C_tot));
  const delta_m = Math.sqrt(rho / (Math.PI * f_eff_Hz * MU0));
  const A_eff_m2 =
    delta_m >= Math.min(w_m, h_m) / 2 ? w_m * h_m : w_m * h_m - (w_m - 2 * delta_m) * (h_m - 2 * delta_m);
  return {
    d_m,
    GMR_m,
    spacingRatio,
    Lprime_H_m,
    f_eff_Hz,
    delta_m,
    A_eff_m2,
    Rprime_ohm_m: (2 * rho) / A_eff_m2,
    railMass_kg: 2 * w_m * h_m * ell_m * MATERIALS[material].density_kg_m3,
  };
}

function positive(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

function nonNegative(v: number): boolean {
  return Number.isFinite(v) && v >= 0;
}

/** Structural checks on a design. An empty list means the solver accepts it. */
export function validateRailgunDesign(d: RailgunDesign): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const bad = (field: string, message: string) => out.push({ field, message });
  const r = d.rails;
  if (!positive(r.w_m)) bad('rails.w_m', 'Rail width must be a positive number of meters.');
  if (!positive(r.h_m)) bad('rails.h_m', 'Rail height must be a positive number of meters.');
  if (!positive(r.s_m)) bad('rails.s_m', 'Rail separation must be a positive number of meters.');
  if (!positive(r.ell_m)) bad('rails.ell_m', 'Bore length must be a positive number of meters.');
  if (r.material !== 'copper' && r.material !== 'aluminum6061') bad('rails.material', 'Rails must be copper or aluminum.');
  if (out.length === 0) {
    const ratio = (r.s_m + r.w_m) / (PHYSICS_CONFIG.RECT_GMR_FACTOR * (r.w_m + r.h_m));
    if (ratio < PHYSICS_CONFIG.MIN_RAIL_SPACING_RATIO) bad('rails.s_m', 'Rails too close together for this model');
  }
  if (!positive(d.L_b_H)) bad('L_b_H', 'Breech inductance must be positive.');
  if (!nonNegative(d.R_b_ohm)) bad('R_b_ohm', 'Breech resistance cannot be negative.');
  if (!nonNegative(d.R_arm_ohm)) bad('R_arm_ohm', 'Armature contact resistance cannot be negative.');
  const a = d.armature;
  if (!positive(a.mass_kg)) bad('armature.mass_kg', 'Armature mass must be positive.');
  if (!nonNegative(a.mu_k) || !nonNegative(a.mu_s) || a.mu_s < a.mu_k) {
    bad('armature.mu_s', 'Static friction must be at least the kinetic friction, and neither can be negative.');
  }
  if (!nonNegative(a.preload_N)) bad('armature.preload_N', 'Armature preload cannot be negative.');
  if (!positive(d.mount.f_sep_max_N_per_m)) bad('mount.f_sep_max_N_per_m', 'Mount rating must be positive.');
  if (!nonNegative(d.trigger_jitter_s)) bad('trigger_jitter_s', 'Trigger jitter cannot be negative.');
  if (d.modules.length < 1 || d.modules.length > PHYSICS_CONFIG.MAX_RAIL_MODULES) {
    bad('modules', `A railgun needs between 1 and ${PHYSICS_CONFIG.MAX_RAIL_MODULES} capacitor modules.`);
  }
  d.modules.forEach((m, k) => {
    const p = `modules[${k}]`;
    if (!positive(m.C_F)) bad(`${p}.C_F`, 'Capacitance must be positive.');
    if (!nonNegative(m.V0_V)) bad(`${p}.V0_V`, 'Charge voltage cannot be negative.');
    if (!nonNegative(m.R_ohm)) bad(`${p}.R_ohm`, 'Series resistance cannot be negative.');
    if (!positive(m.L_H)) bad(`${p}.L_H`, 'Series inductance must be positive.');
    if (!nonNegative(m.Vf_V)) bad(`${p}.Vf_V`, 'Switch forward drop cannot be negative.');
    if (!nonNegative(m.trigger_delay_s)) bad(`${p}.trigger_delay_s`, 'Trigger delay cannot be negative.');
    if (!positive(m.capacitor.V_rated_V) || !positive(m.capacitor.I_peak_A) || !nonNegative(m.capacitor.reversalFraction)) {
      bad(`${p}.capacitor`, 'Capacitor ratings must be positive.');
    }
    if (!positive(m.switch.I_peak_A) || !positive(m.switch.I2t_A2s) || !positive(m.switch.dIdt_A_per_s)) {
      bad(`${p}.switch`, 'Switch ratings must be positive.');
    }
  });
  return out;
}

// State vector layout. Per-module blocks follow the fixed block.
const X = 0;
const V = 1;
const TB = 2;
const E_OHM = 3;
const E_DROP = 4;
const E_FRIC = 5;
const E_RAIL = 6;
const ACTION = 7;
const J_EM = 8;
const J_FRIC = 9;
const FIXED = 10;

const WAIT = 0;
const ACTIVE = 1;
const DONE = 2;
const FAILED = 3;

/**
 * Solve one railgun shot with RK4 (brief section 4.3). Events (module triggers, thyristor
 * current zero, muzzle exit) are located by shortening the step to land on them.
 */
export function simulateRailgun(design: RailgunDesign, opts: SimOptions = {}): ShotResult {
  const issues = validateRailgunDesign(design);
  if (issues.length > 0) {
    return { ok: false, kind: 'InvalidDesign', message: issues[0].message, issues };
  }
  const cfg = PHYSICS_CONFIG;
  const mods = design.modules;
  const n = mods.length;
  const T_bulk_K = opts.initialRailTemp_K ?? T_AMBIENT_K;
  const geo = railGeometry(design, T_bulk_K);
  const rail = MATERIALS[design.rails.material];
  const Lp = geo.Lprime_H_m;
  const Rp = geo.Rprime_ohm_m;
  const Aeff = geo.A_eff_m2;
  const Lb = design.L_b_H;
  const Rfix = design.R_b_ohm + design.R_arm_ohm;
  const ell = design.rails.ell_m;
  const m_kg = design.armature.mass_kg;
  const F_kin = design.armature.mu_k * design.armature.preload_N;
  const F_stat = design.armature.mu_s * design.armature.preload_N;
  const T_melt_K = rail.melt_K * (opts.railMeltDerate ?? 1);
  const T_soft_K = cfg.RAIL_SOFTENING_FRACTION * T_melt_K;
  const rhoMassCp = rail.density_kg_m3 * rail.cp_J_kg_K;
  const fixedArmature = opts.diagnostic?.fixedArmature === true;
  const prescribed = opts.diagnostic?.prescribedCurrent_A;
  const diagnostic = fixedArmature || prescribed !== undefined;

  const IV = FIXED;
  const II = FIXED + n;
  const IQ = FIXED + 2 * n;
  const N = FIXED + 3 * n;

  const C = new Float64Array(n);
  const L = new Float64Array(n);
  const R = new Float64Array(n);
  const Vf = new Float64Array(n);
  const V0 = new Float64Array(n);
  const trig = new Float64Array(n);
  const crowbar = new Uint8Array(n);
  const capIpeak = new Float64Array(n);
  const capRev = new Float64Array(n);
  const swIpeak = new Float64Array(n);
  const swI2t = new Float64Array(n);
  const swDidt = new Float64Array(n);
  const state = new Int8Array(n);
  const active = new Uint8Array(n);
  const rng = mulberry32(opts.seed ?? 1);
  let C_min = Infinity;
  let L_min = Lb;
  let R_max = Rfix + Rp * ell;
  const y = new Float64Array(N);
  let E_cap0 = 0;
  for (let k = 0; k < n; k++) {
    const mk = mods[k];
    C[k] = mk.C_F;
    L[k] = mk.L_H;
    R[k] = mk.R_ohm;
    Vf[k] = mk.Vf_V;
    V0[k] = mk.V0_V;
    crowbar[k] = mk.crowbar ? 1 : 0;
    capIpeak[k] = mk.capacitor.I_peak_A;
    capRev[k] = mk.capacitor.reversalFraction;
    swIpeak[k] = mk.switch.I_peak_A;
    swI2t[k] = mk.switch.I2t_A2s;
    swDidt[k] = mk.switch.dIdt_A_per_s;
    const jitter = design.trigger_jitter_s > 0 ? design.trigger_jitter_s * gaussian(rng) : 0;
    trig[k] = Math.max(0, mk.trigger_delay_s + jitter);
    y[IV + k] = mk.V0_V;
    E_cap0 += 0.5 * mk.C_F * mk.V0_V * mk.V0_V;
    C_min = Math.min(C_min, mk.C_F);
    L_min = Math.min(L_min, mk.L_H);
    R_max = Math.max(R_max, mk.R_ohm);
  }
  y[TB] = T_bulk_K;

  const T_char = Math.min(2 * Math.PI * Math.sqrt(L_min * C_min), R_max > 0 ? L_min / R_max : Infinity);
  const dt = Math.min(cfg.RAIL_DT_MAX_S, T_char / cfg.STEPS_PER_CHAR_TIME) * (opts.dtScale ?? 1);

  const verify = opts.verifyClosure === true;
  const failures: Failure[] = [];
  let E_fail = 0;
  const addFailure = (f: Failure) => failures.push(f);

  const magneticEnergy = (): number => {
    let I = 0;
    let e = 0;
    for (let k = 0; k < n; k++) {
      if (active[k]) {
        const Ik = y[II + k];
        I += Ik;
        e += 0.5 * L[k] * Ik * Ik;
      }
    }
    return e + 0.5 * (Lb + Lp * y[X]) * I * I;
  };
  const capEnergy = (): number => {
    let e = 0;
    for (let k = 0; k < n; k++) {
      const v = crowbar[k] && y[IV + k] < 0 ? 0 : y[IV + k];
      e += 0.5 * C[k] * v * v;
    }
    return e;
  };
  const ledgerSum = (): number =>
    capEnergy() + magneticEnergy() + 0.5 * m_kg * y[V] * y[V] + y[E_OHM] + y[E_DROP] + y[E_FRIC] + E_fail;

  /** Remove a module from the circuit; the magnetic energy that vanishes goes to `bucket`. */
  const removeModule = (k: number, finalState: number, toFail: boolean): void => {
    const before = magneticEnergy();
    y[II + k] = 0;
    active[k] = 0;
    state[k] = finalState;
    const lost = before - magneticEnergy();
    if (toFail) E_fail += lost;
    else y[E_DROP] += lost;
  };

  // Capacitors charged above their rating fail before the shot starts.
  for (let k = 0; k < n; k++) {
    const rated = mods[k].capacitor.V_rated_V;
    if (V0[k] > rated) {
      E_fail += 0.5 * C[k] * V0[k] * V0[k];
      y[IV + k] = 0;
      state[k] = FAILED;
      addFailure({
        kind: 'capacitor_overvoltage',
        consequence: 'module_lost',
        index: k,
        t_s: 0,
        limit: rated,
        value: V0[k],
        unit: 'V',
        message: `Capacitor ${k + 1} was charged to ${V0[k].toFixed(0)} V, above its ${rated.toFixed(0)} V rating. The module is lost.`,
      });
    }
  }

  const rhs = (_t: number, s: Float64Array, d: Float64Array): void => {
    const x = s[X];
    const v = s[V];
    const Lr = Lb + Lp * x;
    const Rr = Rfix + Rp * x;
    let Isum = 0;
    for (let k = 0; k < n; k++) if (active[k]) Isum += s[II + k];
    const I = prescribed !== undefined ? prescribed : Isum;
    let invSum = 1 / Lr;
    let num = (Rr * Isum + Lp * v * Isum) / Lr;
    for (let k = 0; k < n; k++) {
      if (active[k]) {
        const Vk = s[IV + k];
        const Ve = crowbar[k] && Vk < 0 ? 0 : Vk;
        invSum += 1 / L[k];
        num += (Ve - R[k] * s[II + k] - Vf[k]) / L[k];
      }
    }
    const Vn = num / invSum;
    let ohm = Rr * I * I;
    let drop = 0;
    for (let k = 0; k < n; k++) {
      if (active[k] && prescribed === undefined) {
        const Ik = s[II + k];
        const Vk = s[IV + k];
        const clamped = crowbar[k] && Vk <= 0;
        const Ve = clamped ? 0 : Vk;
        d[II + k] = (Ve - R[k] * Ik - Vn - Vf[k]) / L[k];
        d[IV + k] = clamped ? 0 : -Ik / C[k];
        d[IQ + k] = Ik * Ik;
        ohm += R[k] * Ik * Ik;
        drop += Vf[k] * Ik;
      } else {
        d[II + k] = 0;
        d[IV + k] = 0;
        d[IQ + k] = 0;
      }
    }
    const Fem = 0.5 * Lp * I * I;
    let fric = 0;
    let fricForce = 0;
    let dv = 0;
    let dx = 0;
    if (!fixedArmature) {
      if (v > 0) {
        fric = F_kin;
        fricForce = fric;
        dv = (Fem - fric) / m_kg;
        dx = v;
      } else if (Fem > F_stat) {
        fric = F_kin;
        fricForce = fric;
        dv = (Fem - fric) / m_kg;
      } else {
        // Held at rest: static friction exactly balances the electromagnetic force.
        fricForce = Fem;
      }
    }
    const rho = rail.resistivity20_ohm_m * (1 + rail.alpha_per_K * (s[TB] - T_AMBIENT_K));
    const J = I / Aeff;
    d[X] = dx;
    d[V] = dv;
    d[TB] = (Math.max(rho, 0) * J * J) / rhoMassCp;
    d[E_OHM] = ohm;
    d[E_DROP] = drop;
    d[E_FRIC] = fric * v;
    d[E_RAIL] = Rp * x * I * I;
    d[ACTION] = I * I;
    d[J_EM] = Fem;
    d[J_FRIC] = fricForce;
  };

  const rk = new Rk4(N);
  const k1 = new Float64Array(N);
  const trace = new TraceRecorder(cfg.TRACE_MAX_POINTS);
  const peak = new PeakTracker();
  let t = 0;
  let steps = 0;
  let residualMax = 0;
  let status: 'MUZZLE_EXIT' | 'FIZZLE' | 'ABORTED_BY_FAILURE' = 'FIZZLE';
  let railsDamaged = false;
  let endedByFailure = false;

  const totalCurrent = (): number => {
    let I = 0;
    for (let k = 0; k < n; k++) if (active[k]) I += y[II + k];
    return prescribed !== undefined ? prescribed : I;
  };

  const diverged = (why: string): ShotResult => ({
    ok: false,
    kind: 'SimulationDiverged',
    message: `The shot solver diverged (${why}) at ${(t * 1e3).toFixed(3)} ms. Check for extreme values in the design.`,
    issues: [],
  });

  for (;;) {
    if (steps >= cfg.MAX_STEPS) {
      return {
        ok: false,
        kind: 'StepCapExceeded',
        message: `The shot needs more than ${cfg.MAX_STEPS} steps. Reduce the design's fastest time constant or lengthen its inductance.`,
        issues: [],
      };
    }
    for (let k = 0; k < n; k++) {
      if (state[k] === WAIT && t >= trig[k] - 1e-15) {
        state[k] = ACTIVE;
        active[k] = 1;
      }
    }
    rhs(t, y, k1);
    if (!diagnostic) {
      let changed = false;
      for (let k = 0; k < n; k++) {
        if (active[k] && y[II + k] <= cfg.CURRENT_ZERO_EPS_A && k1[II + k] <= 0) {
          removeModule(k, DONE, false);
          changed = true;
        }
      }
      if (changed) rhs(t, y, k1);
      for (let k = 0; k < n; k++) {
        if (active[k]) {
          const didt = Math.abs(k1[II + k]);
          const lim = swDidt[k];
          if (didt > lim) {
            removeModule(k, FAILED, true);
            addFailure({
              kind: 'switch_didt',
              consequence: 'switch_open',
              index: k,
              t_s: t,
              limit: lim,
              value: didt,
              unit: 'A/s',
              message: `Switch ${k + 1} saw ${(didt / 1e6).toFixed(0)} A/us against a ${(lim / 1e6).toFixed(0)} A/us rating at ${(t * 1e3).toFixed(3)} ms. It failed open.`,
            });
            changed = true;
          }
        }
      }
      if (changed) rhs(t, y, k1);
    }

    let h = dt;
    let anyWait = false;
    for (let k = 0; k < n; k++) {
      if (state[k] === WAIT) {
        anyWait = true;
        const gap = trig[k] - t;
        if (gap > 0 && gap < h) h = Math.max(gap, cfg.MIN_EVENT_STEP_S);
      } else if (active[k] && !diagnostic) {
        const Ik = y[II + k];
        const dI = k1[II + k];
        if (Ik > 0 && dI < 0) {
          const tz = Ik / -dI;
          if (tz < h) h = Math.max(tz, cfg.MIN_EVENT_STEP_S);
        }
      }
    }
    if (y[V] > 0) {
      const tm = (ell - y[X]) / y[V];
      if (tm < h) h = Math.max(tm, cfg.MIN_EVENT_STEP_S);
    }
    if (t + h > cfg.MAX_SHOT_TIME_S) h = Math.max(cfg.MAX_SHOT_TIME_S - t, cfg.MIN_EVENT_STEP_S);

    rk.step(rhs, t, y, h, k1);
    t += h;
    steps++;
    if (!allFinite(y)) return diverged('non-finite state');

    if (!diagnostic) {
      for (let k = 0; k < n; k++) {
        if (active[k] && y[II + k] <= cfg.CURRENT_ZERO_EPS_A) removeModule(k, DONE, false);
        if (crowbar[k] && y[IV + k] < 0) {
          y[E_DROP] += 0.5 * C[k] * y[IV + k] * y[IV + k];
          y[IV + k] = 0;
        }
      }
    }
    if (y[V] < 0) {
      y[E_FRIC] += 0.5 * m_kg * y[V] * y[V];
      y[V] = 0;
    }

    const I = totalCurrent();
    if (!(Math.abs(I) < 1e10)) return diverged('current out of range');
    peak.add(t, I);

    if (!diagnostic) {
      for (let k = 0; k < n; k++) {
        if (!active[k]) continue;
        const Ik = y[II + k];
        const Vk = y[IV + k];
        if (Ik > capIpeak[k]) {
          capacitorLost(k, 'capacitor_peak_current', capIpeak[k], Ik, 'A', 'discharge current');
        } else if (!crowbar[k] && Vk < 0 && -Vk > capRev[k] * V0[k]) {
          capacitorLost(k, 'capacitor_reversal', capRev[k] * V0[k], -Vk, 'V', 'reverse voltage');
        } else if (Ik > swIpeak[k]) {
          switchOpen(k, 'switch_peak_current', swIpeak[k], Ik, 'A', 'peak current');
        } else if (y[IQ + k] > swI2t[k]) {
          switchOpen(k, 'switch_i2t', swI2t[k], y[IQ + k], 'A^2 s', 'I^2 t');
        }
      }
      if (verify) residualMax = Math.max(residualMax, closureResidual(ledgerSum(), E_cap0));
    }

    trace.push(t, I, y[V], y[X]);

    if (y[TB] >= T_soft_K) railsDamaged = true;
    const fsep = (MU0 * I * I) / (2 * Math.PI * geo.d_m);
    if (y[TB] >= T_melt_K) {
      addFailure({
        kind: 'rail_melt',
        consequence: 'shot_ended',
        index: -1,
        t_s: t,
        limit: T_melt_K,
        value: y[TB],
        unit: 'K',
        message: `The breech end of the rails reached ${y[TB].toFixed(0)} K, past the ${T_melt_K.toFixed(0)} K melting limit, at ${(t * 1e3).toFixed(3)} ms. The shot ended and the rails are lost.`,
      });
      endedByFailure = true;
    }
    if (fsep > design.mount.f_sep_max_N_per_m) {
      addFailure({
        kind: 'mount_separation_load',
        consequence: 'mount_destroyed',
        index: -1,
        t_s: t,
        limit: design.mount.f_sep_max_N_per_m,
        value: fsep,
        unit: 'N/m',
        message: `The rails pushed apart with ${(fsep / 1e3).toFixed(0)} kN/m against a ${(design.mount.f_sep_max_N_per_m / 1e3).toFixed(0)} kN/m mount rating at ${(t * 1e3).toFixed(3)} ms. The mount failed and the launcher is disabled.`,
      });
      endedByFailure = true;
    }
    if (endedByFailure) {
      status = 'ABORTED_BY_FAILURE';
      break;
    }
    if (y[X] >= ell - 1e-12) {
      status = 'MUZZLE_EXIT';
      break;
    }
    if (t >= cfg.MAX_SHOT_TIME_S - 1e-15) {
      status = 'FIZZLE';
      break;
    }
    if (
      t >= cfg.FIZZLE_MIN_TIME_S &&
      !anyWait &&
      Math.abs(I) <= cfg.FIZZLE_CURRENT_FRACTION * peak.peak &&
      y[V] < cfg.FIZZLE_SPEED_M_S
    ) {
      status = 'FIZZLE';
      break;
    }
  }

  function capacitorLost(k: number, kind: Failure['kind'], limit: number, value: number, unit: string, what: string): void {
    E_fail += 0.5 * C[k] * y[IV + k] * y[IV + k];
    y[IV + k] = 0;
    removeModule(k, FAILED, true);
    addFailure({
      kind,
      consequence: 'module_lost',
      index: k,
      t_s: t,
      limit,
      value,
      unit,
      message: `Capacitor ${k + 1} reached ${value.toPrecision(4)} ${unit} ${what} against a ${limit.toPrecision(4)} ${unit} limit at ${(t * 1e3).toFixed(3)} ms. The module is lost and stays discharged until replaced.`,
    });
  }

  function switchOpen(k: number, kind: Failure['kind'], limit: number, value: number, unit: string, what: string): void {
    removeModule(k, FAILED, true);
    addFailure({
      kind,
      consequence: 'switch_open',
      index: k,
      t_s: t,
      limit,
      value,
      unit,
      message: `Switch ${k + 1} reached ${value.toPrecision(4)} ${unit} ${what} against a ${limit.toPrecision(4)} ${unit} rating at ${(t * 1e3).toFixed(3)} ms. It failed open and the bank keeps its remaining charge.`,
    });
  }

  const Iend = totalCurrent();
  const E_mag = magneticEnergy();
  const E_cap = capEnergy();
  const KE = 0.5 * m_kg * y[V] * y[V];
  const residualEnd = diagnostic ? 0 : closureResidual(ledgerSum(), E_cap0);
  const exited = status === 'MUZZLE_EXIT';
  const peakCurrent = Math.max(peak.peak, Math.abs(Iend));
  const Vend: number[] = [];
  for (let k = 0; k < n; k++) Vend.push(y[IV + k]);
  if (!allFinite(y)) return diverged('non-finite result');

  return {
    ok: true,
    kind: 'railgun',
    status,
    physicsVersion,
    muzzleSpeed_m_s: exited ? y[V] : 0,
    muzzleEnergy_J: exited ? KE : 0,
    muzzleMomentum_Ns: exited ? m_kg * y[V] : 0,
    recoilImpulse_Ns: exited ? m_kg * y[V] : 0,
    efficiency: exited && E_cap0 > 0 ? KE / E_cap0 : 0,
    t_end_s: t,
    I_peak_A: peakCurrent,
    I_peak_t_s: peak.peakT,
    actionIntegral_A2s: y[ACTION],
    peakSeparationLoad_N_per_m: (MU0 * peakCurrent * peakCurrent) / (2 * Math.PI * geo.d_m),
    T_breech_end_K: y[TB],
    railsDamaged,
    railHeat_J: y[E_RAIL],
    coilTemps_K: [],
    V_end_V: Vend,
    impulseEm_Ns: y[J_EM],
    impulseFric_Ns: y[J_FRIC],
    steps,
    dt_s: dt,
    ledger: {
      E_cap0_J: E_cap0,
      KE0_J: 0,
      E_cap_end_J: E_cap,
      E_mag_end_J: E_mag,
      KE_J: KE,
      E_ohm_J: y[E_OHM],
      E_drop_J: y[E_DROP],
      E_fric_J: y[E_FRIC],
      E_fail_J: E_fail,
      E_muzzle_dump_J: exited ? E_mag : 0,
      residual_max_rel: Math.max(residualMax, residualEnd),
      residual_end_rel: residualEnd,
    },
    failures,
    trace: trace.finish(t, Iend, y[V], y[X]),
  };
}
