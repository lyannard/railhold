import { T_AMBIENT_K } from './constants.ts';
import { PHYSICS_CONFIG } from './config.ts';
import { MATERIALS } from './materials.ts';
import { simulateRailgun, railGeometry, type RailgunDesign } from './railgun.ts';
import { simulateCoilgun, type CoilgunDesign } from './coilgun.ts';
import type { ShotResult } from './results.ts';

export type Blueprint =
  | { readonly kind: 'railgun'; readonly design: RailgunDesign }
  | { readonly kind: 'coilgun'; readonly design: CoilgunDesign };

/** Persistent thermal state of a launcher between shots (brief section 5.4). */
export interface LauncherThermalState {
  /** Bulk rail temperature, K (railgun). */
  readonly railBulk_K: number;
  /** Bulk coil temperatures, K (coilgun, one per stage). */
  readonly coilBulk_K: readonly number[];
  /** Rails marked damaged by an earlier shot: their melting limit is derated. */
  readonly railsDamaged: boolean;
}

/** Fraction by which damaged rails lose melting margin (game rule). */
export const DAMAGED_RAIL_DERATE = 0.9;

export function freshThermalState(bp: Blueprint): LauncherThermalState {
  return {
    railBulk_K: T_AMBIENT_K,
    coilBulk_K: bp.kind === 'coilgun' ? bp.design.stages.map(() => T_AMBIENT_K) : [],
    railsDamaged: false,
  };
}

/** True while every tracked temperature is below the firing limit. */
export function canFire(state: LauncherThermalState): boolean {
  const lim = PHYSICS_CONFIG.LAUNCHER_FIRE_LIMIT_K;
  return state.railBulk_K < lim && state.coilBulk_K.every((T) => T < lim);
}

/** Newtonian cooling over `dt_s` toward ambient with time constant `tau_s`. */
export function coolTo(T_K: number, dt_s: number, tau_s: number): number {
  return T_AMBIENT_K + (T_K - T_AMBIENT_K) * Math.exp(-dt_s / tau_s);
}

export function coolState(state: LauncherThermalState, dt_s: number, tau_s: number): LauncherThermalState {
  return {
    railBulk_K: coolTo(state.railBulk_K, dt_s, tau_s),
    coilBulk_K: state.coilBulk_K.map((T) => coolTo(T, dt_s, tau_s)),
    railsDamaged: state.railsDamaged,
  };
}

/**
 * Run one shot and return the shot result with the launcher's next thermal state.
 * The shot's rail heat is mixed into the bulk rail temperature by mass; coil temperatures
 * carry over directly because each stage heats as a whole winding.
 */
export function simulateLauncher(
  bp: Blueprint,
  state: LauncherThermalState,
  seed: number,
): { result: ShotResult; nextState: LauncherThermalState } {
  if (bp.kind === 'railgun') {
    const result = simulateRailgun(bp.design, {
      seed,
      initialRailTemp_K: state.railBulk_K,
      railMeltDerate: state.railsDamaged ? DAMAGED_RAIL_DERATE : 1,
    });
    if (!result.ok) return { result, nextState: state };
    const mat = MATERIALS[bp.design.rails.material];
    const railMass = railGeometry(bp.design, state.railBulk_K).railMass_kg;
    const next = state.railBulk_K + result.railHeat_J / (railMass * mat.cp_J_kg_K);
    return {
      result,
      nextState: {
        railBulk_K: Number.isFinite(next) ? next : state.railBulk_K,
        coilBulk_K: [],
        railsDamaged: state.railsDamaged || result.railsDamaged,
      },
    };
  }
  const result = simulateCoilgun(bp.design, { seed, initialCoilTemps_K: state.coilBulk_K });
  if (!result.ok) return { result, nextState: state };
  return {
    result,
    nextState: { railBulk_K: state.railBulk_K, coilBulk_K: result.coilTemps_K, railsDamaged: state.railsDamaged },
  };
}
