import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBank,
  dragCoefficient,
  eddyBrakingForce_N,
  Flight,
  G0,
  isa,
  magneticReynolds,
  MATERIALS,
  mulberry32,
  MU0,
  R_AIR,
  resistivity_ohm_m,
  sweepPointCapsule,
  sweepPointSphere,
  TraceRecorder,
  type ShieldZone,
} from '../src/index.ts';
import { relErr } from './helpers.ts';

test('4.8.11 ISA: sea-level density, tropopause density and speed of sound', () => {
  const sea = isa(0);
  assert.ok(Math.abs(sea.rho_kg_m3 - 1.225) < 1e-3, `rho(0) = ${sea.rho_kg_m3}`);
  assert.ok(Math.abs(sea.T_K - 288.15) < 1e-12);
  assert.ok(relErr(sea.a_m_s, 340.29) < 1e-3, `a(0) = ${sea.a_m_s}`);
  const top = isa(11000);
  assert.ok(relErr(top.rho_kg_m3, 22632.06 / (R_AIR * 216.65)) < 2e-3, `rho(11000) = ${top.rho_kg_m3}`);
  assert.ok(Math.abs(top.T_K - 216.65) < 1e-9);
  assert.ok(isa(5000).rho_kg_m3 < sea.rho_kg_m3 && isa(5000).rho_kg_m3 > top.rho_kg_m3, 'density falls with altitude');
  assert.equal(isa(-50).rho_kg_m3, sea.rho_kg_m3, 'below ground clamps to sea level');
});

test('4.8.12 ballistics: constant density, no gravity, v = v0 / (1 + k v0 t)', () => {
  const m = 0.04;
  const A = 4e-4;
  const rho = 1.225;
  const cd = 0.3;
  const f = new Flight({ mass_kg: m, frontalArea_m2: A, gravity_m_s2: 0, rhoOverride_kg_m3: rho, cdOverride: cd });
  const v0 = 900;
  f.reset(0, 0, 0, v0, 0, 0);
  const k = (rho * cd * A) / (2 * m);
  const dt = 1 / 240;
  let t = 0;
  for (let i = 1; i <= 480; i++) {
    f.step(dt);
    t = i * dt;
    if (i % 60 === 0) {
      const expected = v0 / (1 + k * v0 * t);
      assert.ok(relErr(f.speed_m_s, expected) < 1e-3, `t = ${t}: ${f.speed_m_s} vs ${expected}`);
      const xExpected = Math.log(1 + k * v0 * t) / k;
      assert.ok(relErr(f.s[0], xExpected) < 1e-3, `x(${t}) = ${f.s[0]} vs ${xExpected}`);
    }
  }
});

test('4.8.12 ballistics: with zero drag the trajectory is the analytic parabola', () => {
  const f = new Flight({ mass_kg: 0.04, frontalArea_m2: 4e-4, gravity_m_s2: G0, cdOverride: 0 });
  const v0x = 600;
  const v0y = 80;
  f.reset(1, 2, -3, v0x, v0y, 25);
  const dt = 1 / 240;
  for (let i = 1; i <= 360; i++) {
    f.step(dt);
    const t = i * dt;
    assert.ok(relErr(f.s[0], 1 + v0x * t) < 1e-6);
    assert.ok(relErr(f.s[1], 2 + v0y * t - 0.5 * G0 * t * t) < 1e-6);
    assert.ok(relErr(f.s[2], -3 + 25 * t) < 1e-6);
    assert.ok(relErr(f.s[4], v0y - G0 * t) < 1e-6);
  }
});

test('drag coefficient has the transonic shape: flat, a peak near Mach 1.2, then a slow decline', () => {
  assert.equal(dragCoefficient(0.1), 0.25);
  let peakM = 0;
  let peak = 0;
  for (let m = 0; m <= 6; m += 0.01) {
    const c = dragCoefficient(m);
    if (c > peak) {
      peak = c;
      peakM = m;
    }
  }
  assert.ok(peakM >= 1.1 && peakM <= 1.3, `peak at Mach ${peakM}`);
  assert.ok(dragCoefficient(3) < peak && dragCoefficient(3) > dragCoefficient(5));
  assert.ok(dragCoefficient(0.95) > dragCoefficient(0.5), 'rises through the transonic region');
});

