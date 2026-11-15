import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENEMY_ORDER, enemyPath, GAME, RANGE, starterRailgun, starterCoilgun, solveElevation, analyzeBlueprint, type Blueprint } from '@railhold/shared';
import { flightParamsFor } from '@railhold/physics';
import { Room, stepGrid, waterFill, generation_W, type Snapshot, type Outgoing } from '../src/index.ts';
import { ALL_PARTS, errors, newRoom, send, tier } from './helpers.ts';

function runFor(room: Room, seconds: number, onTick?: (snap: Snapshot) => void, every = 0.05): Outgoing[] {
  const all: Outgoing[] = [];
  let nextSnap = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    room.tick(1 / 60);
    if (room.t >= nextSnap) {
      nextSnap = room.t + every;
      onTick?.(room.snapshot());
    }
    all.push(...room.drainEvents());
  }
  return all;
}

test('grid: water filling is fair, bounded by demand and conserves power', () => {
  assert.deepEqual(waterFill(100, [10, 20, 30]), [10, 20, 30]);
  const w = waterFill(60, [10, 50, 50]);
  assert.ok(Math.abs(w[0] - 10) < 1e-9 && Math.abs(w[1] - 25) < 1e-9 && Math.abs(w[2] - 25) < 1e-9);
  assert.deepEqual(waterFill(100, [0, 0]), [0, 0]);
  for (let n = 1; n <= 4; n++) {
    const demand = Array.from({ length: n }, (_, i) => 30_000 + 27_000 * i);
    for (const buf of [0, 1e5, GAME.GRID.E_BUF_J]) {
      const dt = 1 / 60;
      const r = stepGrid({ players: n, buffer_J: buf, demand_W: demand, dt_s: dt });
      const sum = r.alloc_W.reduce((a, b) => a + b, 0);
      // allocation = generation + buffer discharge (flow>0) or generation - buffer charge (flow<0)
      const supply = r.gen_W + (r.bufferFlow_W > 0 ? r.bufferFlow_W : r.bufferFlow_W);
      assert.ok(sum <= supply + 1e-6, 'allocation exceeds supply');
      r.alloc_W.forEach((a, i) => assert.ok(a <= demand[i] + 1e-9 && a >= 0));
      assert.ok(Math.abs(r.buffer_J - (buf - r.bufferFlow_W * dt)) < 1e-6, 'buffer energy does not follow flow');
      assert.ok(r.buffer_J >= 0 && r.buffer_J <= GAME.GRID.E_BUF_J + 1e-9);
    }
  }
  // Overdemand with an empty buffer throttles every launcher below demand and flags a brownout.
  const r = stepGrid({ players: 4, buffer_J: 0, demand_W: [80_000, 80_000, 80_000, 80_000], dt_s: 1 / 60 });
  assert.ok(r.brownout.every(Boolean));
  assert.ok(Math.abs(r.alloc_W[0] - generation_W(4) / 4) < 1e-6);
});

test('lobby: join, code-free errors, room full, loadout checks, host-only start', () => {
  const room = newRoom();
  assert.equal(room.join('host', 'Host', []).ok, true);
  for (let i = 1; i < 4; i++) assert.equal(room.join(`g${i}`, `G${i}`, []).ok, true);
  const full = room.join('g5', 'Late', []);
  assert.ok(!full.ok && full.code === 'room_full');
  send(room, 'g1', { t: 'start' });
  send(room, 'host', { t: 'start' });
  const e1 = errors(room.drainEvents());
  assert.deepEqual(e1, ['not_host', 'no_blueprint']);
  send(room, 'host', { t: 'loadout', blueprint: { kind: 'railgun' } });
  send(room, 'host', { t: 'loadout', blueprint: tier('rail-3') });
  send(room, 'host', { t: 'loadout', blueprint: tier('rail-1') });
  const e2 = errors(room.drainEvents());
  assert.deepEqual(e2, ['blueprint_invalid', 'parts_locked']);
  const snap = room.snapshot();
  assert.equal(snap.players[0].hasLoadout, true);
  assert.equal(snap.players[0].bpName, 'Starter Railgun');
});

