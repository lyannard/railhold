import { GAME, PROTOCOL_VERSION, parseClientMessage, type ClientMessage } from '@railhold/shared';
import type { GameEvent, Outgoing, Snapshot } from '@railhold/engine';
import { dialRoom, HostPeers, MAX_BUFFERED_BYTES, NetError, type GuestChannel, type GuestLink, type HostFrame } from './net.ts';
import type { FromWorker, ToWorker } from './worker-protocol.ts';

export type Link = 'connecting' | 'open' | 'lost';
export type Outbound = Omit<ClientMessage, 'v'> & Record<string, unknown>;

/** What the screens see. Solo, host and guest sessions all look the same from here. */
export interface Session {
  readonly kind: 'solo' | 'host' | 'guest' | 'range';
  readonly myId: string;
  readonly code: string;
  snap: Snapshot | null;
  link: Link;
  send(msg: Outbound): void;
  onSnap(fn: (s: Snapshot) => void): () => void;
  onEvent(fn: (e: GameEvent) => void): () => void;
  onLink(fn: (l: Link, text: string) => void): () => void;
  /** Smoothed offset between the host's simulation clock and this page's clock, s. */
  simNow(): number;
  close(): void;
}

class Emitter<T> {
  private fns = new Set<(v: T) => void>();
  on(fn: (v: T) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  emit(v: T): void {
    for (const f of [...this.fns]) f(v);
  }
}

/** Keeps a local clock that follows the host's simulation time by slewing, so hitches on the host never make enemies jump. */
class SimClock {
  private offset = 0;
  private primed = false;
  update(hostT: number): void {
    const local = performance.now() / 1000;
    const target = hostT - local;
    if (!this.primed || Math.abs(target - this.offset) > 0.5) {
      this.offset = target;
      this.primed = true;
    } else this.offset += (target - this.offset) * 0.1;
  }
  now(): number {
    return performance.now() / 1000 + this.offset;
  }
}

abstract class Base implements Session {
  abstract readonly kind: Session['kind'];
  snap: Snapshot | null = null;
  link: Link = 'connecting';
  protected readonly snaps = new Emitter<Snapshot>();
  protected readonly events = new Emitter<GameEvent>();
  protected readonly links = new Emitter<{ l: Link; text: string }>();
  protected readonly clock = new SimClock();
  readonly myId: string;
  code: string;
  constructor(myId: string, code: string) {
    this.myId = myId;
    this.code = code;
  }
  abstract send(msg: Outbound): void;
  abstract close(): void;
  onSnap(fn: (s: Snapshot) => void): () => void {
    return this.snaps.on(fn);
  }
  onEvent(fn: (e: GameEvent) => void): () => void {
    return this.events.on(fn);
  }
  onLink(fn: (l: Link, text: string) => void): () => void {
    return this.links.on((v) => fn(v.l, v.text));
  }
  simNow(): number {
    return this.clock.now();
  }
  protected setLink(l: Link, text = ''): void {
    this.link = l;
    this.links.emit({ l, text });
  }
  protected gotSnap(s: Snapshot): void {
    this.snap = s;
    this.clock.update(s.t);
    this.snaps.emit(s);
  }
}

function frame(msg: Outbound): ClientMessage {
  return { v: PROTOCOL_VERSION, ...msg } as ClientMessage;
}

// ------------------------------------------------------------------ host / solo / range

export class HostSession extends Base {
  readonly kind: 'solo' | 'host' | 'range';
  private readonly worker: Worker;
  private peers: HostPeers | null = null;
  private readonly guests = new Map<string, GuestLink>();
  private lastSnapFrame = 0;

  private readonly name: string;
  private readonly unlocked: string[];

