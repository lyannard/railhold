import { test } from 'node:test';
import assert from 'node:assert/strict';
import { railGeometry, simulateRailgun, STARTER_RAILGUN, type RailgunDesign } from '../src/index.ts';
import { expectOk, relErr, UNLIMITED } from './helpers.ts';

test('4.8.1 RLC oscillation with the armature held fixed matches the analytic peak', () => {
  const C = 1e-3;
  const V0 = 1000;
  const Rk = 0.01;
  const Lk = 5e-6;
  const Lb = 1e-6;
  const design: RailgunDesign = {
    ...STARTER_RAILGUN,
    L_b_H: Lb,
    R_b_ohm: 0,
    R_arm_ohm: 0,
    modules: [{ C_F: C, V0_V: V0, R_ohm: Rk, L_H: Lk, Vf_V: 0, trigger_delay_s: 0, crowbar: false, ...UNLIMITED }],
  };
  const r = expectOk(simulateRailgun(design, { diagnostic: { fixedArmature: true } }));
  const L = Lk + Lb;
  const alpha = Rk / (2 * L);
  const omega = Math.sqrt(1 / (L * C) - alpha * alpha);
  const tPeak = Math.atan(omega / alpha) / omega;
  const iPeak = (V0 / (omega * L)) * Math.exp(-alpha * tPeak) * Math.sin(omega * tPeak);
  assert.ok(relErr(r.I_peak_A, iPeak) < 1e-3, `peak ${r.I_peak_A} vs ${iPeak}`);
  assert.ok(relErr(r.I_peak_t_s, tPeak) < 1e-3, `time ${r.I_peak_t_s} vs ${tPeak}`);
});

test('4.8.2 prescribed constant current gives v = I0 sqrt(Lprime x / m)', () => {
  const design: RailgunDesign = {
    ...STARTER_RAILGUN,
    armature: { mass_kg: 0.05, mu_k: 0, mu_s: 0, preload_N: 0 },
    rails: { ...STARTER_RAILGUN.rails, ell_m: 1.5 },
  };
  const I0 = 1e5;
  const r = expectOk(simulateRailgun(design, { diagnostic: { prescribedCurrent_A: I0 } }));
  const Lp = railGeometry(design, 293.15).Lprime_H_m;
  const expected = I0 * Math.sqrt((Lp * 1.5) / 0.05);
  assert.equal(r.status, 'MUZZLE_EXIT');
  assert.ok(relErr(r.muzzleSpeed_m_s, expected) < 1e-3, `${r.muzzleSpeed_m_s} vs ${expected}`);
});

test('4.8.4 two identical modules equal one module with doubled C and halved R and L', () => {
  const m = { ...STARTER_RAILGUN.modules[0], ...UNLIMITED };
  const two: RailgunDesign = { ...STARTER_RAILGUN, mount: { f_sep_max_N_per_m: 1e12 }, modules: [m, m] };
  const one: RailgunDesign = {
    ...two,
    modules: [{ ...m, C_F: 2 * m.C_F, R_ohm: m.R_ohm / 2, L_H: m.L_H / 2 }],
  };
  const a = expectOk(simulateRailgun(two));
  const b = expectOk(simulateRailgun(one));
  assert.equal(a.status, 'MUZZLE_EXIT');
  assert.ok(relErr(a.muzzleSpeed_m_s, b.muzzleSpeed_m_s) < 1e-3, `${a.muzzleSpeed_m_s} vs ${b.muzzleSpeed_m_s}`);
});

test('4.8.6 recoil impulse equals armature momentum and the force impulse balances', () => {
  const r = expectOk(simulateRailgun(STARTER_RAILGUN));
  const m = STARTER_RAILGUN.armature.mass_kg;
  assert.equal(r.status, 'MUZZLE_EXIT');
  assert.equal(r.recoilImpulse_Ns, m * r.muzzleSpeed_m_s);
  const balance = r.impulseEm_Ns - (m * r.muzzleSpeed_m_s + r.impulseFric_Ns);
  assert.ok(Math.abs(balance) / r.impulseEm_Ns < 1e-4, `imbalance ${balance}`);
});

test('rails closer than the model allows are rejected with the documented message', () => {
  const bad: RailgunDesign = { ...STARTER_RAILGUN, rails: { ...STARTER_RAILGUN.rails, w_m: 0.02, h_m: 0.2, s_m: 0.005 } };
  const r = simulateRailgun(bad);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.kind, 'InvalidDesign');
    assert.equal(r.message, 'Rails too close together for this model');
  }
});

test('the brief sanity check: 2 cm square rails 2 cm apart give about 0.6 uH/m', () => {
  const Lp = railGeometry(STARTER_RAILGUN, 293.15).Lprime_H_m;
  assert.ok(Lp > 0.58e-6 && Lp < 0.62e-6, `Lprime ${Lp}`);
});