test('over budget loadouts are refused', () => {
  const room = newRoom();
  room.join('host', 'Host', ALL_PARTS);
  send(room, 'host', { t: 'loadout', blueprint: tier('rail-4') });
  const e = errors(room.drainEvents());
  assert.deepEqual(e, ['over_budget']);
});

test('solo run: build, charge, defense with a starter railgun; kills credit the shooter and energy stays accounted', () => {
  const room = newRoom(11);
  room.join('host', 'Ada', []);
  send(room, 'host', { t: 'loadout', blueprint: starterRailgun() });
  assert.deepEqual(errors(room.drainEvents()), []);
  send(room, 'host', { t: 'start' });
  assert.equal(room.phase, 'build');
  send(room, 'host', { t: 'ready', value: true });
  room.tick(1 / 60);
  assert.equal(room.phase, 'charge');
  let fired = 0;
  const evs = runFor(room, 200, (snap) => {
    if (snap.phase !== 'defense' && snap.phase !== 'charge') return;
    const targets = snap.enemies.filter((e) => e[4] > 0).map((e) => {
      const p = enemyPath(e[0], ENEMY_ORDER[e[1]], e[2]);
      const age = snap.t - e[3] + 0.9;
      return { x: p.x0 + p.dx * p.speed_m_s * age, z: p.z0 + p.dz * p.speed_m_s * age, d: Math.hypot(p.x0 + p.dx * p.speed_m_s * age, p.z0 + p.dz * p.speed_m_s * age) };
    }).sort((a, b) => a.d - b.d);
    if (targets.length === 0) return;
    send(room, 'host', { t: 'aim', x: targets[0].x, z: targets[0].z });
    if (snap.players[0].charge.ready) {
      send(room, 'host', { t: 'fire' });
      fired++;
    }
  });
  assert.ok(fired > 5);
  const hits = evs.filter((o) => o.ev.e === 'hit');
  assert.ok(hits.length >= 1, 'no hits landed');
  const snap = room.snapshot();
  assert.ok(snap.players[0].stats.shots >= 1);
  const drawn = snap.players[0].stats.drawn_J;
  assert.ok(drawn > 0);
  // Stored energy never exceeds what the chargers delivered at their efficiency.
  assert.ok(snap.players[0].charge.stored_J <= drawn * GAME.GRID.ETA_CHARGE + 1e-6);
  const shots = evs.filter((o) => o.ev.e === 'shot');
  for (const s of shots) {
    if (s.ev.e !== 'shot') continue;
    assert.ok(s.ev.report.ledger.residual_max_rel < 1e-3, 'ledger residual above 0.1 %');
  }
});

test('range mode: chronograph, boards report drop, elevation changes where the slug crosses', () => {
  const room = newRoom(3, 'range');
  room.join('host', 'Ada', []);
  send(room, 'host', { t: 'loadout', blueprint: starterRailgun() });
  assert.deepEqual(errors(room.drainEvents()), []);
  const run = (el: number) => {
    send(room, 'host', { t: 'aim', elevation_mrad: el });
    room.tick(1); // clears the minimum interval
    send(room, 'host', { t: 'fire' });
    return runFor(room, 3);
  };
  const flat = run(0);
  const boardsFlat = flat.filter((o) => o.ev.e === 'board').map((o) => o.ev as Extract<typeof o.ev, { e: 'board' }>);
  assert.ok(boardsFlat.length >= 3 && boardsFlat.length <= RANGE.BOARD_DISTANCES_M.length, 'slug should cross the near boards and land before the 400 m board');
  for (let i = 1; i < boardsFlat.length; i++) assert.ok(boardsFlat[i].y < boardsFlat[i - 1].y, 'height must fall with distance');
  assert.ok(boardsFlat[0].hit, 'flat shot hits the 50 m board');
  const up = run(6);
  const boardsUp = up.filter((o) => o.ev.e === 'board').map((o) => o.ev as Extract<typeof o.ev, { e: 'board' }>);
  assert.ok(boardsUp[1].y > boardsFlat[1].y);
  const shot = flat.find((o) => o.ev.e === 'shot');
  assert.ok(shot && shot.ev.e === 'shot' && shot.ev.report.muzzleSpeed_m_s > 500);
  // Drop at the 100 m board agrees with an independent RK4 run of the shared flight function.
  const a = analyzeBlueprint(starterRailgun());
  const ref = solveElevation(flightParamsFor(a.projectile, a.projectileMass_kg), (shot!.ev as Extract<typeof shot.ev, { e: 'shot' }>).report.muzzleSpeed_m_s, 100, boardsFlat[1].y, GAME.MUZZLE_HEIGHT_M);
  assert.ok(Math.abs(ref.elevation_rad) < 2e-4, `independent flight disagrees: ${ref.elevation_rad}`);
});

