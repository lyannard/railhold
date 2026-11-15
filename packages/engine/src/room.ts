import {
  canFire,
  coolState,
  Flight,
  flightParamsFor,
  freshThermalState,
  mulberry32,
  PHYSICS_CONFIG,
  simulateLauncher,
  sweepPointCapsule,
  type Blueprint as PhysBlueprint,
  type LauncherThermalState,
  type ShieldZone,
} from '@railhold/physics';
import {
  analyzeBlueprint,
  BLUEPRINT_SCHEMA_VERSION,
  cleanName,
  defaultUnlocked,
  emplacementX,
  ENEMIES,
  ENEMY_ORDER,
  enemyCapsule,
  enemyPath,
  expandWave,
  GAME,
  impactDamage,
  lockedParts,
  migrateBlueprint,
  PROTOCOL_VERSION,
  RANGE,
  solveElevation,
  validateBlueprint,
  WAVE_TABLE,
  type Analysis,
  type Blueprint,
  type ClientMessage,
  type EnemyPath,
  type EnemyType,
  type ErrorCode,
  type SpawnEvent,
} from '@railhold/shared';
import { stepGrid, generation_W } from './grid.ts';
import { toReport } from './report.ts';
import type { DebriefPlayer, GameEvent, Outgoing, Phase, PlayerStats, PlayerView, ShotReport, Snapshot } from './types.ts';

const TICK_S = 1 / GAME.TICK_HZ;
const FLIGHT_SUBSTEPS = 4;
const FLIGHT_DT_S = TICK_S / FLIGHT_SUBSTEPS;
const SCOPE_POINTS = 200;
/** Projectiles leaving this box are removed. */
const WORLD_LIMIT_M = 2500;
/** Lead assist picks the enemy nearest the aim point within this distance, m. */
const LEAD_PICK_RADIUS_M = 30;
const LEAD_ITERATIONS = 2;
const FULL_VOLTAGE_FRACTION = GAME.GRID.READY_VOLTAGE_FRACTION;

export interface RoomOptions {
  readonly seed: number;
  readonly mode: 'defense' | 'range';
  readonly code: string;
  readonly hostId: string;
}

interface Player {
  id: string;
  seat: number;
  name: string;
  connected: boolean;
  unlocked: Set<string>;
  bp: Blueprint | null;
  /** Blueprint with destroyed modules removed, valid until the next build phase. */
  work: Blueprint | null;
  /** Analysis of `work` at full charge voltage. */
  full: Analysis | null;
  ready: boolean;
  target: number;
  stored_J: number;
  thermal: LauncherThermalState | null;
  thermalT: number;
  lastShotT: number;
  disabled: boolean;
  jammed: boolean;
  shotCount: number;
  alloc_W: number;
  demand_W: number;
  brownout: boolean;
  stats: PlayerStats;
  runStats: PlayerStats;
  msgWindowStart: number;
  msgCount: number;
  lostParts: number;
  elevation_mrad: number;
  aimX: number;
  aimZ: number;
  lead: boolean;
  x_m: number;
  disconnectedAt: number;
}

interface Enemy {
  id: number;
  type: EnemyType;
  lane: number;
  spawnT: number;
  hp: number;
  path: EnemyPath;
  alive: boolean;
}

interface Projectile {
  id: number;
  seat: number;
  flight: Flight;
  mass_kg: number;
  area_m2: number;
  age_s: number;
  /** Range boards already crossed. */
  boardsDone: number;
}

export function emptyStats(): PlayerStats {
  return { kills: 0, damage_J: 0, shots: 0, hits: 0, drawn_J: 0, muzzle_J: 0 };
}

