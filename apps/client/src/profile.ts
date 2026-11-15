import { BLUEPRINT_SCHEMA_VERSION, defaultUnlocked, GAME, migrateBlueprint, starterCoilgun, starterRailgun, validateBlueprint, type Blueprint } from '@railhold/shared';
import type { ShotReport } from '@railhold/engine';

const KEY = 'railhold.profile.v1';
const SAVE_DELAY_MS = 1500;

export interface Settings {
  volume: number;
  musicVolume: number;
  sfxVolume: number;
  quality: 'high' | 'low';
  reducedMotion: boolean;
  screenShake: boolean;
  sensitivity: number;
  fireKey: string;
}

export interface BlueprintRecord {
  id: string;
  bp: Blueprint;
  updated: number;
}

export interface ShotLogEntry {
  id: string;
  at: number;
  physicsVersion: string;
  report: ShotReport;
  blueprint: Blueprint;
  source: 'range' | 'defense';
}

export interface ProfileData {
  v: 1;
  clientId: string;
  name: string;
  credits: number;
  unlocked: string[];
  blueprints: BlueprintRecord[];
  shots: ShotLogEntry[];
  settings: Settings;
  campaign: { bestWave: number; runs: number; victories: number; bestScore: number; tutorialDone: boolean };
}

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'blocked';

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.7,
  musicVolume: 0.5,
  sfxVolume: 0.85,
  quality: 'high',
  reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  screenShake: true,
  sensitivity: 1,
  fireKey: 'Space',
};

function randomId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fresh(name: string): ProfileData {
  const now = Date.now();
  return {
    v: 1,
    clientId: randomId(),
    name,
    credits: GAME.STARTING_CREDITS,
    unlocked: defaultUnlocked(),
    blueprints: [
      { id: randomId(), bp: starterRailgun(), updated: now },
      { id: randomId(), bp: starterCoilgun(), updated: now },
    ],
    shots: [],
    settings: { ...DEFAULT_SETTINGS },
    campaign: { bestWave: 0, runs: 0, victories: 0, bestScore: 0, tutorialDone: false },
  };
}

/** Read and repair stored data. Returns null when nothing usable is stored. */
function parse(text: string): ProfileData | null {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  const p = o as Partial<ProfileData> | null;
  if (!p || p.v !== 1 || typeof p.name !== 'string' || typeof p.clientId !== 'string') return null;
  const base = fresh(p.name);
  const blueprints: BlueprintRecord[] = [];
  for (const r of Array.isArray(p.blueprints) ? p.blueprints : []) {
    const v = validateBlueprint(migrateBlueprint(r?.bp));
    if (v.ok && typeof r.id === 'string') blueprints.push({ id: r.id, bp: v.value, updated: typeof r.updated === 'number' ? r.updated : Date.now() });
  }
  return {
    v: 1,
    clientId: p.clientId,
    name: p.name,
    credits: typeof p.credits === 'number' && Number.isFinite(p.credits) ? Math.max(0, p.credits) : base.credits,
    unlocked: Array.isArray(p.unlocked) ? p.unlocked.filter((k): k is string => typeof k === 'string') : base.unlocked,
    blueprints: blueprints.length > 0 ? blueprints : base.blueprints,
    shots: Array.isArray(p.shots) ? p.shots.slice(-GAME.LOGBOOK_SHOTS) : [],
    settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) },
    campaign: { ...base.campaign, ...(p.campaign ?? {}) },
  };
}

/** Local profile. Saves to localStorage after a short pause and on page hide; there is no account or server. */
export class Profile {
  data: ProfileData;
  state: SaveState = 'saved';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: SaveState) => void>();
  private storageOk = true;

  private constructor(data: ProfileData) {
    this.data = data;
  }

  static load(): Profile | null {
    try {
      const t = localStorage.getItem(KEY);
      if (!t) return null;
      const d = parse(t);
      return d ? new Profile(d) : null;
    } catch {
      return null;
    }
  }

  static create(name: string): Profile {
    const p = new Profile(fresh(name.trim() || 'Player'));
    p.save();
    return p;
  }

  /** Guest profile that lives in memory only (used when storage is blocked). */
  static memoryOnly(name: string): Profile {
    const p = new Profile(fresh(name));
    p.storageOk = false;
    p.state = 'blocked';
    return p;
  }

  onSave(fn: (s: SaveState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(s: SaveState): void {
    this.state = s;
    for (const l of this.listeners) l(s);
  }

  /** Mark data changed. The write happens after the debounce, or at once with `flush`. */
  touch(): void {
    if (!this.storageOk) {
      this.setState(this.state); // memory-only: nothing to save, but let the UI refresh
      return;
    }
    this.setState('unsaved');
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), SAVE_DELAY_MS);
  }

  flush(): void {
    if (this.timer) this.save();
  }

  private save(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.setState('saving');
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
      this.storageOk = true;
      this.setState('saved');
    } catch {
      this.storageOk = false;
      this.setState('blocked');
    }
  }

  // ---------------------------------------------------------------- blueprints

  blueprint(id: string): BlueprintRecord | undefined {
    return this.data.blueprints.find((b) => b.id === id);
  }

  saveBlueprint(id: string, bp: Blueprint): void {
    const r = this.blueprint(id);
    if (r) {
      r.bp = bp;
      r.updated = Date.now();
    } else this.data.blueprints.push({ id, bp, updated: Date.now() });
    this.touch();
  }

  newBlueprint(bp: Blueprint): string {
    const id = randomId();
    this.data.blueprints.push({ id, bp: { ...bp, schema_version: BLUEPRINT_SCHEMA_VERSION }, updated: Date.now() });
    this.touch();
    return id;
  }

  deleteBlueprint(id: string): boolean {
    if (this.data.blueprints.length <= 1) return false;
    this.data.blueprints = this.data.blueprints.filter((b) => b.id !== id);
    this.touch();
    return true;
  }

  addShot(report: ShotReport, blueprint: Blueprint, source: 'range' | 'defense'): void {
    this.data.shots.push({ id: randomId(), at: Date.now(), physicsVersion: report.physicsVersion, report, blueprint, source });
    if (this.data.shots.length > GAME.LOGBOOK_SHOTS) this.data.shots.splice(0, this.data.shots.length - GAME.LOGBOOK_SHOTS);
    this.touch();
  }

  addCredits(n: number): void {
    this.data.credits += n;
    this.touch();
  }

  unlock(key: string, cost: number): boolean {
    if (this.data.unlocked.includes(key) || this.data.credits < cost) return false;
    this.data.credits -= cost;
    this.data.unlocked.push(key);
    this.touch();
    return true;
  }
}

export function newId(): string {
  return randomId();
}
