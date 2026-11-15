import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulateCoilgun, simulateRailgun, flightParamsFor, flightAtRangeSelfCheck } from './helpers.ts';
import {
  ALL_UNLOCKABLES,
  analyzeBlueprint,
  BALANCE_TIERS,
  bankSummary,
  BLUEPRINT_SCHEMA_VERSION,
  CAPACITORS,
  defaultUnlocked,
  dropTable,
  ENEMIES,
  expandWave,
  flightAtRange,
  GAME,
  impactDamage,
  lockedParts,
  migrateBlueprint,
  parseClientMessage,
  isValidRoomCode,
  makeRoomCode,
  normalizeRoomCode,
  cleanName,
  parseWaves,
  PROTOCOL_VERSION,
  solveElevation,
  starterCoilgun,
  starterRailgun,
  teamScale,
  validateBlueprint,
  type Blueprint,
  type RailgunBlueprint,
} from '../src/index.ts';
import { mulberry32 } from '@railhold/physics';

function solve(bp: Blueprint) {
  const v = validateBlueprint(bp);
  assert.ok(v.ok, v.ok ? '' : v.issues.map((i) => `${i.field}: ${i.message}`).join('; '));
  const a = analyzeBlueprint(v.value);
  const r = 'rails' in a.design ? simulateRailgun(a.design, { verifyClosure: true }) : simulateCoilgun(a.design, { verifyClosure: true });
  assert.ok(r.ok, r.ok ? '' : r.message);
  return { a, r };
}

test('shipped starter blueprints pass the schema and reach the brief targets (5.6)', () => {
  const rail = solve(starterRailgun());
  assert.equal(rail.r.status, 'MUZZLE_EXIT');
  assert.ok(rail.r.muzzleSpeed_m_s >= 400 && rail.r.muzzleSpeed_m_s <= 900, `${rail.r.muzzleSpeed_m_s}`);
  assert.ok(rail.r.efficiency >= 0.05 && rail.r.efficiency <= 0.15, `${rail.r.efficiency}`);
  assert.deepEqual(rail.r.failures, []);
  const coil = solve(starterCoilgun());
  assert.equal(coil.r.status, 'MUZZLE_EXIT');
  assert.ok(coil.r.muzzleSpeed_m_s >= 80 && coil.r.muzzleSpeed_m_s <= 250, `${coil.r.muzzleSpeed_m_s}`);
  assert.deepEqual(coil.r.failures, []);
  for (const t of [rail, coil]) assert.ok(t.r.ledger.residual_max_rel < 1e-3);
});

test('5.6 every balance tier stays inside the catalog bands and never exceeds 45 % efficiency', () => {
  for (const tier of BALANCE_TIERS) {
    const { r } = solve(tier.blueprint);
    assert.ok(r.ok && r.status === 'MUZZLE_EXIT', `${tier.label}: ${r.status}`);
    assert.ok(r.I_peak_A >= 1e3 && r.I_peak_A <= 1.5e6, `${tier.label}: peak ${r.I_peak_A}`);
    assert.ok(r.efficiency < 0.45, `${tier.label}: efficiency ${r.efficiency}`);
    assert.deepEqual(r.failures, [], tier.label);
    assert.ok(r.ledger.residual_max_rel < 1e-3, tier.label);
  }
});

function hitsToKill(bp: Blueprint, enemy: 'walker' | 'plated', range_m: number): number {
  const { a, r } = solve(bp);
  assert.ok(r.ok && r.status === 'MUZZLE_EXIT');
  const sol = solveElevation(flightParamsFor(a.projectile, a.projectileMass_kg), r.muzzleSpeed_m_s, range_m, GAME.AIM_HEIGHT_M, GAME.MUZZLE_HEIGHT_M);
  const d = impactDamage(ENEMIES[enemy], a.projectileMass_kg, sol.impactSpeed_m_s, a.projectile.frontalArea_m2);
  return Math.ceil(ENEMIES[enemy].hp_J / d.damage_J);
}

test('5.6 Starter Railgun kills a Walker in 1 to 2 hits; Plated needs at least 3 from the starter and 1 from the top tier', () => {
  for (const range of [50, 150, 300]) {
    const walker = hitsToKill(starterRailgun(), 'walker', range);
    assert.ok(walker >= 1 && walker <= 2, `walker hits at ${range} m: ${walker}`);
    assert.ok(hitsToKill(starterRailgun(), 'plated', range) >= 3, `starter vs plated at ${range} m`);
  }
  const top = BALANCE_TIERS.find((t) => t.id === 'rail-4')!.blueprint;
  assert.equal(hitsToKill(top, 'plated', 300), 1);
});

