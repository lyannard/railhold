import { T_AMBIENT_K } from './constants.ts';

export type MaterialId = 'copper' | 'aluminum6061' | 'iron' | 'polymer';

export interface Material {
  readonly id: MaterialId;
  readonly name: string;
  /** Resistivity at 293.15 K, ohm m. */
  readonly resistivity20_ohm_m: number;
  /** Linear temperature coefficient of resistivity, 1/K. */
  readonly alpha_per_K: number;
  readonly density_kg_m3: number;
  readonly cp_J_kg_K: number;
  /** Melting point, or solidus where the alloy has no single melting point, K. */
  readonly melt_K: number;
  /** Relative permeability before demagnetization (1 for non-magnetic). */
  readonly mu_r: number;
  /** Saturation flux density, T (0 for non-magnetic). */
  readonly Bsat_T: number;
}

/*
 * Reference values near 293 K, as specified in the Railhold brief (section 4.2). They agree with
 * the usual handbook ranges (CRC Handbook of Chemistry and Physics for copper; ASM Handbook for
 * 6061-T6 and low-carbon steel). The brief's numbers are normative; none has been changed.
 * The polymer entry is a game material (glass-filled composite) for the non-conductive slug
 * option. Its density penalty: at 1900 kg/m^3 a slug of the same volume carries 24 % of the
 * mass of a steel slug (7850) and 70 % of an aluminum slug (2700), so it arrives with less
 * momentum and energy. In exchange its magnetic Reynolds number is zero (no eddy braking).
 */
export const MATERIALS: Readonly<Record<MaterialId, Material>> = {
  copper: {
    id: 'copper',
    name: 'Copper',
    resistivity20_ohm_m: 1.68e-8,
    alpha_per_K: 3.93e-3,
    density_kg_m3: 8960,
    cp_J_kg_K: 385,
    melt_K: 1357.8,
    mu_r: 1,
    Bsat_T: 0,
  },
  aluminum6061: {
    id: 'aluminum6061',
    name: 'Aluminum 6061-T6',
    resistivity20_ohm_m: 3.99e-8,
    alpha_per_K: 3.9e-3,
    density_kg_m3: 2700,
    cp_J_kg_K: 896,
    melt_K: 855,
    mu_r: 1,
    Bsat_T: 0,
  },
  iron: {
    id: 'iron',
    name: 'Iron / low-carbon steel',
    resistivity20_ohm_m: 1.43e-7,
    alpha_per_K: 5.0e-3,
    density_kg_m3: 7850,
    cp_J_kg_K: 490,
    melt_K: 1700,
    mu_r: 1000,
    Bsat_T: 2.0,
  },
  polymer: {
    id: 'polymer',
    name: 'Glass-filled polymer composite',
    resistivity20_ohm_m: 1e14,
    alpha_per_K: 0,
    density_kg_m3: 1900,
    cp_J_kg_K: 1200,
    melt_K: 600,
    mu_r: 1,
    Bsat_T: 0,
  },
};

/** rho(T) = rho20 * (1 + alpha * (T - 293.15)), floored at 10 % of rho20 to stay positive. */
export function resistivity_ohm_m(id: MaterialId, T_K: number): number {
  const m = MATERIALS[id];
  const r = m.resistivity20_ohm_m * (1 + m.alpha_per_K * (T_K - T_AMBIENT_K));
  return Math.max(r, 0.1 * m.resistivity20_ohm_m);
}

export function conductivity_S_m(id: MaterialId, T_K: number): number {
  return 1 / resistivity_ohm_m(id, T_K);
}