test('real drag slows the starter slug over 100 m and gravity pulls it down', () => {
  const f = new Flight({ mass_kg: 0.025, frontalArea_m2: 1.13e-4, gravity_m_s2: G0 });
  f.reset(0, 1.5, 0, 670, 0, 0);
  let steps = 0;
  while (f.s[0] < 100 && steps < 2400) {
    f.step();
    steps++;
  }
  assert.ok(f.s[0] >= 100, 'reaches 100 m');
  const lost = 670 - f.speed_m_s;
  assert.ok(lost > 20 && lost < 250, `speed lost over 100 m: ${lost}`);
  assert.ok(f.s[1] < 1.5, 'the slug has dropped');
  const flightTime = steps / 240;
  assert.ok(flightTime > 100 / 670 && flightTime < 0.3, `time of flight ${flightTime}`);
});

test('4.8.13 eddy braking: low-Rm limit is the classical force and high-Rm saturates at magnetic pressure', () => {
  const B = 0.8;
  const A = 4e-4;
  const Lc = 0.05;
  const kappa = 1;
  const sigma = 1 / MATERIALS.aluminum6061.resistivity20_ohm_m;
  const v = 1e-5;
  assert.ok(magneticReynolds(v, sigma, Lc) < 1e-4);
  const low = eddyBrakingForce_N({ v_m_s: v, B_T: B, sigma_S_m: sigma, frontalArea_m2: A, Lc_m: Lc, kappa });
  assert.ok(relErr(low, 0.5 * kappa * sigma * B * B * v * A * Lc) < 1e-3, `low-Rm force ${low}`);
  const fast = eddyBrakingForce_N({ v_m_s: 1e7, B_T: B, sigma_S_m: sigma, frontalArea_m2: A, Lc_m: Lc, kappa });
  const pressure = kappa * ((B * B) / (2 * MU0)) * A;
  assert.ok(relErr(fast, pressure) < 1e-3, `saturated force ${fast} vs ${pressure}`);
  let prev = 0;
  for (const speed of [1e-2, 1, 10, 100, 1000, 1e4]) {
    const f = eddyBrakingForce_N({ v_m_s: speed, B_T: B, sigma_S_m: sigma, frontalArea_m2: A, Lc_m: Lc, kappa });
    assert.ok(f > prev && f <= pressure, `monotone and bounded at v = ${speed}`);
    prev = f;
  }
  assert.ok(magneticReynolds(800, sigma, Lc) > 1000, 'real slug speeds are deep in the high-Rm regime');
});

test('a non-conductive slug is not braked by a shield zone, a conductive one is', () => {
  const zone: ShieldZone = { cx_m: 50, cy_m: 0, cz_m: 0, radius_m: 20, B_T: 1.5 };
  const run = (sigma: number): number => {
    const f = new Flight({ mass_kg: 0.03, frontalArea_m2: 4e-4, gravity_m_s2: 0, cdOverride: 0, slugSigma_S_m: sigma, slugLength_m: 0.05, shield: zone });
    f.reset(0, 0, 0, 600, 0, 0);
    for (let i = 0; i < 90; i++) f.step();
    return f.speed_m_s;
  };
  const conductive = run(1 / MATERIALS.aluminum6061.resistivity20_ohm_m);
  const polymer = run(1 / MATERIALS.polymer.resistivity20_ohm_m);
  assert.ok(polymer > 599.999, `polymer ${polymer}`);
  assert.ok(conductive < 580, `aluminum ${conductive}`);
});

test('swept collision finds a hit that a point check would miss at 1 km/s', () => {
  const p0 = [0, 0, 0];
  const p1 = [4.2, 0, 0];
  const c = [2.1, 0.1, 0];
  assert.ok(Math.hypot(p1[0] - c[0], p1[1] - c[1]) > 0.5, 'the end point is outside the sphere, so a point check misses');
  const s = sweepPointSphere(p0, p1, c, 0.5);
  assert.ok(s > 0 && s < 1);
  const hitX = p0[0] + s * (p1[0] - p0[0]);
  assert.ok(Math.abs(Math.hypot(hitX - c[0], 0 - c[1]) - 0.5) < 1e-12, 'contact lies on the sphere surface');
  assert.equal(sweepPointSphere(p0, p1, [2.1, 3, 0], 0.5), -1);
  assert.equal(sweepPointSphere([2.1, 0.2, 0], p1, c, 0.5), 0, 'starting inside counts as an immediate hit');
  assert.equal(sweepPointSphere(p0, p0, [9, 9, 9], 0.5), -1);
});

