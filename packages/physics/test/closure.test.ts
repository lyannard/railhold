import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateCoilgun, simulateRailgun, STARTER_COILGUN, STARTER_RAILGUN } from '../src/index.ts';
import { expectOk, randomCoilgun, randomRailgun, relErr } from './helpers.ts';

const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i * 7919);

test('4.8.3 railgun energy ledger closes below 0.1 % at every step (20 random designs)', () => {
  let exits = 0;
  for (const seed of SEEDS) {
    const r = expectOk(simulateRailgun(randomRailgun(seed), { seed, verifyClosure: true }));
    assert.ok(r.ledger.residual_max_rel < 1e-3, `seed ${seed}: worst residual ${r.ledger.residual_max_rel}`);
    assert.ok(r.ledger.residual_end_rel < 1e-3, `seed ${seed}: end residual ${r.ledger.residual_end_rel}`);
    if (r.status === 'MUZZLE_EXIT') exits++;
  }
  assert.ok(exits >= 10, `only ${exits} of 20 random railguns reached the muzzle, so the test is weak`);
});

test('4.8.3 coilgun energy ledger closes below 0.1 % at every step (20 random designs)', () => {
  let exits = 0;
  for (const seed of SEEDS) {
    const r = expectOk(simulateCoilgun(randomCoilgun(seed), { seed, verifyClosure: true }));
    assert.ok(r.ledger.residual_max_rel < 1e-3, `seed ${seed}: worst residual ${r.ledger.residual_max_rel}`);
    assert.ok(r.ledger.residual_end_rel < 1e-3, `seed ${seed}: end residual ${r.ledger.residual_end_rel}`);
    if (r.status === 'MUZZLE_EXIT') exits++;
  }
  assert.ok(exits >= 10, `only ${exits} of 20 random coilguns reached the muzzle, so the test is weak`);
});

test('the ledger terms are individually sensible', () => {
  const r = expectOk(simulateRailgun(STARTER_RAILGUN, { verifyClosure: true }));
  const L = r.ledger;
  for (const v of [L.E_cap0_J, L.E_cap_end_J, L.E_mag_end_J, L.KE_J, L.E_ohm_J, L.E_drop_J, L.E_fric_J, L.E_fail_J]) {
    assert.ok(Number.isFinite(v) && v >= 0, `negative or non-finite ledger term ${v}`);
  }
  assert.ok(relErr(L.E_muzzle_dump_J, L.E_mag_end_J) < 1e-12);
  assert.ok(relErr(L.KE_J, r.muzzleEnergy_J) < 1e-12);
});

test('4.8.5 halving the time step changes muzzle velocity by less than 0.01 %', () => {
  for (const [name, a, b] of [
    ['railgun', simulateRailgun(STARTER_RAILGUN), simulateRailgun(STARTER_RAILGUN, { dtScale: 0.5 })],
    ['coilgun', simulateCoilgun(STARTER_COILGUN), simulateCoilgun(STARTER_COILGUN, { dtScale: 0.5 })],
  ] as const) {
    const x = expectOk(a);
    const y = expectOk(b);
    assert.equal(x.status, 'MUZZLE_EXIT');
    const e = relErr(x.muzzleSpeed_m_s, y.muzzleSpeed_m_s);
    assert.ok(e < 1e-4, `${name}: ${x.muzzleSpeed_m_s} vs ${y.muzzleSpeed_m_s}, relative change ${e}`);
  }
});

test('4.8.15 the same blueprint and seed gives bit-identical results', () => {
  const jittery = { ...STARTER_RAILGUN, trigger_jitter_s: 5e-6, modules: [STARTER_RAILGUN.modules[0], { ...STARTER_RAILGUN.modules[0], trigger_delay_s: 1e-4 }] };
  const a = JSON.stringify(simulateRailgun(jittery, { seed: 42 }));
  const b = JSON.stringify(simulateRailgun(jittery, { seed: 42 }));
  assert.equal(a, b);
  assert.notEqual(a, JSON.stringify(simulateRailgun(jittery, { seed: 43 })), 'a different seed must change jittered timing');
  const c1 = JSON.stringify(simulateCoilgun(STARTER_COILGUN, { seed: 5 }));
  assert.equal(c1, JSON.stringify(simulateCoilgun(STARTER_COILGUN, { seed: 5 })));
});

test('the trace holds at most 600 points and ends at the final state', () => {
  const r = expectOk(simulateRailgun(STARTER_RAILGUN));
  assert.ok(r.trace.t_s.length <= 600 && r.trace.t_s.length > 50);
  assert.equal(r.trace.t_s.length, r.trace.I_A.length);
  assert.equal(r.trace.t_s[r.trace.t_s.length - 1], r.t_end_s);
  assert.ok(Math.abs(r.trace.x_m[r.trace.x_m.length - 1] - STARTER_RAILGUN.rails.ell_m) < 1e-6, 'the muzzle exit is located to within 1 micrometre');
});

test('solvers never return NaN or Infinity, even for extreme but valid inputs', () => {
  const extreme = {
    ...STARTER_RAILGUN,
    modules: [{ ...STARTER_RAILGUN.modules[0], V0_V: 1e7, C_F: 10, L_H: 1e-9, R_ohm: 1e-9, capacitor: { V_rated_V: 1e9, reversalFraction: 10, I_peak_A: 1e12 }, switch: { I_peak_A: 1e12, I2t_A2s: 1e30, dIdt_A_per_s: 1e30 } }],
    mount: { f_sep_max_N_per_m: 1e30 },
  };
  const r = simulateRailgun(extreme);
  if (r.ok) {
    for (const v of [r.muzzleSpeed_m_s, r.muzzleEnergy_J, r.I_peak_A, r.T_breech_end_K, r.ledger.residual_max_rel]) {
      assert.ok(Number.isFinite(v), `non-finite ${v}`);
    }
  } else {
    assert.ok(['SimulationDiverged', 'StepCapExceeded'].includes(r.kind));
    assert.ok(r.message.length > 10);
  }
});

test('invalid numeric input is rejected as InvalidDesign, never thrown', () => {
  const nan = simulateRailgun({ ...STARTER_RAILGUN, L_b_H: Number.NaN });
  assert.equal(nan.ok, false);
  const none = simulateRailgun({ ...STARTER_RAILGUN, modules: [] });
  assert.equal(none.ok, false);
  const shortSlug = simulateCoilgun({ ...STARTER_COILGUN, slug: { ...STARTER_COILGUN.slug, length_m: 0.005 } });
  assert.equal(shortSlug.ok, false);
});
