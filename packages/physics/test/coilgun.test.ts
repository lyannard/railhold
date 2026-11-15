import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  awgDiameter_m,
  demagFactorProlate,
  lncosh,
  longSolenoidInductance_H,
  makeOverlap,
  overlap,
  overlapDerivative,
  saturatedForce_N,
  simulateCoilgun,
  STARTER_COILGUN,
  wheelerInductance_H,
  type CoilgunDesign,
} from '../src/index.ts';
import { expectOk, UNLIMITED } from './helpers.ts';

test('4.8.10 demagnetizing factor: 1/3 at m = 1, decreasing, and the large-m asymptote', () => {
  assert.ok(Math.abs(demagFactorProlate(1) - 1 / 3) < 1e-12);
  assert.ok(Math.abs(demagFactorProlate(1 + 1e-9) - 1 / 3) < 1e-8, 'continuous through the singular point');
  let prev = demagFactorProlate(1);
  for (const m of [1.01, 1.5, 2, 3, 5, 10, 30, 100, 1000]) {
    const nd = demagFactorProlate(m);
    assert.ok(nd < prev, `Nd must decrease: Nd(${m}) = ${nd} >= ${prev}`);
    prev = nd;
  }
  for (const m of [1e3, 1e4, 1e5]) {
    const ratio = (demagFactorProlate(m) * m * m) / (Math.log(2 * m) - 1);
    assert.ok(Math.abs(ratio - 1) < 2e-3, `Nd m^2/(ln 2m - 1) = ${ratio} at m = ${m}`);
  }
  assert.ok(Math.abs(demagFactorProlate(2) - 0.1735) < 1e-3, 'textbook value for an aspect ratio of 2');
});

test('4.8.9 Wheeler inductance approaches the long-solenoid limit', () => {
  const N = 200;
  const r = 0.01;
  let lastDeviation = Infinity;
  for (const ratio of [10, 20, 40, 60, 120]) {
    const l = ratio * r;
    const dev = 1 - wheelerInductance_H(r, l, N) / longSolenoidInductance_H(r, l, N);
    assert.ok(dev > 0 && dev < lastDeviation, 'the gap must shrink monotonically as the coil gets longer');
    lastDeviation = dev;
    // The brief asks for 3 % at l = 10 r. The long-solenoid formula ignores end effects, which
    // alone are about 0.9 r / l, and Wheeler's constant 0.1 differs from the exact 0.10027 by
    // another 0.27 %, so 3 % is only reached from about l = 40 r. See docs/PHYSICS.md.
    if (ratio >= 40) assert.ok(dev < 0.03, `${(dev * 100).toFixed(2)} % at l = ${ratio} r`);
    assert.ok(Math.abs(dev - 0.9 / (ratio + 0.9)) < 0.004, 'the gap equals the end correction plus the 0.27 % constant');
  }
  const at10 = 1 - wheelerInductance_H(r, 10 * r, N) / longSolenoidInductance_H(r, 10 * r, N);
  assert.ok(at10 > 0.08 && at10 < 0.09, `at l = 10 r the two formulas differ by ${(at10 * 100).toFixed(2)} %`);
});

test('AWG wire diameter reproduces the standard table', () => {
  assert.ok(Math.abs(awgDiameter_m(36) - 0.127e-3) < 1e-9);
  assert.ok(Math.abs(awgDiameter_m(10) - 2.588e-3) < 2e-5, 'AWG 10 is 2.588 mm');
  assert.ok(Math.abs(awgDiameter_m(0) - 8.251e-3) < 5e-5, 'AWG 0 is 8.251 mm');
});

test('4.8.8 saturation: unsaturated limit equals half DeltaL prime I squared', () => {
  const dLp = 3.7e-4;
  for (const I of [1, 10, 100, 1000]) {
    const f = saturatedForce_N(dLp, 1e12, I);
    assert.ok(Math.abs(f / (0.5 * dLp * I * I) - 1) < 1e-9, `F(${I}) = ${f}`);
  }
});

test('4.8.8 saturation: above I_sat the force grows slower than I squared', () => {
  const dLp = 3.7e-4;
  const Isat = 300;
  let I = 3 * Isat;
  while (I < 100 * Isat) {
    const ratio = saturatedForce_N(dLp, Isat, 2 * I) / saturatedForce_N(dLp, Isat, I);
    assert.ok(ratio < 4 && ratio > 1.9, `doubling the current multiplies the force by ${ratio}`);
    I *= 1.7;
  }
  const lowRatio = saturatedForce_N(dLp, Isat, 0.02 * Isat) / saturatedForce_N(dLp, Isat, 0.01 * Isat);
  assert.ok(Math.abs(lowRatio - 4) < 1e-3, 'below I_sat the force still scales as I squared');
  assert.ok(Math.abs(lncosh(800) - (800 - Math.LN2)) < 1e-12, 'lncosh stays finite for huge arguments');
  assert.ok(Math.abs(lncosh(-5) - lncosh(5)) < 1e-15, 'lncosh is even');
});

