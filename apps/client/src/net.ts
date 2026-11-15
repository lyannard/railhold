import { encode, isValidRoomCode, makeRoomCode, normalizeRoomCode, PROTOCOL_VERSION, parseClientMessage, type ClientMessage } from '@railhold/shared';
import type { GameEvent, Outgoing, Snapshot } from '@railhold/engine';
import { runtimeConfig } from './config.ts';
import { newId } from './profile.ts';

const POLL_MS = 1000;
const GATHER_TIMEOUT_MS = 4000;
const JOIN_TIMEOUT_MS = 25_000;
const MAX_BUFFERED_BYTES = 256 * 1024;
const FRAME_TIMEOUT_MS = 12_000;

export class NetError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// ------------------------------------------------------------------ signaling

async function signal<T>(op: string, body: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${runtimeConfig().signalUrl}?op=${op}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new NetError('offline', 'Could not reach the room service. Check your internet connection.');
  }
  const j = (await res.json().catch(() => null)) as (T & { error?: string; message?: string }) | null;
  if (!res.ok || !j) throw new NetError(j?.error ?? 'http_' + res.status, j?.message ?? 'The room service is not available on this site.');
  return j;
}

/** Whether this deployment can host rooms (the API exists and has a database). */
export async function multiplayerAvailable(): Promise<{ ok: boolean; reason: string }> {
  try {
    const url = runtimeConfig().signalUrl.replace(/signal$/, 'health');
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return { ok: false, reason: 'This copy of the game was published without its room service. Solo play and Range Trials still work.' };
    const j = (await res.json()) as { multiplayer?: boolean };
    return j.multiplayer ? { ok: true, reason: '' } : { ok: false, reason: 'The room database is not connected on this site yet. Solo play and Range Trials still work.' };
  } catch {
    return { ok: false, reason: 'Could not reach the room service. Solo play and Range Trials still work.' };
  }
}

function token(): string {
  return newId() + newId().slice(0, 8);
}

