import data from './waves.json' with { type: 'json' };
import { parseWaves, type WaveTable } from './waves.ts';

const parsed = parseWaves(data);
if (!parsed.ok) throw new Error(`waves.json is invalid: ${parsed.errors.join(' ')}`);

/** The validated wave table shipped with the game. */
export const WAVE_TABLE: WaveTable = parsed.value;
