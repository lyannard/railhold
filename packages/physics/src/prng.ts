import { PHYSICS_CONFIG } from './config.ts';

/** Mulberry32: 32-bit seeded generator returning floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal sample (Box-Muller) clamped to the configured number of sigmas. */
export function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-300);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const c = PHYSICS_CONFIG.JITTER_CLAMP_SIGMAS;
  return Math.max(-c, Math.min(c, z));
}
