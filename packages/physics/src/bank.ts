/** One catalog capacitor module. */
export interface CapacitorModuleSpec {
  readonly C_F: number;
  readonly V_rated_V: number;
  readonly ESR_ohm: number;
  readonly ESL_H: number;
  readonly mass_kg: number;
  readonly cost: number;
}

/** Electrical and physical values of a series/parallel bank. */
export interface CapacitorBank {
  readonly C_F: number;
  readonly V_rated_V: number;
  readonly ESR_ohm: number;
  readonly ESL_H: number;
  readonly mass_kg: number;
  readonly cost: number;
  /** Energy stored at the rated voltage, J. */
  readonly energyRated_J: number;
}

/**
 * Bank of `s` modules in series and `p` strings in parallel (brief section 4.5):
 * C = p*Cm/s, Vrated = s*Vm, ESR = s*ESRm/p, ESL = s*ESLm/p, mass = s*p*mm, cost = s*p*costm.
 */
export function buildBank(module: CapacitorModuleSpec, s: number, p: number): CapacitorBank {
  if (!Number.isInteger(s) || !Number.isInteger(p) || s < 1 || p < 1) {
    throw new RangeError('Bank series and parallel counts must be integers of at least 1.');
  }
  const C_F = (p * module.C_F) / s;
  const V_rated_V = s * module.V_rated_V;
  return {
    C_F,
    V_rated_V,
    ESR_ohm: (s * module.ESR_ohm) / p,
    ESL_H: (s * module.ESL_H) / p,
    mass_kg: s * p * module.mass_kg,
    cost: s * p * module.cost,
    energyRated_J: 0.5 * C_F * V_rated_V * V_rated_V,
  };
}