  constructor(kind: 'solo' | 'host' | 'range', myId: string, code: string, name: string, unlocked: string[]) {
    super(myId, code);
    this.kind = kind;
    this.name = name;
    this.unlocked = unlocked;
    this.worker = new Worker(new URL('./host.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.fromWorker(e.data);
    this.worker.onerror = () => this.setLink('lost', 'The match engine stopped unexpectedly. Reload the page.');
  }

  /** Start the room in the worker, and for multiplayer reserve a code. Resolves when the code (if any) is ready. */
  async start(): Promise<void> {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const post = (m: ToWorker): void => this.worker.postMessage(m);
    if (this.kind === 'host') {
      this.peers = await HostPeers.open({
        onGuestOpen: (l) => {
          this.guests.set(l.id, l);
        },
        onGuestFrame: (l, raw) => this.fromGuest(l, raw),
        onGuestClose: (l) => {
          if (this.guests.get(l.id) === l) {
            this.guests.delete(l.id);
            post({ k: 'drop', id: l.id });
          }
        },
      });
      this.code = this.peers.code;
    }
    post({ k: 'create', seed, mode: this.kind === 'range' ? 'range' : 'defense', code: this.code, hostId: this.myId, name: this.name, unlocked: this.unlocked });
    this.setLink('open');
  }

  private fromGuest(l: GuestLink, raw: string): void {
    const p = parseClientMessage(raw);
    if (!p.ok) {
      l.send(JSON.stringify({ ev: [{ e: 'err', code: p.code, message: p.message }] } satisfies HostFrame));
      return;
    }
    const m = p.msg;
    if (m.t === 'hello') {
      if (m.cid !== l.id) {
        l.send(JSON.stringify({ refused: { code: 'bad_message', message: 'Client id does not match.' } } satisfies HostFrame));
        return;
      }
      this.worker.postMessage({ k: 'join', id: l.id, name: m.name, unlocked: m.unlocked } satisfies ToWorker);
      return;
    }
    this.worker.postMessage({ k: 'msg', id: l.id, msg: m } satisfies ToWorker);
  }

  private fromWorker(m: FromWorker): void {
    switch (m.k) {
      case 'ready':
        break;
      case 'snap': {
        this.gotSnap(m.snap);
        if (this.guests.size > 0) {
          const text = JSON.stringify({ snap: m.snap } satisfies HostFrame);
          for (const g of this.guests.values()) if (g.open && g.bufferedAmount() < MAX_BUFFERED_BYTES) g.send(text);
        }
        this.lastSnapFrame = performance.now();
        break;
      }
      case 'events': {
        const toGuest = new Map<string, GameEvent[]>();
        for (const o of m.evs as Outgoing[]) {
          if (o.to === 'all' || o.to === this.myId) this.events.emit(o.ev);
          if (this.guests.size === 0) continue;
          for (const id of this.guests.keys()) {
            if (o.to === 'all' || o.to === id) {
              const a = toGuest.get(id) ?? [];
              a.push(o.ev);
              toGuest.set(id, a);
            }
          }
        }
        for (const [id, evs] of toGuest) this.guests.get(id)?.send(JSON.stringify({ ev: evs } satisfies HostFrame));
        break;
      }
      case 'joined': {
        const g = this.guests.get(m.id);
        if (!g) break;
        if (m.ok) g.send(JSON.stringify({ welcome: { seat: m.seat, code: this.code } } satisfies HostFrame));
        else {
          g.send(JSON.stringify({ refused: { code: m.code, message: m.message } } satisfies HostFrame));
          setTimeout(() => g.close(), 300);
        }
        break;
      }
    }
  }

  send(msg: Outbound): void {
    this.worker.postMessage({ k: 'msg', id: this.myId, msg: frame(msg) } satisfies ToWorker);
  }

  guestCount(): number {
    return this.guests.size;
  }

  idleMs(): number {
    return performance.now() - this.lastSnapFrame;
  }

  close(): void {
    this.peers?.close();
    for (const g of this.guests.values()) g.close();
    this.guests.clear();
    this.worker.postMessage({ k: 'close' } satisfies ToWorker);
    this.worker.terminate();
    this.setLink('lost', 'Session ended.');
  }
}

// ------------------------------------------------------------------ guest

export class GuestSession extends Base {
  readonly kind = 'guest' as const;
  private ch: GuestChannel | null = null;
  seat = -1;
  private closedByUs = false;
  private lastFrame = 0;
  private watchdog: ReturnType<typeof setInterval> | null = null;

  private readonly name: string;
  private readonly unlocked: string[];

  constructor(myId: string, code: string, name: string, unlocked: string[]) {
    super(myId, code);
    this.name = name;
    this.unlocked = unlocked;
  }

  /** Dial the code and say hello. Throws a NetError with a plain-language message when the join fails. */
  async connect(onStatus: (t: string) => void): Promise<void> {
    const ch = await dialRoom(this.code, this.myId, onStatus);
    this.ch = ch;
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new NetError('no_welcome', 'The host connected but did not seat you. Try again.')), 8000);
      ch.onFrame = (raw) => {
        const f = JSON.parse(raw) as HostFrame;
        if ('welcome' in f) {
          clearTimeout(t);
          this.seat = f.welcome.seat;
          resolve();
        } else if ('refused' in f) {
          clearTimeout(t);
          reject(new NetError(f.refused.code, f.refused.message));
        }
      };
      ch.onClose = () => {
        clearTimeout(t);
        reject(new NetError('closed', 'The connection closed before you were seated.'));
      };
      ch.send(JSON.stringify(frame({ t: 'hello', cid: this.myId, name: this.name, unlocked: this.unlocked })));
    }).catch((e) => {
      ch.close();
      throw e;
    });
    this.lastFrame = performance.now();
    ch.onFrame = (raw) => this.onFrame(raw);
    ch.onClose = () => {
      if (!this.closedByUs) this.setLink('lost', 'Connection to the host was lost. Rejoin with the same code to take your seat back.');
    };
    this.watchdog = setInterval(() => {
      if (performance.now() - this.lastFrame > 8000 && this.link === 'open') this.setLink('lost', 'The host stopped responding. Rejoin with the same code.');
      else ch.send(JSON.stringify(frame({ t: 'ping', n: Date.now() })));
    }, 2000);
    this.setLink('open');
  }

  private onFrame(raw: string): void {
    this.lastFrame = performance.now();
    let f: HostFrame;
    try {
      f = JSON.parse(raw) as HostFrame;
    } catch {
      return;
    }
    if ('snap' in f) this.gotSnap(f.snap);
    else if ('ev' in f) for (const e of f.ev) this.events.emit(e);
  }

  send(msg: Outbound): void {
    this.ch?.send(JSON.stringify(frame(msg)));
  }

  close(): void {
    this.closedByUs = true;
    if (this.watchdog) clearInterval(this.watchdog);
    this.send({ t: 'leave' });
    this.ch?.close();
    this.setLink('lost', 'Left the room.');
  }
}

export { GAME };
