import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  simulateCoilgun,
  simulateRailgun,
  STARTER_COILGUN,
  STARTER_RAILGUN,
  type CoilgunDesign,
  type Failure,
  type FailureKind,
  type RailgunDesign,
} from '../src/index.ts';
import { expectOk } from './helpers.ts';

const BIG = 1e12;
const rail = (patch: Partial<RailgunDesign>): RailgunDesign => ({ ...STARTER_RAILGUN, ...patch });
const withModule = (patch: Record<string, unknown>): RailgunDesign =>
  rail({ modules: STARTER_RAILGUN.modules.map((m) => ({ ...m, ...patch })) as RailgunDesign['modules'] });
const coil = (stagePatch: Record<string, unknown>): CoilgunDesign => ({
  ...STARTER_COILGUN,
  stages: STARTER_COILGUN.stages.map((s) => ({ ...s, ...stagePatch })) as CoilgunDesign['stages'],
});

function firstFailure(design: RailgunDesign | CoilgunDesign, kind: FailureKind): Failure {
  const run = () => ('rails' in design ? simulateRailgun(design) : simulateCoilgun(design));
  const a = expectOk(run());
  const f = a.failures.find((x) => x.kind === kind);
  assert.ok(f, `expected ${kind}, got [${a.failures.map((x) => x.kind).join(', ')}] with status ${a.status}`);
  assert.equal(JSON.stringify(expectOk(run()).failures), JSON.stringify(a.failures), 'the same design must fail identically every time');
  assert.ok(f.value > f.limit, `${kind}: value ${f.value} must exceed limit ${f.limit}`);
  assert.ok(f.message.length > 40 && /\d/.test(f.message), 'the message states the numbers');
  assert.ok(f.t_s >= 0);
  return f;
}

const okModule = STARTER_RAILGUN.modules[0];
const rated = (patch: Record<string, unknown>) => ({
  capacitor: { ...okModule.capacitor, ...(patch.capacitor as object) },
  switch: { ...okModule.switch, ...(patch.switch as object) },
});

test('4.8.14 railgun: capacitor overvoltage loses the module before the shot', () => {
  const d = rail({ modules: [{ ...okModule, V0_V: 5200 }, okModule] });
  const f = firstFailure(d, 'capacitor_overvoltage');
  assert.equal(f.consequence, 'module_lost');
  assert.equal(f.index, 0);
  assert.equal(f.t_s, 0);
  assert.equal(f.limit, 5000);
  assert.equal(f.value, 5200);
  const r = expectOk(simulateRailgun(d, { verifyClosure: true }));
  assert.ok(r.ledger.E_fail_J > 0 && r.ledger.residual_max_rel < 1e-3, 'the lost bank is booked in the ledger');
});

test('4.8.14 railgun: capacitor peak current', () => {
  const f = firstFailure(withModule(rated({ capacitor: { I_peak_A: 1e5 } })), 'capacitor_peak_current');
  assert.equal(f.consequence, 'module_lost');
  assert.equal(f.limit, 1e5);
});

test('4.8.14 railgun: capacitor reversal without a crowbar diode', () => {
  const f = firstFailure(withModule({ crowbar: false, capacitor: { ...okModule.capacitor, reversalFraction: 0.05 }, L_H: 1.5e-6 }), 'capacitor_reversal');
  assert.equal(f.consequence, 'module_lost');
  assert.ok(Math.abs(f.limit - 0.05 * 4000) < 1e-9);
});

test('4.8.14 railgun: crowbar diode prevents the reversal failure', () => {
  const r = expectOk(simulateRailgun(withModule({ crowbar: true, capacitor: { ...okModule.capacitor, reversalFraction: 0.05 }, L_H: 1.5e-6 })));
  assert.ok(!r.failures.some((f) => f.kind === 'capacitor_reversal'));
});

test('4.8.14 railgun: switch peak current fails open and the bank keeps charge', () => {
  const d = withModule(rated({ switch: { I_peak_A: 1e5 } }));
  const f = firstFailure(d, 'switch_peak_current');
  assert.equal(f.consequence, 'switch_open');
  const r = expectOk(simulateRailgun(d, { verifyClosure: true }));
  assert.ok(r.ledger.E_cap_end_J > 0.2 * r.ledger.E_cap0_J, 'stored energy remains in the bank');
  assert.ok(r.ledger.residual_max_rel < 1e-3);
});

test('4.8.14 railgun: switch I^2 t', () => {
  assert.equal(firstFailure(withModule(rated({ switch: { I2t_A2s: 1e6 } })), 'switch_i2t').consequence, 'switch_open');
});

test('4.8.14 railgun: switch dI/dt fails at the very start of the pulse', () => {
  const f = firstFailure(withModule(rated({ switch: { dIdt_A_per_s: 1e8 } })), 'switch_didt');
  assert.equal(f.consequence, 'switch_open');
  assert.equal(f.t_s, 0);
});

