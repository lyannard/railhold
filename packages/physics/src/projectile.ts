import { G0 } from './constants.ts';
import { conductivity_S_m, type MaterialId } from './materials.ts';
import { T_AMBIENT_K } from './constants.ts';
import type { FlightParams, ShieldZone } from './ballistics.ts';

/** What the launched slug looks like once it is in the air. */
export interface ProjectileSpec {
  readonly material: MaterialId;
  readonly frontalArea_m2: number;
  readonly length_m: number;
}

/** Flight parameters for a slug of mass `mass_kg` (gravity on, ISA air, optional shield zone). */
export function flightParamsFor(spec: ProjectileSpec, mass_kg: number, shield: ShieldZone | null = null): FlightParams {
  return {
    mass_kg,
    frontalArea_m2: spec.frontalArea_m2,
    gravity_m_s2: G0,
    slugSigma_S_m: conductivity_S_m(spec.material, T_AMBIENT_K),
    slugLength_m: spec.length_m,
    shield,
  };
}
