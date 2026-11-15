import {
  buildBank,
  MATERIALS,
  slugMass_kg,
  windingGeometry,
  type CoilgunDesign,
  type CoilStageDesign,
  type ProjectileSpec,
  type RailgunDesign,
  type RailModule,
} from '@railhold/physics';
import {
  BANK_WIRING,
  BREECH,
  CAPACITORS,
  COOLING,
  INDUCTOR,
  MATERIAL_COST_PER_KG,
  MOUNTS,
  PAYLOADS,
  SWITCHES,
  TRIGGERS,
  WIRE_COST_PER_KG,
  unlockKey,
} from './catalog.ts';

export const BLUEPRINT_SCHEMA_VERSION = 2;

export interface BankSpec {
  capacitor: string;
  series: number;
  parallel: number;
  /** Charge voltage of the whole bank, V. */
  charge_V: number;
}

export interface RailBankSpec extends BankSpec {
  switch: string;
  inductor_uH: number;
  trigger_delay_us: number;
  crowbar: boolean;
}

export interface RailgunBlueprint {
  schema_version: number;
  kind: 'railgun';
  name: string;
  rails: { material: 'copper' | 'aluminum6061'; w_mm: number; h_mm: number; s_mm: number; length_mm: number };
  armature: { material: 'copper' | 'aluminum6061'; diameter_mm: number; length_mm: number };
  payload: string;
  banks: RailBankSpec[];
  mount: string;
  cooling: string;
  trigger: 'electric' | 'fiber';
}

export interface CoilStageSpec extends BankSpec {
  turns: number;
  awg: number;
  length_mm: number;
  switch: string;
  /** Slug centre trigger position relative to the coil centre, mm. Ignored for stage 1, which fires at once. */
  trigger_offset_mm: number;
  freewheel: boolean;
}

export interface CoilgunBlueprint {
  schema_version: number;
  kind: 'coilgun';
  name: string;
  slug: { length_mm: number; diameter_mm: number };
  tube_bore_mm: number;
  /** Distance of the slug centre in front of the first coil centre at rest, mm (negative side). */
  start_offset_mm: number;
  spacing_mm: number;
  stages: CoilStageSpec[];
  cooling: string;
  trigger: 'electric' | 'fiber';
}

export type Blueprint = RailgunBlueprint | CoilgunBlueprint;

export interface FieldIssue {
  readonly field: string;
  readonly message: string;
}

export const LIMITS = {
  name: { min: 1, max: 40 },
  railW_mm: { min: 4, max: 80 },
  railH_mm: { min: 4, max: 80 },
  railS_mm: { min: 6, max: 120 },
  railLength_mm: { min: 300, max: 6000 },
  armatureD_mm: { min: 4, max: 60 },
  armatureL_mm: { min: 10, max: 300 },
  series: { min: 1, max: 6 },
  parallel: { min: 1, max: 24 },
  inductor_uH: { min: 0, max: INDUCTOR.maxL_H * 1e6 },
  delay_us: { min: 0, max: 2000 },
  banks: { min: 1, max: 4 },
  turns: { min: 5, max: 400 },
  awg: { min: 6, max: 30 },
  coilLength_mm: { min: 10, max: 200 },
  slugL_mm: { min: 10, max: 200 },
  slugD_mm: { min: 4, max: 60 },
  tubeBore_mm: { min: 6, max: 90 },
  startOffset_mm: { min: 0, max: 300 },
  spacing_mm: { min: 20, max: 400 },
  triggerOffset_mm: { min: -200, max: 200 },
  stages: { min: 1, max: 10 },
  chargeOverRated: 1.25,
} as const;

/** Pulsed current density rating of the winding, A/m^2 (game rule, documented in PHYSICS.md). */
export const COIL_J_MAX_A_M2 = 1e10;
/** Clearance the coil winding keeps from the slug tube, m. Windings start at the tube bore radius. */
export const COIL_STAGE_FRICTION = { mu_k_N: 0.1, mu_s_N: 0.15 } as const;

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