function hashSeed(a: number, b: number, c: number): number {
  let h = (a ^ Math.imul(b + 1, 0x9e3779b1) ^ Math.imul(c + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Build budget in credits for a wave (brief section 5.1: cost cap per run, rising per wave). */
export function budgetForWave(wave: number): number {
  return GAME.BUILD_BUDGET + GAME.BUILD_BUDGET_PER_WAVE * (Math.max(1, wave) - 1);
}

/** Blueprint with every bank charged to `f` times its chosen voltage. */
export function scaleCharge(bp: Blueprint, f: number): Blueprint {
  if (bp.kind === 'railgun') return { ...bp, banks: bp.banks.map((b) => ({ ...b, charge_V: b.charge_V * f })) };
  return { ...bp, stages: bp.stages.map((s) => ({ ...s, charge_V: s.charge_V * f })) };
}

/** Remove the module or stage at `index` (a part destroyed by an exceeded rating). */
function withoutPart(bp: Blueprint, index: number): Blueprint | null {
  if (bp.kind === 'railgun') {
    const banks = bp.banks.filter((_, i) => i !== index);
    return banks.length > 0 ? { ...bp, banks } : null;
  }
  const stages = bp.stages.filter((_, i) => i !== index);
  return stages.length > 0 ? { ...bp, stages } : null;
}

export type JoinResult = { ok: true; seat: number } | { ok: false; code: ErrorCode; message: string };

/**
 * The match. One instance runs in the host's browser (in a Web Worker); guests send messages to
 * it and receive snapshots and events. The class does no I/O: callers feed it messages and time,
 * and drain its events. Everything is deterministic for a given seed and message sequence.
 */
export class Room {
  readonly opts: RoomOptions;
  phase: Phase;
  wave = 0;
  t = 0;
  private phaseT = 0;
  private phaseLen = 0;
  private acc = 0;
  private snapN = 0;
  private readonly rng: () => number;
  private readonly players: Player[] = [];
  private readonly out: Outgoing[] = [];
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private schedule: SpawnEvent[] = [];
  private scheduleIdx = 0;
  private waveT = 0;
  private nextEnemyId = 1;
  private nextShotId = 1;
  private baseHp: number = GAME.BASE_HP;
  private buffer_J: number = GAME.GRID.E_BUF_J;
  private bufferFlow_W = 0;
  private gridDemand_W = 0;
  private gridAlloc_W = 0;
  private score = 0;
  private waveKillHp = 0;
  private waveDrawn_J = 0;
  private waveMuzzle_J = 0;
  private readonly scoreAt = new Map<number, number>();
  private totalDrawn_J = 0;
  private totalMuzzle_J = 0;
  private waveStats = new Map<string, PlayerStats>();
  private seatCount = 0;
  private lastJamState = new Map<string, boolean>();

  constructor(opts: RoomOptions) {
    this.opts = opts;
    this.rng = mulberry32(opts.seed);
    this.phase = opts.mode === 'range' ? 'range' : 'lobby';
  }

  // ------------------------------------------------------------------ players

  get playerCount(): number {
    return this.players.length;
  }

  hasPlayer(id: string): boolean {
    return this.players.some((p) => p.id === id);
  }

  /** Add a player, or reconnect one that dropped. */
  join(id: string, name: string, unlocked: readonly string[]): JoinResult {
    const known = this.players.find((p) => p.id === id);
    const keys = new Set<string>([...defaultUnlocked(), ...unlocked]);
    if (known) {
      known.connected = true;
      known.name = cleanName(name);
      known.unlocked = keys;
      this.emit(id, { e: 'lobby', note: 'Reconnected to your seat.' });
      return { ok: true, seat: known.seat };
    }
    if (this.phase !== 'lobby' && this.phase !== 'range') return { ok: false, code: 'room_started', message: 'This match has already started. Ask the host for a new code.' };
    if (this.players.length >= (this.opts.mode === 'range' ? 1 : GAME.MAX_PLAYERS)) return { ok: false, code: 'room_full', message: `This room is full (${GAME.MAX_PLAYERS} players).` };
    const seat = this.players.length;
    this.players.push({
      id, seat, name: cleanName(name), connected: true, unlocked: keys, bp: null, work: null, full: null, ready: false, target: 1,
      stored_J: 0, thermal: null, thermalT: this.t, lastShotT: -10, disabled: false, jammed: false, shotCount: 0, alloc_W: 0, demand_W: 0, brownout: false,
      stats: emptyStats(), runStats: emptyStats(), msgWindowStart: this.t, msgCount: 0, lostParts: 0, elevation_mrad: 0, aimX: 0, aimZ: 100, lead: true,
      x_m: 0, disconnectedAt: 0,
    });
    this.layoutSeats();
    return { ok: true, seat };
  }

  /** Mark a player as gone. In the lobby the seat is freed, later it is held for a reconnect. */
  leave(id: string): void {
    const p = this.players.find((q) => q.id === id);
    if (!p) return;
    if (this.phase === 'lobby') {
      this.players.splice(this.players.indexOf(p), 1);
      this.players.forEach((q, i) => (q.seat = i));
      this.layoutSeats();
      this.lastJamState.delete(id);
      return;
    }
    p.connected = false;
    p.ready = true;
    p.disconnectedAt = this.t;
  }

  private layoutSeats(): void {
    this.seatCount = this.players.length;
    for (const p of this.players) p.x_m = this.opts.mode === 'range' ? 0 : emplacementX(p.seat, this.seatCount);
  }

  private player(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  private emit(to: 'all' | string, ev: GameEvent): void {
    this.out.push({ to, ev });
  }

  private fail(id: string, code: ErrorCode, message: string): void {
    this.emit(id, { e: 'err', code, message });
  }

  /** Events produced since the last call. */
  drainEvents(): Outgoing[] {
    const o = this.out.slice();
    this.out.length = 0;
    return o;
  }

  // ------------------------------------------------------------------ messages

  handle(id: string, msg: ClientMessage): void {
    const p = this.player(id);
    if (!p) {
      this.fail(id, 'not_in_room', 'You are not in this room.');
      return;
    }
    if (this.t - p.msgWindowStart >= 1) {
      p.msgWindowStart = this.t;
      p.msgCount = 0;
    }
    if (++p.msgCount > GAME.MSG_RATE_PER_S) {
      if (p.msgCount === GAME.MSG_RATE_PER_S + 1) this.fail(id, 'rate_limited', 'Too many messages. Slow down.');
      return;
    }
    switch (msg.t) {
      case 'hello':
      case 'ping':
        return;
      case 'loadout':
        this.setLoadout(p, msg.blueprint);
        return;
      case 'ready':
        if (this.phase !== 'lobby' && this.phase !== 'build') return this.fail(id, 'wrong_phase', 'Ready can only be set in the lobby or the build phase.');
        if (msg.value && !p.bp) return this.fail(id, 'no_blueprint', 'Choose a blueprint first.');
        p.ready = msg.value;
        return;
      case 'start':
        return this.startRun(p);
      case 'retry':
        if (p.id !== this.opts.hostId) return this.fail(id, 'not_host', 'Only the host can restart the run.');
        if (this.phase !== 'defeat') return this.fail(id, 'wrong_phase', 'You can only retry after the base is lost.');
        this.retry(msg.wave);
        return;
      case 'next':
        if (p.id !== this.opts.hostId) return this.fail(id, 'not_host', 'Only the host can skip the debrief.');
        if (this.phase === 'debrief') this.beginBuild();
        return;
      case 'aim':
        if (msg.x !== undefined && msg.z !== undefined) {
          p.aimX = msg.x;
          p.aimZ = msg.z;
        }
        if (msg.lead !== undefined) p.lead = msg.lead;
        if (msg.elevation_mrad !== undefined) p.elevation_mrad = Math.max(RANGE.ELEVATION_MRAD.min, Math.min(RANGE.ELEVATION_MRAD.max, msg.elevation_mrad));
        return;
      case 'chargeTarget':
        p.target = Math.max(GAME.MIN_CHARGE_TARGET, Math.min(1, msg.fraction));
        return;
      case 'fire':
        return this.fire(p);
      case 'leave':
        this.leave(id);
        return;
    }
  }

  private setLoadout(p: Player, raw: unknown): void {
    if (this.phase !== 'lobby' && this.phase !== 'build' && this.phase !== 'range') return this.fail(p.id, 'wrong_phase', 'Blueprints can only be changed in the lobby or the build phase.');
    const v = validateBlueprint(migrateBlueprint(raw));
    if (!v.ok) return this.fail(p.id, 'blueprint_invalid', `Blueprint is not valid: ${v.issues[0].field}: ${v.issues[0].message}`);
    if (v.value.schema_version !== BLUEPRINT_SCHEMA_VERSION) return this.fail(p.id, 'blueprint_invalid', 'Blueprint schema version is not supported.');
    const a = analyzeBlueprint(v.value);
    if (a.modelIssues.length > 0) return this.fail(p.id, 'blueprint_invalid', `Outside the model's range: ${a.modelIssues[0].message}`);
    const locked = lockedParts(a, [...p.unlocked]);
    if (locked.length > 0) return this.fail(p.id, 'parts_locked', `Locked parts in this blueprint: ${locked.join(', ')}. Unlock them in the workshop first.`);
    const budget = this.opts.mode === 'range' ? Infinity : budgetForWave(Math.max(1, this.wave));
    if (a.cost > budget) return this.fail(p.id, 'over_budget', `Blueprint costs ${Math.round(a.cost)} credits; the budget is ${budget}.`);
    p.bp = v.value;
    p.work = v.value;
    p.full = a;
    p.thermal = freshThermalState({ kind: a.blueprint.kind, design: a.design } as PhysBlueprint);
    p.thermalT = this.t;
    p.stored_J = Math.min(p.stored_J, a.bankEnergy_J);
    p.disabled = false;
    p.lostParts = 0;
    p.ready = false;
    if (this.opts.mode === 'range') {
      p.stored_J = a.bankEnergy_J;
      this.warm();
    }
  }

  private startRun(p: Player): void {
    if (p.id !== this.opts.hostId) return this.fail(p.id, 'not_host', 'Only the host can start the match.');
    if (this.phase !== 'lobby') return this.fail(p.id, 'wrong_phase', 'The match has already started.');
    const waiting = this.players.filter((q) => q.connected && !q.bp);
    if (waiting.length > 0) return this.fail(p.id, 'no_blueprint', `${waiting.map((q) => q.name).join(', ')} still need to choose a blueprint.`);
    const notReady = this.players.filter((q) => q.connected && q.id !== p.id && !q.ready);
    if (notReady.length > 0) return this.fail(p.id, 'not_ready', `${notReady.map((q) => q.name).join(', ')} not ready yet.`);
    this.layoutSeats();
    this.wave = 1;
    this.beginBuild();
  }

  // ------------------------------------------------------------------ phases

  /** The build and debrief timers only run when more than one person is connected: a lone player is never rushed. */
  private timed(): boolean {
    return this.phaseLen > 0 && ((this.phase !== 'build' && this.phase !== 'debrief') || this.humans() > 1);
  }

  private humans(): number {
    return this.players.filter((p) => p.connected).length;
  }

  private setPhase(phase: Phase, length_s: number): void {
    this.phase = phase;
    this.phaseT = 0;
    this.phaseLen = length_s;
    this.emit('all', { e: 'phase', phase, wave: this.wave });
  }

  /** After a defeat: go back to the build phase of `fromWave` (clamped to the wave that was lost) with a repaired base. */
  private retry(fromWave: number): void {
    const w = Math.min(Math.max(1, Math.floor(fromWave)), Math.max(1, this.wave));
    this.wave = w;
    this.baseHp = GAME.BASE_HP;
    this.enemies = [];
    this.projectiles = [];
    this.score = this.scoreAt.get(w) ?? 0;
    if (w === 1) {
      this.totalDrawn_J = 0;
      this.totalMuzzle_J = 0;
    }
    for (const p of this.players) p.stored_J = 0;
    this.beginBuild();
  }

  private beginBuild(): void {
    this.scoreAt.set(this.wave, this.score);
    for (const p of this.players) {
      // Repairs between waves are free (game rule): destroyed parts, damaged rails and the mount come back.
      p.work = p.bp;
      if (p.bp) {
        p.full = analyzeBlueprint(p.bp);
        if (p.thermal) p.thermal = { ...p.thermal, railsDamaged: false };
      }
      p.disabled = false;
      p.lostParts = 0;
      p.ready = !p.connected;
      p.stored_J = Math.min(p.stored_J, p.full?.bankEnergy_J ?? 0);
    }
    this.setPhase('build', GAME.BUILD_PHASE_S);
  }

  /** Run each launcher's shot once and discard it, so the JavaScript engine compiles the solver before the first real shot. */
  private warm(): void {
    for (const p of this.players) {
      if (!p.work || !p.full || !p.thermal) continue;
      try {
        simulateLauncher({ kind: p.full.blueprint.kind, design: p.full.design } as PhysBlueprint, freshThermalState({ kind: p.full.blueprint.kind, design: p.full.design } as PhysBlueprint), 1);
      } catch {
        /* a blueprint that cannot be simulated is reported when the player fires */
      }
    }
  }

  private beginCharge(): void {
    for (const p of this.players) if (p.bp && !p.work) p.work = p.bp;
    this.warm();
    this.setPhase('charge', GAME.CHARGE_PHASE_S);
  }

  private beginDefense(): void {
    const w = WAVE_TABLE.waves[this.wave - 1];
    this.schedule = expandWave(w, Math.max(1, this.players.filter((p) => p.connected).length), this.rng);
    this.scheduleIdx = 0;
    this.waveT = 0;
    this.waveKillHp = 0;
    this.waveDrawn_J = 0;
    this.waveMuzzle_J = 0;
    this.waveStats = new Map(this.players.map((p) => [p.id, emptyStats()]));
    this.setPhase('defense', 0);
  }

  private endWave(): void {
    const eff = this.waveDrawn_J > 0 ? Math.min(1, this.waveMuzzle_J / this.waveDrawn_J) : 0;
    const bonus = Math.round(GAME.CREDITS.EFFICIENCY_BONUS_MAX * Math.min(1, eff / GAME.EFFICIENCY_REF));
    const base = GAME.CREDITS.PER_WAVE_BASE + GAME.CREDITS.PER_WAVE_STEP * (this.wave - 1);
    const players: DebriefPlayer[] = this.players.map((p) => ({
      id: p.id, seat: p.seat, name: p.name, credits: base + bonus, efficiencyBonus: bonus, stats: this.waveStats.get(p.id) ?? emptyStats(),
    }));
    this.score += GAME.SCORE.PER_KILL_HP_J * this.waveKillHp;
    this.emit('all', { e: 'waveEnd', wave: this.wave, players, baseHp: this.baseHp, efficiency: eff, score: Math.round(this.score) });
    if (this.wave >= GAME.WAVES) {
      this.finishRun('victory');
      return;
    }
    this.wave += 1;
    this.setPhase('debrief', GAME.DEBRIEF_S);
  }

  private finishRun(result: 'victory' | 'defeat'): void {
    const eff = this.totalDrawn_J > 0 ? Math.min(1, this.totalMuzzle_J / this.totalDrawn_J) : 0;
    this.score += GAME.SCORE.EFFICIENCY_WEIGHT * eff + GAME.SCORE.BASE_HP_WEIGHT * Math.max(0, this.baseHp);
    this.projectiles = [];
    this.setPhase(result, 0);
    this.emit('all', { e: 'runEnd', result, wave: result === 'victory' ? GAME.WAVES : this.wave, score: Math.round(this.score), bonusCredits: result === 'victory' ? GAME.CREDITS.CAMPAIGN_COMPLETE_BONUS : 0 });
  }

  // ------------------------------------------------------------------ time

  /** Advance by wall-clock time. Runs whole 1/60 s ticks, at most MAX_CATCHUP_S per call. */
  advance(dt_s: number): void {
    this.acc += Math.min(Math.max(dt_s, 0), GAME.MAX_CATCHUP_S);
    while (this.acc >= TICK_S) {
      this.acc -= TICK_S;
      this.tick(TICK_S);
    }
  }

  tick(dt: number): void {
    this.t += dt;
    this.phaseT += dt;
    for (const p of this.players) if (!p.connected && this.phase === 'build') p.ready = true;
    switch (this.phase) {
      case 'build':
        if ((this.timed() && this.phaseT >= this.phaseLen) || (this.players.length > 0 && this.players.every((p) => p.ready))) this.beginCharge();
        break;
      case 'charge':
        this.stepPower(dt);
        if (this.phaseT >= this.phaseLen) this.beginDefense();
        break;
      case 'defense':
        this.waveT += dt;
        this.stepPower(dt);
        this.spawn();
        this.stepJammers();
        this.stepProjectiles(dt);
        this.stepEnemies();
        if (this.baseHp <= 0) this.finishRun('defeat');
        else if (this.scheduleIdx >= this.schedule.length && this.enemies.length === 0) this.endWave();
        break;
      case 'debrief':
        if (this.timed() && this.phaseT >= this.phaseLen) this.beginBuild();
        break;
      case 'range':
        this.stepProjectiles(dt);
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------ power

  private energyAtTarget(p: Player): number {
    return p.full ? p.full.bankEnergy_J * p.target * p.target : 0;
  }

  private stepPower(dt: number): void {
    const demands = this.players.map((p) => {
      const cap = this.energyAtTarget(p);
      if (!p.work || p.disabled || !p.connected || p.stored_J >= cap) {
        if (p.stored_J > cap) p.stored_J = cap;
        return 0;
      }
      return Math.min(GAME.GRID.P_CHARGER_MAX_W, (cap - p.stored_J) / (GAME.GRID.ETA_CHARGE * dt));
    });
    const g = stepGrid({ players: Math.max(1, this.players.filter((p) => p.connected).length), buffer_J: this.buffer_J, demand_W: demands, dt_s: dt });
    this.buffer_J = g.buffer_J;
    this.bufferFlow_W = g.bufferFlow_W;
    this.gridDemand_W = demands.reduce((a, b) => a + b, 0);
    this.gridAlloc_W = g.alloc_W.reduce((a, b) => a + b, 0);
    this.players.forEach((p, i) => {
      p.alloc_W = g.alloc_W[i];
      p.demand_W = demands[i];
      p.brownout = g.brownout[i];
      const drawn = g.alloc_W[i] * dt;
      p.stored_J += drawn * GAME.GRID.ETA_CHARGE;
      const cap = this.energyAtTarget(p);
      if (p.stored_J > cap) p.stored_J = cap;
      p.runStats.drawn_J += drawn;
      this.totalDrawn_J += drawn;
      this.waveDrawn_J += drawn;
      const ws = this.waveStats.get(p.id);
      if (ws) ws.drawn_J += drawn;
    });
  }

  // ------------------------------------------------------------------ enemies

  private enemyPos(e: Enemy, t: number): { x: number; z: number } {
    const age = Math.max(0, t - e.spawnT);
    return { x: e.path.x0 + e.path.dx * e.path.speed_m_s * age, z: e.path.z0 + e.path.dz * e.path.speed_m_s * age };
  }

  private spawn(): void {
    while (this.scheduleIdx < this.schedule.length && this.schedule[this.scheduleIdx].t_s <= this.waveT) {
      const s = this.schedule[this.scheduleIdx++];
      const id = this.nextEnemyId++;
      const def = ENEMIES[s.type];
      const e: Enemy = { id, type: s.type, lane: s.lane, spawnT: this.t, hp: def.hp_J, path: enemyPath(id, s.type, s.lane), alive: true };
      this.enemies.push(e);
      this.emit('all', { e: 'spawn', id, type: s.type, lane: s.lane });
    }
  }

  private stepEnemies(): void {
    const keep: Enemy[] = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const pos = this.enemyPos(e, this.t);
      if (Math.hypot(pos.x, pos.z) <= GAME.BASE_CONTACT_RADIUS_M) {
        const def = ENEMIES[e.type];
        this.baseHp -= def.contactDamage;
        e.alive = false;
        this.emit('all', { e: 'baseHit', enemy: e.id, type: e.type, damage: def.contactDamage, baseHp: Math.max(0, this.baseHp) });
        continue;
      }
      keep.push(e);
    }
    this.enemies = keep;
  }

  private stepJammers(): void {
    const states = new Map<string, boolean>();
    for (const p of this.players) states.set(p.id, false);
    for (const e of this.enemies) {
      if (e.type !== 'jammer') continue;
      const age = this.t - e.spawnT;
      const k = Math.floor(age / GAME.JAMMER.PERIOD_S);
      if (k < 1 || age - k * GAME.JAMMER.PERIOD_S >= GAME.JAMMER.DURATION_S) continue;
      const pos = this.enemyPos(e, this.t);
      for (const p of this.players) {
        if (Math.hypot(pos.x - p.x_m, pos.z) <= GAME.JAMMER.RANGE_M && !(p.full?.emiImmune ?? false)) states.set(p.id, true);
      }
    }
    for (const p of this.players) {
      const on = states.get(p.id) ?? false;
      if (on !== p.jammed) this.emit('all', { e: 'jam', seat: p.seat, on });
      p.jammed = on;
    }
  }

  // ------------------------------------------------------------------ firing

  private thermalNow(p: Player): LauncherThermalState | null {
    if (!p.thermal || !p.full) return null;
    const dt = this.t - p.thermalT;
    if (dt > 0) {
      p.thermal = coolState(p.thermal, dt, p.full.coolingTau_s);
      p.thermalT = this.t;
    }
    return p.thermal;
  }

  private voltageFraction(p: Player): number {
    if (!p.full || p.full.bankEnergy_J <= 0) return 0;
    return Math.sqrt(p.stored_J / p.full.bankEnergy_J);
  }

  private fire(p: Player): void {
    const isRange = this.opts.mode === 'range';
    if (this.phase !== 'defense' && this.phase !== 'charge' && !isRange) return this.fail(p.id, 'wrong_phase', 'You can fire once the wave begins.');
    if (!p.work || !p.full || !p.thermal) return this.fail(p.id, 'no_blueprint', 'Choose a blueprint first.');
    if (p.disabled) return this.fail(p.id, 'launcher_disabled', 'Launcher is disabled until the next build phase.');
    if (p.jammed) return this.fail(p.id, 'jammed', 'Electrical trigger link is jammed. A fiber-optic link would not be affected.');
    if (this.t - p.lastShotT < GAME.FIRE_MIN_INTERVAL_S) return;
    const therm = this.thermalNow(p);
    if (!therm || !canFire(therm)) return this.fail(p.id, 'overheated', 'Launcher is too hot to fire. Wait for it to cool.');
    if (isRange) p.stored_J = p.full.bankEnergy_J * p.target * p.target;
    const vf = Math.min(p.target, this.voltageFraction(p));
    if (vf < p.target * FULL_VOLTAGE_FRACTION) return this.fail(p.id, 'no_charge', 'Banks are not charged to the target yet.');
    const shotBp = scaleCharge(p.work, vf);
    const a = analyzeBlueprint(shotBp);
    const shotId = this.nextShotId++;
    p.lastShotT = this.t;
    let r;
    try {
      r = simulateLauncher({ kind: a.blueprint.kind, design: a.design } as PhysBlueprint, therm, hashSeed(this.opts.seed, p.seat, p.shotCount++));
    } catch {
      return this.fail(p.id, 'internal', 'The physics solver failed on this shot.');
    }
    if (!r.result.ok) return this.fail(p.id, 'blueprint_invalid', r.result.issues[0]?.message ?? 'Blueprint cannot be simulated.');
    const s = r.result;
    p.thermal = r.nextState;
    p.thermalT = this.t;
    p.stored_J = Math.max(0, p.stored_J - s.ledger.E_cap0_J + s.ledger.E_cap_end_J);
    p.runStats.shots++;
    const wsShot = this.waveStats.get(p.id);
    if (wsShot) wsShot.shots++;
    const muzzle = s.status === 'MUZZLE_EXIT';
    if (muzzle) {
      p.runStats.muzzle_J += s.muzzleEnergy_J;
      this.totalMuzzle_J += s.muzzleEnergy_J;
      this.waveMuzzle_J += s.muzzleEnergy_J;
      const ws = this.waveStats.get(p.id);
      if (ws) ws.muzzle_J += s.muzzleEnergy_J;
    }

    // Aim: the host solves the elevation with the real flight, so the crosshair number is the flight time.
    const params = flightParamsFor(a.projectile, a.projectileMass_kg);
    let elevation = 0;
    let flightTime = 0;
    let reachable = true;
    let az = 0;
    if (isRange) {
      elevation = p.elevation_mrad / 1000;
    } else {
      let ax = p.aimX;
      let az0 = p.aimZ;
      let aimY = GAME.AIM_HEIGHT_M;
      const v = s.muzzleSpeed_m_s;
      if (muzzle && p.lead && v > 0) {
        // Lead assist: pick the enemy nearest the aim point and intercept where its straight path will be when the slug arrives.
        let tgt: Enemy | null = null;
        let best = LEAD_PICK_RADIUS_M * LEAD_PICK_RADIUS_M;
        for (const e of this.enemies) {
          const q = this.enemyPos(e, this.t);
          const d2 = (q.x - p.aimX) ** 2 + (q.z - p.aimZ) ** 2;
          if (d2 < best) {
            best = d2;
            tgt = e;
          }
        }
        if (tgt) {
          const def = ENEMIES[tgt.type];
          aimY = tgt.path.altitude_m + Math.max(def.radius_m, def.height_m / 2);
          let T = 0;
          for (let i = 0; i < LEAD_ITERATIONS; i++) {
            const q = this.enemyPos(tgt, this.t + T);
            const range = Math.hypot(q.x - p.x_m, q.z);
            T = solveElevation(params, v, Math.max(range, 1), aimY, GAME.MUZZLE_HEIGHT_M).flightTime_s;
          }
          const q = this.enemyPos(tgt, this.t + T);
          ax = q.x;
          az0 = q.z;
        }
      }
      const dx = ax - p.x_m;
      const dz = az0;
      const range = Math.hypot(dx, dz);
      az = Math.atan2(dx, dz);
      if (muzzle && range > 1) {
        const sol = solveElevation(params, s.muzzleSpeed_m_s, range, aimY, GAME.MUZZLE_HEIGHT_M);
        elevation = sol.elevation_rad;
        flightTime = sol.flightTime_s;
        reachable = sol.reachable;
      }
    }
    if (muzzle) {
      const flight = new Flight(params);
      const ce = Math.cos(elevation);
      const v = s.muzzleSpeed_m_s;
      const vx = v * ce * Math.sin(az);
      const vz = v * ce * Math.cos(az);
      const vy = v * Math.sin(elevation);
      flight.reset(p.x_m, GAME.MUZZLE_HEIGHT_M, 0, vx, vy, vz);
      this.projectiles.push({ id: shotId, seat: p.seat, flight, mass_kg: a.projectileMass_kg, area_m2: a.projectile.frontalArea_m2, age_s: 0, boardsDone: 0 });
      this.emit('all', {
        e: 'fire', shotId, seat: p.seat, x0: p.x_m, y0: GAME.MUZZLE_HEIGHT_M, z0: 0, vx, vy, vz, mass_kg: a.projectileMass_kg, area_m2: a.projectile.frontalArea_m2,
        material: a.projectile.material, length_m: a.projectile.length_m, t: this.t,
      });
    }
    const report: ShotReport = toReport(s, { shotId, seat: p.seat, elevation_mrad: elevation * 1000, flightTime_s: flightTime, reachable }, SCOPE_POINTS);
    this.emit(p.id, { e: 'shot', report });
    this.applyFailures(p, s.failures);
  }

  private applyFailures(p: Player, failures: readonly { consequence: string; index: number; message: string }[]): void {
    const removed: number[] = [];
    for (const f of failures) {
      this.emit('all', { e: 'failure', seat: p.seat, message: f.message, consequence: f.consequence });
      if (f.consequence === 'mount_destroyed') p.disabled = true;
      else if ((f.consequence === 'module_lost' || f.consequence === 'switch_open' || f.consequence === 'stage_lost') && f.index >= 0 && !removed.includes(f.index)) removed.push(f.index);
    }
    if (removed.length === 0 || !p.work) return;
    // Remove from the highest index down so earlier indices stay valid. A destroyed part is gone until the next build phase.
    let w: Blueprint | null = p.work;
    for (const i of removed.sort((x, y) => y - x)) {
      w = w ? withoutPart(w, i) : null;
      p.lostParts++;
    }
    if (!w) {
      p.disabled = true;
      p.stored_J = 0;
      return;
    }
    p.work = w;
    p.full = analyzeBlueprint(w);
    p.stored_J = Math.min(p.stored_J, p.full.bankEnergy_J);
  }

  // ------------------------------------------------------------------ projectiles

  private shieldFor(x: number, y: number, z: number, t: number): ShieldZone | null {
    for (const e of this.enemies) {
      if (e.type !== 'shield' || !e.alive) continue;
      const pos = this.enemyPos(e, t);
      const dx = x - pos.x;
      const dy = y - 1;
      const dz = z - pos.z;
      if (dx * dx + dy * dy + dz * dz < GAME.SHIELD.RADIUS_M * GAME.SHIELD.RADIUS_M) {
        return { cx_m: pos.x, cy_m: 1, cz_m: pos.z, radius_m: GAME.SHIELD.RADIUS_M, B_T: GAME.SHIELD.B_T };
      }
    }
    return null;
  }

  private stepProjectiles(dt: number): void {
    if (this.projectiles.length === 0) return;
    const live: Projectile[] = [];
    const p0 = [0, 0, 0];
    const p1 = [0, 0, 0];
    const a = [0, 0, 0];
    const b = [0, 0, 0];
    const tickStart = this.t - dt;
    for (const pr of this.projectiles) {
      let done = false;
      const owner = this.players[pr.seat];
      const f = pr.flight;
      const defense = this.opts.mode === 'defense';
      for (let k = 0; k < FLIGHT_SUBSTEPS && !done; k++) {
        const tSub = tickStart + (k + 0.5) * FLIGHT_DT_S;
        p0[0] = f.s[0]; p0[1] = f.s[1]; p0[2] = f.s[2];
        f.shield = defense ? this.shieldFor(p0[0], p0[1], p0[2], tSub) : null;
        f.step(FLIGHT_DT_S);
        p1[0] = f.s[0]; p1[1] = f.s[1]; p1[2] = f.s[2];
        pr.age_s += FLIGHT_DT_S;
        // Ground: first contact on this segment.
        let sGround = -1;
        if (p1[1] <= 0) sGround = p0[1] <= 0 ? 0 : p0[1] / (p0[1] - p1[1]);
        // Enemies: earliest swept contact.
        let sHit = Infinity;
        let hitEnemy: Enemy | null = null;
        if (defense) {
          const minX = Math.min(p0[0], p1[0]) - 4;
          const maxX = Math.max(p0[0], p1[0]) + 4;
          const minZ = Math.min(p0[2], p1[2]) - 4;
          const maxZ = Math.max(p0[2], p1[2]) + 4;
          for (const e of this.enemies) {
            if (!e.alive) continue;
            const pos = this.enemyPos(e, tSub);
            if (pos.x < minX || pos.x > maxX || pos.z < minZ || pos.z > maxZ) continue;
            const def = ENEMIES[e.type];
            const cap = enemyCapsule(def, e.path.altitude_m, pos.x, pos.z);
            a[0] = cap.ax; a[1] = cap.ay; a[2] = cap.az;
            b[0] = cap.bx; b[1] = cap.by; b[2] = cap.bz;
            const s = sweepPointCapsule(p0, p1, a, b, def.radius_m);
            if (s >= 0 && s < sHit) {
              sHit = s;
              hitEnemy = e;
            }
          }
        } else {
          this.checkBoards(pr, p0, p1, tSub);
        }
        if (hitEnemy && (sGround < 0 || sHit <= sGround)) {
          this.applyHit(pr, hitEnemy, p0, p1, sHit, owner);
          done = true;
        } else if (sGround >= 0) {
          const gx = p0[0] + sGround * (p1[0] - p0[0]);
          const gz = p0[2] + sGround * (p1[2] - p0[2]);
          this.emit('all', { e: 'ground', shotId: pr.id, seat: pr.seat, x: gx, z: gz });
          done = true;
        } else if (pr.age_s > GAME.MAX_FLIGHT_TIME_S || Math.abs(p1[0]) > WORLD_LIMIT_M || Math.abs(p1[2]) > WORLD_LIMIT_M || !Number.isFinite(p1[0] + p1[1] + p1[2])) {
          done = true;
        }
      }
      if (!done) live.push(pr);
    }
    this.projectiles = live;
  }

  private checkBoards(pr: Projectile, p0: number[], p1: number[], t: number): void {
    const d = RANGE.BOARD_DISTANCES_M;
    while (pr.boardsDone < d.length && p0[2] < d[pr.boardsDone] && p1[2] >= d[pr.boardsDone]) {
      const board = d[pr.boardsDone];
      const u = (board - p0[2]) / (p1[2] - p0[2]);
      const x = p0[0] + u * (p1[0] - p0[0]);
      const y = p0[1] + u * (p1[1] - p0[1]);
      const hit = Math.abs(x) <= RANGE.BOARD_HALF_WIDTH_M && y >= 0 && y <= RANGE.BOARD_HEIGHT_M;
      this.emit('all', { e: 'board', shotId: pr.id, distance_m: board, x, y, t: pr.age_s - (1 - u) * FLIGHT_DT_S + 0 * t, speed: pr.flight.speed_m_s, hit });
      pr.boardsDone++;
    }
  }

  private applyHit(pr: Projectile, e: Enemy, p0: number[], p1: number[], s: number, owner: Player): void {
    const def = ENEMIES[e.type];
    const speed = pr.flight.speed_m_s;
    const r = impactDamage(def, pr.mass_kg, speed, pr.area_m2);
    const before = e.hp;
    e.hp -= r.damage_J;
    const killed = e.hp <= 0;
    const dealt = Math.min(before, r.damage_J);
    owner.runStats.hits++;
    owner.runStats.damage_J += dealt;
    const ws = this.waveStats.get(owner.id);
    if (ws) {
      ws.hits++;
      ws.damage_J += dealt;
    }
    if (killed) {
      e.alive = false;
      owner.runStats.kills++;
      if (ws) ws.kills++;
      this.waveKillHp += def.hp_J;
      this.enemies = this.enemies.filter((x) => x !== e);
    }
    this.emit('all', {
      e: 'hit', shotId: pr.id, seat: pr.seat, enemy: e.id, type: e.type, damage_J: r.damage_J, energy_J: r.energy_J, penetrated: r.penetrates, hpLeft_J: Math.max(0, e.hp), killed,
      x: p0[0] + s * (p1[0] - p0[0]), y: p0[1] + s * (p1[1] - p0[1]), z: p0[2] + s * (p1[2] - p0[2]), speed,
    });
  }

  // ------------------------------------------------------------------ snapshot

  snapshot(): Snapshot {
    const lim = PHYSICS_CONFIG.LAUNCHER_FIRE_LIMIT_K;
    const players: PlayerView[] = this.players.map((p) => {
      const th = this.thermalNow(p);
      const hottest = th ? Math.max(th.railBulk_K, ...th.coilBulk_K) : 0;
      const target_J = this.energyAtTarget(p);
      const full_J = p.full?.bankEnergy_J ?? 0;
      return {
        id: p.id, seat: p.seat, name: p.name, host: p.id === this.opts.hostId, connected: p.connected, ready: p.ready, hasLoadout: p.bp !== null,
        bpName: p.bp?.name ?? '', kind: p.bp?.kind ?? null, x_m: p.x_m,
        charge: {
          stored_J: p.stored_J, target_J, full_J, target_fraction: p.target, voltage_fraction: this.voltageFraction(p),
          ready: p.full !== null && this.voltageFraction(p) >= p.target * FULL_VOLTAGE_FRACTION, alloc_W: p.alloc_W, demand_W: p.demand_W, brownout: p.brownout,
        },
        heat: { hottest_K: hottest, limit_K: lim, canFire: th ? canFire(th) : false, railsDamaged: th?.railsDamaged ?? false },
        disabled: p.disabled, jammed: p.jammed, emiImmune: p.full?.emiImmune ?? false, cost: p.full?.cost ?? 0, budget: this.opts.mode === 'range' ? 0 : budgetForWave(Math.max(1, this.wave)),
        stats: { ...p.runStats }, lostParts: p.lostParts,
      };
    });
    const w = this.wave >= 1 ? WAVE_TABLE.waves[Math.min(this.wave, GAME.WAVES) - 1] : null;
    return {
      n: this.snapN++, t: this.t, phase: this.phase, phaseLeft_s: this.timed() ? Math.max(0, this.phaseLen - this.phaseT) : 0, phaseLength_s: this.timed() ? this.phaseLen : 0,
      wave: this.wave, waveLabel: w?.label ?? '', baseHp: Math.max(0, this.baseHp), baseHpMax: GAME.BASE_HP, score: Math.round(this.score),
      spawnedRemaining: this.schedule.length - this.scheduleIdx,
      grid: { gen_W: generation_W(Math.max(1, this.players.filter((p) => p.connected).length)), buffer_J: this.buffer_J, bufferMax_J: GAME.GRID.E_BUF_J, demand_W: this.gridDemand_W, alloc_W: this.gridAlloc_W, bufferFlow_W: this.bufferFlow_W },
      players,
      enemies: this.enemies.map((e) => [e.id, ENEMY_ORDER.indexOf(e.type), e.lane, e.spawnT, Math.max(0, e.hp)] as const),
      mode: this.opts.mode,
      code: this.opts.code,
    };
  }
}

export { PROTOCOL_VERSION };
