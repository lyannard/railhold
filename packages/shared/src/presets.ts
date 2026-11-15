import { BLUEPRINT_SCHEMA_VERSION, starterCoilgun, starterRailgun, type CoilgunBlueprint, type RailBankSpec, type RailgunBlueprint } from './blueprint.ts';

export interface Tier {
  readonly id: string;
  readonly label: string;
  readonly blueprint: RailgunBlueprint | CoilgunBlueprint;
}

function railTier(name: string, bank: Partial<RailBankSpec>, count: number, mount: string, armD: number, armL: number): RailgunBlueprint {
  const base = starterRailgun();
  const b: RailBankSpec = { ...base.banks[0], ...bank };
  return {
    ...base,
    name,
    schema_version: BLUEPRINT_SCHEMA_VERSION,
    rails: { material: 'copper', w_mm: 30, h_mm: 30, s_mm: 24, length_mm: 3000 },
    armature: { material: 'copper', diameter_mm: armD, length_mm: armL },
    banks: Array.from({ length: count }, () => ({ ...b })),
    mount,
    cooling: 'K2',
  };
}

function coilTier(name: string, n: number): CoilgunBlueprint {
  const base = starterCoilgun();
  const stage = { capacitor: 'C0', series: 2, parallel: 2, charge_V: 1800, switch: 'SW120', turns: 30, awg: 12, length_mm: 60, trigger_offset_mm: -50, freewheel: true };
  return { ...base, name, stages: Array.from({ length: n }, () => ({ ...stage })), cooling: 'K2' };
}

/** Upgrade tiers used by `pnpm balance`, the balance tests and the documentation. */
export const BALANCE_TIERS: readonly Tier[] = [
  { id: 'rail-1', label: 'Railgun tier 1 (starter)', blueprint: starterRailgun() },
  { id: 'rail-2', label: 'Railgun tier 2', blueprint: railTier('Railgun tier 2', { capacitor: 'C2', series: 1, parallel: 6, charge_V: 3000, inductor_uH: 4, switch: 'SW350' }, 3, 'M2', 14, 100) },
  { id: 'rail-3', label: 'Railgun tier 3', blueprint: railTier('Railgun tier 3', { capacitor: 'C3', series: 1, parallel: 4, charge_V: 3500, inductor_uH: 5, switch: 'SW700' }, 3, 'M3', 14, 100) },
  { id: 'rail-4', label: 'Railgun tier 4 (fully upgraded)', blueprint: railTier('Railgun tier 4', { capacitor: 'C3', series: 1, parallel: 6, charge_V: 3500, inductor_uH: 6, switch: 'SW700' }, 3, 'M3', 14, 100) },
  { id: 'coil-1', label: 'Coilgun tier 1 (starter)', blueprint: starterCoilgun() },
  { id: 'coil-2', label: 'Coilgun tier 2 (10 stages)', blueprint: coilTier('Coilgun tier 2', 10) },
];
