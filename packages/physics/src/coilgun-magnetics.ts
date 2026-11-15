import { MU0 } from './constants.ts';
import { PHYSICS_CONFIG } from './config.ts';
import { MATERIALS } from './materials.ts';

const INCH_M = 0.0254;
/** Wire diameter at AWG 36 in mm, and the 92-to-39 geometric progression of the AWG series. */
const AWG_D36_MM = 0.127;
const AWG_BASE = 92;
const AWG_STEPS = 39;
const AWG_REF = 36;

/** Bare wire diameter from the AWG number, m (brief section 4.4). */
export function awgDiameter_m(n_awg: number): number {
  return (AWG_D36_MM * Math.pow(AWG_BASE, (AWG_REF - n_awg) / AWG_STEPS)) / 1000;
}

/**
 * Demagnetizing factor along the axis of a prolate spheroid of aspect ratio m = length/diameter.
 * Uses a series near m = 1 where the closed form cancels catastrophically (1/3 at m = 1).
 */
export function demagFactorProlate(m: number): number {
  const u2 = m * m - 1;
  if (u2 < 1e-4) return 1 / 3 - (2 * u2) / 15 + (8 * u2 * u2) / 105;
  const u = Math.sqrt(u2);
  return (1 / u2) * ((m / u) * Math.log(m + u) - 1);
}

/** Demagnetization-corrected effective relative permeability. */
export function effectivePermeability(mu_r: number, Nd: number): number {
  return 1 + (mu_r - 1) / (1 + Nd * (mu_r - 1));
}

/**
 * Wheeler's finite-solenoid formula, L_uH = r^2 N^2 / (9 r + 10 l) with r and l in inches,
 * converted to SI. `r_mean_m` is the mean winding radius.
 */
export function wheelerInductance_H(r_mean_m: number, length_m: number, turns: number): number {
  const r = r_mean_m / INCH_M;
  const l = length_m / INCH_M;
  return (1e-6 * r * r * turns * turns) / (9 * r + 10 * l);
}

/** Long-solenoid limit mu0 N^2 A / l. */
export function longSolenoidInductance_H(r_m: number, length_m: number, turns: number): number {
  return (MU0 * turns * turns * Math.PI * r_m * r_m) / length_m;
}


/** Below this |a| the closed forms cancel catastrophically, so Taylor series are used instead. */
const SERIES_LIMIT = 0.01;

/**
 * Writes tanh(a) to out[0] and ln(cosh(a)) to out[1]. Large arguments use
 * |a| + ln(1 + exp(-2|a|)) - ln 2 (one exponential, no overflow). For |a| < 0.01 that form loses
 * all precision (the answer is of order a^2/2 while its terms are of order 1), so Taylor series
 * are used there; they agree with the closed form to better than 1e-13 relative at the switch.
 * `out` is caller-owned so the solver hot loop allocates nothing.
 */
export function tanhAndLncosh(a: number, out: Float64Array): void {
  const x = Math.abs(a);
  if (x < SERIES_LIMIT) {
    const a2 = a * a;
    out[0] = a * (1 - a2 / 3 + (2 * a2 * a2) / 15 - (17 * a2 * a2 * a2) / 315);
    out[1] = a2 * (0.5 - a2 / 12 + (a2 * a2) / 45);
    return;
  }
  const e = Math.exp(-2 * x);
  const th = (1 - e) / (1 + e);
  out[0] = a < 0 ? -th : th;
  out[1] = x + Math.log1p(e) - Math.LN2;
}

const SAT_SCRATCH = new Float64Array(2);

/** Natural log of cosh, safe for any argument. */
export function lncosh(a: number): number {
  tanhAndLncosh(a, SAT_SCRATCH);
  return SAT_SCRATCH[1];
}

/**
 * Longitudinal force of one saturating stage, F = DeltaL'(z) * Isat^2 * ln(cosh(I/Isat)).
 * Reduces to 0.5 * DeltaL' * I^2 for I << Isat (brief section 4.4).
 */
export function saturatedForce_N(dLprime_H_per_m: number, Isat_A: number, I_A: number): number {
  return dLprime_H_per_m * Isat_A * Isat_A * lncosh(I_A / Isat_A);
}

export interface Winding {
  readonly wireDiameter_m: number;
  readonly wireArea_m2: number;
  readonly turnsPerLayer: number;
  readonly layers: number;
  /** Radius of the middle of the winding depth, m. */
  readonly meanRadius_m: number;
  readonly outerRadius_m: number;
  readonly wireLength_m: number;
}

