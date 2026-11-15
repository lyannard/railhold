'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { handleSignal, handleIce, makeUpstashKv, makeMemoryKv } = require('../deploy/vercel/api/_core.js');

const TOKEN = 'host-token-0123456789abcdef';
const GID = 'guest-id-123456';

test('open, join, poll, answer, answer-get round trip', async () => {
  const kv = makeMemoryKv();
  assert.equal((await handleSignal(kv, 'open', { code: 'ABCD23', token: TOKEN })).status, 200);
  assert.equal((await handleSignal(kv, 'open', { code: 'ABCD23', token: TOKEN })).status, 409);
  assert.equal((await handleSignal(kv, 'join', { code: 'abcd23', gid: GID, offer: 'OFFER' })).status, 200);
  assert.equal((await handleSignal(kv, 'poll', { code: 'ABCD23', token: 'x'.repeat(20) })).status, 403);
  const p = await handleSignal(kv, 'poll', { code: 'ABCD23', token: TOKEN });
  assert.deepEqual(p.json.offers, [{ gid: GID, offer: 'OFFER' }]);
  assert.deepEqual((await handleSignal(kv, 'poll', { code: 'ABCD23', token: TOKEN })).json.offers, []);
  assert.equal((await handleSignal(kv, 'answer-get', { code: 'ABCD23', gid: GID })).json.answer, null);
  assert.equal((await handleSignal(kv, 'answer', { code: 'ABCD23', token: TOKEN, gid: GID, answer: 'ANS' })).status, 200);
  assert.equal((await handleSignal(kv, 'answer-get', { code: 'ABCD23', gid: GID })).json.answer, 'ANS');
});

test('validation: bad codes, unknown rooms, oversize SDP, close', async () => {
  const kv = makeMemoryKv();
  assert.equal((await handleSignal(kv, 'open', { code: 'ABO1CD', token: TOKEN })).status, 400);
  assert.equal((await handleSignal(kv, 'join', { code: 'ZZZZZ2', gid: GID, offer: 'o' })).status, 404);
  await handleSignal(kv, 'open', { code: 'ABCD23', token: TOKEN });
  assert.equal((await handleSignal(kv, 'join', { code: 'ABCD23', gid: GID, offer: 'x'.repeat(16001) })).status, 400);
  assert.equal((await handleSignal(kv, 'close', { code: 'ABCD23', token: TOKEN })).status, 200);
  assert.equal((await handleSignal(kv, 'join', { code: 'ABCD23', gid: GID, offer: 'o' })).status, 404);
});

test('inbox cap and TTL expiry', async () => {
  let now = 1_000_000;
  const kv = makeMemoryKv(() => now);
  await handleSignal(kv, 'open', { code: 'ABCD23', token: TOKEN });
  let last;
  for (let i = 0; i < 9; i++) last = await handleSignal(kv, 'join', { code: 'ABCD23', gid: 'guest-id-' + i + '0000', offer: 'o' });
  assert.equal(last.status, 429);
  now += 7201 * 1000;
  assert.equal((await handleSignal(kv, 'join', { code: 'ABCD23', gid: GID, offer: 'o' })).status, 404, 'room expires after the TTL');
});

test('Upstash REST client sends one JSON command per POST with a bearer token', async () => {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const cmd = JSON.parse(init.body);
    const result = cmd[0] === 'SET' ? 'OK' : cmd[0] === 'LPOP' ? ['a'] : cmd[0] === 'RPUSH' ? 1 : null;
    return { ok: true, json: async () => ({ result }) };
  };
  try {
    const kv = makeUpstashKv('https://db.example/redis', 'tok');
    assert.equal(await kv.set('k', 'v', 60, true), true);
    assert.deepEqual(JSON.parse(calls[0].init.body), ['SET', 'k', 'v', 'EX', '60', 'NX']);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(await kv.lpopAll('q'), ['a']);
    assert.deepEqual(JSON.parse(calls[1].init.body), ['LPOP', 'q', '50']);
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
    await assert.rejects(() => kv.get('k'), /Redis error: boom/);
  } finally {
    globalThis.fetch = real;
  }
});

test('ice: no TURN configured returns null; configured returns relay servers; cross-site refused', async () => {
  assert.deepEqual((await handleIce({}, null, '', 'x.app')).json, { turn: false, iceServers: null });
  let seen;
  const fakeFetch = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ iceServers: { urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'c' } }) }; };
  const env = { CF_TURN_KEY_ID: 'kid', CF_TURN_API_TOKEN: 'tok' };
  const ok = await handleIce(env, fakeFetch, 'https://x.app', 'x.app');
  assert.equal(ok.status, 200);
  assert.equal(ok.json.turn, true);
  assert.equal(ok.json.iceServers[0].username, 'u');
  assert.match(seen.url, /keys\/kid\/credentials\/generate-ice-servers$/);
  assert.equal(seen.opts.headers.Authorization, 'Bearer tok');
  assert.equal((await handleIce(env, fakeFetch, 'https://evil.com', 'x.app')).status, 403);
  assert.equal((await handleIce(env, async () => ({ ok: false }), '', 'x.app')).status, 502);
});