test('smoothed overlap is C1, bounded, and its analytic derivative matches a numerical check', () => {
  for (const [coil, slug] of [[0.06, 0.03], [0.03, 0.06], [0.04, 0.04], [0.05, 0.0501]] as const) {
    const p = makeOverlap(coil, slug);
    const edge = (coil + slug) / 2;
    const h = 1e-8;
    for (let z = -edge * 1.2; z <= edge * 1.2; z += edge / 97) {
      const g = overlap(p, z);
      assert.ok(g >= -1e-12 && g <= 1 + 1e-12, `g(${z}) = ${g}`);
      const numeric = (overlap(p, z + h) - overlap(p, z - h)) / (2 * h);
      const analytic = overlapDerivative(p, z);
      assert.ok(Math.abs(numeric - analytic) < 1e-5 * Math.max(1, Math.abs(analytic)) + 1e-4, `dg/dz at ${z}: ${analytic} vs ${numeric}`);
    }
    assert.equal(overlap(p, edge * 1.5), 0);
    assert.equal(overlapDerivative(p, edge * 1.5), 0);
    assert.ok(Math.abs(overlapDerivative(p, 0)) < 1e-9, 'symmetric profile has zero slope at the centre');
    assert.ok(Math.abs(overlap(p, -0.013) - overlap(p, 0.013)) < 1e-15, 'g is even in z');
  }
});

/** One 6 cm coil, a slug arriving at 60 m/s, and a trigger offset to sweep. */
function singleStage(offset_m: number, freewheel: boolean): CoilgunDesign {
  const st = STARTER_COILGUN.stages[1];
  return {
    ...STARTER_COILGUN,
    x0_m: -0.3,
    v0_m_s: 60,
    x_exit_m: 0.3,
    stages: [{ ...st, z_m: 0, V0_V: 1200, freewheel, trigger: { kind: 'position', offset_m }, ...UNLIMITED, J_max_A_m2: 1e15 }],
  };
}

test('4.8.7 final speed against trigger offset has one interior maximum and a braking region', () => {
  const offsets: number[] = [];
  for (let o = -0.14; o <= 0.1001; o += 0.01) offsets.push(Math.round(o * 1000) / 1000);
  const v = offsets.map((o) => expectOk(simulateCoilgun(singleStage(o, false))).muzzleSpeed_m_s);
  const entry = 60;
  const best = v.indexOf(Math.max(...v));
  assert.ok(best > 0 && best < v.length - 1, `maximum at index ${best}`);
  assert.ok(v[best] > entry + 10, `the optimum adds real speed: ${v[best]}`);
  let peaks = 0;
  for (let i = 1; i < v.length - 1; i++) if (v[i] > v[i - 1] && v[i] > v[i + 1] && v[i] > entry + 0.5) peaks++;
  assert.equal(peaks, 1, `exactly one local maximum above the entry speed: ${v.map((x) => x.toFixed(1)).join(' ')}`);
  for (let i = 1; i <= best; i++) assert.ok(v[i] >= v[i - 1] - 0.05, `speed must rise up to the optimum (index ${i})`);
  const slowest = Math.min(...v);
  assert.ok(slowest < entry - 10, `triggering late gives a negative contribution: slowest ${slowest} m/s against ${entry} m/s entry`);
  assert.ok(offsets[v.indexOf(slowest)] > offsets[best], 'the braking region lies after the optimum');
  for (const edge of [v[0], v[v.length - 1]]) {
    assert.ok(Math.abs(edge - entry) < 0.1, `triggers that miss the slug leave it coasting at the entry speed: ${edge}`);
  }
});

test('a freewheel diode keeps the capacitor from reversing and raises the best achievable speed', () => {
  let bestWith = 0;
  let bestWithout = 0;
  for (let o = -0.07; o <= -0.02; o += 0.005) {
    bestWith = Math.max(bestWith, expectOk(simulateCoilgun(singleStage(o, true))).muzzleSpeed_m_s);
    bestWithout = Math.max(bestWithout, expectOk(simulateCoilgun(singleStage(o, false))).muzzleSpeed_m_s);
  }
  assert.ok(bestWith > bestWithout, `${bestWith} vs ${bestWithout}`);
  const withDiode = expectOk(simulateCoilgun(singleStage(-0.04, true)));
  const without = expectOk(simulateCoilgun(singleStage(-0.04, false)));
  assert.ok(withDiode.V_end_V[0] >= 0, `capacitor stays at or above zero with a diode: ${withDiode.V_end_V[0]}`);
  assert.ok(without.V_end_V[0] < 0, `capacitor rings negative without one: ${without.V_end_V[0]}`);
});

test('the ledger includes the kinetic energy a slug carries into the first coil', () => {
  const r = expectOk(simulateCoilgun(singleStage(-0.04, false), { verifyClosure: true }));
  assert.ok(r.ledger.KE0_J > 70 && r.ledger.KE0_J < 80, `initial kinetic energy ${r.ledger.KE0_J}`);
  assert.ok(r.ledger.residual_max_rel < 1e-3, `worst residual ${r.ledger.residual_max_rel}`);
  assert.ok(r.efficiency > 0 && r.efficiency < 0.45, 'efficiency counts only the energy the bank added');
});

test('a stage that never triggers leaves the slug coasting and the bank unspent', () => {
  const r = expectOk(simulateCoilgun(singleStage(5, false)));
  assert.ok(Math.abs(r.muzzleSpeed_m_s - 60) < 0.2, `coasting speed ${r.muzzleSpeed_m_s}`);
  assert.equal(r.I_peak_A, 0);
  assert.ok(r.ledger.E_cap_end_J > 0.999 * r.ledger.E_cap0_J);
});
