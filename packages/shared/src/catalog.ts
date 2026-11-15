/**
 * Part catalog. Every number is a game-scale value chosen to stay physically coherent:
 * capacitor energy density is about 1 kJ/kg at rated voltage (brief section 4.5), and ESR, ESL
 * and current ratings scale with module size. Costs are credits.
 */

export interface CapacitorPart {
  readonly id: string;
  readonly name: string;
  readonly C_F: number;
  readonly V_rated_V: number;
  readonly ESR_ohm: number;
  readonly ESL_H: number;
  readonly mass_kg: number;
  readonly cost: number;
  /** Largest tolerated discharge current of one module, A. */
  readonly I_peak_A: number;
  /** Largest tolerated reverse voltage as a fraction of the starting voltage. */
  readonly reversalFraction: number;
  readonly unlockCost: number;
}

export interface SwitchPart {
  readonly id: string;
  readonly name: string;
  readonly I_peak_A: number;
  readonly I2t_A2s: number;
  readonly dIdt_A_per_s: number;
  readonly Vf_V: number;
  readonly mass_kg: number;
  readonly cost: number;
  readonly unlockCost: number;
}

export interface MountPart {
  readonly id: string;
  readonly name: string;
  readonly f_sep_max_N_per_m: number;
  readonly mass_kg: number;
  readonly cost: number;
  readonly unlockCost: number;
}

export interface CoolingPart {
  readonly id: string;
  readonly name: string;
  /** Newtonian cooling time constant, s. */
  readonly tau_s: number;
  readonly mass_kg: number;
  readonly cost: number;
  readonly unlockCost: number;
}

export interface TriggerPart {
  readonly id: 'electric' | 'fiber';
  readonly name: string;
  /** Immune to the Jammer's electromagnetic pulse. */
  readonly emiImmune: boolean;
  readonly cost: number;
  readonly unlockCost: number;
}

export interface PayloadPart {
  readonly id: string;
  readonly name: string;
  /** Material of the flying payload. 'none' means the armature itself flies. */
  readonly material: 'none' | 'aluminum6061' | 'copper' | 'iron' | 'polymer';
  readonly unlockCost: number;
}

export const CAPACITORS: Readonly<Record<string, CapacitorPart>> = {
  C0: { id: 'C0', name: 'Compact film, 2.0 mF, 1.0 kV', C_F: 2.0e-3, V_rated_V: 1000, ESR_ohm: 8e-3, ESL_H: 150e-9, mass_kg: 1.0, cost: 80, I_peak_A: 15e3, reversalFraction: 0.3, unlockCost: 0 },
  C1: { id: 'C1', name: 'Film, 2.75 mF, 2.5 kV', C_F: 2.75e-3, V_rated_V: 2500, ESR_ohm: 3e-3, ESL_H: 200e-9, mass_kg: 8.6, cost: 300, I_peak_A: 80e3, reversalFraction: 0.2, unlockCost: 0 },
  C2: { id: 'C2', name: 'Low-ESR film, 2.2 mF, 3.0 kV', C_F: 2.2e-3, V_rated_V: 3000, ESR_ohm: 1.2e-3, ESL_H: 120e-9, mass_kg: 9.9, cost: 650, I_peak_A: 140e3, reversalFraction: 0.25, unlockCost: 3000 },
  C3: { id: 'C3', name: 'Dry high-energy, 4.0 mF, 3.5 kV', C_F: 4.0e-3, V_rated_V: 3500, ESR_ohm: 0.9e-3, ESL_H: 90e-9, mass_kg: 24.5, cost: 1500, I_peak_A: 250e3, reversalFraction: 0.3, unlockCost: 9000 },
};

export const SWITCHES: Readonly<Record<string, SwitchPart>> = {
  SW25: { id: 'SW25', name: 'Thyristor, 25 kA', I_peak_A: 25e3, I2t_A2s: 5e6, dIdt_A_per_s: 2e9, Vf_V: 1.5, mass_kg: 0.6, cost: 150, unlockCost: 0 },
  SW120: { id: 'SW120', name: 'Stud thyristor, 120 kA', I_peak_A: 120e3, I2t_A2s: 1.5e8, dIdt_A_per_s: 1e10, Vf_V: 1.8, mass_kg: 2.5, cost: 600, unlockCost: 1500 },
  SW350: { id: 'SW350', name: 'Press-pack thyristor, 350 kA', I_peak_A: 350e3, I2t_A2s: 2e9, dIdt_A_per_s: 5e10, Vf_V: 2.0, mass_kg: 6, cost: 1600, unlockCost: 0 },
  SW700: { id: 'SW700', name: 'Press-pack thyristor, 700 kA', I_peak_A: 700e3, I2t_A2s: 8e9, dIdt_A_per_s: 1e11, Vf_V: 2.4, mass_kg: 11, cost: 3800, unlockCost: 8000 },
};

