import { PHYSICS_CONFIG } from './config.ts';
import { eddyBrakingForce_N } from './eddy.ts';
import { isaDensity_kg_m3, isaSoundSpeed_m_s } from './atmosphere.ts';
import { Rk4 } from './rk4.ts';

/*
 * Drag coefficient of a generic blunt slug against Mach number.
 * These numbers are approximate and are NOT taken from a specific standard or wind-tunnel
 * dataset. They keep the real qualitative shape: roughly constant subsonic, a steep rise
 * through the transonic region, a peak near Mach 1.1 to 1.3, then a slow decline.
 */
export const CD_MACH: readonly number[] = [0, 0.6, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5, 2.0, 3.0, 5.0, 10.0];
export const CD_VALUE: readonly number[] = [0.25, 0.25, 0.27, 0.32, 0.45, 0.56, 0.58, 0.57, 0.52, 0.42, 0.33, 0.28, 0.25];

/** Piecewise-linear Cd(M), held constant outside the table. */
export function dragCoefficient(mach: number): number {
  const n = CD_MACH.length;
  if (mach <= CD_MACH[0]) return CD_VALUE[0];
  if (mach >= CD_MACH[n - 1]) return CD_VALUE[n - 1];
  let hi = 1;
  while (CD_MACH[hi] < mach) hi++;
  const lo = hi - 1;
  const f = (mach - CD_MACH[lo]) / (CD_MACH[hi] - CD_MACH[lo]);
  return CD_VALUE[lo] + f * (CD_VALUE[hi] - CD_VALUE[lo]);
}

/** Spherical region of uniform flux density that brakes conductive slugs (brief section 4.7). */
export interface ShieldZone {
  readonly cx_m: number;
  readonly cy_m: number;
  readonly cz_m: number;
  readonly radius_m: number;
  readonly B_T: number;
}

export interface FlightParams {
  readonly mass_kg: number;
  readonly frontalArea_m2: number;
  /** Gravity magnitude, m/s^2 (0 disables it). */
  readonly gravity_m_s2: number;
  /** Fixed air density replacing the ISA model (used by tests). */
  readonly rhoOverride_kg_m3?: number;
  /** Fixed drag coefficient replacing the Mach table (used by tests). */
  readonly cdOverride?: number;
  /** Slug conductivity, S/m, for eddy braking. 0 or absent disables braking. */
  readonly slugSigma_S_m?: number;
  /** Slug length, m, the characteristic length of the braking model. */
  readonly slugLength_m?: number;
  readonly eddyKappa?: number;
  /** Initial shield zone. Moving zones are set each step through `Flight.shield`. */
  readonly shield?: ShieldZone | null;
}

const IX = 0;
const IY = 1;
const IZ = 2;
const IVX = 3;
const IVY = 4;
const IVZ = 5;

/**
 * Projectile in 3D flight, y up, flat ground at y = 0. RK4 at a fixed step.
 * State layout in `s`: x, y, z, vx, vy, vz (m and m/s). Stepping allocates nothing.
 */
export class Flight {
  readonly s = new Float64Array(6);
  readonly params: FlightParams;
  /** Shield zone the projectile is currently being tested against (null for none). */
  shield: ShieldZone | null;
  private readonly rk = new Rk4(6);
  private readonly rhs: (t: number, y: Float64Array, d: Float64Array) => void;

  constructor(params: FlightParams) {
    this.params = params;
    this.shield = params.shield ?? null;
    const p = params;
    this.rhs = (_t, y, d) => {
      const vx = y[IVX];
      const vy = y[IVY];
      const vz = y[IVZ];
      d[IX] = vx;
      d[IY] = vy;
      d[IZ] = vz;
      let ax = 0;
      let ay = -p.gravity_m_s2;
      let az = 0;
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (speed > 1e-12) {
        const h = y[IY];
        const rho = p.rhoOverride_kg_m3 ?? isaDensity_kg_m3(h);
        const cd = p.cdOverride ?? dragCoefficient(speed / isaSoundSpeed_m_s(h));
        let force = 0.5 * rho * cd * p.frontalArea_m2 * speed * speed;
        const z = this.shield;
        if (z && p.slugSigma_S_m) {
          const dx = y[IX] - z.cx_m;
          const dy = y[IY] - z.cy_m;
          const dz = y[IZ] - z.cz_m;
          if (dx * dx + dy * dy + dz * dz < z.radius_m * z.radius_m) {
            force += eddyBrakingForce_N({
              v_m_s: speed,
              B_T: z.B_T,
              sigma_S_m: p.slugSigma_S_m,
              frontalArea_m2: p.frontalArea_m2,
              Lc_m: p.slugLength_m ?? 0,
              kappa: p.eddyKappa ?? PHYSICS_CONFIG.EDDY_KAPPA,
            });
          }
        }
        const k = force / (p.mass_kg * speed);
        ax -= k * vx;
        ay -= k * vy;
        az -= k * vz;
      }
      d[IVX] = ax;
      d[IVY] = ay;
      d[IVZ] = az;
    };
  }

