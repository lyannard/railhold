import { ALL_UNLOCKABLES, analyzeBlueprint, BALANCE_TIERS, GAME, lockedParts, unlockKey, type Blueprint } from '@railhold/shared';
import { simulateCoilgun, simulateRailgun } from '@railhold/physics';
import type { Profile } from '../profile.ts';
import { clear, eng, h } from '../dom.ts';
import { icon } from './widgets.ts';

/** What the shop needs from the app. */
export interface ShopCtx {
  profile: Profile;
  sfx(name: 'buy' | 'error' | 'confirm' | 'click'): void;
  toast(message: string, kind?: 'info' | 'fault'): void;
}

interface Kit {
  id: string;
  name: string;
  blurb: string;
  blueprint: Blueprint;
}

/** Plain names for the six preset launchers. Stats on the cards are simulated, never typed in. */
const KIT_TEXT: Record<string, { name: string; blurb: string }> = {
  'rail-1': { name: 'Starter Railgun', blurb: 'Reliable and cheap. Fast, light slugs.' },
  'rail-2': { name: 'Heavy Railgun', blurb: 'A heavier copper slug. More punch per shot, slower to reach.' },
  'rail-3': { name: 'Siege Railgun', blurb: 'Big banks and a strong mount. Hits armoured enemies hard.' },
  'rail-4': { name: 'Titan Railgun', blurb: 'The strongest launcher. Needs a big budget and good cooling.' },
  'coil-1': { name: 'Starter Coilgun', blurb: 'Gentle, rapid and forgiving. Good for swarms.' },
  'coil-2': { name: 'Rapid Coilgun', blurb: 'Ten stages. Still quick to charge, much more speed.' },
};

export const KITS: Kit[] = BALANCE_TIERS.map((t) => ({ id: t.id, name: KIT_TEXT[t.id]?.name ?? t.label, blurb: KIT_TEXT[t.id]?.blurb ?? '', blueprint: t.blueprint }));

interface KitStats {
  ok: boolean;
  speed: number;
  energy: number;
  cost: number;
  charge_s: number;
  missing: string[];
  missingCost: number;
}

const statCache = new Map<string, Omit<KitStats, 'missing' | 'missingCost'>>();

function costOf(key: string): number {
  return ALL_UNLOCKABLES.find((u) => unlockKey(u.group, u.id) === key)?.unlockCost ?? 0;
}

export function partName(key: string): string {
  const u = ALL_UNLOCKABLES.find((p) => unlockKey(p.group, p.id) === key);
  return u ? u.name : key;
}

export function kitStats(kit: Kit, unlocked: readonly string[]): KitStats {
  let base = statCache.get(kit.id);
  const a = analyzeBlueprint(kit.blueprint);
  if (!base) {
    const r = 'rails' in a.design ? simulateRailgun(a.design, {}) : simulateCoilgun(a.design, {});
    const supply = GAME.GRID.P_GEN_BASE_W + GAME.GRID.P_GEN_PER_PLAYER_W;
    base = {
      ok: r.ok && r.status === 'MUZZLE_EXIT',
      speed: r.ok ? r.muzzleSpeed_m_s : 0,
      energy: r.ok ? r.muzzleEnergy_J : 0,
      cost: a.cost,
      charge_s: a.bankEnergy_J / (GAME.GRID.ETA_CHARGE * Math.min(GAME.GRID.P_CHARGER_MAX_W, supply)),
    };
    statCache.set(kit.id, base);
  }
  const missing = lockedParts(a, unlocked);
  return { ...base, missing, missingCost: missing.reduce((s, k) => s + costOf(k), 0) };
}

/** Add a kit to the player's launchers, buying any missing parts first. Returns the new launcher id, or null. */
export function acquireKit(ctx: ShopCtx, kit: Kit): string | null {
  const p = ctx.profile;
  const st = kitStats(kit, p.data.unlocked);
  if (st.missingCost > p.data.credits) {
    ctx.sfx('error');
    ctx.toast(`You need ${(st.missingCost - p.data.credits).toLocaleString()} more credits.`, 'fault');
    return null;
  }
  for (const k of st.missing) p.unlock(k, costOf(k));
  const bp = JSON.parse(JSON.stringify(kit.blueprint)) as Blueprint;
  const taken = new Set(p.data.blueprints.map((b) => b.bp.name));
  let name = kit.name;
  for (let i = 2; taken.has(name); i++) name = `${kit.name} ${i}`;
  bp.name = name;
  const id = p.newBlueprint(bp);
  ctx.sfx(st.missingCost > 0 ? 'buy' : 'confirm');
  ctx.toast(st.missingCost > 0 ? `Bought and added ${name}.` : `Added ${name}.`);
  return id;
}

export function buyPart(ctx: ShopCtx, key: string): boolean {
  const cost = costOf(key);
  const ok = ctx.profile.unlock(key, cost);
  ctx.sfx(ok ? 'buy' : 'error');
  if (ok) ctx.toast(`Unlocked ${partName(key)}.`);
  else ctx.toast(`You need ${(cost - ctx.profile.data.credits).toLocaleString()} more credits.`, 'fault');
  return ok;
}