test('momentum per frontal area decides penetration: dense long slugs beat armor, light ones do not', () => {
  const plated = ENEMIES.plated;
  const light = impactDamage(plated, 0.025, 600, 1.13e-4);
  const heavy = impactDamage(plated, 0.138, 700, 1.54e-4);
  assert.equal(light.penetrates, false);
  assert.equal(heavy.penetrates, true);
  assert.ok(light.damage_J < 0.25 * light.energy_J + 1e-9);
  assert.equal(heavy.damage_J, heavy.energy_J);
});

test('blueprint validation rejects out-of-range, wrong-type and structurally broken input with field paths', () => {
  const bad = (mut: (b: RailgunBlueprint) => unknown) => {
    const b = structuredClone(starterRailgun());
    return validateBlueprint(mut(b) ?? b);
  };
  const r1 = bad((b) => { b.rails.length_mm = 99999; });
  assert.ok(!r1.ok && r1.issues.some((i) => i.field === 'rails.length_mm'));
  const r2 = bad((b) => { (b.banks[0] as unknown as { series: unknown }).series = 'two'; });
  assert.ok(!r2.ok && r2.issues.some((i) => i.field === 'banks[0].series'));
  const r3 = bad((b) => { b.banks[0].capacitor = 'C9'; });
  assert.ok(!r3.ok && r3.issues.some((i) => i.field === 'banks[0].capacitor'));
  const r4 = bad((b) => { b.banks[0].charge_V = 1e6; });
  assert.ok(!r4.ok && r4.issues.some((i) => i.field === 'banks[0].charge_V'));
  const r5 = bad((b) => { b.armature.diameter_mm = 25; });
  assert.ok(!r5.ok && r5.issues.some((i) => i.field === 'armature.diameter_mm'));
  const r6 = bad((b) => { b.banks = []; });
  assert.ok(!r6.ok && r6.issues.some((i) => i.field === 'banks'));
  for (const junk of [null, 5, 'x', [], {}]) assert.equal(validateBlueprint(junk).ok, false);
  const c = structuredClone(starterCoilgun());
  c.tube_bore_mm = 10;
  const rc = validateBlueprint(c);
  assert.ok(!rc.ok && rc.issues.some((i) => i.field === 'tube_bore_mm'));
  const nan = structuredClone(starterRailgun());
  nan.rails.w_mm = Number.NaN;
  assert.equal(validateBlueprint(nan).ok, false);
});

test('over-rated charge is allowed by the schema so players can trigger failures deliberately', () => {
  const b = starterRailgun();
  b.banks[0].charge_V = 1.2 * CAPACITORS.C1.V_rated_V * b.banks[0].series;
  const { r } = solve(b);
  assert.ok(r.ok && r.failures.some((f) => f.kind === 'capacitor_overvoltage'));
});

test('geometry the rail model cannot handle surfaces as a solver error, not a crash', () => {
  const b = starterRailgun();
  b.rails = { material: 'copper', w_mm: 20, h_mm: 80, s_mm: 6, length_mm: 2000 };
  const a = analyzeBlueprint(b);
  const r = simulateRailgun(a.design as never);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.message, 'Rails too close together for this model');
});

test('4.8 blueprint migration: schema version 1 documents load and become valid', () => {
  const old = structuredClone(starterRailgun()) as unknown as Record<string, unknown>;
  old.schema_version = 1;
  delete old.payload;
  old.banks = (old.banks as Record<string, unknown>[]).map((b) => {
    const { charge_V: _drop, ...rest } = b;
    void _drop;
    return { ...rest, charge_frac: 0.8 };
  });
  const migrated = migrateBlueprint(old);
  const v = validateBlueprint(migrated);
  assert.ok(v.ok, v.ok ? '' : JSON.stringify(v.issues));
  if (v.ok && v.value.kind === 'railgun') {
    assert.equal(v.value.schema_version, BLUEPRINT_SCHEMA_VERSION);
    assert.equal(v.value.payload, 'none');
    assert.equal(v.value.banks[0].charge_V, 4000);
  }
  const current = starterCoilgun();
  assert.deepEqual(migrateBlueprint(current), current, 'current documents pass through unchanged');
  assert.equal(migrateBlueprint(7), 7);
});