  /** Set position and velocity. */
  reset(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const s = this.s;
    s[IX] = x;
    s[IY] = y;
    s[IZ] = z;
    s[IVX] = vx;
    s[IVY] = vy;
    s[IVZ] = vz;
  }

  /** Advance by `dt_s` (default: the fixed 1/240 s step). */
  step(dt_s: number = PHYSICS_CONFIG.FLIGHT_DT_S): void {
    this.rk.step(this.rhs, 0, this.s, dt_s);
  }

  get speed_m_s(): number {
    const s = this.s;
    return Math.sqrt(s[IVX] * s[IVX] + s[IVY] * s[IVY] + s[IVZ] * s[IVZ]);
  }
}

type Vec3 = ArrayLike<number>;

/**
 * Swept test of the segment p0 -> p1 against a sphere. Returns the fraction s in [0, 1] of the
 * first contact, 0 when p0 is already inside, or -1 for a miss. Never samples points.
 */
export function sweepPointSphere(p0: Vec3, p1: Vec3, c: Vec3, r_m: number): number {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const dz = p1[2] - p0[2];
  const ox = p0[0] - c[0];
  const oy = p0[1] - c[1];
  const oz = p0[2] - c[2];
  const cc = ox * ox + oy * oy + oz * oz - r_m * r_m;
  if (cc <= 0) return 0;
  const a = dx * dx + dy * dy + dz * dz;
  if (a < 1e-24) return -1;
  const b = ox * dx + oy * dy + oz * dz;
  const disc = b * b - a * cc;
  if (disc < 0) return -1;
  const s = (-b - Math.sqrt(disc)) / a;
  return s >= 0 && s <= 1 ? s : -1;
}

/**
 * Swept test of the segment p0 -> p1 against a capsule (axis a -> b, radius r_m).
 * Returns the fraction of first contact in [0, 1], 0 when p0 starts inside, or -1 for a miss.
 */
export function sweepPointCapsule(p0: Vec3, p1: Vec3, a: Vec3, b: Vec3, r_m: number): number {
  const bax = b[0] - a[0];
  const bay = b[1] - a[1];
  const baz = b[2] - a[2];
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-18) return sweepPointSphere(p0, p1, a, r_m);

  const oax = p0[0] - a[0];
  const oay = p0[1] - a[1];
  const oaz = p0[2] - a[2];
  const baoa = bax * oax + bay * oay + baz * oaz;
  const u = Math.min(Math.max(baoa / baba, 0), 1);
  const ex = oax - u * bax;
  const ey = oay - u * bay;
  const ez = oaz - u * baz;
  if (ex * ex + ey * ey + ez * ez <= r_m * r_m) return 0;

  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const dz = p1[2] - p0[2];
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-24) return -1;
  const len = Math.sqrt(len2);
  const rdx = dx / len;
  const rdy = dy / len;
  const rdz = dz / len;

  let best = Infinity;
  const bard = bax * rdx + bay * rdy + baz * rdz;
  const rdoa = rdx * oax + rdy * oay + rdz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const qa = baba - bard * bard;
  if (qa > 1e-12 * baba) {
    const qb = baba * rdoa - baoa * bard;
    const qc = baba * oaoa - baoa * baoa - r_m * r_m * baba;
    const h = qb * qb - qa * qc;
    if (h >= 0) {
      const t = (-qb - Math.sqrt(h)) / qa;
      const y = baoa + t * bard;
      if (t >= 0 && y > 0 && y < baba) best = t;
    }
  }
  for (let end = 0; end < 2; end++) {
    const e = end === 0 ? a : b;
    const ocx = p0[0] - e[0];
    const ocy = p0[1] - e[1];
    const ocz = p0[2] - e[2];
    const bq = rdx * ocx + rdy * ocy + rdz * ocz;
    const cq = ocx * ocx + ocy * ocy + ocz * ocz - r_m * r_m;
    const hh = bq * bq - cq;
    if (hh >= 0) {
      const t = -bq - Math.sqrt(hh);
      if (t >= 0 && t < best) best = t;
    }
  }
  return best <= len ? best / len : -1;
}