test('4.8.14 railgun: rails melt at the breech end and the shot ends', () => {
  const d = rail({ mount: { f_sep_max_N_per_m: BIG }, rails: { w_m: 0.003, h_m: 0.003, s_m: 0.01, ell_m: 2, material: 'aluminum6061' } });
  const f = firstFailure(d, 'rail_melt');
  assert.equal(f.consequence, 'shot_ended');
  assert.equal(f.limit, 855);
  const r = expectOk(simulateRailgun(d));
  assert.equal(r.status, 'ABORTED_BY_FAILURE');
  assert.equal(r.muzzleSpeed_m_s, 0);
});

test('4.8.14 railgun: mount separation load destroys the mount', () => {
  const d = rail({ mount: { f_sep_max_N_per_m: 1e5 } });
  const f = firstFailure(d, 'mount_separation_load');
  assert.equal(f.consequence, 'mount_destroyed');
  assert.equal(expectOk(simulateRailgun(d)).status, 'ABORTED_BY_FAILURE');
});

test('softening: rails that pass 0.6 of the melting point are marked damaged without failing', () => {
  const d = rail({ rails: { w_m: 0.006, h_m: 0.006, s_m: 0.012, ell_m: 2, material: 'aluminum6061' }, mount: { f_sep_max_N_per_m: BIG }, modules: [{ ...okModule, V0_V: 1800 }, { ...okModule, V0_V: 1800 }] });
  let damaged = 0;
  for (const V of [1200, 1500, 1800, 2200, 2600]) {
    const r = expectOk(simulateRailgun({ ...d, modules: d.modules.map((m) => ({ ...m, V0_V: V })) }));
    if (r.railsDamaged && !r.failures.some((f) => f.kind === 'rail_melt')) damaged++;
  }
  assert.ok(damaged >= 1, 'some voltage lands between the softening limit and melting');
});

test('4.8.14 coilgun: capacitor overvoltage, peak current and reversal', () => {
  assert.equal(firstFailure(coil({ V0_V: 2500 }), 'capacitor_overvoltage').consequence, 'module_lost');
  assert.equal(firstFailure(coil({ capacitor: { ...STARTER_COILGUN.stages[0].capacitor, I_peak_A: 2000 } }), 'capacitor_peak_current').consequence, 'module_lost');
  const rev = firstFailure(coil({ freewheel: false, capacitor: { ...STARTER_COILGUN.stages[0].capacitor, reversalFraction: 0.05 } }), 'capacitor_reversal');
  assert.equal(rev.consequence, 'module_lost');
});

test('4.8.14 coilgun: switch peak current, I^2 t and dI/dt', () => {
  const sw = STARTER_COILGUN.stages[0].switch;
  assert.equal(firstFailure(coil({ switch: { ...sw, I_peak_A: 3000 } }), 'switch_peak_current').consequence, 'switch_open');
  assert.equal(firstFailure(coil({ switch: { ...sw, I2t_A2s: 1e4 } }), 'switch_i2t').consequence, 'switch_open');
  assert.equal(firstFailure(coil({ switch: { ...sw, dIdt_A_per_s: 1e7 } }), 'switch_didt').consequence, 'switch_open');
});

test('4.8.14 coilgun: coil insulation limit and current density lose the stage', () => {
  const ins = firstFailure(coil({ awg: 22, J_max_A_m2: 1e15 }), 'coil_overtemperature');
  assert.equal(ins.consequence, 'stage_lost');
  assert.equal(ins.limit, 420);
  assert.ok(ins.value >= 420 && ins.value < 425, `the failure triggers at the limit, not far past it: ${ins.value}`);
  const dens = firstFailure(coil({ J_max_A_m2: 1e8 }), 'coil_current_density');
  assert.equal(dens.consequence, 'stage_lost');
  assert.equal(dens.limit, 1e8);
});

test('failures close the energy ledger for coilguns too', () => {
  const r = expectOk(simulateCoilgun(coil({ awg: 22 }), { verifyClosure: true }));
  assert.ok(r.failures.length > 0);
  assert.ok(r.ledger.E_fail_J > 0);
  assert.ok(r.ledger.residual_max_rel < 1e-3, `residual ${r.ledger.residual_max_rel}`);
});

test('random numbers never decide a failure: jitter changes timing, not which ratings fail', () => {
  const d = withModule(rated({ switch: { I_peak_A: 1e5 } }));
  const kinds = (seed: number) => expectOk(simulateRailgun({ ...d, trigger_jitter_s: 2e-6 }, { seed })).failures.map((f) => f.kind).sort().join();
  assert.equal(kinds(1), kinds(2));
  assert.equal(kinds(2), kinds(3));
});
