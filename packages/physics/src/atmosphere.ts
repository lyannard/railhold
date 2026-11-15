import { GAMMA_AIR, R_AIR } from './constants.ts';
import { PHYSICS_CONFIG } from './config.ts';

/** ISA sea-level temperature, K. */
const T0_K = 288.15;
/** ISA sea-level pressure, Pa. */
const P0_PA = 101325;
/** Tropospheric lapse rate, K/m. */
const LAPSE_K_PER_M = 0.0065;
/** Pressure exponent g/(R L) of the ISA troposphere. */
const PRESSURE_EXPONENT = 5.25588;

export interface Atmosphere {
  readonly T_K: number;
  readonly p_Pa: number;
  readonly rho_kg_m3: number;
  readonly a_m_s: number;
}

function clampAltitude(h_m: number): number {
  return Math.min(Math.max(h_m, 0), PHYSICS_CONFIG.ISA_MAX_ALTITUDE_M);
}

/** ISA troposphere state at geometric altitude `h_m`, clamped to 0..11000 m. */
export function isa(h_m: number): Atmosphere {
  const h = clampAltitude(h_m);
  const T_K = T0_K - LAPSE_K_PER_M * h;
  const p_Pa = P0_PA * Math.pow(T_K / T0_K, PRESSURE_EXPONENT);
  return {
    T_K,
    p_Pa,
    rho_kg_m3: p_Pa / (R_AIR * T_K),
    a_m_s: Math.sqrt(GAMMA_AIR * R_AIR * T_K),
  };
}

/** Air density only, kg/m^3 (no allocation; used in the flight loop). */
export function isaDensity_kg_m3(h_m: number): number {
  const h = clampAltitude(h_m);
  const T_K = T0_K - LAPSE_K_PER_M * h;
  return (P0_PA * Math.pow(T_K / T0_K, PRESSURE_EXPONENT)) / (R_AIR * T_K);
}

/** Speed of sound only, m/s (no allocation). */
export function isaSoundSpeed_m_s(h_m: number): number {
  const h = clampAltitude(h_m);
  return Math.sqrt(GAMMA_AIR * R_AIR * (T0_K - LAPSE_K_PER_M * h));
}