class Checker {
  readonly issues: FieldIssue[] = [];
  num(o: Rec, key: string, path: string, min: number, max: number, integer = false): number {
    const v = o[key];
    const f = `${path}${key}`;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.issues.push({ field: f, message: `${label(key)} must be a number.` });
      return min;
    }
    if (integer && !Number.isInteger(v)) this.issues.push({ field: f, message: `${label(key)} must be a whole number.` });
    if (v < min || v > max) this.issues.push({ field: f, message: `${label(key)} must be between ${min} and ${max}.` });
    return v;
  }
  oneOf<T extends string>(o: Rec, key: string, path: string, allowed: readonly T[]): T {
    const v = o[key];
    if (typeof v !== 'string' || !allowed.includes(v as T)) {
      this.issues.push({ field: `${path}${key}`, message: `${label(key)} must be one of: ${allowed.join(', ')}.` });
      return allowed[0];
    }
    return v as T;
  }
  bool(o: Rec, key: string, path: string): boolean {
    if (typeof o[key] !== 'boolean') this.issues.push({ field: `${path}${key}`, message: `${label(key)} must be true or false.` });
    return o[key] === true;
  }
  obj(o: Rec, key: string, path: string): Rec {
    const v = o[key];
    if (!isRec(v)) {
      this.issues.push({ field: `${path}${key}`, message: `${label(key)} is missing.` });
      return {};
    }
    return v;
  }
}