test('part catalog: capacitor energy density is near 1 kJ/kg and unlock bookkeeping is consistent', () => {
  for (const p of Object.values(CAPACITORS)) {
    const density = (0.5 * p.C_F * p.V_rated_V ** 2) / 1000 / p.mass_kg;
    assert.ok(density > 0.9 && density < 1.1, `${p.id}: ${density} kJ/kg`);
  }
  const free = defaultUnlocked();
  assert.ok(free.includes('capacitor:C1') && !free.includes('capacitor:C3'));
  assert.equal(new Set(ALL_UNLOCKABLES.map((p) => `${p.group}:${p.id}`)).size, ALL_UNLOCKABLES.length, 'unlock keys are unique');
  const top = analyzeBlueprint(BALANCE_TIERS[3].blueprint);
  const locked = lockedParts(top, free);
  assert.ok(locked.includes('capacitor:C3') && locked.includes('switch:SW700') && locked.includes('mount:M3'));
  assert.deepEqual(lockedParts(analyzeBlueprint(starterRailgun()), free), []);
  assert.deepEqual(lockedParts(analyzeBlueprint(starterCoilgun()), free), []);
});

test('bank summary follows the series/parallel rules and the starter bank holds 44 kJ', () => {
  const b = bankSummary(starterRailgun().banks[0]);
  assert.ok(Math.abs(b.C_F - 5.5e-3) < 1e-12 && b.V_rated_V === 5000);
  assert.ok(Math.abs(b.energyAtCharge_J - 44000) < 1e-6);
});

test('wave table: waves.json validates, expands deterministically and scales with the team', () => {
  const raw = JSON.parse(readFileSync(new URL('../src/waves.json', import.meta.url), 'utf8'));
  const parsed = parseWaves(raw);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('; '));
  if (!parsed.ok) return;
  assert.equal(parsed.value.waves.length, GAME.WAVES);
  const a = expandWave(parsed.value.waves[2], 2, mulberry32(5));
  const b = expandWave(parsed.value.waves[2], 2, mulberry32(5));
  assert.deepEqual(a, b);
  for (let i = 1; i < a.length; i++) assert.ok(a[i].t_s >= a[i - 1].t_s, 'events are time ordered');
  const solo = expandWave(parsed.value.waves[0], 1, mulberry32(1)).length;
  const four = expandWave(parsed.value.waves[0], 4, mulberry32(1)).length;
  assert.equal(solo, 6);
  assert.equal(four, Math.round(6 * teamScale(4)));
  for (const lane of a.map((e) => e.lane)) assert.ok(lane >= 0 && lane < GAME.LANE_BEARINGS_DEG.length);
  const types = new Set(parsed.value.waves.flatMap((w) => w.spawns.map((s) => s.type)));
  assert.deepEqual([...types].sort(), Object.keys(ENEMIES).sort(), 'every enemy type appears');
});

test('wave table validation reports specific errors', () => {
  assert.equal(parseWaves(null).ok, false);
  const r = parseWaves({ version: 1, waves: [{ number: 1, label: 'x', spawns: [{ type: 'dragon', count: 0, lane: 9, start_s: -1, interval_s: 0 }] }] });
  assert.ok(!r.ok);
  if (!r.ok) assert.ok(r.errors.length >= 5, r.errors.join('; '));
});

