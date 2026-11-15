import { simulateCoilgun, simulateRailgun, flightParamsFor, physicsVersion } from '../packages/physics/src/index.ts';
import { analyzeBlueprint, BALANCE_TIERS, ENEMIES, GAME, impactDamage, solveElevation, type Blueprint } from '../packages/shared/src/index.ts';

/** Distance at which impact numbers are evaluated, m. */
const EVAL_RANGE_M = 150;
/** Starter-grid supply for one player, W, and the charger ceiling. */
const SUPPLY_W = GAME.GRID.P_GEN_BASE_W + GAME.GRID.P_GEN_PER_PLAYER_W;

interface Row {
  label: string;
  cells: string[];
}

function evaluate(label: string, bp: Blueprint): Row {
  const a = analyzeBlueprint(bp);
  const r = 'rails' in a.design ? simulateRailgun(a.design, { verifyClosure: true }) : simulateCoilgun(a.design, { verifyClosure: true });
  if (!r.ok) return { label, cells: [r.kind, '-', '-', '-', '-', '-', '-', '-', '-', '-'] };
  const chargeS = a.bankEnergy_J / (GAME.GRID.ETA_CHARGE * Math.min(GAME.GRID.P_CHARGER_MAX_W, SUPPLY_W));
  let walker = '-';
  let plated = '-';
  if (r.status === 'MUZZLE_EXIT') {
    const sol = solveElevation(flightParamsFor(a.projectile, a.projectileMass_kg), r.muzzleSpeed_m_s, EVAL_RANGE_M, GAME.AIM_HEIGHT_M, GAME.MUZZLE_HEIGHT_M);
    const hits = (t: 'walker' | 'plated') => {
      const d = impactDamage(ENEMIES[t], a.projectileMass_kg, sol.impactSpeed_m_s, a.projectile.frontalArea_m2);
      return String(Math.ceil(ENEMIES[t].hp_J / d.damage_J));
    };
    walker = hits('walker');
    plated = hits('plated');
  }
  const peakTemp = r.kind === 'railgun' ? r.T_breech_end_K : Math.max(...r.coilTemps_K);
  return {
    label,
    cells: [
      r.status,
      r.muzzleSpeed_m_s.toFixed(0),
      r.muzzleEnergy_J.toFixed(0),
      (100 * r.efficiency).toFixed(1),
      (r.I_peak_A / 1e3).toFixed(0),
      peakTemp.toFixed(0),
      chargeS.toFixed(1),
      walker,
      plated,
      r.failures.length === 0 ? 'none' : r.failures.map((f) => f.kind).join(','),
    ],
  };
}

const header = ['Design', 'Status', 'm/s', 'Energy J', 'Eff %', 'Peak kA', 'Peak K', 'Charge s', 'Walker hits', 'Plated hits', 'Failures'];
const rows = BALANCE_TIERS.map((t) => evaluate(t.label, t.blueprint));
const table = [header, ...rows.map((r) => [r.label, ...r.cells])];
const w = header.map((_, i) => Math.max(...table.map((r) => r[i].length)));
const fmt = (r: string[]) => r.map((c, i) => (i === 0 || i === 1 || i === r.length - 1 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
const out = [
  `Railhold balance, physics ${physicsVersion}`,
  `Impact numbers at ${EVAL_RANGE_M} m with ISA drag and gravity. Charge time uses one player's grid share (${SUPPLY_W / 1e3} kW supply, ${GAME.GRID.P_CHARGER_MAX_W / 1e3} kW charger, eta ${GAME.GRID.ETA_CHARGE}).`,
  '',
  fmt(table[0]),
  w.map((n) => '-'.repeat(n)).join('  '),
  ...table.slice(1).map(fmt),
];
process.stdout.write(`${out.join('\n')}\n`);