async function gather(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;
  await new Promise<void>((resolve) => {
    const done = (): void => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(t);
      resolve();
    };
    const check = (): void => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const t = setTimeout(done, GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

// ------------------------------------------------------------------ host side

export interface GuestLink {
  readonly id: string;
  send(frame: string): void;
  readonly open: boolean;
  bufferedAmount(): number;
  close(): void;
}

export interface HostPeersHandlers {
  onGuestOpen(link: GuestLink): void;
  onGuestFrame(link: GuestLink, raw: string): void;
  onGuestClose(link: GuestLink): void;
}

/** Opens a room code and accepts guests that dial in with it. */
export class HostPeers {
  readonly code: string;
  private readonly hostToken = token();
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private closed = false;
  private readonly pcs = new Set<RTCPeerConnection>();

  private readonly h: HostPeersHandlers;

  private constructor(code: string, h: HostPeersHandlers) {
    this.code = code;
    this.h = h;
  }

  /** Reserve a fresh room code and start polling for guests. */
  static async open(h: HostPeersHandlers): Promise<HostPeers> {
    for (let i = 0; i < 6; i++) {
      const code = makeRoomCode(() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32);
      const peers = new HostPeers(code, h);
      try {
        await signal('open', { code, token: peers.hostToken });
      } catch (e) {
        if (e instanceof NetError && e.code === 'code_taken') continue;
        throw e;
      }
      peers.timer = setInterval(() => void peers.poll(), POLL_MS);
      return peers;
    }
    throw new NetError('code_taken', 'Could not find a free room code. Try again.');
  }

  private async poll(): Promise<void> {
    if (this.busy || this.closed) return;
    this.busy = true;
    try {
      const r = await signal<{ offers: Array<{ gid: string; offer: string }> }>('poll', { code: this.code, token: this.hostToken });
      for (const o of r.offers) void this.accept(o.gid, o.offer);
    } catch {
      /* a missed poll is retried one second later */
    } finally {
      this.busy = false;
    }
  }

  private async accept(gid: string, offerJson: string): Promise<void> {
    const pc = new RTCPeerConnection({ iceServers: runtimeConfig().iceServers });
    this.pcs.add(pc);
    let link: GuestLink | null = null;
    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      const l: GuestLink = {
        id: gid,
        send: (f) => {
          if (ch.readyState === 'open') ch.send(f);
        },
        get open() {
          return ch.readyState === 'open';
        },
        bufferedAmount: () => ch.bufferedAmount,
        close: () => {
          try {
            ch.close();
            pc.close();
          } catch {
            /* already closed */
          }
        },
      };
      link = l;
      ch.onopen = () => this.h.onGuestOpen(l);
      ch.onmessage = (m) => {
        if (typeof m.data === 'string') this.h.onGuestFrame(l, m.data);
      };
      ch.onclose = () => this.h.onGuestClose(l);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.pcs.delete(pc);
        if (link) this.h.onGuestClose(link);
      }
    };
    try {
      await pc.setRemoteDescription(JSON.parse(offerJson) as RTCSessionDescriptionInit);
      await pc.setLocalDescription(await pc.createAnswer());
      await gather(pc);
      await signal('answer', { code: this.code, token: this.hostToken, gid, answer: JSON.stringify(pc.localDescription) });
    } catch {
      pc.close();
      this.pcs.delete(pc);
    }
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearInterval(this.timer);
    void signal('close', { code: this.code, token: this.hostToken }).catch(() => undefined);
    for (const pc of this.pcs) pc.close();
    this.pcs.clear();
  }
}

// ------------------------------------------------------------------ guest side

export interface GuestChannel {
  send(frame: string): void;
  close(): void;
  onFrame: ((raw: string) => void) | null;
  onClose: (() => void) | null;
}

/** Dial a room code. Resolves with an open data channel, or throws a NetError that says what to fix. */
export async function dialRoom(codeInput: string, gid: string, onStatus: (text: string) => void): Promise<GuestChannel> {
  const code = normalizeRoomCode(codeInput);
  if (!isValidRoomCode(code)) throw new NetError('bad_code', 'A room code has 6 characters, using the digits 2 to 9 and the letters A to Z without I, L and O.');
  const pc = new RTCPeerConnection({ iceServers: runtimeConfig().iceServers });
  const ch = pc.createDataChannel('rh', { ordered: true });
  const out: GuestChannel = { send: (f) => ch.readyState === 'open' && ch.send(f), close: () => { try { ch.close(); pc.close(); } catch { /* closed */ } }, onFrame: null, onClose: null };
  try {
    onStatus('Preparing connection');
    await pc.setLocalDescription(await pc.createOffer());
    await gather(pc);
    onStatus('Contacting room');
    await signal('join', { code, gid, offer: JSON.stringify(pc.localDescription) });
    onStatus('Waiting for the host');
    const t0 = Date.now();
    let answer: string | null = null;
    while (!answer) {
      if (Date.now() - t0 > JOIN_TIMEOUT_MS) throw new NetError('timeout', 'The host did not answer. Make sure the host still has the lobby open, then try again.');
      await new Promise((r) => setTimeout(r, 700));
      const r = await signal<{ answer: string | null }>('answer-get', { code, gid });
      answer = r.answer;
    }
    onStatus('Connecting');
    await pc.setRemoteDescription(JSON.parse(answer) as RTCSessionDescriptionInit);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new NetError('ice_failed', 'Could not open a direct connection to the host. A strict firewall or mobile network can block it. Try another network.')), JOIN_TIMEOUT_MS);
      ch.onopen = () => {
        clearTimeout(t);
        resolve();
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed') {
          clearTimeout(t);
          reject(new NetError('ice_failed', 'Could not open a direct connection to the host. A strict firewall or mobile network can block it. Try another network.'));
        }
      };
    });
  } catch (e) {
    out.close();
    throw e;
  }
  ch.onmessage = (m) => {
    if (typeof m.data === 'string') out.onFrame?.(m.data);
  };
  ch.onclose = () => out.onClose?.();
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') out.onClose?.();
  };
  return out;
}

// ------------------------------------------------------------------ frames

export type HostFrame =
  | { snap: Snapshot }
  | { ev: GameEvent[] }
  | { welcome: { seat: number; code: string } }
  | { refused: { code: string; message: string } };

export { MAX_BUFFERED_BYTES, FRAME_TIMEOUT_MS, encode, parseClientMessage, PROTOCOL_VERSION };
export type { ClientMessage, Outgoing };