test('protocol: malformed, oversized, wrong-version and out-of-range frames are rejected, never thrown', () => {
  const v = PROTOCOL_VERSION;
  const frames = [
    '', '{', 'null', '[]', '42', '"x"', JSON.stringify({ t: 'fire' }), JSON.stringify({ v: 99, t: 'fire' }), JSON.stringify({ v, t: 'nope' }),
    JSON.stringify({ v, t: 'hello', cid: 'abcdefgh', name: 5, unlocked: [] }), JSON.stringify({ v, t: 'hello', cid: 'abcdefgh', name: 'a', unlocked: [1] }), JSON.stringify({ v, t: 'hello', cid: '../x', name: 'a', unlocked: [] }), JSON.stringify({ v, t: 'loadout', blueprint: 3 }), JSON.stringify({ v, t: 'aim', x: 'a', z: 1 }), JSON.stringify({ v, t: 'aim', x: 1e9, z: 0 }),
    JSON.stringify({ v, t: 'chargeTarget', fraction: 2 }), JSON.stringify({ v, t: 'chargeTarget', fraction: Number.NaN }), 
    JSON.stringify({ v, t: 'ready', value: 'yes' }), 'x'.repeat(20000), JSON.stringify({ v, t: 'aim', elevation_mrad: 99999 }),
  ];
  for (const f of frames) {
    const r = parseClientMessage(f);
    assert.equal(r.ok, false, `accepted: ${f.slice(0, 60)}`);
    if (!r.ok) assert.ok(r.message.length > 5);
  }
  const wrongVersion = parseClientMessage(JSON.stringify({ v: 99, t: 'fire' }));
  assert.ok(!wrongVersion.ok && wrongVersion.code === 'bad_version' && /refresh/i.test(wrongVersion.message));
  const good = [
    { v, t: 'hello', cid: 'abcdefgh1234', name: 'Ada', unlocked: ['capacitor:C0'] }, { v, t: 'loadout', blueprint: { kind: 'railgun' } }, { v, t: 'next' }, { v, t: 'ready', value: true }, { v, t: 'fire' },
    { v, t: 'aim', x: 10, z: 200 }, { v, t: 'aim', elevation_mrad: 12.5 }, { v, t: 'chargeTarget', fraction: 0.5 }, { v, t: 'ping', n: 3 },
  ];
  for (const m of good) assert.equal(parseClientMessage(JSON.stringify(m)).ok, true, JSON.stringify(m));
});

test('fire control: the solved elevation puts the flight on the target to within a centimetre', () => {
  const { a, r } = solve(starterRailgun());
  assert.ok(r.ok);
  const params = flightParamsFor(a.projectile, a.projectileMass_kg);
  for (const range of [60, 150, 300, 450]) {
    const sol = solveElevation(params, r.muzzleSpeed_m_s, range, GAME.AIM_HEIGHT_M, GAME.MUZZLE_HEIGHT_M);
    assert.ok(sol.reachable, `range ${range}`);
    const f = flightAtRange(params, r.muzzleSpeed_m_s, sol.elevation_rad, range, GAME.MUZZLE_HEIGHT_M);
    assert.ok(Math.abs(f.height_m - GAME.AIM_HEIGHT_M) < 0.01, `height error at ${range} m: ${f.height_m - GAME.AIM_HEIGHT_M}`);
    assert.ok(Math.abs(f.time_s - sol.flightTime_s) < 1e-9);
    assert.ok(sol.flightTime_s > range / r.muzzleSpeed_m_s, 'drag makes the real flight slower than the muzzle-speed estimate');
  }
  const far = solveElevation(params, 50, 5000, 1, 1.6);
  assert.equal(far.reachable, false);
});

test('fire control: drop table grows with distance and is gravity-only with drag removed', () => {
  const { a, r } = solve(starterRailgun());
  assert.ok(r.ok);
  const drops = dropTable(flightParamsFor(a.projectile, a.projectileMass_kg), r.muzzleSpeed_m_s, [50, 100, 200, 400], 1.6);
  for (let i = 1; i < drops.length; i++) assert.ok(drops[i] > drops[i - 1]);
  assert.ok(drops[0] > 0 && drops[0] < 0.2, `drop at 50 m: ${drops[0]}`);
  const noDrag = flightAtRangeSelfCheck(1000, 200);
  assert.ok(Math.abs(noDrag.drop - 0.5 * 9.80665 * noDrag.time ** 2) < 1e-3, 'vacuum drop equals g t^2 / 2');
});

test('room codes: generated codes are valid, typed codes are normalised, look-alikes are rejected', () => {
  const rng = mulberry32(5);
  for (let i = 0; i < 200; i++) assert.ok(isValidRoomCode(makeRoomCode(rng)));
  assert.equal(normalizeRoomCode(' ab-c 234 '), 'ABC234');
  for (const bad of ['', 'ABC23', 'ABC2345', 'ABC0EF', 'ABCOEF', 'ABC1EF', 'ABCIEF', 'ABCLEF', 'abc234']) assert.equal(isValidRoomCode(bad), false, bad);
  assert.equal(cleanName('  <b>Ada</b>  '), 'bAdab');
  assert.equal(cleanName(''), 'Player');
  assert.equal(cleanName('x'.repeat(50)).length, 20);
});
