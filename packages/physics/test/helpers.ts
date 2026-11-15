import assert from 'node:assert/strict';
import {
  mulberry32,
  STARTER_COILGUN,
  STARTER_RAILGUN,
  type CoilgunDesign,
  type CoilStageDesign,
  type RailgunDesign,
  type RailModule,
  type ShotSummary,
  type ShotResult,
} from '../src/index.ts';

export function expectOk(r: ShotResult): ShotSummary {
  assert.equal(r.ok, true, r.ok ? '' : `solver returned ${r.kind}: ${r.message}`);
  return r as ShotSummary;
}

export function relErr(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
}

/** Ratings that no test design can reach, so only the physics is exercised. */
export const UNLIMITED = {
  capacitor: { V_rated_V: 1e6, reversalFraction: 10, I_peak_A: 1e9 },
  switch: { I_peak_A: 1e9, I2t_A2s: 1e15, dIdt_A_per_s: 1e15 },
} as const;

function pick(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

/** A random railgun with 1 to 4 modules. Ratings are unlimited so the solver runs to completion. */
export function randomRailgun(seed: number): RailgunDesign {
  const rng = mulberry32(seed);
  const n = 1 + Math.floor(rng() * 4);
  const modules: RailModule[] = [];
  for (let k = 0; k < n; k++) {
    modules.push({
      C_F: pick(rng, 1e-3, 6e-3),
      V0_V: pick(rng, 2500, 4500),
      R_ohm: pick(rng, 1e-3, 8e-3),
      L_H: pick(rng, 1.5e-6, 5e-6),
      Vf_V: pick(rng, 0, 3),
      trigger_delay_s: k === 0 ? 0 : rng() < 0.5 ? 0 : pick(rng, 0, 3e-4),
      crowbar: rng() < 0.75,
      ...UNLIMITED,
    });
  }
  const w = pick(rng, 0.01, 0.04);
  const h = pick(rng, 0.01, 0.04);
  return {
    ...STARTER_RAILGUN,
    rails: { w_m: w, h_m: h, s_m: pick(rng, 0.015, 0.05), ell_m: pick(rng, 0.8, 2.5), material: rng() < 0.5 ? 'copper' : 'aluminum6061' },
    L_b_H: pick(rng, 0.5e-6, 3e-6),
    armature: { mass_kg: pick(rng, 0.01, 0.05), mu_k: 0.1, mu_s: 0.15, preload_N: pick(rng, 500, 3000) },
    mount: { f_sep_max_N_per_m: 1e12 },
    trigger_jitter_s: 0,
    modules,
  };
}

/** A random coilgun with 1 to 6 stages spaced 6 cm apart. */
export function randomCoilgun(seed: number): CoilgunDesign {
  const rng = mulberry32(seed);
  const n = 1 + Math.floor(rng() * 6);
  const spacing = 0.06;
  const stages: CoilStageDesign[] = [];
  const base = STARTER_COILGUN.stages[0];
  for (let j = 0; j < n; j++) {
    stages.push({
      ...base,
      z_m: j * spacing,
      turns: 20 + Math.floor(rng() * 60),
      awg: 12 + Math.floor(rng() * 4),
      C_F: pick(rng, 0.4e-3, 2e-3),
      V0_V: pick(rng, 400, 1800),
      R_series_ohm: pick(rng, 0.005, 0.05),
      Vf_V: pick(rng, 0, 2),
      freewheel: rng() < 0.6,
      trigger: j === 0 ? { kind: 'delay', t_s: 0 } : { kind: 'position', offset_m: pick(rng, -0.05, -0.01) },
      ...UNLIMITED,
      J_max_A_m2: 1e15,
    });
  }
  return {
    ...STARTER_COILGUN,
    x_exit_m: (n - 1) * spacing + spacing,
    stages,
  };
}