function label(key: string): string {
  const t = key.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function checkBank(c: Checker, o: Rec, path: string): BankSpec {
  const capacitor = c.oneOf(o, 'capacitor', path, Object.keys(CAPACITORS));
  const series = c.num(o, 'series', path, LIMITS.series.min, LIMITS.series.max, true);
  const parallel = c.num(o, 'parallel', path, LIMITS.parallel.min, LIMITS.parallel.max, true);
  const part = CAPACITORS[capacitor];
  const max = part.V_rated_V * series * LIMITS.chargeOverRated;
  const charge_V = c.num(o, 'charge_V', path, 0, max);
  return { capacitor, series, parallel, charge_V };
}

/** Validate unknown input as a current-version blueprint. Returns the typed value or all issues. */
export function validateBlueprint(input: unknown): { ok: true; value: Blueprint } | { ok: false; issues: FieldIssue[] } {
  const c = new Checker();
  if (!isRec(input)) return { ok: false, issues: [{ field: '', message: 'A blueprint must be an object.' }] };
  const kind = c.oneOf(input, 'kind', '', ['railgun', 'coilgun'] as const);
  const nameRaw = input.name;
  if (typeof nameRaw !== 'string' || nameRaw.trim().length < LIMITS.name.min || nameRaw.length > LIMITS.name.max) {
    c.issues.push({ field: 'name', message: `Name must be ${LIMITS.name.min} to ${LIMITS.name.max} characters.` });
  }
  const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
  const cooling = c.oneOf(input, 'cooling', '', Object.keys(COOLING));
  const trigger = c.oneOf(input, 'trigger', '', ['electric', 'fiber'] as const);
  const schema_version = c.num(input, 'schema_version', '', BLUEPRINT_SCHEMA_VERSION, BLUEPRINT_SCHEMA_VERSION, true);
  if (kind === 'railgun') {
    const r = c.obj(input, 'rails', '');
    const a = c.obj(input, 'armature', '');
    const rails = {
      material: c.oneOf(r, 'material', 'rails.', ['copper', 'aluminum6061'] as const),
      w_mm: c.num(r, 'w_mm', 'rails.', LIMITS.railW_mm.min, LIMITS.railW_mm.max),
      h_mm: c.num(r, 'h_mm', 'rails.', LIMITS.railH_mm.min, LIMITS.railH_mm.max),
      s_mm: c.num(r, 's_mm', 'rails.', LIMITS.railS_mm.min, LIMITS.railS_mm.max),
      length_mm: c.num(r, 'length_mm', 'rails.', LIMITS.railLength_mm.min, LIMITS.railLength_mm.max),
    };
    const armature = {
      material: c.oneOf(a, 'material', 'armature.', ['copper', 'aluminum6061'] as const),
      diameter_mm: c.num(a, 'diameter_mm', 'armature.', LIMITS.armatureD_mm.min, LIMITS.armatureD_mm.max),
      length_mm: c.num(a, 'length_mm', 'armature.', LIMITS.armatureL_mm.min, LIMITS.armatureL_mm.max),
    };
    if (armature.diameter_mm >= Math.min(rails.s_mm, rails.h_mm)) {
      c.issues.push({ field: 'armature.diameter_mm', message: 'Armature must be narrower than the rail gap and the rail height.' });
    }
    const payload = c.oneOf(input, 'payload', '', Object.keys(PAYLOADS));
    const mount = c.oneOf(input, 'mount', '', Object.keys(MOUNTS));
    const banksRaw = input.banks;
    const banks: RailBankSpec[] = [];
    if (!Array.isArray(banksRaw) || banksRaw.length < LIMITS.banks.min || banksRaw.length > LIMITS.banks.max) {
      c.issues.push({ field: 'banks', message: `A railgun needs ${LIMITS.banks.min} to ${LIMITS.banks.max} capacitor banks.` });
    } else {
      banksRaw.forEach((b, i) => {
        const p = `banks[${i}].`;
        if (!isRec(b)) {
          c.issues.push({ field: `banks[${i}]`, message: 'Bank is missing.' });
          return;
        }
        banks.push({
          ...checkBank(c, b, p),
          switch: c.oneOf(b, 'switch', p, Object.keys(SWITCHES)),
          inductor_uH: c.num(b, 'inductor_uH', p, LIMITS.inductor_uH.min, LIMITS.inductor_uH.max),
          trigger_delay_us: c.num(b, 'trigger_delay_us', p, LIMITS.delay_us.min, LIMITS.delay_us.max),
          crowbar: c.bool(b, 'crowbar', p),
        });
      });
    }
    if (c.issues.length > 0) return { ok: false, issues: c.issues };
    return { ok: true, value: { schema_version, kind: 'railgun', name, rails, armature, payload, banks, mount, cooling, trigger } };
  }
  const s = c.obj(input, 'slug', '');
  const slug = {
    length_mm: c.num(s, 'length_mm', 'slug.', LIMITS.slugL_mm.min, LIMITS.slugL_mm.max),
    diameter_mm: c.num(s, 'diameter_mm', 'slug.', LIMITS.slugD_mm.min, LIMITS.slugD_mm.max),
  };
  const tube_bore_mm = c.num(input, 'tube_bore_mm', '', LIMITS.tubeBore_mm.min, LIMITS.tubeBore_mm.max);
  const start_offset_mm = c.num(input, 'start_offset_mm', '', LIMITS.startOffset_mm.min, LIMITS.startOffset_mm.max);
  const spacing_mm = c.num(input, 'spacing_mm', '', LIMITS.spacing_mm.min, LIMITS.spacing_mm.max);
  if (slug.length_mm < slug.diameter_mm) c.issues.push({ field: 'slug.length_mm', message: 'Slug must be at least as long as it is wide.' });
  if (tube_bore_mm <= slug.diameter_mm) c.issues.push({ field: 'tube_bore_mm', message: 'Tube bore must be wider than the slug.' });
  const stagesRaw = input.stages;
  const stages: CoilStageSpec[] = [];
  if (!Array.isArray(stagesRaw) || stagesRaw.length < LIMITS.stages.min || stagesRaw.length > LIMITS.stages.max) {
    c.issues.push({ field: 'stages', message: `A coilgun needs ${LIMITS.stages.min} to ${LIMITS.stages.max} stages.` });
  } else {
    stagesRaw.forEach((st, i) => {
      const p = `stages[${i}].`;
      if (!isRec(st)) {
        c.issues.push({ field: `stages[${i}]`, message: 'Stage is missing.' });
        return;
      }
      stages.push({
        ...checkBank(c, st, p),
        turns: c.num(st, 'turns', p, LIMITS.turns.min, LIMITS.turns.max, true),
        awg: c.num(st, 'awg', p, LIMITS.awg.min, LIMITS.awg.max, true),
        length_mm: c.num(st, 'length_mm', p, LIMITS.coilLength_mm.min, LIMITS.coilLength_mm.max),
        switch: c.oneOf(st, 'switch', p, Object.keys(SWITCHES)),
        trigger_offset_mm: c.num(st, 'trigger_offset_mm', p, LIMITS.triggerOffset_mm.min, LIMITS.triggerOffset_mm.max),
        freewheel: c.bool(st, 'freewheel', p),
      });
    });
  }
  if (c.issues.length > 0) return { ok: false, issues: c.issues };
  return { ok: true, value: { schema_version, kind: 'coilgun', name, slug, tube_bore_mm, start_offset_mm, spacing_mm, stages, cooling, trigger } };
}

/** Everything the editor and server need to know about a blueprint's hardware. */
export interface Analysis {
  readonly blueprint: Blueprint;
  readonly design: RailgunDesign | CoilgunDesign;
  readonly projectile: ProjectileSpec;
  /** Mass of the object that leaves the muzzle, kg. */
  readonly projectileMass_kg: number;
  /** Total energy stored at the chosen charge voltages, J. */
  readonly bankEnergy_J: number;
  readonly launcherMass_kg: number;
  readonly cost: number;
  readonly emiImmune: boolean;
  readonly coolingTau_s: number;
  /** Unlock keys of every part used. */
  readonly partKeys: string[];
  /** Model-range issues found while converting (for example rails too close together). */
  readonly modelIssues: FieldIssue[];
}

const MM = 1e-3;

function bankValues(spec: BankSpec) {
  const part = CAPACITORS[spec.capacitor];
  const bank = buildBank(part, spec.series, spec.parallel);
  return { part, bank, I_peak_A: part.I_peak_A * spec.parallel };
}

/** Convert a validated blueprint into the physics solver's design and totals. */
export function analyzeBlueprint(bp: Blueprint): Analysis {
  const keys = new Set<string>([unlockKey('cooling', bp.cooling), unlockKey('trigger', bp.trigger)]);
  const trig = TRIGGERS[bp.trigger];
  const cool = COOLING[bp.cooling];
  let mass = cool.mass_kg;
  let cost = cool.cost + trig.cost;
  let energy = 0;

  if (bp.kind === 'railgun') {
    const mount = MOUNTS[bp.mount];
    keys.add(unlockKey('mount', bp.mount));
    keys.add(unlockKey('payload', bp.payload));
    mass += mount.mass_kg;
    cost += mount.cost;
    const armMat = MATERIALS[bp.armature.material];
    const armD = bp.armature.diameter_mm * MM;
    const armArea = (Math.PI * armD * armD) / 4;
    const armMass = armMat.density_kg_m3 * armArea * bp.armature.length_mm * MM;
    const payload = PAYLOADS[bp.payload];
    let flyMat: ProjectileSpec['material'] = bp.armature.material;
    let flyMass = armMass;
    let flyArea = armArea;
    let flyLen = bp.armature.length_mm * MM;
    let accelMass = armMass;
    mass += armMass;
    cost += armMass * MATERIAL_COST_PER_KG[bp.armature.material];
    if (payload.material !== 'none') {
      const dartD = 0.7 * armD;
      flyArea = (Math.PI * dartD * dartD) / 4;
      flyLen = 0.9 * bp.armature.length_mm * MM;
      flyMass = MATERIALS[payload.material].density_kg_m3 * flyArea * flyLen;
      flyMat = payload.material;
      accelMass += flyMass;
      mass += flyMass;
      cost += flyMass * MATERIAL_COST_PER_KG[payload.material];
    }
    const modules: RailModule[] = bp.banks.map((b) => {
      const { part, bank, I_peak_A } = bankValues(b);
      const sw = SWITCHES[b.switch];
      keys.add(unlockKey('capacitor', b.capacitor));
      keys.add(unlockKey('switch', b.switch));
      const L_pfn = b.inductor_uH * 1e-6;
      mass += bank.mass_kg + sw.mass_kg + b.inductor_uH * INDUCTOR.mass_per_uH_kg;
      cost += bank.cost + sw.cost + b.inductor_uH * INDUCTOR.cost_per_uH;
      energy += 0.5 * bank.C_F * b.charge_V * b.charge_V;
      return {
        C_F: bank.C_F,
        V0_V: b.charge_V,
        R_ohm: bank.ESR_ohm + BANK_WIRING.R_ohm + INDUCTOR.R_per_H * L_pfn,
        L_H: bank.ESL_H + BANK_WIRING.L_H + L_pfn,
        Vf_V: sw.Vf_V,
        trigger_delay_s: b.trigger_delay_us * 1e-6,
        crowbar: b.crowbar,
        capacitor: { V_rated_V: bank.V_rated_V, reversalFraction: part.reversalFraction, I_peak_A },
        switch: { I_peak_A: sw.I_peak_A, I2t_A2s: sw.I2t_A2s, dIdt_A_per_s: sw.dIdt_A_per_s },
      };
    });
    const railMat = MATERIALS[bp.rails.material];
    const railMass = 2 * railMat.density_kg_m3 * bp.rails.w_mm * MM * bp.rails.h_mm * MM * bp.rails.length_mm * MM;
    mass += railMass;
    cost += railMass * MATERIAL_COST_PER_KG[bp.rails.material];
    const projectile: ProjectileSpec = { material: flyMat, frontalArea_m2: flyArea, length_m: flyLen };
    const design: RailgunDesign = {
      rails: { w_m: bp.rails.w_mm * MM, h_m: bp.rails.h_mm * MM, s_m: bp.rails.s_mm * MM, ell_m: bp.rails.length_mm * MM, material: bp.rails.material },
      L_b_H: BREECH.L_H,
      R_b_ohm: BREECH.R_ohm,
      R_arm_ohm: BREECH.R_arm_ohm,
      armature: { mass_kg: accelMass, mu_k: BREECH.mu_k, mu_s: BREECH.mu_s, preload_N: BREECH.preload_N },
      projectile,
      mount: { f_sep_max_N_per_m: mount.f_sep_max_N_per_m },
      trigger_jitter_s: 0,
      modules,
    };
    return {
      blueprint: bp,
      design,
      projectile,
      projectileMass_kg: flyMass,
      bankEnergy_J: energy,
      launcherMass_kg: mass,
      cost,
      emiImmune: trig.emiImmune,
      coolingTau_s: cool.tau_s,
      partKeys: [...keys],
      modelIssues: [],
    };
  }

  const slugSpec = { length_m: bp.slug.length_mm * MM, diameter_m: bp.slug.diameter_mm * MM, material: 'iron' as const };
  const slugMass = slugMass_kg(slugSpec);
  mass += slugMass;
  cost += slugMass * MATERIAL_COST_PER_KG.iron;
  const spacing = bp.spacing_mm * MM;
  const stages: CoilStageDesign[] = bp.stages.map((st, j) => {
    const { part, bank, I_peak_A } = bankValues(st);
    const sw = SWITCHES[st.switch];
    keys.add(unlockKey('capacitor', st.capacitor));
    keys.add(unlockKey('switch', st.switch));
    const innerRadius_m = (bp.tube_bore_mm * MM) / 2;
    const wind = windingGeometry(st.turns, st.awg, st.length_mm * MM, innerRadius_m);
    const wireMass = MATERIALS.copper.density_kg_m3 * wind.wireArea_m2 * wind.wireLength_m;
    mass += bank.mass_kg + sw.mass_kg + wireMass;
    cost += bank.cost + sw.cost + wireMass * WIRE_COST_PER_KG;
    energy += 0.5 * bank.C_F * st.charge_V * st.charge_V;
    return {
      z_m: j * spacing,
      turns: st.turns,
      awg: st.awg,
      length_m: st.length_mm * MM,
      innerRadius_m,
      C_F: bank.C_F,
      V0_V: st.charge_V,
      R_series_ohm: bank.ESR_ohm + BANK_WIRING.R_ohm,
      L_series_H: bank.ESL_H + BANK_WIRING.L_H,
      Vf_V: sw.Vf_V,
      freewheel: st.freewheel,
      trigger: j === 0 ? { kind: 'delay', t_s: 0 } : { kind: 'position', offset_m: st.trigger_offset_mm * MM },
      capacitor: { V_rated_V: bank.V_rated_V, reversalFraction: part.reversalFraction, I_peak_A },
      switch: { I_peak_A: sw.I_peak_A, I2t_A2s: sw.I2t_A2s, dIdt_A_per_s: sw.dIdt_A_per_s },
      J_max_A_m2: COIL_J_MAX_A_M2,
    };
  });
  const n = stages.length;
  const design: CoilgunDesign = {
    slug: slugSpec,
    x0_m: -bp.start_offset_mm * MM,
    v0_m_s: 0,
    x_exit_m: (n - 1) * spacing + spacing,
    friction_kinetic_N: COIL_STAGE_FRICTION.mu_k_N,
    friction_static_N: COIL_STAGE_FRICTION.mu_s_N,
    trigger_jitter_s: 0,
    stages,
  };
  const area = (Math.PI * slugSpec.diameter_m * slugSpec.diameter_m) / 4;
  const projectile: ProjectileSpec = { material: 'iron', frontalArea_m2: area, length_m: slugSpec.length_m };
  return {
    blueprint: bp,
    design,
    projectile,
    projectileMass_kg: slugMass,
    bankEnergy_J: energy,
    launcherMass_kg: mass,
    cost,
    emiImmune: trig.emiImmune,
    coolingTau_s: cool.tau_s,
    partKeys: [...keys],
    modelIssues: [],
  };
}

/** Parts the account has not unlocked yet. */
export function lockedParts(a: Analysis, unlocked: readonly string[]): string[] {
  return a.partKeys.filter((k) => !unlocked.includes(k));
}

export function bankSummary(spec: BankSpec) {
  const { bank } = bankValues(spec);
  return { ...bank, energyAtCharge_J: 0.5 * bank.C_F * spec.charge_V * spec.charge_V };
}

// ---------------------------------------------------------------- starters

export function starterRailgun(): RailgunBlueprint {
  const bank = (): RailBankSpec => ({ capacitor: 'C1', series: 2, parallel: 4, charge_V: 4000, switch: 'SW350', inductor_uH: 2.5, trigger_delay_us: 0, crowbar: true });
  return {
    schema_version: BLUEPRINT_SCHEMA_VERSION,
    kind: 'railgun',
    name: 'Starter Railgun',
    rails: { material: 'copper', w_mm: 20, h_mm: 20, s_mm: 20, length_mm: 2000 },
    armature: { material: 'aluminum6061', diameter_mm: 12, length_mm: 82 },
    payload: 'none',
    banks: [bank(), bank()],
    mount: 'M1',
    cooling: 'K1',
    trigger: 'electric',
  };
}

export function starterCoilgun(): CoilgunBlueprint {
  const stage = (): CoilStageSpec => ({ capacitor: 'C0', series: 2, parallel: 1, charge_V: 1500, switch: 'SW25', turns: 40, awg: 14, length_mm: 60, trigger_offset_mm: -50, freewheel: true });
  return {
    schema_version: BLUEPRINT_SCHEMA_VERSION,
    kind: 'coilgun',
    name: 'Starter Coilgun',
    slug: { length_mm: 30, diameter_mm: 15 },
    tube_bore_mm: 22,
    start_offset_mm: 30,
    spacing_mm: 50,
    stages: Array.from({ length: 6 }, stage),
    cooling: 'K1',
    trigger: 'electric',
  };
}

// -------------------------------------------------------------- migrations

/**
 * Bring a stored blueprint up to the current schema version. Version 1 stored the rail bank
 * charge as a fraction of the rated voltage (`charge_frac`) and had no payload field.
 */
export function migrateBlueprint(input: unknown): unknown {
  if (!isRec(input)) return input;
  let bp: Rec = { ...input };
  const version = typeof bp.schema_version === 'number' ? bp.schema_version : 1;
  if (version < 2) {
    if (bp.kind === 'railgun') {
      bp.payload = typeof bp.payload === 'string' ? bp.payload : 'none';
      if (Array.isArray(bp.banks)) {
        bp.banks = bp.banks.map((b) => {
          if (!isRec(b)) return b;
          const next: Rec = { ...b };
          if (typeof next.charge_frac === 'number' && typeof next.charge_V !== 'number') {
            const part = typeof next.capacitor === 'string' ? CAPACITORS[next.capacitor] : undefined;
            const s = typeof next.series === 'number' ? next.series : 1;
            if (part) next.charge_V = Math.round(next.charge_frac * part.V_rated_V * s);
          }
          delete next.charge_frac;
          return next;
        });
      }
    }
    bp = { ...bp, schema_version: 2 };
  }
  return bp;
}
