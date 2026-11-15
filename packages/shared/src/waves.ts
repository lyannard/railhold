import { ENEMIES, type EnemyType } from './enemies.ts';
import { GAME } from './config.ts';

export interface SpawnGroup {
  readonly type: EnemyType;
  readonly count: number;
  readonly lane: 'spread' | 'random' | number;
  readonly start_s: number;
  readonly interval_s: number;
}

export interface WaveDef {
  readonly number: number;
  readonly label: string;
  readonly spawns: readonly SpawnGroup[];
}

export interface WaveTable {
  readonly version: number;
  readonly waves: readonly WaveDef[];
}

/** Validate the parsed contents of waves.json. */
export function parseWaves(input: unknown): { ok: true; value: WaveTable } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const o = input as { version?: unknown; waves?: unknown } | null;
  if (typeof o !== 'object' || o === null) return { ok: false, errors: ['Wave table must be an object.'] };
  if (o.version !== 1) errors.push('Wave table version must be 1.');
  if (!Array.isArray(o.waves) || o.waves.length !== GAME.WAVES) errors.push(`Wave table needs exactly ${GAME.WAVES} waves.`);
  const waves: WaveDef[] = [];
  if (Array.isArray(o.waves)) {
    o.waves.forEach((w: unknown, i: number) => {
      const p = `waves[${i}]`;
      const wo = w as { number?: unknown; label?: unknown; spawns?: unknown } | null;
      if (typeof wo !== 'object' || wo === null) {
        errors.push(`${p} must be an object.`);
        return;
      }
      if (wo.number !== i + 1) errors.push(`${p}.number must be ${i + 1}.`);
      if (typeof wo.label !== 'string' || wo.label.length === 0) errors.push(`${p}.label must be text.`);
      const spawns: SpawnGroup[] = [];
      if (!Array.isArray(wo.spawns) || wo.spawns.length === 0) errors.push(`${p}.spawns must list at least one group.`);
      else {
        wo.spawns.forEach((s: unknown, j: number) => {
          const sp = s as Record<string, unknown> | null;
          const q = `${p}.spawns[${j}]`;
          if (typeof sp !== 'object' || sp === null) {
            errors.push(`${q} must be an object.`);
            return;
          }
          if (typeof sp.type !== 'string' || !(sp.type in ENEMIES)) errors.push(`${q}.type must be one of ${Object.keys(ENEMIES).join(', ')}.`);
          if (typeof sp.count !== 'number' || !Number.isInteger(sp.count) || sp.count < 1 || sp.count > 100) errors.push(`${q}.count must be a whole number from 1 to 100.`);
          const laneOk = sp.lane === 'spread' || sp.lane === 'random' || (typeof sp.lane === 'number' && Number.isInteger(sp.lane) && sp.lane >= 0 && sp.lane < GAME.LANE_BEARINGS_DEG.length);
          if (!laneOk) errors.push(`${q}.lane must be spread, random or a lane index from 0 to ${GAME.LANE_BEARINGS_DEG.length - 1}.`);
          if (typeof sp.start_s !== 'number' || sp.start_s < 0 || sp.start_s > 300) errors.push(`${q}.start_s must be 0 to 300.`);
          if (typeof sp.interval_s !== 'number' || sp.interval_s < 0.05 || sp.interval_s > 60) errors.push(`${q}.interval_s must be 0.05 to 60.`);
          spawns.push(sp as unknown as SpawnGroup);
        });
      }
      waves.push({ number: i + 1, label: String(wo.label), spawns });
    });
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { version: 1, waves } };
}

/** Enemy count multiplier for a team of `players`. */
export function teamScale(players: number): number {
  return 1 + 0.5 * (Math.max(1, players) - 1);
}

export interface SpawnEvent {
  readonly t_s: number;
  readonly type: EnemyType;
  /** Lane index. */
  readonly lane: number;
}

/**
 * Expand a wave into a time-ordered list of spawn events. `rng` supplies lane choices for
 * random groups so the server can keep the schedule deterministic with a seeded generator.
 */
export function expandWave(wave: WaveDef, players: number, rng: () => number): SpawnEvent[] {
  const lanes = GAME.LANE_BEARINGS_DEG.length;
  const out: SpawnEvent[] = [];
  for (const g of wave.spawns) {
    const n = Math.max(1, Math.round(g.count * teamScale(players)));
    for (let i = 0; i < n; i++) {
      const lane = g.lane === 'spread' ? i % lanes : g.lane === 'random' ? Math.floor(rng() * lanes) : g.lane;
      out.push({ t_s: g.start_s + i * g.interval_s, type: g.type, lane });
    }
  }
  return out.sort((a, b) => a.t_s - b.t_s);
}