test('swept capsule collision: side hit, end-cap hit, miss, and start inside', () => {
  const a = [10, 0, 0];
  const b = [10, 2, 0];
  const r = 0.3;
  const side = sweepPointCapsule([0, 1, 0], [20, 1, 0], a, b, r);
  assert.ok(Math.abs(side - (10 - r) / 20) < 1e-12, `side ${side}`);
  const cap = sweepPointCapsule([10, -5, 0], [10, 5, 0], a, b, r);
  assert.ok(Math.abs(cap - (5 - r) / 10) < 1e-12, `cap ${cap}`);
  assert.equal(sweepPointCapsule([0, 5, 0], [20, 5, 0], a, b, r), -1);
  assert.equal(sweepPointCapsule([0, 1, 0], [5, 1, 0], a, b, r), -1, 'segment ends before the capsule');
  assert.equal(sweepPointCapsule([10.1, 1, 0], [20, 1, 0], a, b, r), 0);
  assert.ok(sweepPointCapsule([0, 0, 0], [20, 0, 0], a, a, r) >= 0, 'a zero-length capsule behaves as a sphere');
});

test('mulberry32 is deterministic, uniform in [0, 1) and seed sensitive', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  let sum = 0;
  for (let i = 0; i < 10000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
    sum += x;
  }
  assert.ok(Math.abs(sum / 10000 - 0.5) < 0.02);
  assert.notEqual(mulberry32(1)(), mulberry32(2)());
});

test('material resistivity follows rho20 (1 + alpha (T - 293.15))', () => {
  assert.equal(resistivity_ohm_m('copper', 293.15), 1.68e-8);
  assert.ok(relErr(resistivity_ohm_m('copper', 393.15), 1.68e-8 * (1 + 3.93e-3 * 100)) < 1e-12);
  assert.ok(resistivity_ohm_m('aluminum6061', 5000) > 0 && resistivity_ohm_m('copper', 0) > 0, 'never reaches zero');
});

test('capacitor bank series and parallel scaling', () => {
  const m = { C_F: 1e-3, V_rated_V: 450, ESR_ohm: 0.01, ESL_H: 1e-7, mass_kg: 2, cost: 100 };
  const b = buildBank(m, 3, 2);
  assert.ok(relErr(b.C_F, (2 * 1e-3) / 3) < 1e-12);
  assert.equal(b.V_rated_V, 1350);
  assert.ok(relErr(b.ESR_ohm, 0.015) < 1e-12 && relErr(b.ESL_H, 1.5e-7) < 1e-12);
  assert.equal(b.mass_kg, 12);
  assert.equal(b.cost, 600);
  assert.ok(relErr(b.energyRated_J, 0.5 * b.C_F * 1350 * 1350) < 1e-12);
  assert.throws(() => buildBank(m, 0, 1), RangeError);
});

test('the trace recorder never exceeds its capacity however many samples arrive', () => {
  const rec = new TraceRecorder(600);
  for (let i = 0; i < 123456; i++) rec.push(i, i, i, i);
  const out = rec.finish(123456, 1, 2, 3);
  assert.ok(out.t_s.length <= 600 && out.t_s.length >= 300);
  assert.equal(out.t_s[out.t_s.length - 1], 123456);
  for (let i = 1; i < out.t_s.length; i++) assert.ok(out.t_s[i] > out.t_s[i - 1], 'time stays increasing');
});

test('ballistics: vertical fall in constant-density air reaches the analytic terminal velocity', () => {
  const m = 0.05;
  const A = 5e-4;
  const rho = 1.225;
  const cd = 0.3;
  const f = new Flight({ mass_kg: m, frontalArea_m2: A, gravity_m_s2: G0, rhoOverride_kg_m3: rho, cdOverride: cd });
  f.reset(0, 1e6, 0, 0, 0, 0);
  const vt = Math.sqrt((2 * m * G0) / (rho * cd * A));
  const k = Math.sqrt((rho * cd * A) / (2 * m * G0)); // v(t) = vt tanh(g t / vt)
  for (let i = 1; i <= 240 * 60; i++) {
    f.step(1 / 240);
    if (i % 240 === 0) {
      const t = i / 240;
      const expected = vt * Math.tanh((G0 * t) / vt);
      assert.ok(relErr(f.speed_m_s, expected) < 1e-6, `t = ${t}: ${f.speed_m_s} vs ${expected}`);
    }
  }
  assert.ok(relErr(f.speed_m_s, vt) < 1e-3);
  assert.ok(k > 0);
});