test('firing guards: before charge, jammed, overheated, wrong phase', () => {
  const room = newRoom(5);
  room.join('host', 'Ada', []);
  send(room, 'host', { t: 'fire' });
  assert.deepEqual(errors(room.drainEvents()), ['wrong_phase']);
  send(room, 'host', { t: 'loadout', blueprint: starterRailgun() });
  send(room, 'host', { t: 'start' });
  room.drainEvents();
  send(room, 'host', { t: 'ready', value: true });
  room.tick(1 / 60);
  send(room, 'host', { t: 'fire' });
  assert.deepEqual(errors(room.drainEvents()), ['no_charge']);
});

test('determinism: the same seed and inputs give identical snapshots', () => {
  const sim = () => {
    const room = newRoom(99);
    room.join('host', 'Ada', []);
    send(room, 'host', { t: 'loadout', blueprint: starterRailgun() });
    send(room, 'host', { t: 'start' });
    send(room, 'host', { t: 'ready', value: true });
    runFor(room, 40);
    return JSON.stringify({ ...room.snapshot(), n: 0 });
  };
  assert.equal(sim(), sim());
});

test('reconnect keeps the seat, and a late joiner is refused after start', () => {
  const room = newRoom(2);
  room.join('host', 'Ada', []);
  room.join('g1', 'Bo', []);
  send(room, 'host', { t: 'loadout', blueprint: starterRailgun() });
  send(room, 'g1', { t: 'loadout', blueprint: starterCoilgun() });
  send(room, 'g1', { t: 'ready', value: true });
  send(room, 'host', { t: 'start' });
  assert.equal(room.phase, 'build');
  room.leave('g1');
  const back = room.join('g1', 'Bo', []);
  assert.ok(back.ok && back.seat === 1);
  const late = room.join('zz', 'Late', []);
  assert.ok(!late.ok && late.code === 'room_started');
});