export const MOUNTS: Readonly<Record<string, MountPart>> = {
  M1: { id: 'M1', name: 'Steel clamp mount, 600 kN/m', f_sep_max_N_per_m: 600e3, mass_kg: 40, cost: 1000, unlockCost: 0 },
  M2: { id: 'M2', name: 'Laminate mount, 1.2 MN/m', f_sep_max_N_per_m: 1.2e6, mass_kg: 70, cost: 2400, unlockCost: 4000 },
  M3: { id: 'M3', name: 'Prestressed mount, 2.4 MN/m', f_sep_max_N_per_m: 2.4e6, mass_kg: 120, cost: 5200, unlockCost: 12000 },
};

export const COOLING: Readonly<Record<string, CoolingPart>> = {
  K1: { id: 'K1', name: 'Passive fins, 60 s', tau_s: 60, mass_kg: 5, cost: 200, unlockCost: 0 },
  K2: { id: 'K2', name: 'Forced air, 30 s', tau_s: 30, mass_kg: 14, cost: 900, unlockCost: 2500 },
  K3: { id: 'K3', name: 'Liquid loop, 12 s', tau_s: 12, mass_kg: 30, cost: 2600, unlockCost: 8000 },
};

export const TRIGGERS: Readonly<Record<string, TriggerPart>> = {
  electric: { id: 'electric', name: 'Electrical trigger link', emiImmune: false, cost: 50, unlockCost: 0 },
  fiber: { id: 'fiber', name: 'Fiber-optic trigger link', emiImmune: true, cost: 700, unlockCost: 3500 },
};

export const PAYLOADS: Readonly<Record<string, PayloadPart>> = {
  none: { id: 'none', name: 'Armature flies', material: 'none', unlockCost: 0 },
  aluminum: { id: 'aluminum', name: 'Aluminum dart in sabot', material: 'aluminum6061', unlockCost: 1200 },
  copper: { id: 'copper', name: 'Copper dart in sabot', material: 'copper', unlockCost: 2500 },
  polymer: { id: 'polymer', name: 'Polymer dart in sabot', material: 'polymer', unlockCost: 1800 },
};

/** Armature and rail material costs, credits per kilogram. */
export const MATERIAL_COST_PER_KG: Readonly<Record<string, number>> = {
  copper: 14,
  aluminum6061: 6,
  iron: 2,
  polymer: 9,
};

export const INDUCTOR = {
  /** Largest pulse-shaping inductance per bank, H. */
  maxL_H: 60e-6,
  /** Resistance per henry of an air-core pulse inductor, ohm/H (20 ohm/H is 0.02 mohm per uH). */
  R_per_H: 20,
  /** Cost per microhenry. */
  cost_per_uH: 20,
  /** Mass per microhenry, kg. */
  mass_per_uH_kg: 0.05,
} as const;

/** Cabling common to every bank: series resistance and inductance of busbars and the switch. */
export const BANK_WIRING = { R_ohm: 0.5e-3, L_H: 0.4e-6 } as const;

/** Breech block and armature contact (railgun). */
export const BREECH = { L_H: 1e-6, R_ohm: 1e-4, R_arm_ohm: 2e-4, preload_N: 2000, mu_k: 0.1, mu_s: 0.15 } as const;

/** Wire cost per kilogram of copper winding, credits. */
export const WIRE_COST_PER_KG = 22;

export const ALL_UNLOCKABLES: ReadonlyArray<{ readonly group: string; readonly id: string; readonly name: string; readonly unlockCost: number }> = [
  ...Object.values(CAPACITORS).map((p) => ({ group: 'capacitor', id: p.id, name: p.name, unlockCost: p.unlockCost })),
  ...Object.values(SWITCHES).map((p) => ({ group: 'switch', id: p.id, name: p.name, unlockCost: p.unlockCost })),
  ...Object.values(MOUNTS).map((p) => ({ group: 'mount', id: p.id, name: p.name, unlockCost: p.unlockCost })),
  ...Object.values(COOLING).map((p) => ({ group: 'cooling', id: p.id, name: p.name, unlockCost: p.unlockCost })),
  ...Object.values(TRIGGERS).map((p) => ({ group: 'trigger', id: p.id, name: p.name, unlockCost: p.unlockCost })),
  ...Object.values(PAYLOADS).map((p) => ({ group: 'payload', id: p.id, name: p.name, unlockCost: p.unlockCost })),
];

/** Part ids every account owns from the start. */
export function defaultUnlocked(): string[] {
  return ALL_UNLOCKABLES.filter((p) => p.unlockCost === 0).map((p) => `${p.group}:${p.id}`);
}

export function unlockKey(group: string, id: string): string {
  return `${group}:${id}`;
}
