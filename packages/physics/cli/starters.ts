import {
  physicsVersion,
  simulateCoilgun,
  simulateRailgun,
  STARTER_COILGUN,
  STARTER_RAILGUN,
  type CoilgunDesign,
  type RailgunDesign,
  type ShotResult,
} from '../src/index.ts';

interface Row {
  readonly name: string;
  readonly result: ShotResult;
}

function scaleRail(d: RailgunDesign, fraction: number): RailgunDesign {
  return { ...d, modules: d.modules.map((m) => ({ ...m, V0_V: m.V0_V * fraction })) as unknown as RailgunDesign['modules'] };
}

function scaleCoil(d: CoilgunDesign, fraction: number): CoilgunDesign {
  return { ...d, stages: d.stages.map((s) => ({ ...s, V0_V: s.V0_V * fraction })) as unknown as CoilgunDesign['stages'] };
}

const rows: Row[] = [
  { name: 'Starter Railgun, full charge', result: simulateRailgun(STARTER_RAILGUN, { verifyClosure: true }) },
  { name: 'Starter Railgun, 85 % voltage', result: simulateRailgun(scaleRail(STARTER_RAILGUN, 0.85), { verifyClosure: true }) },
  { name: 'Starter Railgun, 70 % voltage', result: simulateRailgun(scaleRail(STARTER_RAILGUN, 0.7), { verifyClosure: true }) },
  { name: 'Starter Coilgun, full charge', result: simulateCoilgun(STARTER_COILGUN, { verifyClosure: true }) },
  { name: 'Starter Coilgun, 80 % voltage', result: simulateCoilgun(scaleCoil(STARTER_COILGUN, 0.8), { verifyClosure: true }) },
  { name: 'Starter Coilgun, 60 % voltage', result: simulateCoilgun(scaleCoil(STARTER_COILGUN, 0.6), { verifyClosure: true }) },
];

const cols = ['Design', 'Status', 'Speed m/s', 'Energy J', 'Eff %', 'Peak kA', 'Peak temp K', 'Bank kJ', 'Ledger err'];
const table: string[][] = [cols];
for (const { name, result } of rows) {
  if (!result.ok) {
    table.push([name, result.kind, '-', '-', '-', '-', '-', '-', '-']);
    continue;
  }
  const peakTemp = result.kind === 'railgun' ? result.T_breech_end_K : Math.max(...result.coilTemps_K);
  table.push([
    name,
    result.status,
    result.muzzleSpeed_m_s.toFixed(1),
    result.muzzleEnergy_J.toFixed(0),
    (100 * result.efficiency).toFixed(2),
    (result.I_peak_A / 1e3).toFixed(1),
    peakTemp.toFixed(1),
    (result.ledger.E_cap0_J / 1e3).toFixed(2),
    result.ledger.residual_max_rel.toExponential(1),
  ]);
}
const widths = cols.map((_, i) => Math.max(...table.map((r) => r[i].length)));
const line = (r: string[]) => r.map((c, i) => (i < 2 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
const out: string[] = [`Railhold physics ${physicsVersion}: starter designs`, '', line(table[0]), widths.map((w) => '-'.repeat(w)).join('  ')];
for (const r of table.slice(1)) out.push(line(r));
out.push('', 'Peak temp is the breech end of the rails for the railgun and the hottest winding for the coilgun.');
process.stdout.write(`${out.join('\n')}\n`);