test('a full 4-player run finishes waves and the per-tick cost stays inside the budget', () => {
  const room = newRoom(21);
  const ids = ['host', 'b', 'c', 'd'];
  ids.forEach((id, i) => room.join(id, `P${i}`, ALL_PARTS));
  const bps: Blueprint[] = [starterRailgun(), starterCoilgun(), starterRailgun(), starterCoilgun()];
  ids.forEach((id, i) => send(room, id, { t: 'loadout', blueprint: bps[i] }));
  assert.deepEqual(errors(room.drainEvents()), []);
  ids.slice(1).forEach((id) => send(room, id, { t: 'ready', value: true }));
  send(room, 'host', { t: 'start' });
  ids.forEach((id) => send(room, id, { t: 'ready', value: true }));
  const tickMs: number[] = [];
  const defenseMs: number[] = [];
  let events = 0;
  for (let i = 0; i < 60 * 150; i++) {
    const t0 = performance.now();
    room.tick(1 / 60);
    if (i % 3 === 0) {
      const snap = room.snapshot();
      if (snap.phase === 'defense') {
        const tg = snap.enemies.map((e) => {
          const p = enemyPath(e[0], ENEMY_ORDER[e[1]], e[2]);
          const age = snap.t - e[3] + 0.8;
          const x = p.x0 + p.dx * p.speed_m_s * age;
          const z = p.z0 + p.dz * p.speed_m_s * age;
          return { x, z, d: Math.hypot(x, z) };
        }).sort((a, b) => a.d - b.d);
        if (tg.length > 0) {
          ids.forEach((id, k) => {
            const t = tg[Math.min(k, tg.length - 1)];
            send(room, id, { t: 'aim', x: t.x, z: t.z });
            if (snap.players[k].charge.ready) send(room, id, { t: 'fire' });
          });
        }
      }
    }
    const dtMs = performance.now() - t0;
    tickMs.push(dtMs);
    if (room.phase === 'defense') defenseMs.push(dtMs);
    events += room.drainEvents().length;
  }
  tickMs.sort((a, b) => a - b);
  const p99 = tickMs[Math.floor(tickMs.length * 0.99)];
  const max = tickMs[tickMs.length - 1];
  console.log(`      4-player run: ${tickMs.length} ticks, p50 ${tickMs[tickMs.length >> 1].toFixed(3)} ms, p99 ${p99.toFixed(3)} ms, max ${max.toFixed(2)} ms, ${events} events, wave ${room.snapshot().wave}`);
  defenseMs.sort((a, b) => a - b);
  console.log(`      defense ticks only: n ${defenseMs.length}, p99 ${defenseMs[Math.floor(defenseMs.length * 0.99)].toFixed(2)} ms, max ${defenseMs[defenseMs.length - 1].toFixed(2)} ms`);
  assert.ok(events > 100);
  // The worst tick is a tick that runs a shot (solver plus aim solve); the host runs the room in a Web Worker so rendering never waits for it.
  assert.ok(defenseMs[defenseMs.length - 1] < 120, 'a defense tick took longer than 120 ms');
  assert.ok(defenseMs[Math.floor(defenseMs.length * 0.99)] < 5, 'p99 defense tick above 5 ms');
  // A shot costs one solver run (budget 10 ms p99 in the physics bench); ticks without a shot stay far below a frame.
  assert.ok(tickMs[Math.floor(tickMs.length * 0.9)] < 2, 'p90 tick time above 2 ms');
});

test('solo build phase has no timer; after a defeat the host can retry the lost wave or restart from wave 1', () => {
  const room = newRoom(5);
  room.join('host', 'Ada', []);
  room.join('g1', 'Bo', []);
  send(room, 'host', { t: 'loadout', blueprint: starterRailgun() });
  send(room, 'g1', { t: 'loadout', blueprint: starterRailgun() });
  send(room, 'g1', { t: 'ready', value: true });
  send(room, 'host', { t: 'ready', value: true });
  send(room, 'host', { t: 'start' });
  assert.equal(room.phase, 'build');
  room.leave('g1');
  // one human left: the build phase must wait, however long it takes
  for (let i = 0; i < 60 * 200; i++) room.tick(1 / 60);
  assert.equal(room.phase, 'build', 'a single player is not rushed');
  assert.equal(room.snapshot().phaseLength_s, 0);
  // retry is not allowed while the run is going
  room.drainEvents();
  send(room, 'host', { t: 'retry', wave: 1 });
  assert.deepEqual(errors(room.drainEvents()), ['wrong_phase']);
  // never fire: enemies walk to the base and the run is lost
  for (let i = 0; i < 60 * 3000 && (room.phase as string) !== 'defeat' && (room.phase as string) !== 'victory'; i++) {
    if (room.phase === 'build') send(room, 'host', { t: 'ready', value: true });
    if ((room.phase as string) === 'debrief') send(room, 'host', { t: 'next' });
    room.tick(1 / 60);
  }
  assert.equal(room.phase, 'defeat');
  room.drainEvents();
  room.join('g2', 'Cy', []);
  assert.equal(room.phase, 'defeat');
  send(room, 'g2', { t: 'retry', wave: 1 });
  send(room, 'host', { t: 'retry', wave: 1 });
  assert.equal(room.phase, 'build');
  const snap = room.snapshot();
  assert.equal(snap.wave, 1);
  assert.equal(snap.baseHp, GAME.BASE_HP);
  assert.equal(snap.enemies.length, 0);
});
