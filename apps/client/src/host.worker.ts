/// <reference lib="webworker" />
import { Room } from '@railhold/engine';
import { GAME } from '@railhold/shared';
import type { FromWorker, ToWorker } from './worker-protocol.ts';

declare const self: DedicatedWorkerGlobalScope;

let room: Room | null = null;
let last = 0;
let nextSnap = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const post = (m: FromWorker): void => self.postMessage(m);

function loop(): void {
  if (!room) return;
  const now = performance.now();
  room.advance((now - last) / 1000);
  last = now;
  const evs = room.drainEvents();
  if (evs.length > 0) post({ k: 'events', evs });
  if (now >= nextSnap) {
    nextSnap = now + 1000 / GAME.SNAPSHOT_HZ;
    post({ k: 'snap', snap: room.snapshot() });
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.k) {
    case 'create':
      room = new Room({ seed: m.seed, mode: m.mode, code: m.code, hostId: m.hostId });
      room.join(m.hostId, m.name, m.unlocked);
      last = performance.now();
      nextSnap = 0;
      if (timer) clearInterval(timer);
      timer = setInterval(loop, 8);
      post({ k: 'ready' });
      break;
    case 'join': {
      if (!room) return;
      const r = room.join(m.id, m.name, m.unlocked);
      post(r.ok ? { k: 'joined', id: m.id, ok: true, seat: r.seat } : { k: 'joined', id: m.id, ok: false, code: r.code, message: r.message });
      break;
    }
    case 'msg':
      room?.handle(m.id, m.msg);
      break;
    case 'drop':
      room?.leave(m.id);
      break;
    case 'close':
      if (timer) clearInterval(timer);
      timer = null;
      room = null;
      break;
  }
};
