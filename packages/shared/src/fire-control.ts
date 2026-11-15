import { Flight, type FlightParams } from '@railhold/physics';
import { GAME } from './config.ts';

export interface FlightAtRange {
  /** Height above ground where the path crosses the horizontal range, m. */
  readonly height_m: number;
  readonly time_s: number;
  readonly speed_m_s: number;
  /** True when the projectile reached the ground before the range. */
  readonly hitGround: boolean;
}

/**
 * Fly a projectile in the vertical plane and report where it crosses `range_m` of horizontal
 * distance. Uses the same RK4 flight function as the server (drag from ISA air, gravity).
 */
export function flightAtRange(params: FlightParams, muzzleSpeed_m_s: number, elevation_rad: number, range_m: number, h0_m: number): FlightAtRange {
  const f = new Flight(params);
  f.reset(0, h0_m, 0, muzzleSpeed_m_s * Math.cos(elevation_rad), muzzleSpeed_m_s * Math.sin(elevation_rad), 0);
  const dt = 1 / 240;
  const maxSteps = Math.ceil(GAME.MAX_FLIGHT_TIME_S / dt);
  let t = 0;
  for (let i = 0; i < maxSteps; i++) {
    const x0 = f.s[0];
    const y0 = f.s[1];
    f.step(dt);
    t += dt;
    if (f.s[1] <= 0) {
      const u = y0 / (y0 - f.s[1]);
      return { height_m: 0, time_s: t - dt + u * dt, speed_m_s: f.speed_m_s, hitGround: f.s[0] * u + x0 * (1 - u) < range_m };
    }
    if (f.s[0] >= range_m) {
      const u = (range_m - x0) / (f.s[0] - x0);
      return { height_m: y0 + u * (f.s[1] - y0), time_s: t - dt + u * dt, speed_m_s: f.speed_m_s, hitGround: false };
    }
  }
  return { height_m: f.s[1], time_s: t, speed_m_s: f.speed_m_s, hitGround: true };
}

export interface AimSolution {
  readonly elevation_rad: number;
  readonly flightTime_s: number;
  readonly impactSpeed_m_s: number;
  /** False when even the largest allowed elevation falls short. */
  readonly reachable: boolean;
}

/**
 * Elevation that makes the flight cross `range_m` at `targetHeight_m`. The height at the range is
 * a smooth, increasing function of elevation wherever the slug reaches the range, so once both
 * ends of the bracket do, the solver switches from bisection to the Illinois form of regula falsi.
 * It stops when the path is within 2 mm of the target height, which takes about eight flights.
 */
export function solveElevation(params: FlightParams, muzzleSpeed_m_s: number, range_m: number, targetHeight_m: number, h0_m: number): AimSolution {
  let lo: number = -0.1;
  let hi: number = GAME.MAX_ELEVATION_RAD;
  const top = flightAtRange(params, muzzleSpeed_m_s, hi, range_m, h0_m);
  if (top.hitGround || top.height_m < targetHeight_m) {
    return { elevation_rad: hi, flightTime_s: top.time_s, impactSpeed_m_s: top.speed_m_s, reachable: false };
  }
  const bot = flightAtRange(params, muzzleSpeed_m_s, lo, range_m, h0_m);
  let fLo = bot.hitGround ? Number.NaN : bot.height_m - targetHeight_m;
  let fHi = top.height_m - targetHeight_m;
  let side = 0;
  let best = { el: hi, r: top };
  for (let i = 0; i < 60; i++) {
    const useFalse = !Number.isNaN(fLo) && fLo < 0 && fHi > 0;
    const mid = useFalse ? (lo * fHi - hi * fLo) / (fHi - fLo) : 0.5 * (lo + hi);
    const r = flightAtRange(params, muzzleSpeed_m_s, mid, range_m, h0_m);
    best = { el: mid, r };
    if (r.hitGround || r.height_m < targetHeight_m) {
      const f = r.hitGround ? Number.NaN : r.height_m - targetHeight_m;
      if (!r.hitGround && Math.abs(f) < 0.002) break;
      lo = mid;
      fLo = f;
      if (useFalse && side === -1) fHi *= 0.5;
      side = -1;
    } else {
      const f = r.height_m - targetHeight_m;
      if (f < 0.002) break;
      hi = mid;
      fHi = f;
      if (useFalse && side === 1) fLo *= 0.5;
      side = 1;
    }
    if (hi - lo < 1e-9) break;
  }
  return { elevation_rad: best.el, flightTime_s: best.r.time_s, impactSpeed_m_s: best.r.speed_m_s, reachable: true };
}

/** Drop of the bore line below the launch height at each distance (positive numbers, m). */
export function dropTable(params: FlightParams, muzzleSpeed_m_s: number, distances_m: readonly number[], h0_m: number): number[] {
  return distances_m.map((d) => {
    const r = flightAtRange(params, muzzleSpeed_m_s, 0, d, h0_m);
    return r.hitGround ? h0_m : h0_m - r.height_m;
  });
}
