import { GAME } from './config.ts';

export type EnemyType = 'walker' | 'plated' | 'swarm' | 'shield' | 'jammer';

export interface EnemyDef {
  readonly id: EnemyType;
  readonly name: string;
  /** Hit points in joules of damage. */
  readonly hp_J: number;
  readonly speed_m_s: number;
  /** Collision radius of the capsule or sphere, m. */
  readonly radius_m: number;
  /** Height of the capsule's top above its base, m. Zero makes a sphere. */
  readonly height_m: number;
  /** Altitude of the lowest point above ground, m. */
  readonly altitude_m: number;
  /** Momentum per frontal area needed to penetrate, kg/(m s). Zero means never reduced. */
  readonly armorThreshold: number;
  /** Fraction of impact energy that counts when the projectile does not penetrate. */
  readonly armorFactor: number;
  /** Damage dealt to the base on contact. */
  readonly contactDamage: number;
  readonly points: number;
  readonly note: string;
}

export const ENEMIES: Readonly<Record<EnemyType, EnemyDef>> = {
  walker: { id: 'walker', name: 'Walker', hp_J: 4500, speed_m_s: 8, radius_m: 0.5, height_m: 1.8, altitude_m: 0, armorThreshold: 0, armorFactor: 1, contactDamage: 60, points: 1, note: 'Slow ground unit. Any adequate hit works.' },
  plated: { id: 'plated', name: 'Plated', hp_J: 14000, speed_m_s: 5, radius_m: 0.8, height_m: 2.4, altitude_m: 0, armorThreshold: 450_000, armorFactor: 0.2, contactDamage: 130, points: 4, note: 'Armor stops light slugs. Needs high momentum per frontal area.' },
  swarm: { id: 'swarm', name: 'Swarm drone', hp_J: 900, speed_m_s: 22, radius_m: 0.55, height_m: 0, altitude_m: 3, armorThreshold: 0, armorFactor: 1, contactDamage: 15, points: 0.5, note: 'Small, fast and many. Needs a high rate of fire.' },
  shield: { id: 'shield', name: 'Shield bearer', hp_J: 9000, speed_m_s: 6, radius_m: 0.7, height_m: 2.0, altitude_m: 0, armorThreshold: 60_000, armorFactor: 0.5, contactDamage: 80, points: 3, note: 'Its magnetic field brakes conductive slugs by eddy currents.' },
  jammer: { id: 'jammer', name: 'Jammer', hp_J: 5000, speed_m_s: 9, radius_m: 0.5, height_m: 1.6, altitude_m: 0, armorThreshold: 60_000, armorFactor: 0.5, contactDamage: 40, points: 3, note: 'Pulses every 8 s and disables electrical triggers within 300 m.' },
};

export function lanePosition(bearing_deg: number, distance_m: number): { x: number; z: number } {
  const a = (bearing_deg * Math.PI) / 180;
  return { x: Math.sin(a) * distance_m, z: Math.cos(a) * distance_m };
}

/** Emplacement x position of seat `seat` among `count` players, centred on the base axis. */
export function emplacementX(seat: number, count: number): number {
  return (seat - (count - 1) / 2) * GAME.EMPLACEMENT_SPACING_M;
}

export interface ImpactResult {
  readonly energy_J: number;
  /** Momentum per frontal area, kg/(m s). */
  readonly momentumPerArea: number;
  readonly penetrates: boolean;
  readonly damage_J: number;
}

/**
 * Game-rule damage (brief section 5.3, not terminal ballistics): damage is the kinetic energy at
 * impact, reduced by the armor factor when momentum per frontal area is below the threshold.
 */
export function impactDamage(def: EnemyDef, mass_kg: number, speed_m_s: number, frontalArea_m2: number): ImpactResult {
  const energy_J = 0.5 * mass_kg * speed_m_s * speed_m_s;
  const momentumPerArea = (mass_kg * speed_m_s) / frontalArea_m2;
  const penetrates = momentumPerArea >= def.armorThreshold;
  return { energy_J, momentumPerArea, penetrates, damage_J: penetrates ? energy_J : energy_J * def.armorFactor };
}

/** Enemy type order used by compact network messages. */
export const ENEMY_ORDER: readonly EnemyType[] = ['walker', 'plated', 'swarm', 'shield', 'jammer'];

export interface EnemyPath {
  readonly x0: number;
  readonly z0: number;
  /** Unit direction of travel on the ground plane. */
  readonly dx: number;
  readonly dz: number;
  readonly speed_m_s: number;
  /** Height of the lowest point above ground, m. */
  readonly altitude_m: number;
}

/**
 * Deterministic path of an enemy: a straight line from its spawn point to the base. Server and
 * clients both compute positions from this, so snapshots carry no per-enemy positions.
 */
export function enemyPath(id: number, type: EnemyType, lane: number): EnemyPath {
  const def = ENEMIES[type];
  const bearing = GAME.LANE_BEARINGS_DEG[lane];
  const base = lanePosition(bearing, GAME.SPAWN_DISTANCE_M);
  const a = (bearing * Math.PI) / 180;
  const lateral = (((id * 7919) % 11) - 5) * 2.2;
  const x0 = base.x + Math.cos(a) * lateral;
  const z0 = base.z - Math.sin(a) * lateral;
  const len = Math.hypot(x0, z0);
  const altitude_m = def.altitude_m > 0 ? def.altitude_m + ((id * 131) % 6) : 0;
  return { x0, z0, dx: -x0 / len, dz: -z0 / len, speed_m_s: def.speed_m_s, altitude_m };
}

/** Capsule axis end points (base and top centre) of an enemy standing at (x, z). */
export function enemyCapsule(def: EnemyDef, altitude_m: number, x: number, z: number): { ax: number; ay: number; az: number; bx: number; by: number; bz: number } {
  const ay = altitude_m + def.radius_m;
  const by = Math.max(ay, altitude_m + def.height_m - def.radius_m);
  return { ax: x, ay, az: z, bx: x, by, bz: z };
}
