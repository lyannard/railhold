import type { ErrorCode, EnemyType } from '@railhold/shared';

export type Phase = 'lobby' | 'build' | 'charge' | 'defense' | 'debrief' | 'victory' | 'defeat' | 'range';

export interface PlayerStats {
  kills: number;
  damage_J: number;
  shots: number;
  hits: number;
  drawn_J: number;
  muzzle_J: number;
}

export interface PlayerView {
  readonly id: string;
  readonly seat: number;
  readonly name: string;
  readonly host: boolean;
  readonly connected: boolean;
  readonly ready: boolean;
  readonly hasLoadout: boolean;
  readonly bpName: string;
  readonly kind: 'railgun' | 'coilgun' | null;
  /** Emplacement position on the east axis, m. */
  readonly x_m: number;
  readonly charge: {
    readonly stored_J: number;
    readonly target_J: number;
    readonly full_J: number;
    readonly target_fraction: number;
    readonly voltage_fraction: number;
    readonly ready: boolean;
    readonly alloc_W: number;
    readonly demand_W: number;
    readonly brownout: boolean;
  };
  readonly heat: { readonly hottest_K: number; readonly limit_K: number; readonly canFire: boolean; readonly railsDamaged: boolean };
  readonly disabled: boolean;
  readonly jammed: boolean;
  readonly emiImmune: boolean;
  readonly cost: number;
  readonly budget: number;
  readonly stats: PlayerStats;
  readonly lostParts: number;
}

export interface Snapshot {
  readonly n: number;
  /** Simulation time, s. */
  readonly t: number;
  readonly phase: Phase;
  /** Seconds left in a timed phase, else 0. */
  readonly phaseLeft_s: number;
  readonly phaseLength_s: number;
  readonly wave: number;
  readonly waveLabel: string;
  readonly baseHp: number;
  readonly baseHpMax: number;
  readonly score: number;
  readonly spawnedRemaining: number;
  readonly grid: { readonly gen_W: number; readonly buffer_J: number; readonly bufferMax_J: number; readonly demand_W: number; readonly alloc_W: number; readonly bufferFlow_W: number };
  readonly players: readonly PlayerView[];
  /** Alive enemies: id, type index into ENEMY_ORDER, lane, spawn time, remaining hit points in J. */
  readonly enemies: ReadonlyArray<readonly [number, number, number, number, number]>;
  readonly mode: 'defense' | 'range';
  readonly code: string;
}

export interface ScopeTrace {
  readonly t_s: number[];
  readonly I_A: number[];
  readonly v_m_s: number[];
  readonly x_m: number[];
}

export interface ShotReport {
  readonly shotId: number;
  readonly seat: number;
  readonly kind: 'railgun' | 'coilgun';
  readonly status: 'MUZZLE_EXIT' | 'FIZZLE' | 'ABORTED_BY_FAILURE';
  readonly muzzleSpeed_m_s: number;
  readonly muzzleEnergy_J: number;
  readonly muzzleMomentum_Ns: number;
  readonly efficiency: number;
  readonly I_peak_A: number;
  readonly t_end_s: number;
  readonly ledger: {
    readonly E_cap0_J: number; readonly E_ohm_J: number; readonly E_drop_J: number; readonly E_fric_J: number; readonly E_fail_J: number;
    readonly E_muzzle_dump_J: number; readonly E_cap_end_J: number; readonly E_mag_end_J: number; readonly KE_J: number; readonly KE0_J: number; readonly residual_max_rel: number;
  };
  readonly failures: ReadonlyArray<{ kind: string; consequence: string; index: number; t_s: number; limit: number; value: number; unit: string; message: string }>;
  readonly trace: ScopeTrace;
  readonly T_breech_end_K: number;
  readonly V_end_V: number[];
  readonly elevation_mrad: number;
  readonly flightTime_s: number;
  readonly reachable: boolean;
  readonly physicsVersion: string;
}

export interface DebriefPlayer {
  readonly id: string;
  readonly seat: number;
  readonly name: string;
  readonly credits: number;
  readonly efficiencyBonus: number;
  readonly stats: PlayerStats;
}

export type GameEvent =
  | { readonly e: 'phase'; readonly phase: Phase; readonly wave: number }
  | { readonly e: 'spawn'; readonly id: number; readonly type: EnemyType; readonly lane: number }
  | { readonly e: 'fire'; readonly shotId: number; readonly seat: number; readonly x0: number; readonly y0: number; readonly z0: number; readonly vx: number; readonly vy: number; readonly vz: number; readonly mass_kg: number; readonly area_m2: number; readonly material: string; readonly length_m: number; readonly t: number }
  | { readonly e: 'shot'; readonly report: ShotReport }
  | { readonly e: 'hit'; readonly shotId: number; readonly seat: number; readonly enemy: number; readonly type: EnemyType; readonly damage_J: number; readonly energy_J: number; readonly penetrated: boolean; readonly hpLeft_J: number; readonly killed: boolean; readonly x: number; readonly y: number; readonly z: number; readonly speed: number }
  | { readonly e: 'ground'; readonly shotId: number; readonly seat: number; readonly x: number; readonly z: number }
  | { readonly e: 'board'; readonly shotId: number; readonly distance_m: number; readonly x: number; readonly y: number; readonly t: number; readonly speed: number; readonly hit: boolean }
  | { readonly e: 'baseHit'; readonly enemy: number; readonly type: EnemyType; readonly damage: number; readonly baseHp: number }
  | { readonly e: 'failure'; readonly seat: number; readonly message: string; readonly consequence: string }
  | { readonly e: 'jam'; readonly seat: number; readonly on: boolean }
  | { readonly e: 'waveEnd'; readonly wave: number; readonly players: readonly DebriefPlayer[]; readonly baseHp: number; readonly efficiency: number; readonly score: number }
  | { readonly e: 'runEnd'; readonly result: 'victory' | 'defeat'; readonly wave: number; readonly score: number; readonly bonusCredits: number }
  | { readonly e: 'err'; readonly code: ErrorCode; readonly message: string }
  | { readonly e: 'lobby'; readonly note: string };

export interface Outgoing {
  /** 'all' or a player id. */
  readonly to: 'all' | string;
  readonly ev: GameEvent;
}
