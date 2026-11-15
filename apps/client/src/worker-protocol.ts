import type { ClientMessage, ErrorCode } from '@railhold/shared';
import type { Outgoing, Snapshot } from '@railhold/engine';

export type ToWorker =
  | { k: 'create'; seed: number; mode: 'defense' | 'range'; code: string; hostId: string; name: string; unlocked: string[] }
  | { k: 'join'; id: string; name: string; unlocked: string[] }
  | { k: 'msg'; id: string; msg: ClientMessage }
  | { k: 'drop'; id: string }
  | { k: 'close' };

export type FromWorker =
  | { k: 'ready' }
  | { k: 'snap'; snap: Snapshot }
  | { k: 'events'; evs: Outgoing[] }
  | { k: 'joined'; id: string; ok: true; seat: number }
  | { k: 'joined'; id: string; ok: false; code: ErrorCode; message: string };
