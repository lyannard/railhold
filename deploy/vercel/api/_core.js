'use strict';
/*
 * Room-code signaling for Railhold's browser-to-browser multiplayer.
 *
 * The host browser runs the match. A guest types the host's room code, and the two browsers use
 * this tiny mailbox once to exchange WebRTC offer and answer messages. After that, the match
 * traffic flows directly between the browsers and never touches this server.
 *
 * `kv` is any object with these async methods (see makeUpstashKv and the in-memory test store):
 *   set(key, value, ttlSeconds, onlyIfAbsent) -> boolean   get(key) -> string | null   del(key)
 *   rpush(key, value) -> new length   lpopAll(key) -> string[]   expire(key, ttlSeconds)
 */

const ROOM_TTL_S = 7200;
const INBOX_TTL_S = 120;
const ANSWER_TTL_S = 120;
const INBOX_MAX = 8;
const MAX_SDP_CHARS = 16000;
const CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

function reply(status, json) {
  return { status, json };
}

function bad(message) {
  return reply(400, { error: 'bad_request', message });
}

async function readRoom(kv, code) {
  const raw = await kv.get('room:' + code);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function handleSignal(kv, op, body) {
  const b = body && typeof body === 'object' ? body : {};
  const code = typeof b.code === 'string' ? b.code.toUpperCase() : '';
  if (!CODE_RE.test(code)) return bad('Room code must be 6 characters from 2-9 and A-Z without I, L, O.');

  if (op === 'open') {
    if (typeof b.token !== 'string' || !TOKEN_RE.test(b.token)) return bad('Host token is not valid.');
    const ok = await kv.set('room:' + code, JSON.stringify({ token: b.token }), ROOM_TTL_S, true);
    return ok ? reply(200, { ok: true }) : reply(409, { error: 'code_taken', message: 'That code is already in use.' });
  }

  const room = await readRoom(kv, code);
  if (!room) return reply(404, { error: 'room_not_found', message: 'No open room has that code. Check the code with the host.' });

  if (op === 'join') {
    if (typeof b.gid !== 'string' || !ID_RE.test(b.gid)) return bad('Guest id is not valid.');
    if (typeof b.offer !== 'string' || b.offer.length === 0 || b.offer.length > MAX_SDP_CHARS) return bad('Offer is missing or too large.');
    const len = await kv.rpush('inbox:' + code, JSON.stringify({ gid: b.gid, offer: b.offer }));
    await kv.expire('inbox:' + code, INBOX_TTL_S);
    if (len > INBOX_MAX) {
      await kv.del('inbox:' + code);
      return reply(429, { error: 'busy', message: 'Too many people are joining at once. Try again in a few seconds.' });
    }
    return reply(200, { ok: true });
  }

  if (op === 'answer-get') {
    if (typeof b.gid !== 'string' || !ID_RE.test(b.gid)) return bad('Guest id is not valid.');
    const a = await kv.get('ans:' + code + ':' + b.gid);
    return reply(200, { answer: a });
  }

  // Everything below is for the host only.
  if (typeof b.token !== 'string' || b.token !== room.token) return reply(403, { error: 'not_host', message: 'Only the host of this room can do that.' });

  if (op === 'poll') {
    const items = await kv.lpopAll('inbox:' + code);
    await kv.expire('room:' + code, ROOM_TTL_S);
    const offers = [];
    for (const raw of items) {
      try {
        const o = JSON.parse(raw);
        if (typeof o.gid === 'string' && typeof o.offer === 'string') offers.push({ gid: o.gid, offer: o.offer });
      } catch {
        /* skip a corrupt entry */
      }
    }
    return reply(200, { offers });
  }
  if (op === 'answer') {
    if (typeof b.gid !== 'string' || !ID_RE.test(b.gid)) return bad('Guest id is not valid.');
    if (typeof b.answer !== 'string' || b.answer.length === 0 || b.answer.length > MAX_SDP_CHARS) return bad('Answer is missing or too large.');
    await kv.set('ans:' + code + ':' + b.gid, b.answer, ANSWER_TTL_S, false);
    return reply(200, { ok: true });
  }
  if (op === 'close') {
    await kv.del('room:' + code);
    await kv.del('inbox:' + code);
    return reply(200, { ok: true });
  }
  return bad('Unknown operation.');
}

/** Key-value store backed by an Upstash Redis REST endpoint (one JSON command per POST). */
function makeUpstashKv(url, token) {
  async function cmd(args) {
    const res = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error('Redis error: ' + (j.error || res.status));
    return j.result;
  }
  return {
    async set(key, value, ttl, nx) {
      const args = ['SET', key, value, 'EX', String(ttl)];
      if (nx) args.push('NX');
      return (await cmd(args)) === 'OK';
    },
    get: (key) => cmd(['GET', key]),
    del: (key) => cmd(['DEL', key]),
    rpush: (key, value) => cmd(['RPUSH', key, value]),
    async lpopAll(key) {
      const r = await cmd(['LPOP', key, '50']);
      return Array.isArray(r) ? r : [];
    },
    expire: (key, ttl) => cmd(['EXPIRE', key, String(ttl)]),
  };
}

/** In-memory store with the same behaviour, for the local dev server and the tests. */
function makeMemoryKv(now) {
  const clock = now || (() => Date.now());
  const data = new Map();
  const live = (k) => {
    const e = data.get(k);
    if (!e) return null;
    if (e.exp !== null && e.exp <= clock()) {
      data.delete(k);
      return null;
    }
    return e;
  };
  return {
    async set(key, value, ttl, nx) {
      if (nx && live(key)) return false;
      data.set(key, { v: value, exp: clock() + ttl * 1000 });
      return true;
    },
    async get(key) {
      const e = live(key);
      return e && typeof e.v === 'string' ? e.v : null;
    },
    async del(key) {
      data.delete(key);
    },
    async rpush(key, value) {
      let e = live(key);
      if (!e || !Array.isArray(e.v)) {
        e = { v: [], exp: null };
        data.set(key, e);
      }
      e.v.push(value);
      return e.v.length;
    },
    async lpopAll(key) {
      const e = live(key);
      if (!e || !Array.isArray(e.v)) return [];
      data.delete(key);
      return e.v;
    },
    async expire(key, ttl) {
      const e = live(key);
      if (e) e.exp = clock() + ttl * 1000;
    },
  };
}

module.exports = { handleSignal, makeUpstashKv, makeMemoryKv, ROOM_TTL_S };
