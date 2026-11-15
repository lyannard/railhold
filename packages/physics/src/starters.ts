import type { RailgunDesign, RailModule } from './railgun.ts';
import type { CoilgunDesign, CoilStageDesign } from './coilgun.ts';

const RAIL_MODULE: RailModule = {
  C_F: 5.5e-3,
  V0_V: 4000,
  R_ohm: 2e-3,
  L_H: 3e-6,
  Vf_V: 2,
  trigger_delay_s: 0,
  crowbar: true,
  capacitor: { V_rated_V: 5000, reversalFraction: 0.3, I_peak_A: 400e3 },
  switch: { I_peak_A: 350e3, I2t_A2s: 2e9, dIdt_A_per_s: 5e10 },
};

/** Starter Railgun: two 5.5 mF modules at 4 kV with crowbar diodes into 2 m copper rails. */
export const STARTER_RAILGUN: RailgunDesign = {
  rails: { w_m: 0.02, h_m: 0.02, s_m: 0.02, ell_m: 2, material: 'copper' },
  L_b_H: 1e-6,
  R_b_ohm: 1e-4,
  R_arm_ohm: 2e-4,
  armature: { mass_kg: 0.025, mu_k: 0.1, mu_s: 0.15, preload_N: 2000 },
  projectile: { material: 'aluminum6061', frontalArea_m2: 1.13e-4, length_m: 0.08 },
  mount: { f_sep_max_N_per_m: 600e3 },
  trigger_jitter_s: 0,
  modules: [RAIL_MODULE, RAIL_MODULE],
};

const COIL_STAGE: CoilStageDesign = {
  z_m: 0,
  turns: 40,
  awg: 14,
  length_m: 0.06,
  innerRadius_m: 0.011,
  C_F: 1.0e-3,
  V0_V: 1500,
  R_series_ohm: 0.02,
  L_series_H: 2e-6,
  Vf_V: 1.5,
  freewheel: true,
  trigger: { kind: 'delay', t_s: 0 },
  capacitor: { V_rated_V: 2000, reversalFraction: 0.3, I_peak_A: 30e3 },
  switch: { I_peak_A: 25e3, I2t_A2s: 5e6, dIdt_A_per_s: 2e9 },
  J_max_A_m2: 1e10,
};

const COIL_STAGE_SPACING_M = 0.05;
const COIL_TRIGGER_OFFSET_M = -0.05;

/** Starter Coilgun: six stages of 40 turns, 1 mF at 1.5 kV each, 30 mm iron slug. */
export const STARTER_COILGUN: CoilgunDesign = {
  slug: { length_m: 0.03, diameter_m: 0.015, material: 'iron' },
  x0_m: -0.03,
  v0_m_s: 0,
  x_exit_m: 5 * COIL_STAGE_SPACING_M + COIL_STAGE_SPACING_M,
  friction_kinetic_N: 0.1,
  friction_static_N: 0.15,
  trigger_jitter_s: 0,
  stages: Array.from({ length: 6 }, (_, i): CoilStageDesign => ({
    ...COIL_STAGE,
    z_m: i * COIL_STAGE_SPACING_M,
    trigger: i === 0 ? { kind: 'delay', t_s: 0 } : { kind: 'position', offset_m: COIL_TRIGGER_OFFSET_M },
  })),
};