/**
 * Winding geometry from turns, AWG, winding length and inner radius. Layers are packed at the
 * configured pitch; wire length is summed over the layer radii.
 */
export function windingGeometry(turns: number, awg: number, length_m: number, innerRadius_m: number): Winding {
  const wireDiameter_m = awgDiameter_m(awg);
  const pitch = wireDiameter_m * PHYSICS_CONFIG.WIRE_PITCH_FACTOR;
  const turnsPerLayer = Math.max(1, Math.floor(length_m / pitch));
  const layers = Math.ceil(turns / turnsPerLayer);
  let wireLength_m = 0;
  for (let i = 0; i < layers; i++) {
    const inLayer = Math.min(turnsPerLayer, turns - i * turnsPerLayer);
    wireLength_m += inLayer * 2 * Math.PI * (innerRadius_m + (i + 0.5) * pitch);
  }
  return {
    wireDiameter_m,
    wireArea_m2: (Math.PI * wireDiameter_m * wireDiameter_m) / 4,
    turnsPerLayer,
    layers,
    meanRadius_m: innerRadius_m + 0.5 * layers * pitch,
    outerRadius_m: innerRadius_m + layers * pitch,
    wireLength_m,
  };
}

/** Parameters of the smoothed trapezoid overlap of a slug and a coil along the axis. */
export interface OverlapProfile {
  readonly invL: number;
  readonly za: number;
  readonly zb: number;
  readonly rhoA: number;
  readonly rhoB: number;
  /** True when slug and coil have equal length (no plateau). */
  readonly merged: boolean;
}

export function makeOverlap(coilLength_m: number, slugLength_m: number): OverlapProfile {
  const L = Math.min(coilLength_m, slugLength_m);
  const za = Math.abs(coilLength_m - slugLength_m) / 2;
  const zb = (coilLength_m + slugLength_m) / 2;
  const rho = PHYSICS_CONFIG.OVERLAP_SMOOTHING_FRACTION * L;
  const merged = za < 1e-12 * L;
  return { invL: 1 / L, za, zb, rhoA: merged ? rho : Math.min(rho, za), rhoB: rho, merged };
}

/**
 * Normalized overlap g(z) of slug and coil, z being the slug centre relative to the coil centre.
 * The trapezoid corners are rounded with quadratic blends, so g is C1.
 */
export function overlap(p: OverlapProfile, z: number): number {
  const u = Math.abs(z);
  if (p.merged) {
    if (u < p.rhoA) return 1 + p.invL * u - (p.invL * (u + p.rhoA) * (u + p.rhoA)) / (2 * p.rhoA);
  } else {
    if (u <= p.za - p.rhoA) return 1;
    if (u < p.za + p.rhoA) {
      const w = u - p.za + p.rhoA;
      return 1 - (p.invL * w * w) / (4 * p.rhoA);
    }
  }
  if (u <= p.zb - p.rhoB) return 1 - p.invL * (u - p.za);
  if (u < p.zb + p.rhoB) {
    const w = u - p.zb + p.rhoB;
    return -p.invL * (u - p.zb) + (p.invL * w * w) / (4 * p.rhoB);
  }
  return 0;
}

/** Analytic derivative dg/dz (no finite differences). */
export function overlapDerivative(p: OverlapProfile, z: number): number {
  const u = Math.abs(z);
  let d: number;
  if (p.merged && u < p.rhoA) d = (-p.invL * u) / p.rhoA;
  else if (!p.merged && u <= p.za - p.rhoA) d = 0;
  else if (!p.merged && u < p.za + p.rhoA) d = (-p.invL * (u - p.za + p.rhoA)) / (2 * p.rhoA);
  else if (u <= p.zb - p.rhoB) d = -p.invL;
  else if (u < p.zb + p.rhoB) d = -p.invL + (p.invL * (u - p.zb + p.rhoB)) / (2 * p.rhoB);
  else d = 0;
  return z < 0 ? -d : d;
}

export interface SlugSpec {
  readonly length_m: number;
  readonly diameter_m: number;
  readonly material: 'iron';
}

export function slugMass_kg(s: SlugSpec): number {
  return MATERIALS[s.material].density_kg_m3 * Math.PI * (s.diameter_m * s.diameter_m / 4) * s.length_m;
}
