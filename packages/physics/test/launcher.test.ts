import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canFire,
  coolState,
  coolTo,
  DAMAGED_RAIL_DERATE,
  freshThermalState,
  physicsVersion,
  PHYSICS_CONFIG,
  simulateCoilgun,
  simulateLauncher,
  simulateRailgun,
  STARTER_COILGUN,
  STARTER_RAILGUN,
  T_AMBIENT_K,
  type Blueprint,
} from '../src/index.ts';
import { expectOk, randomCoilgun, randomRailgun, relErr } from './helpers.ts';

const RAIL_BP: Blueprint = { kind: 'railgun', design: STARTER_RAILGUN };
const COIL_BP: Blueprint = { kind: 'coilgun', design: STARTER_COILGUN };

test('physicsVersion is a semantic version and every result records it', () => {
  assert.match(physicsVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(expectOk(simulateRailgun(STARTER_RAILGUN)).physicsVersion, physicsVersion);
  assert.equal(expectOk(simulateCoilgun(STARTER_COILGUN)).physicsVersion, physicsVersion);
});

test('5.6 Starter Railgun: 400 to 900 m/s, 5 to 15 % efficiency, peak current within the catalog band', () => {
  const r = expectOk(simulateRailgun(STARTER_RAILGUN, { verifyClosure: true }));
  assert.equal(r.status, 'MUZZLE_EXIT');
  assert.ok(r.muzzleSpeed_m_s >= 400 && r.muzzleSpeed_m_s <= 900, `velocity ${r.muzzleSpeed_m_s}`);
  assert.ok(r.efficiency >= 0.05 && r.efficiency <= 0.15, `efficiency ${r.efficiency}`);
  assert.ok(r.I_peak_A >= 1e3 && r.I_peak_A <= 1.5e6, `peak current ${r.I_peak_A}`);
  assert.deepEqual(r.failures, []);
  assert.ok(!r.railsDamaged);
  assert.ok(r.T_breech_end_K > T_AMBIENT_K && r.T_breech_end_K < 400);
});

test('5.6 Starter Coilgun: 80 to 250 m/s with a short shot, so a high rate of fire is possible', () => {
  const r = expectOk(simulateCoilgun(STARTER_COILGUN, { verifyClosure: true }));
  assert.equal(r.status, 'MUZZLE_EXIT');
  assert.ok(r.muzzleSpeed_m_s >= 80 && r.muzzleSpeed_m_s <= 250, `velocity ${r.muzzleSpeed_m_s}`);
  assert.ok(r.I_peak_A >= 1e3 && r.I_peak_A <= 1.5e6, `peak current ${r.I_peak_A}`);
  assert.ok(r.efficiency > 0 && r.efficiency < 0.45);
  assert.deepEqual(r.failures, []);
  assert.ok(Math.max(...r.coilTemps_K) < PHYSICS_CONFIG.COIL_INSULATION_LIMIT_K - 50, 'headroom below the insulation limit');
  assert.ok(r.t_end_s < 0.02, `the whole shot lasts ${r.t_end_s * 1e3} ms`);
});

test('5.6 no random design in either family reaches an efficiency of 45 %', () => {
  for (let i = 0; i < 40; i++) {
    const a = expectOk(simulateRailgun(randomRailgun(77 + i)));
    const b = expectOk(simulateCoilgun(randomCoilgun(77 + i)));
    assert.ok(a.efficiency < 0.45, `railgun seed ${77 + i}: ${a.efficiency}`);
    assert.ok(b.efficiency < 0.45, `coilgun seed ${77 + i}: ${b.efficiency}`);
    assert.ok(a.I_peak_A < 1.5e6, `railgun peak ${a.I_peak_A}`);
  }
});

test('ledger: the starter railgun loses most energy as resistive heat, and the muzzle dump grows when the pulse outlasts the transit', () => {
  const base = expectOk(simulateRailgun(STARTER_RAILGUN)).ledger;
  assert.ok(base.E_ohm_J > 0.8 * base.E_cap0_J, 'resistive loss dominates the starter');
  assert.ok(base.E_muzzle_dump_J < 0.05 * base.E_cap0_J, 'its pulse has decayed before the armature leaves the muzzle');
  const slowPulse = (L_H: number, ell_m: number, mass_kg: number) => {
    const m = { ...STARTER_RAILGUN.modules[0], L_H };
    return expectOk(
      simulateRailgun({ ...STARTER_RAILGUN, rails: { ...STARTER_RAILGUN.rails, ell_m }, armature: { ...STARTER_RAILGUN.armature, mass_kg }, modules: [m, m] }, { verifyClosure: true }),
    );
  };
  const slow = slowPulse(40e-6, 0.5, 0.1);
  assert.equal(slow.status, 'MUZZLE_EXIT');
  assert.ok(slow.ledger.E_muzzle_dump_J > 0.25 * slow.ledger.E_cap0_J, `muzzle dump ${(100 * slow.ledger.E_muzzle_dump_J / slow.ledger.E_cap0_J).toFixed(1)} % of the bank`);
  assert.ok(slow.efficiency < base.KE_J / base.E_cap0_J, 'and efficiency falls with it');
  assert.ok(slow.ledger.residual_max_rel < 1e-3);
});

test('partial charge uses the real solver with the actual voltage', () => {
  const at = (frac: number) =>
    expectOk(
      simulateRailgun({
        ...STARTER_RAILGUN,
        modules: STARTER_RAILGUN.modules.map((m) => ({ ...m, V0_V: m.V0_V * frac })) as typeof STARTER_RAILGUN.modules,
      }),
    );
  const full = at(1);
  const half = at(0.5);
  assert.ok(half.status !== 'MUZZLE_EXIT' || half.muzzleSpeed_m_s < full.muzzleSpeed_m_s * 0.6);
  assert.ok(relErr(half.ledger.E_cap0_J, full.ledger.E_cap0_J / 4) < 1e-12, 'bank energy scales with voltage squared');
});

test('5.4 thermal state: shot heat mixes into the rails by mass and cooling is Newtonian', () => {
  const s0 = freshThermalState(RAIL_BP);
  assert.equal(s0.railBulk_K, T_AMBIENT_K);
  assert.ok(canFire(s0));
  const { result, nextState } = simulateLauncher(RAIL_BP, s0, 1);
  const r = expectOk(result);
  assert.ok(nextState.railBulk_K > s0.railBulk_K);
  assert.ok(nextState.railBulk_K < r.T_breech_end_K, 'the bulk rail is cooler than the breech end');
  const cooled = coolTo(nextState.railBulk_K, 30, 30);
  const expected = T_AMBIENT_K + (nextState.railBulk_K - T_AMBIENT_K) / Math.E;
  assert.ok(relErr(cooled, expected) < 1e-12, 'one time constant leaves 1/e of the excess');
  assert.equal(coolState(nextState, 1e9, 30).railBulk_K, T_AMBIENT_K);
});

test('5.4 firing is blocked above the limit temperature, and a hot rail starts the next shot hotter', () => {
  const hot = { railBulk_K: PHYSICS_CONFIG.LAUNCHER_FIRE_LIMIT_K + 1, coilBulk_K: [], railsDamaged: false };
  assert.equal(canFire(hot), false);
  let state = freshThermalState(RAIL_BP);
  const temps: number[] = [];
  for (let i = 0; i < 4; i++) {
    const out = simulateLauncher(RAIL_BP, state, i);
    expectOk(out.result);
    state = out.nextState;
    temps.push(state.railBulk_K);
  }
  for (let i = 1; i < temps.length; i++) assert.ok(temps[i] > temps[i - 1], 'repeated shots keep heating the rails');
});

test('5.4 coil temperatures persist between shots and a hot stage heats further', () => {
  let state = freshThermalState(COIL_BP);
  assert.equal(state.coilBulk_K.length, 6);
  const first = simulateLauncher(COIL_BP, state, 1);
  expectOk(first.result);
  state = first.nextState;
  assert.ok(state.coilBulk_K.every((T) => T > T_AMBIENT_K));
  const second = simulateLauncher(COIL_BP, state, 2);
  expectOk(second.result);
  assert.ok(second.nextState.coilBulk_K[0] > state.coilBulk_K[0]);
});

test('damaged rails melt at a lower temperature', () => {
  assert.ok(DAMAGED_RAIL_DERATE < 1 && DAMAGED_RAIL_DERATE > 0.5);
  const thin = { ...STARTER_RAILGUN, mount: { f_sep_max_N_per_m: 1e12 }, rails: { w_m: 0.006, h_m: 0.006, s_m: 0.012, ell_m: 2, material: 'aluminum6061' as const } };
  const hotMod = thin.modules.map((m) => ({ ...m, V0_V: 2000 })) as typeof thin.modules;
  const bp: Blueprint = { kind: 'railgun', design: { ...thin, modules: hotMod } };
  const fresh = expectOk(simulateLauncher(bp, freshThermalState(bp), 1).result);
  const damaged = expectOk(simulateLauncher(bp, { ...freshThermalState(bp), railsDamaged: true }, 1).result);
  const meltsFresh = fresh.failures.some((f) => f.kind === 'rail_melt');
  const meltsDamaged = damaged.failures.some((f) => f.kind === 'rail_melt');
  assert.ok(!meltsFresh || meltsDamaged, 'anything that melts fresh rails melts damaged rails');
  const lim = damaged.failures.find((f) => f.kind === 'rail_melt');
  if (lim) assert.ok(Math.abs(lim.limit - 855 * DAMAGED_RAIL_DERATE) < 1e-9);
});

test('a solver error leaves the launcher state untouched', () => {
  const bad: Blueprint = { kind: 'railgun', design: { ...STARTER_RAILGUN, modules: [] } };
  const s = freshThermalState(bad);
  const out = simulateLauncher(bad, s, 1);
  assert.equal(out.result.ok, false);
  assert.equal(out.nextState, s);
});
