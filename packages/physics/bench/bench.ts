import os from 'node:os';
import {
  simulateCoilgun,
  simulateRailgun,
  STARTER_COILGUN,
  STARTER_RAILGUN,
  type CoilgunDesign,
  type RailgunDesign,
} from '../src/index.ts';

/** Budget from the brief, section 4.8 item 16: p99 under 10 ms. */
const BUDGET_P99_MS = 10;
const WARMUP = 50;
const RUNS = 500;

const rail4: RailgunDesign = {
  ...STARTER_RAILGUN,
  modules: [0, 1, 2, 3].map(() => ({ ...STARTER_RAILGUN.modules[0], V0_V: 3000, C_F: 3e-3 })) as unknown as RailgunDesign['modules'],
};
const coil10: CoilgunDesign = {
  ...STARTER_COILGUN,
  x_exit_m: 10 * 0.05,
  stages: Array.from({ length: 10 }, (_, i) => ({
    ...STARTER_COILGUN.stages[1],
    z_m: i * 0.05,
    trigger: i === 0 ? ({ kind: 'delay', t_s: 0 } as const) : STARTER_COILGUN.stages[1].trigger,
  })),
};

interface Case {
  readonly name: string;
  readonly run: () => unknown;
  readonly check: () => string;
}

const cases: Case[] = [
  {
    name: '4-module railgun',
    run: () => simulateRailgun(rail4),
    check: () => {
      const r = simulateRailgun(rail4);
      return r.ok ? `${r.status}, ${r.muzzleSpeed_m_s.toFixed(0)} m/s, ${r.steps} steps` : r.kind;
    },
  },
  {
    name: '10-stage coilgun',
    run: () => simulateCoilgun(coil10),
    check: () => {
      const r = simulateCoilgun(coil10);
      return r.ok ? `${r.status}, ${r.muzzleSpeed_m_s.toFixed(0)} m/s, ${r.steps} steps` : r.kind;
    },
  },
  { name: 'Starter Railgun', run: () => simulateRailgun(STARTER_RAILGUN), check: () => 'reference' },
  { name: 'Starter Coilgun', run: () => simulateCoilgun(STARTER_COILGUN), check: () => 'reference' },
];

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}

const cpu = os.cpus();
const lines: string[] = [`Machine: ${cpu[0]?.model ?? 'unknown'}, ${cpu.length} logical CPUs, Node ${process.version}`, `Runs per case: ${RUNS} after ${WARMUP} warm-up runs`, ''];
let failed = false;
for (const c of cases) {
  for (let i = 0; i < WARMUP; i++) c.run();
  const t: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const a = performance.now();
    c.run();
    t.push(performance.now() - a);
  }
  t.sort((x, y) => x - y);
  const p99 = percentile(t, 0.99);
  const budgeted = c.name.startsWith('4-module') || c.name.startsWith('10-stage');
  const verdict = !budgeted ? '' : p99 <= BUDGET_P99_MS ? '  within budget' : '  OVER BUDGET';
  if (budgeted && p99 > BUDGET_P99_MS) failed = true;
  lines.push(`${c.name.padEnd(18)} p50 ${percentile(t, 0.5).toFixed(2).padStart(6)} ms   p99 ${p99.toFixed(2).padStart(6)} ms   max ${t[t.length - 1].toFixed(2).padStart(6)} ms${verdict}   [${c.check()}]`);
}
lines.push('', `Budget: p99 under ${BUDGET_P99_MS} ms for the 4-module railgun and the 10-stage coilgun.`);
process.stdout.write(`${lines.join('\n')}\n`);
process.exitCode = failed ? 1 : 0;
