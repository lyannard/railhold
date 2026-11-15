import type { ShotTrace } from './trace.ts';

export type FailureKind =
  | 'capacitor_overvoltage'
  | 'capacitor_peak_current'
  | 'capacitor_reversal'
  | 'switch_peak_current'
  | 'switch_i2t'
  | 'switch_didt'
  | 'coil_overtemperature'
  | 'coil_current_density'
  | 'rail_melt'
  | 'mount_separation_load';

export type FailureConsequence = 'module_lost' | 'switch_open' | 'stage_lost' | 'shot_ended' | 'mount_destroyed';

/** A rating that was exceeded, with the exact numbers (brief section 5.2). */
export interface Failure {
  readonly kind: FailureKind;
  readonly consequence: FailureConsequence;
  /** Module or stage index, or -1 for launcher-level failures (rails, mount). */
  readonly index: number;
  readonly t_s: number;
  readonly limit: number;
  readonly value: number;
  readonly unit: string;
  readonly message: string;
}

/**
 * Energy ledger. The identity
 *   E_cap0 + KE0 = E_cap_end + E_mag_end + KE + E_ohm + E_drop + E_fric + E_fail
 * holds at every step; `residual_max_rel` is its worst relative violation over the shot.
 */
export interface EnergyLedger {
  readonly E_cap0_J: number;
  /** Kinetic energy of the projectile when the shot starts (zero unless it enters moving). */
  readonly KE0_J: number;
  /** Energy still stored in the capacitors at the end of the shot. */
  readonly E_cap_end_J: number;
  /** Magnetic energy still stored in the circuit at the end (dissipated in the muzzle arc on exit). */
  readonly E_mag_end_J: number;
  readonly KE_J: number;
  readonly E_ohm_J: number;
  /** Thyristor forward drop, turn-off and clamp losses. */
  readonly E_drop_J: number;
  readonly E_fric_J: number;
  /** Energy dumped when a rating failure removed a part. */
  readonly E_fail_J: number;
  /** Magnetic energy released at the muzzle on exit (zero when the armature did not exit). */
  readonly E_muzzle_dump_J: number;
  readonly residual_max_rel: number;
  readonly residual_end_rel: number;
}

export type ShotStatus = 'MUZZLE_EXIT' | 'FIZZLE' | 'ABORTED_BY_FAILURE';

export interface ShotSummary {
  readonly ok: true;
  readonly kind: 'railgun' | 'coilgun';
  readonly status: ShotStatus;
  readonly physicsVersion: string;
  /** Zero unless the projectile left the muzzle. */
  readonly muzzleSpeed_m_s: number;
  readonly muzzleEnergy_J: number;
  readonly muzzleMomentum_Ns: number;
  /** Launcher recoil impulse, equal to the projectile momentum (brief section 4.3). */
  readonly recoilImpulse_Ns: number;
  /** Muzzle energy over initial bank energy (zero without a muzzle exit). */
  readonly efficiency: number;
  readonly t_end_s: number;
  readonly I_peak_A: number;
  readonly I_peak_t_s: number;
  /** Integral of I^2 dt over the shot, A^2 s. */
  readonly actionIntegral_A2s: number;
  /** Peak rail separation load, N/m (railgun only, else 0). */
  readonly peakSeparationLoad_N_per_m: number;
  /** Breech-end rail temperature at the end of the shot, K (railgun only). */
  readonly T_breech_end_K: number;
  /** True when the breech end passed the softening limit (railgun only). */
  readonly railsDamaged: boolean;
  /** Ohmic heat deposited in the rails, J (railgun only). */
  readonly railHeat_J: number;
  /** Coil temperatures at the end of the shot, K (coilgun only). */
  readonly coilTemps_K: number[];
  /** Capacitor voltages at the end of the shot, V. */
  readonly V_end_V: number[];
  /** Time integral of the electromagnetic force on the armature, N s. */
  readonly impulseEm_Ns: number;
  /** Time integral of the friction force, N s. */
  readonly impulseFric_Ns: number;
  readonly steps: number;
  readonly dt_s: number;
  readonly ledger: EnergyLedger;
  readonly failures: Failure[];
  readonly trace: ShotTrace;
}

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

export interface SimulationFailure {
  readonly ok: false;
  readonly kind: 'SimulationDiverged' | 'StepCapExceeded' | 'InvalidDesign';
  readonly message: string;
  readonly issues: ValidationIssue[];
}

export type ShotResult = ShotSummary | SimulationFailure;

/** Options shared by both solvers. */
export interface SimOptions {
  /** Seed for trigger-timing jitter. Defaults to 1. */
  readonly seed?: number;
  /** Multiplies the automatic time step (tests use 0.5 for the convergence check). */
  readonly dtScale?: number;
  /** Bulk rail temperature at the start of the shot, K. */
  readonly initialRailTemp_K?: number;
  /** Coil temperatures at the start of the shot, K, one per stage. */
  readonly initialCoilTemps_K?: readonly number[];
  /** Multiplier on the rail melting point; below 1 for rails marked damaged. */
  readonly railMeltDerate?: number;
  /**
   * Check the energy ledger after every step instead of only at the end. Costs roughly a third
   * more time per shot, so tests and development builds turn it on and the server leaves it off.
   */
  readonly verifyClosure?: boolean;
  /** Test hooks. Ledger closure is not checked while any of them is active. */
  readonly diagnostic?: {
    /** Hold the armature at its starting position (RLC test). */
    readonly fixedArmature?: boolean;
    /** Force the rail current to this value (constant-current kinematics test). */
    readonly prescribedCurrent_A?: number;
  };
}
