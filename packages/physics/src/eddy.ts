import { MU0 } from './constants.ts';

/** Magnetic Reynolds number Rm = mu0 * sigma * v * Lc. */
export function magneticReynolds(v_m_s: number, sigma_S_m: number, Lc_m: number): number {
  return MU0 * sigma_S_m * v_m_s * Lc_m;
}

export interface EddyBrakingInput {
  readonly v_m_s: number;
  readonly B_T: number;
  readonly sigma_S_m: number;
  readonly frontalArea_m2: number;
  /** Characteristic length of the slug (its length), m. */
  readonly Lc_m: number;
  /** Documented shape factor. */
  readonly kappa: number;
}

/**
 * F_brk = kappa * B^2/(2 mu0) * A * Rm/(1 + Rm), directed against the velocity.
 * Rm << 1 gives (kappa/2) sigma B^2 v A Lc. Rm >> 1 saturates at magnetic pressure times area.
 */
export function eddyBrakingForce_N(i: EddyBrakingInput): number {
  const Rm = magneticReynolds(i.v_m_s, i.sigma_S_m, i.Lc_m);
  return i.kappa * ((i.B_T * i.B_T) / (2 * MU0)) * i.frontalArea_m2 * (Rm / (1 + Rm));
}