export interface ShopOpts {
  /** Called after a launcher is added, with its id. */
  onAdded?(id: string): void;
  /** Called after any purchase, so the caller can refresh what it shows. */
  onChange?(): void;
  budget?: number;
}

/** The shop: launcher kits and single parts, one screen. Re-renders itself after each purchase. */
export function renderShop(host: HTMLElement, ctx: ShopCtx, opts: ShopOpts = {}, tab: 'kits' | 'parts' = 'kits'): void {
  clear(host);
  const p = ctx.profile.data;
  const again = (t: 'kits' | 'parts' = tab): void => {
    opts.onChange?.();
    renderShop(host, ctx, opts, t);
  };
  const tabs = h('div', { class: 'stage-tabs', role: 'tablist', style: 'padding:0' },
    h('button', { class: 'stage-tab', type: 'button', role: 'tab', 'aria-selected': String(tab === 'kits'), onclick: () => renderShop(host, ctx, opts, 'kits') }, 'Launchers'),
    h('button', { class: 'stage-tab', type: 'button', role: 'tab', 'aria-selected': String(tab === 'parts'), onclick: () => renderShop(host, ctx, opts, 'parts') }, 'Parts'));
  const head = h('div', { class: 'spread' }, tabs, h('div', { class: 'pill' }, icon('bolt', 14), h('span', { class: 'readout' }, `${p.credits.toLocaleString()} credits`)));
  host.append(head);

  if (tab === 'kits') {
    host.append(h('p', { class: 'hint', style: 'margin-top:8px' }, 'Ready-made launchers. Buying one unlocks any parts it needs, forever, and adds a copy you can tune. Numbers are simulated from the real circuit and field equations.'));
    const grid = h('div', { class: 'kit-grid' });
    for (const kit of KITS) {
      const st = kitStats(kit, p.unlocked);
      const over = opts.budget !== undefined && st.cost > opts.budget;
      const canBuy = st.missingCost <= p.credits;
      grid.append(h('div', { class: 'kit' },
        h('div', { class: 'spread' }, h('h3', null, kit.name), h('span', { class: 'hint' }, kit.blueprint.kind)),
        h('p', { class: 'hint' }, kit.blurb),
        h('div', { class: 'kit-stats' },
          h('div', null, h('span', { class: 'k' }, 'Speed'), h('span', { class: 'v num' }, st.ok ? `${st.speed.toFixed(0)} m/s` : '–')),
          h('div', null, h('span', { class: 'k' }, 'Punch'), h('span', { class: 'v num' }, st.ok ? eng(st.energy, 'J') : '–')),
          h('div', null, h('span', { class: 'k' }, 'Recharge'), h('span', { class: 'v num' }, `${st.charge_s.toFixed(1)} s`)),
          h('div', null, h('span', { class: 'k' }, 'Build cost'), h('span', { class: 'v num' }, `${Math.round(st.cost).toLocaleString()} cr`))),
        over ? h('p', { class: 'err-text' }, icon('warn', 14), `Over the wave 1 budget (${opts.budget?.toLocaleString()}). Budgets rise each wave.`) : null,
        st.missing.length ? h('p', { class: 'hint' }, `Needs: ${st.missing.map(partName).join(', ')}`) : null,
        h('button', {
          class: `btn ${canBuy ? 'primary' : ''}`, type: 'button', disabled: !canBuy,
          onclick: () => {
            const id = acquireKit(ctx, kit);
            if (id) {
              opts.onAdded?.(id);
              again();
            }
          },
        }, st.missingCost > 0 ? `Buy for ${st.missingCost.toLocaleString()} cr` : 'Add to my launchers')));
    }
    host.append(grid);
    return;
  }

  const groups = [...new Set(ALL_UNLOCKABLES.map((u) => u.group))];
  const names: Record<string, string> = { capacitor: 'Capacitors', switch: 'Switches', mount: 'Mounts', cooling: 'Cooling', trigger: 'Trigger links', payload: 'Payloads' };
  host.append(h('p', { class: 'hint', style: 'margin-top:8px' }, 'Single parts for your own designs. Unlocks are permanent for this profile.'));
  for (const g of groups) {
    host.append(h('div', { class: 'plate', style: 'margin-bottom:12px' }, h('header', null, h('h3', null, names[g] ?? g)), h('div', { class: 'body' },
      ...ALL_UNLOCKABLES.filter((u) => u.group === g).map((u) => {
        const key = unlockKey(u.group, u.id);
        const owned = p.unlocked.includes(key);
        const afford = p.credits >= u.unlockCost;
        return h('div', { class: 'list-row' }, h('strong', null, u.name),
          owned ? h('span', { class: 'status' }, icon('check', 14), 'Owned')
            : h('button', { class: 'btn small', type: 'button', disabled: !afford, onclick: () => { if (buyPart(ctx, key)) again(); } }, `Buy ${u.unlockCost.toLocaleString()} cr`));
      }))));
  }
}
