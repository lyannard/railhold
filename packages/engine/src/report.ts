import {
  analyzeBlueprint,
  type Blueprint,
} from '@railhold/shared';
import { freshThermalState, physicsVersion, simulateLauncher, type Blueprint as PhysBlueprint, type ShotSummary } from '@railhold/physics';
import type { ShotReport } from './types.ts';

export function decimate(arr: readonly number[], n: number): number[] {
  if (arr.length <= n) return arr.slice();
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i * (arr.length - 1)) / (n - 1))]);
  return out;
}

/** Wire-sized copy of a solver result: the trace is resampled to `points` samples. */
export function toReport(s: ShotSummary, base: { shotId: number; seat: number; elevation_mrad: number; flightTime_s: number; reachable: boolean }, points: number): ShotReport {
  return {
    shotId: base.shotId, seat: base.seat, kind: s.kind, status: s.status, muzzleSpeed_m_s: s.muzzleSpeed_m_s, muzzleEnergy_J: s.muzzleEnergy_J, muzzleMomentum_Ns: s.muzzleMomentum_Ns,
    efficiency: s.efficiency, I_peak_A: s.I_peak_A, t_end_s: s.t_end_s,
    ledger: {
      E_cap0_J: s.ledger.E_cap0_J, E_ohm_J: s.ledger.E_ohm_J, E_drop_J: s.ledger.E_drop_J, E_fric_J: s.ledger.E_fric_J, E_fail_J: s.ledger.E_fail_J,
      E_muzzle_dump_J: s.ledger.E_muzzle_dump_J, E_cap_end_J: s.ledger.E_cap_end_J, E_mag_end_J: s.ledger.E_mag_end_J, KE_J: s.ledger.KE_J, KE0_J: s.ledger.KE0_J,
      residual_max_rel: s.ledger.residual_max_rel,
    },
    failures: s.failures.map((f) => ({ kind: f.kind, consequence: f.consequence, index: f.index, t_s: f.t_s, limit: f.limit, value: f.value, unit: f.unit, message: f.message })),
    trace: { t_s: decimate(s.trace.t_s, points), I_A: decimate(s.trace.I_A, points), v_m_s: decimate(s.trace.v_m_s, points), x_m: decimate(s.trace.x_m, points) },
    T_breech_end_K: s.T_breech_end_K, V_end_V: s.V_end_V, elevation_mrad: base.elevation_mrad, flightTime_s: base.flightTime_s, reachable: base.reachable, physicsVersion,
  };
}

export type PreviewResult =
  | { ok: true; report: ShotReport; cost: number; mass_kg: number; energy_J: number; projectileMass_kg: number; emiImmune: boolean; coolingTau_s: number; solveMs: number }
  | { ok: false; message: string };

/** One cold shot of a blueprint at full charge, for the editor's prediction. */
export function previewShot(bp: Blueprint): PreviewResult {
  const a = analyzeBlueprint(bp);
  if (a.modelIssues.length > 0) return { ok: false, message: a.modelIssues[0].message };
  const phys = { kind: a.blueprint.kind, design: a.design } as PhysBlueprint;
  const t0 = performance.now();
  try {
    const r = simulateLauncher(phys, freshThermalState(phys), 1);
    const solveMs = performance.now() - t0;
    if (!r.result.ok) return { ok: false, message: r.result.issues[0]?.message ?? r.result.message };
    return {
      ok: true, report: toReport(r.result, { shotId: 0, seat: 0, elevation_mrad: 0, flightTime_s: 0, reachable: true }, 400),
      cost: a.cost, mass_kg: a.launcherMass_kg, energy_J: a.bankEnergy_J, projectileMass_kg: a.projectileMass_kg, emiImmune: a.emiImmune, coolingTau_s: a.coolingTau_s, solveMs,
    };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'The solver failed.' };
  }
}
