import { PROTOCOL_VERSION } from './config.ts';

/** Error codes the host returns. The client shows a human-readable sentence for each. */
export const ERROR_CODES = [
  'bad_message', 'bad_version', 'not_in_room', 'room_full', 'room_started', 'not_host', 'wrong_phase', 'no_blueprint',
  'blueprint_invalid', 'parts_locked', 'over_budget', 'not_ready', 'locked_out', 'overheated', 'launcher_disabled',
  'jammed', 'no_charge', 'rate_limited', 'internal',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Messages a player sends to the host. The host's browser runs the match, so a guest's blueprint
 * travels in the `loadout` message and is validated by the host like any other untrusted input.
 */
export type ClientMessage =
  | { v: number; t: 'hello'; cid: string; name: string; unlocked: string[] }
  | { v: number; t: 'loadout'; blueprint: unknown }
  | { v: number; t: 'ready'; value: boolean }
  | { v: number; t: 'start' }
  | { v: number; t: 'next' }
  | { v: number; t: 'retry'; wave: number }
  | { v: number; t: 'aim'; x?: number; z?: number; elevation_mrad?: number; lead?: boolean }
  | { v: number; t: 'fire' }
  | { v: number; t: 'chargeTarget'; fraction: number }
  | { v: number; t: 'leave' }
  | { v: number; t: 'ping'; n: number };

export type ParseResult = { ok: true; msg: ClientMessage } | { ok: false; code: ErrorCode; message: string };

export const MAX_FRAME_CHARS = 16_384;
export const MAX_NAME_CHARS = 20;
export const MAX_UNLOCK_KEYS = 64;

function fin(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Cleaned display name: printable characters only, trimmed, never empty. */
export function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, MAX_NAME_CHARS) : '';
  return s.length > 0 ? s : 'Player';
}

/** Validate an untrusted frame. Never throws. */
export function parseClientMessage(raw: string): ParseResult {
  if (raw.length > MAX_FRAME_CHARS) return { ok: false, code: 'bad_message', message: 'Message is too large.' };
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return { ok: false, code: 'bad_message', message: 'Message is not valid JSON.' };
  }
  if (typeof o !== 'object' || o === null || Array.isArray(o)) return { ok: false, code: 'bad_message', message: 'Message must be an object.' };
  const m = o as Record<string, unknown>;
  if (m.v !== PROTOCOL_VERSION) return { ok: false, code: 'bad_version', message: 'This page is out of date. Refresh it to continue.' };
  const bad = (message: string): ParseResult => ({ ok: false, code: 'bad_message', message });
  switch (m.t) {
    case 'hello': {
      if (typeof m.cid !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(m.cid)) return bad('Client id is not valid.');
      if (typeof m.name !== 'string') return bad('Name must be text.');
      if (!Array.isArray(m.unlocked) || m.unlocked.length > MAX_UNLOCK_KEYS || !m.unlocked.every((k) => typeof k === 'string' && k.length < 40)) return bad('Unlock list is not valid.');
      return { ok: true, msg: { v: PROTOCOL_VERSION, t: 'hello', cid: m.cid, name: cleanName(m.name), unlocked: m.unlocked as string[] } };
    }
    case 'loadout':
      if (typeof m.blueprint !== 'object' || m.blueprint === null) return bad('Blueprint must be an object.');
      return { ok: true, msg: { v: PROTOCOL_VERSION, t: 'loadout', blueprint: m.blueprint } };
    case 'ready':
      if (typeof m.value !== 'boolean') return bad('Ready must be true or false.');
      return { ok: true, msg: { v: PROTOCOL_VERSION, t: 'ready', value: m.value } };
    case 'start':
    case 'retry': {
      if (!fin(m.wave) || !Number.isInteger(m.wave) || m.wave < 1 || m.wave > 99) return bad('Wave must be a whole number.');
      return { ok: true, msg: { v: PROTOCOL_VERSION, t: 'retry', wave: m.wave } };
    }
    case 'next':
    case 'fire':
    case 'leave':
      return { ok: true, msg: { v: PROTOCOL_VERSION, t: m.t } };
    case 'aim': {
      const hasXZ = m.x !== undefined || m.z !== undefined;
      if (hasXZ && (!fin(m.x) || !fin(m.z) || Math.abs(m.x) > 5000 || Math.abs(m.z) > 5000)) return bad('Aim point must be two finite numbers within 5 km.');
      if (m.elevation_mrad !== undefined && (!fin(m.elevation_mrad) || Math.abs(m.elevation_mrad) > 1600)) return bad('Elevation must be a finite number of milliradians.');
      if (m.lead !== undefined && typeof m.lead !== 'boolean') return bad('Lead must be true or false.');
      return { ok: true, msg: { v: PROTOCOL_VERSION, t: 'aim', x: hasXZ ? (m.x as number) : undefined, z: hasXZ ? (m.z as number) : undefined, elevation_mrad: m.elevation_mrad as number | undefined, lead: m.lead as boolean | undefined } };
    }
    case 'chargeTarget':
      if (!fin(m.fraction) || m.fraction < 0 || m.fraction > 1) return bad('Charge target must be a fraction between 0 and 1.');
      return { ok: true, msg: { v: PROTOCOL_VERSION, t: 'chargeTarget', fraction: m.fraction } };
    case 'ping':
      if (!fin(m.n)) return bad('Ping needs a number.');
      return { ok: true, msg: { v: PROTOCOL_VERSION, t: 'ping', n: m.n } };
    default:
      return bad('Unknown message type.');
  }
}

export function encode(msg: object): string {
  return JSON.stringify(msg);
}

// ------------------------------------------------------------------ room codes

/** Characters without look-alikes (no 0/O, 1/I/L). 31 symbols, 6 places: about 887 million codes. */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export function makeRoomCode(rng: () => number, length = 6): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ROOM_CODE_ALPHABET[Math.floor(rng() * ROOM_CODE_ALPHABET.length)];
  return s;
}

/** What a person typed, upper-cased with spaces and dashes removed. */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function isValidRoomCode(code: string, length = 6): boolean {
  if (code.length !== length) return false;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}
