import {
  analyzeBlueprint,
  CAPACITORS,
  COOLING,
  GAME,
  LIMITS,
  lockedParts,
  MOUNTS,
  PAYLOADS,
  SWITCHES,
  TRIGGERS,
  unlockKey,
  ALL_UNLOCKABLES,
  validateBlueprint,
  starterCoilgun,
  starterRailgun,
  type Analysis,
  type Blueprint,
  type CoilgunBlueprint,
  type FieldIssue,
  type RailgunBlueprint,
} from '@railhold/shared';
import type { PreviewResult, ShotReport } from '@railhold/engine';
import { Calc } from '../calc.ts';
import { clear, eng, h, pct, s } from '../dom.ts';
import type { Profile } from '../profile.ts';
import { COLORS, icon, ledgerBar, Scope } from './widgets.ts';
import { buyPart, renderShop, partName } from './garage.ts';

void partName;

const PREVIEW_DEBOUNCE_MS = 100;

export interface EditorCtx {
  profile: Profile;
  reducedMotion: boolean;
  openNotes(): void;
  /** Leave the editor to the Range with this blueprint. */
  toRange(id: string): void;
  sfx(name: 'buy' | 'error' | 'confirm' | 'click'): void;
  toast(message: string, kind?: 'info' | 'fault'): void;
  /** When set, the editor is embedded in a running match: no Range link, and this closes it. */
  done?: (id: string) => void;
  /** Credit budget for this match wave; defaults to the wave 1 budget. */
  budget?: number;
  wave?: number;
}

type Draft = Record<string, unknown>;

interface FieldRef {
  input: HTMLInputElement | HTMLSelectElement;
  err: HTMLElement;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Look up a value by a path such as `banks[0].series`. */
function getPath(o: unknown, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur: unknown = o;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setPath(o: unknown, path: string, value: unknown): void {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = o as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] as Record<string, unknown>;
  cur[parts[parts.length - 1]] = value;
}

export function mountEditor(root: HTMLElement, ctx: EditorCtx, startId: string): () => void {
  const calc = new Calc();
  const scope = new Scope(0.56, 'Rail current');
  let id = startId;
  let draft: Draft = clone(ctx.profile.blueprint(id)?.bp ?? starterRailgun()) as unknown as Draft;
  let fields = new Map<string, FieldRef>();
  let stageIdx = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let lastReport: ShotReport | null = null;
  let lastPreview: Extract<PreviewResult, { ok: true }> | null = null;
  let issues: FieldIssue[] = [];
  let analysis: Analysis | null = null;

  const unlocked = (): string[] => ctx.profile.data.unlocked;
  const isOpen = (group: string, pid: string): boolean => unlocked().includes(unlockKey(group, pid));

  // ---------------------------------------------------------------- DOM scaffolding
  const picker = h('select', { 'aria-label': 'Launcher', id: 'launcher-pick', onchange: (e: Event) => switchTo((e.target as HTMLSelectElement).value) });
  const saveNote = h('span', { class: 'hint', role: 'status' }, '');
  const schematic = h('div', { class: 'schematic' });
  const controls = h('div');
  const stageTabs = h('div', { class: 'stage-tabs', role: 'tablist', 'aria-label': 'Coil stages' });
  const predict = h('div', { class: 'predict' });
  const verdict = h('div', { class: 'verdict' }, 'Calculating…');
  const ledgerHost = h('div', { class: 'body' });
  const violations = h('div');
  const timing = h('canvas', { class: 'chart', role: 'img', 'aria-label': 'Slug position against time with coil centres and trigger points' });
  const timingWrap = h('div', { class: 'body stack tight' }, h('h3', null, 'Stage timing'), timing, h('p', { class: 'hint' }, 'Dashed lines are coil centres. Squares mark where each stage switches on. A stage should switch on before the slug reaches its centre and be done once the slug passes it.'));
  const calcStatus = h('span', { class: 'hint', role: 'status' }, 'Calculating');

  const left = h('section', { class: 'parts', 'aria-label': 'Launchers and parts' });
  const mid = h('section', { 'aria-label': 'Schematic and controls' }, schematic, stageTabs, controls);
  const right = h('section', { 'aria-label': 'Predicted shot' });
  const grid = h('div', { class: 'editor' }, left, mid, right);
  root.append(grid);

  function fillPicker(): void {
    clear(picker);
    for (const b of ctx.profile.data.blueprints) picker.append(h('option', { value: b.id, selected: b.id === id }, `${b.bp.name} (${b.bp.kind})`));
  }

  function openShop(tab: 'kits' | 'parts' = 'kits'): void {
    const host = h('div', { class: 'shop-body' });
    const close = (): void => {
      ov.remove();
      refreshAfterPurchase();
    };
    const ov = h('div', { class: 'overlay fixed', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Shop' },
      h('div', { class: 'panel', style: 'width:min(980px,100%)' },
        h('div', { class: 'spread', style: 'padding:var(--s2) var(--s3) 0' }, h('h2', null, 'Shop'), h('button', { class: 'btn small', type: 'button', onclick: close }, icon('cross', 12), 'Close')),
        host));
    const sctx = { profile: ctx.profile, sfx: ctx.sfx, toast: ctx.toast };
    renderShop(host, sctx, {
      budget: ctx.budget,
      onAdded: (nid) => {
        switchTo(nid);
      },
    }, tab);
    root.append(ov);
  }

  function refreshAfterPurchase(): void {
    renderLeft();
    renderControls();
    changed();
  }

  function renderLeft(): void {
    clear(left);
    const bpHead = h('div', { class: 'part' },
      h('div', { class: 'spread' }, h('strong', null, 'My launchers'), h('span', { class: 'pill small num' }, `${ctx.profile.data.credits.toLocaleString()} cr`)),
      h('div', { class: 'field' }, h('label', { class: 'sr-only', for: 'launcher-pick' }, 'Launcher'), picker),
      h('button', { class: 'btn primary', type: 'button', 'data-coach': 'shop', onclick: () => openShop('kits') }, icon('bolt', 14), 'Get launchers and parts'),
      h('div', { class: 'cluster' },
        h('button', { class: 'btn small', type: 'button', onclick: () => addNew('railgun') }, 'New railgun'),
        h('button', { class: 'btn small', type: 'button', onclick: () => addNew('coilgun') }, 'New coilgun'),
        h('button', { class: 'btn small', type: 'button', onclick: duplicate }, 'Duplicate'),
        h('button', { class: 'btn small danger', type: 'button', onclick: remove }, 'Delete'),
      ),
      saveNote,
    );
    left.append(bpHead);
    const actions = h('div', { class: 'part' },
      h('div', { class: 'cluster' },
        ctx.done
          ? h('button', { class: 'btn primary', type: 'button', onclick: () => { ctx.profile.flush(); ctx.done?.(id); } }, icon('check', 14), 'Done, back to the match')
          : h('button', { class: 'btn primary', type: 'button', 'data-coach': 'test', onclick: () => ctx.toRange(id) }, 'Test in Range'),
        h('button', { class: 'btn', type: 'button', onclick: () => ctx.openNotes() }, 'Physics notes'),
      ),
    );
    left.append(actions);
    renderPartsList();
  }

  function partLine(group: string, pid: string, name: string, detail: string): HTMLElement {
    const open = isOpen(group, pid);
    const key = unlockKey(group, pid);
    const cost = ALL_UNLOCKABLES.find((u) => u.group === group && u.id === pid)?.unlockCost ?? 0;
    return h('div', { class: open ? 'part' : 'part locked' },
      h('div', { class: 'part-row' }, open ? null : icon('lock', 14), h('span', { class: 'nm' }, name)),
      h('span', { class: 'hint num' }, detail),
      open ? null : h('button', {
        class: 'btn small', type: 'button', disabled: ctx.profile.data.credits < cost,
        onclick: () => {
          if (buyPart({ profile: ctx.profile, sfx: ctx.sfx, toast: ctx.toast }, key)) refreshAfterPurchase();
        },
      }, `Buy for ${cost.toLocaleString()} cr`),
    );
  }

  function renderPartsList(): void {
    for (const el of Array.from(left.querySelectorAll('.parts-catalog'))) el.remove();
    const cat = h('div', { class: 'parts-catalog' });
    const head = (t: string): HTMLElement => h('div', { class: 'part' }, h('h3', { style: 'font-size:var(--t-0)' }, t));
    cat.append(head('Capacitors'));
    for (const c of Object.values(CAPACITORS)) cat.append(partLine('capacitor', c.id, c.name, `${c.mass_kg} kg, ${c.cost} cr, peak ${eng(c.I_peak_A, 'A', 2)}, ESR ${eng(c.ESR_ohm, 'Ω', 2)}`));
    cat.append(head('Switches'));
    for (const c of Object.values(SWITCHES)) cat.append(partLine('switch', c.id, c.name, `${c.mass_kg} kg, ${c.cost} cr, di/dt ${eng(c.dIdt_A_per_s, 'A/s', 2)}`));
    cat.append(head('Mounts, cooling, triggers'));
    for (const c of Object.values(MOUNTS)) cat.append(partLine('mount', c.id, c.name, `${c.mass_kg} kg, ${c.cost} cr`));
    for (const c of Object.values(COOLING)) cat.append(partLine('cooling', c.id, c.name, `${c.mass_kg} kg, ${c.cost} cr`));
    for (const c of Object.values(TRIGGERS)) cat.append(partLine('trigger', c.id, c.name, `${c.cost} cr${c.emiImmune ? ', immune to jamming' : ''}`));
    left.append(cat);
  }

  // ---------------------------------------------------------------- fields
  function register(path: string, input: HTMLInputElement | HTMLSelectElement, err: HTMLElement): void {
    fields.set(path, { input, err });
  }

  function numField(path: string, label: string, unit: string, step: number, hint?: string): HTMLElement {
    const err = h('div', { class: 'err-text', hidden: true });
    const id0 = `f-${path.replace(/[^a-z0-9]/gi, '-')}`;
    const cur = getPath(draft, path);
    const input = h('input', {
      id: id0, type: 'number', step: String(step), value: typeof cur === 'number' ? String(cur) : '', 'aria-describedby': `${id0}-e`,
      oninput: () => {
        const v = input.value.trim() === '' ? Number.NaN : Number(input.value);
        setPath(draft, path, v);
        changed();
      },
    });
    err.id = `${id0}-e`;
    register(path, input, err);
    return h('div', { class: 'field' }, h('label', { for: id0 }, label),
      h('div', { class: 'row' }, input, h('span', { class: 'unit' }, unit)), hint ? h('span', { class: 'hint' }, hint) : null, err);
  }

  function selectField(path: string, label: string, options: Array<{ value: string; text: string; locked?: boolean }>, hint?: string): HTMLElement {
    const err = h('div', { class: 'err-text', hidden: true });
    const id0 = `f-${path.replace(/[^a-z0-9]/gi, '-')}`;
    const cur = String(getPath(draft, path) ?? '');
    const input = h('select', {
      id: id0, 'aria-describedby': `${id0}-e`,
      onchange: () => {
        setPath(draft, path, input.value);
        changed();
      },
    }, ...options.map((o) => h('option', { value: o.value, selected: o.value === cur, disabled: o.locked && o.value !== cur }, o.locked ? `${o.text} (locked)` : o.text)));
    err.id = `${id0}-e`;
    register(path, input, err);
    return h('div', { class: 'field' }, h('label', { for: id0 }, label), input, hint ? h('span', { class: 'hint' }, hint) : null, err);
  }

  function boolField(path: string, label: string, hint: string): HTMLElement {
    const cur = getPath(draft, path) === true;
    const input = h('input', {
      type: 'checkbox', checked: cur,
      onchange: () => {
        setPath(draft, path, input.checked);
        changed();
      },
    });
    return h('div', { class: 'field' }, h('label', { class: 'check' }, input, label), h('span', { class: 'hint' }, hint));
  }

  const capOpts = (): Array<{ value: string; text: string; locked: boolean }> => Object.values(CAPACITORS).map((c) => ({ value: c.id, text: `${c.id}: ${c.name}`, locked: !isOpen('capacitor', c.id) }));
  const swOpts = (): Array<{ value: string; text: string; locked: boolean }> => Object.values(SWITCHES).map((c) => ({ value: c.id, text: c.name, locked: !isOpen('switch', c.id) }));

  function bankFields(prefix: string, extra: HTMLElement[]): HTMLElement[] {
    return [
      selectField(`${prefix}capacitor`, 'Capacitor module', capOpts()),
      numField(`${prefix}series`, 'Modules in series', '', 1, 'Series raises voltage and ESR.'),
      numField(`${prefix}parallel`, 'Strings in parallel', '', 1, 'Parallel raises capacitance and peak current.'),
      numField(`${prefix}charge_V`, 'Charge voltage', 'V', 50, 'Above the rated voltage the module fails when it fires.'),
      ...extra,
    ];
  }

  function renderControls(): void {
    fields = new Map();
    clear(controls);
    clear(stageTabs);
    const kind = draft.kind as string;
    const wrap = (title: string, items: Array<HTMLElement | null>): HTMLElement => h('div', { class: 'controls' }, h('h3', null, title), ...items.filter((x): x is HTMLElement => x !== null));
    const more = (title: string, items: Array<HTMLElement | null>): HTMLElement =>
      h('details', { class: 'adv' }, h('summary', null, title), h('div', null, ...items.filter((x): x is HTMLElement => x !== null)));
    const nameField = h('div', { class: 'field' }, h('label', { for: 'f-name' }, 'Name'),
      h('input', { id: 'f-name', type: 'text', maxlength: String(LIMITS.name.max), value: String(draft.name ?? ''), oninput: (e: Event) => { draft.name = (e.target as HTMLInputElement).value; changed(); } }));
    const cool = selectField('cooling', 'Cooling', Object.values(COOLING).map((c) => ({ value: c.id, text: c.name, locked: !isOpen('cooling', c.id) })), 'Sets how fast the launcher cools between shots.');
    const trig = selectField('trigger', 'Trigger link', Object.values(TRIGGERS).map((c) => ({ value: c.id, text: c.name, locked: !isOpen('trigger', c.id) })), 'Jammers disable electrical links. Fiber is immune.');
    if (kind === 'railgun') {
      const bp = draft as unknown as RailgunBlueprint;
      controls.append(wrap('Launcher', [nameField,
        selectField('payload', 'Payload', Object.values(PAYLOADS).map((c) => ({ value: c.id, text: c.name, locked: !isOpen('payload', c.id) })), 'A sabot lets a thin dart fly instead of the whole armature.')]));
      controls.append(more('Mount, cooling and trigger', [
        selectField('mount', 'Mount', Object.values(MOUNTS).map((c) => ({ value: c.id, text: c.name, locked: !isOpen('mount', c.id) })), 'Resists the force pushing the rails apart.'),
        cool, trig]));
      controls.append(wrap('Rails', [
        selectField('rails.material', 'Rail material', [{ value: 'copper', text: 'Copper' }, { value: 'aluminum6061', text: 'Aluminum 6061' }]),
        numField('rails.w_mm', 'Rail width', 'mm', 1), numField('rails.h_mm', 'Rail height', 'mm', 1), numField('rails.s_mm', 'Rail gap', 'mm', 1, 'Smaller gaps raise the force per ampere.'), numField('rails.length_mm', 'Rail length', 'mm', 50),
      ]));
      controls.append(wrap('Armature', [
        selectField('armature.material', 'Armature material', [{ value: 'copper', text: 'Copper' }, { value: 'aluminum6061', text: 'Aluminum 6061' }]),
        numField('armature.diameter_mm', 'Diameter', 'mm', 0.5), numField('armature.length_mm', 'Length', 'mm', 1),
      ]));
      bp.banks.forEach((_b, i) => {
        const p = `banks[${i}].`;
        controls.append(h('div', { class: 'controls' }, h('h3', null, `Bank ${i + 1}`),
          ...bankFields(p, [
            selectField(`${p}switch`, 'Switch', swOpts()),
            numField(`${p}inductor_uH`, 'Pulse inductor', 'µH', 0.5, 'Slows the current rise and lowers the peak.'),
            numField(`${p}trigger_delay_us`, 'Trigger delay', 'µs', 10, 'Staggering banks keeps the push going down the rails.'),
            boolField(`${p}crowbar`, 'Crowbar diode', 'Lets the current continue after the capacitor empties.'),
            bp.banks.length > 1 ? h('button', { class: 'btn small danger', type: 'button', onclick: () => { bp.banks.splice(i, 1); renderControls(); changed(); } }, `Remove bank ${i + 1}`) : h('span'),
          ])));
      });
      if (bp.banks.length < LIMITS.banks.max) {
        controls.append(h('div', { class: 'controls' }, h('button', { class: 'btn', type: 'button', onclick: () => { bp.banks.push(clone(bp.banks[bp.banks.length - 1])); renderControls(); changed(); } }, 'Add a capacitor bank')));
      }
    } else {
      const bp = draft as unknown as CoilgunBlueprint;
      controls.append(wrap('Launcher', [nameField]));
      controls.append(more('Cooling and trigger', [cool, trig]));
      controls.append(wrap('Slug and tube', [
        numField('slug.length_mm', 'Slug length', 'mm', 1), numField('slug.diameter_mm', 'Slug diameter', 'mm', 0.5), numField('tube_bore_mm', 'Tube bore', 'mm', 0.5),
        numField('start_offset_mm', 'Slug start behind coil 1', 'mm', 1), numField('spacing_mm', 'Coil spacing', 'mm', 1),
      ]));
      stageIdx = Math.min(stageIdx, bp.stages.length - 1);
      bp.stages.forEach((_st, i) => {
        stageTabs.append(h('button', { class: 'stage-tab', type: 'button', role: 'tab', 'aria-selected': String(i === stageIdx), id: `tab-${i}`, onclick: () => { stageIdx = i; renderControls(); markIssues(); } }, String(i + 1)));
      });
      if (bp.stages.length < LIMITS.stages.max) {
        stageTabs.append(h('button', { class: 'stage-tab', type: 'button', 'aria-label': 'Add stage', onclick: () => { bp.stages.push(clone(bp.stages[bp.stages.length - 1])); stageIdx = bp.stages.length - 1; renderControls(); changed(); } }, '+'));
      }
      const p = `stages[${stageIdx}].`;
      controls.append(h('div', { class: 'controls' }, h('h3', null, `Stage ${stageIdx + 1} of ${bp.stages.length}`),
        ...bankFields(p, [
          selectField(`${p}switch`, 'Switch', swOpts()),
          numField(`${p}turns`, 'Turns', '', 1), numField(`${p}awg`, 'Wire gauge', 'AWG', 1, 'Lower numbers are thicker wire.'), numField(`${p}length_mm`, 'Coil length', 'mm', 1),
          stageIdx === 0 ? h('div', { class: 'hint' }, 'Stage 1 switches on at once. Its trigger position is not used.') : numField(`${p}trigger_offset_mm`, 'Switch-on position', 'mm', 1, 'Slug centre relative to this coil centre. Negative is before the coil.'),
          boolField(`${p}freewheel`, 'Freewheel diode', 'Stops the current from reversing and pulling the slug back.'),
          bp.stages.length > 1 ? h('button', { class: 'btn small danger', type: 'button', onclick: () => { bp.stages.splice(stageIdx, 1); stageIdx = Math.max(0, stageIdx - 1); renderControls(); changed(); } }, `Remove stage ${stageIdx + 1}`) : h('span'),
        ])));
    }
    markIssues();
  }

  // ---------------------------------------------------------------- validation and prediction
  function markIssues(): void {
    queueMicrotask(() => controls.querySelectorAll('details.adv').forEach((d) => { if (d.querySelector('[aria-invalid=true]')) (d as HTMLDetailsElement).open = true; }));
    for (const [path, f] of fields) {
      const bad = issues.find((i) => i.field === path);
      if (bad) {
        f.input.setAttribute('aria-invalid', 'true');
        clear(f.err);
        f.err.append(icon('warn', 14), h('span', null, bad.message));
        f.err.hidden = false;
      } else {
        f.input.removeAttribute('aria-invalid');
        f.err.hidden = true;
      }
    }
    const tabs = Array.from(stageTabs.querySelectorAll('.stage-tab'));
    tabs.forEach((tb, i) => tb.classList.toggle('bad', issues.some((x) => x.field.startsWith(`stages[${i}]`))));
    const generic = issues.filter((i) => !fields.has(i.field));
    clear(violations);
    for (const g of generic) violations.append(h('div', { class: 'violation' }, icon('warn'), h('div', null, h('strong', null, g.field || 'Blueprint'), g.message)));
  }

  function changed(): void {
    const v = validateBlueprint(draft);
    issues = v.ok ? [] : v.issues;
    markIssues();
    if (!v.ok) {
      saveNote.textContent = 'Not saved: fix the highlighted fields.';
      return;
    }
    analysis = analyzeBlueprint(v.value);
    const lock = lockedParts(analysis, unlocked());
    if (analysis.modelIssues.length > 0) {
      issues = analysis.modelIssues.map((m) => ({ field: m.field, message: m.message }));
      markIssues();
      saveNote.textContent = 'Not saved: outside the model range.';
      return;
    }
    ctx.profile.saveBlueprint(id, v.value);
    saveNote.textContent = lock.length > 0 ? `Saved. Uses locked parts: ${lock.join(', ')}.` : 'Saved.';
    renderSchematic(v.value);
    if (timer) clearTimeout(timer);
    calcStatus.textContent = 'Calculating';
    timer = setTimeout(() => void runPreview(v.value), PREVIEW_DEBOUNCE_MS);
  }

  async function runPreview(bp: Blueprint): Promise<void> {
    const { req, result } = await calc.preview(bp);
    if (disposed || req !== calc.latest()) return;
    if (!result.ok) {
      lastReport = null;
      lastPreview = null;
      scope.show(null);
      calcStatus.textContent = result.message;
      renderPredict();
      return;
    }
    lastReport = result.report;
    lastPreview = result;
    calcStatus.textContent = `Predicted in ${result.solveMs.toFixed(0)} ms`;
    scope.show(result.report, exitTime(result.report));
    renderPredict();
    renderSchematic(bp);
    renderLedger();
    renderFailures();
    if (bp.kind === 'coilgun') renderTiming(bp);
  }

  function exitTime(r: ShotReport): number {
    return r.status === 'MUZZLE_EXIT' ? r.t_end_s : 0;
  }

  function stat(k: string, v: string, warn = false): HTMLElement {
    return h('div', null, h('div', { class: 'k' }, k), h('div', { class: 'v' }, warn ? icon('warn', 14) : null, warn ? ' ' : null, v));
  }

  function renderPredict(): void {
    clear(predict);
    const a = analysis;
    const r = lastReport;
    const p = lastPreview;
    if (!a) return;
    const budget = ctx.budget ?? GAME.BUILD_BUDGET;
    const exits = r !== null && r.status === 'MUZZLE_EXIT';
    predict.append(
      stat('Speed', exits ? `${r.muzzleSpeed_m_s.toFixed(0)} m/s` : r ? 'No exit' : '–', r !== null && !exits),
      stat('Punch per shot', r ? eng(r.muzzleEnergy_J, 'J') : '–'),
      stat('Efficiency', r ? pct(r.efficiency) : '–'),
      stat('Cost', `${Math.round(a.cost).toLocaleString()} cr`, a.cost > budget),
    );
    const extra = h('details', { class: 'adv', style: 'grid-column:1/-1' }, h('summary', null, 'More numbers'),
      h('div', { class: 'predict', style: 'padding:0 0 14px;grid-column:1/-1' },
        stat('Peak current', r ? eng(r.I_peak_A, 'A') : '–'),
        stat('Stored energy', eng(a.bankEnergy_J, 'J')),
        stat('Projectile mass', `${(a.projectileMass_kg * 1000).toFixed(1)} g`),
        stat('Launcher mass', `${a.launcherMass_kg.toFixed(0)} kg`)),
      h('p', { class: 'hint', style: 'padding:0 14px 12px' }, `Wave ${ctx.wave ?? 1} budget is ${budget.toLocaleString()} credits and rises by ${GAME.BUILD_BUDGET_PER_WAVE.toLocaleString()} each wave.${p ? ` Cooling time constant ${a.coolingTau_s} s.` : ''}`));
    predict.append(extra);
    // one plain sentence for the whole design
    clear(verdict);
    const nBad = (lastReport?.failures.length ?? 0) + (a.cost > budget ? 1 : 0);
    if (!r) verdict.className = 'verdict', verdict.append('Calculating…');
    else if (!exits) {
      verdict.className = 'verdict bad';
      verdict.append(icon('warn', 20), 'It will not leave the launcher. See below.');
    } else if (nBad > 0) {
      verdict.className = 'verdict bad';
      verdict.append(icon('warn', 20), a.cost > budget ? `Over the wave ${ctx.wave ?? 1} budget (${budget.toLocaleString()} cr).` : 'It fires, but something would break. See below.');
    } else {
      verdict.className = 'verdict ok';
      verdict.append(icon('check', 20), `Ready to fight: ${r.muzzleSpeed_m_s.toFixed(0)} m/s, ${eng(r.muzzleEnergy_J, 'J')} per shot.`);
    }
  }

  function renderLedger(): void {
    clear(ledgerHost);
    if (!lastReport) return;
    ledgerHost.append(h('h3', null, 'Where the energy went'), ledgerBar(lastReport.ledger),
      h('p', { class: 'hint' }, `Energy ledger closes to ${(lastReport.ledger.residual_max_rel * 100).toExponential(1)} % at its worst step (limit 0.1 %).`));
  }

  function renderFailures(): void {
    const keep = Array.from(violations.querySelectorAll('.violation.rating'));
    keep.forEach((k) => k.remove());
    if (!lastReport) return;
    for (const f of lastReport.failures) {
      violations.append(h('div', { class: 'violation rating' }, icon('warn'), h('div', null,
        h('strong', null, `${f.message}`),
        h('span', { class: 'hint num' }, `Limit ${fmtUnit(f.limit, f.unit)}, predicted ${fmtUnit(f.value, f.unit)}. Consequence: ${consequence(f.consequence)}.`))));
    }
    if (lastReport.status === 'FIZZLE') {
      violations.append(h('div', { class: 'violation rating' }, icon('warn'), h('div', null, h('strong', null, 'The armature did not leave the launcher.'), h('span', { class: 'hint' }, 'Friction and inertia beat the push. Raise the charge voltage, shorten the armature, or lower the rail gap.'))));
    }
  }

  function fmtUnit(v: number, unit: string): string {
    return eng(v, unit, 3);
  }

  function consequence(c: string): string {
    return ({ module_lost: 'the capacitor module is destroyed', switch_open: 'the switch fails open', stage_lost: 'the coil stage is destroyed', shot_ended: 'the shot ends', mount_destroyed: 'the mount is destroyed' } as Record<string, string>)[c] ?? c;
  }

  // ---------------------------------------------------------------- schematic
  function renderSchematic(bp: Blueprint): void {
    clear(schematic);
    const W = 760;
    if (bp.kind === 'railgun') {
      const rows = bp.banks.length;
      const H = 28 + rows * 88;
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Schematic: ${rows} capacitor banks feeding the rails` });
      const busX = 470;
      const railY0 = 28;
      const railY1 = H - 28;
      svg.append(s('line', { x1: busX, y1: 52, x2: busX, y2: H - 44, stroke: COLORS.copper, 'stroke-width': 4 }));
      bp.banks.forEach((b, i) => {
        const y = 52 + i * 88;
        const cap = CAPACITORS[b.capacitor];
        svg.append(s('line', { x1: 20, y1: y, x2: 60, y2: y, stroke: COLORS.copper, 'stroke-width': 3 }));
        svg.append(s('line', { x1: 60, y1: y - 16, x2: 60, y2: y + 16, stroke: COLORS.graphite, 'stroke-width': 3 }), s('line', { x1: 72, y1: y - 16, x2: 72, y2: y + 16, stroke: COLORS.graphite, 'stroke-width': 3 }));
        svg.append(s('line', { x1: 72, y1: y, x2: 160, y2: y, stroke: COLORS.copper, 'stroke-width': 3 }));
        // switch
        svg.append(s('rect', { x: 160, y: y - 12, width: 44, height: 24, fill: COLORS.porcelain, stroke: COLORS.graphite, 'stroke-width': 2 }), s('path', { d: `M172 ${y + 7} L172 ${y - 7} L192 ${y} Z`, fill: COLORS.graphite }));
        svg.append(s('line', { x1: 204, y1: y, x2: 250, y2: y, stroke: COLORS.copper, 'stroke-width': 3 }));
        // inductor
        let d = `M250 ${y}`;
        for (let k = 0; k < 4; k++) d += ` a10 10 0 0 1 20 0`;
        svg.append(s('path', { d, fill: 'none', stroke: COLORS.copper, 'stroke-width': 3 }));
        svg.append(s('line', { x1: 330, y1: y, x2: busX, y2: y, stroke: COLORS.copper, 'stroke-width': 3 }));
        const t = (x: number, yy: number, text: string, anchor = 'start', weight = 400): SVGElement => {
          const e = s('text', { x, y: yy, 'font-size': 12, 'text-anchor': anchor, fill: COLORS.graphite, 'font-family': 'B612, system-ui, sans-serif', 'font-weight': weight }, text);
          return e;
        };
        svg.append(t(66, y - 24, `${b.series}S × ${b.parallel}P ${cap.id}`, 'middle'));
        svg.append(t(66, y + 36, `${b.charge_V.toFixed(0)} V, ${eng(0.5 * cap.C_F * (b.parallel / b.series) * b.charge_V ** 2, 'J', 3)}`, 'middle'));
        svg.append(t(182, y - 18, b.switch, 'middle'));
        svg.append(t(290, y - 18, `${b.inductor_uH} µH`, 'middle'));
        if (b.crowbar) svg.append(t(182, y + 36, 'crowbar', 'middle'));
      });
      // rails
      svg.append(s('line', { x1: busX, y1: railY0, x2: W - 24, y2: railY0, stroke: COLORS.copper, 'stroke-width': 8 }), s('line', { x1: busX, y1: railY1, x2: W - 24, y2: railY1, stroke: COLORS.copper, 'stroke-width': 8 }));
      svg.append(s('line', { x1: busX, y1: railY0, x2: busX, y2: 52, stroke: COLORS.copper, 'stroke-width': 3 }), s('line', { x1: busX, y1: railY1, x2: busX, y2: H - 44, stroke: COLORS.copper, 'stroke-width': 3 }));
      const ax = busX + 40;
      svg.append(s('rect', { x: ax, y: railY0 + 4, width: 36, height: railY1 - railY0 - 8, fill: COLORS.graphite }));
      const lab = (x: number, y: number, text: string, anchor = 'start'): SVGElement => s('text', { x, y, 'font-size': 12, 'text-anchor': anchor, fill: COLORS.graphite, 'font-family': 'B612, system-ui, sans-serif' }, text);
      svg.append(lab(busX + 8, railY0 - 12, `${bp.rails.material === 'copper' ? 'Copper' : 'Aluminum'} rails, ${bp.rails.length_mm} mm`));
      if (lastReport) {
        svg.append(lab(W - 24, H / 2 + 4, `${eng(lastReport.I_peak_A, 'A')} peak`, 'end'));
        svg.append(lab(W - 24, H / 2 + 22, lastReport.status === 'MUZZLE_EXIT' ? `${lastReport.muzzleSpeed_m_s.toFixed(0)} m/s at exit` : 'no exit', 'end'));
      }
      schematic.append(svg);
    } else {
      const H = 200;
      const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Schematic: coilgun with ${bp.stages.length} stages` });
      const n = bp.stages.length;
      const spanMm = bp.start_offset_mm + (n - 1) * bp.spacing_mm + (bp.stages[n - 1]?.length_mm ?? 50) + 60;
      const k = (W - 80) / Math.max(spanMm, 100);
      const x0 = 40 + bp.start_offset_mm * k;
      const cy = 90;
      const bore = Math.max(10, bp.tube_bore_mm * k * 1.4);
      svg.append(s('rect', { x: 20, y: cy - bore / 2, width: W - 40, height: bore, fill: COLORS.porcelain, stroke: COLORS.slate, 'stroke-width': 2 }));
      bp.stages.forEach((st, i) => {
        const cxm = x0 + i * bp.spacing_mm * k;
        const wdt = Math.max(8, st.length_mm * k);
        const ht = bore + 28;
        const sel = i === stageIdx;
        svg.append(s('rect', { x: cxm - wdt / 2, y: cy - ht / 2, width: wdt, height: ht, fill: COLORS.copper, stroke: sel ? COLORS.graphite : COLORS.slate, 'stroke-width': sel ? 3 : 1 }));
        const tx = (text: string, yy: number, wt = 400): SVGElement => s('text', { x: cxm, y: yy, 'font-size': 12, 'text-anchor': 'middle', fill: COLORS.graphite, 'font-family': 'B612, system-ui, sans-serif', 'font-weight': wt }, text);
        svg.append(tx(String(i + 1), cy - ht / 2 - 8, 700));
        svg.append(tx(`${st.charge_V.toFixed(0)} V`, cy + ht / 2 + 18));
        svg.append(tx(`${st.turns} t`, cy + ht / 2 + 34));
      });
      const sl = bp.slug.length_mm * k;
      const sx = x0 - bp.start_offset_mm * k;
      svg.append(s('rect', { x: sx - sl / 2, y: cy - (bp.slug.diameter_mm * k * 1.4) / 2, width: sl, height: Math.max(6, bp.slug.diameter_mm * k * 1.4), fill: COLORS.graphite }));
      svg.append(s('text', { x: sx, y: cy + bore / 2 + 52, 'font-size': 12, 'text-anchor': 'middle', fill: COLORS.slate, 'font-family': 'B612, system-ui, sans-serif' }, 'slug at rest'));
      if (lastReport) svg.append(s('text', { x: W - 24, y: H - 8, 'font-size': 12, 'text-anchor': 'end', fill: COLORS.graphite, 'font-family': 'B612, system-ui, sans-serif' }, lastReport.status === 'MUZZLE_EXIT' ? `${lastReport.muzzleSpeed_m_s.toFixed(0)} m/s at exit, ${eng(lastReport.I_peak_A, 'A')} peak` : 'no exit'));
      schematic.append(svg);
    }
  }

  function renderTiming(bp: CoilgunBlueprint): void {
    const r = lastReport;
    if (!r) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = timing.clientWidth || 340;
    const hh = 200;
    timing.width = w * dpr;
    timing.height = hh * dpr;
    const ctx2 = timing.getContext('2d');
    if (!ctx2) return;
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.fillStyle = COLORS.plate;
    ctx2.fillRect(0, 0, w, hh);
    const L = 48, R = 10, T = 10, B = 26;
    const tMax = r.trace.t_s[r.trace.t_s.length - 1] || 1e-3;
    const xs = r.trace.x_m;
    const xMin = Math.min(...xs, -bp.start_offset_mm / 1000);
    const xMax = Math.max(...xs, ((bp.stages.length - 1) * bp.spacing_mm) / 1000 + 0.02);
    const px = (t: number): number => L + (t / tMax) * (w - L - R);
    const py = (x: number): number => hh - B - ((x - xMin) / (xMax - xMin)) * (hh - T - B);
    ctx2.font = '10px "B612", system-ui, sans-serif';
    ctx2.strokeStyle = COLORS.slate;
    ctx2.fillStyle = COLORS.slate;
    ctx2.setLineDash([4, 4]);
    ctx2.textAlign = 'right';
    ctx2.textBaseline = 'middle';
    bp.stages.forEach((_st, i) => {
      const yc = py((i * bp.spacing_mm) / 1000);
      ctx2.beginPath();
      ctx2.moveTo(L, yc);
      ctx2.lineTo(w - R, yc);
      ctx2.stroke();
      ctx2.fillText(String(i + 1), L - 6, yc);
    });
    ctx2.setLineDash([]);
    ctx2.strokeStyle = COLORS.graphite;
    ctx2.lineWidth = 2;
    ctx2.beginPath();
    r.trace.t_s.forEach((t, i) => (i === 0 ? ctx2.moveTo(px(t), py(xs[i])) : ctx2.lineTo(px(t), py(xs[i]))));
    ctx2.stroke();
    ctx2.fillStyle = COLORS.amber;
    ctx2.strokeStyle = COLORS.graphite;
    ctx2.lineWidth = 1;
    bp.stages.forEach((st, i) => {
      const trigX = (i * bp.spacing_mm + (i === 0 ? -bp.start_offset_mm : st.trigger_offset_mm)) / 1000;
      let tt = 0;
      if (i > 0) {
        const k = xs.findIndex((x) => x >= trigX);
        tt = k < 0 ? tMax : r.trace.t_s[k];
      }
      ctx2.fillRect(px(tt) - 4, py(trigX) - 4, 8, 8);
      ctx2.strokeRect(px(tt) - 4, py(trigX) - 4, 8, 8);
    });
    ctx2.fillStyle = COLORS.slate;
    ctx2.textAlign = 'center';
    ctx2.textBaseline = 'top';
    ctx2.fillText(`time, 0 to ${eng(tMax, 's', 2)}`, (L + w - R) / 2, hh - B + 8);
    ctx2.save();
    ctx2.translate(10, hh / 2);
    ctx2.rotate(-Math.PI / 2);
    ctx2.textBaseline = 'top';
    ctx2.fillText('slug position', 0, 0);
    ctx2.restore();
  }

  // ---------------------------------------------------------------- blueprint management
  function switchTo(newId0: string): void {
    const rec = ctx.profile.blueprint(newId0);
    if (!rec) return;
    id = newId0;
    draft = clone(rec.bp) as unknown as Draft;
    stageIdx = 0;
    fillPicker();
    renderControls();
    changed();
  }

  function addNew(kind: 'railgun' | 'coilgun'): void {
    const bp = kind === 'railgun' ? starterRailgun() : starterCoilgun();
    bp.name = `New ${kind}`;
    const nid = ctx.profile.newBlueprint(bp);
    switchTo(nid);
  }

  function duplicate(): void {
    const v = validateBlueprint(draft);
    if (!v.ok) return;
    const copy = clone(v.value);
    copy.name = `${copy.name} copy`.slice(0, LIMITS.name.max);
    switchTo(ctx.profile.newBlueprint(copy));
  }

  function remove(): void {
    if (!ctx.profile.deleteBlueprint(id)) {
      saveNote.textContent = 'Keep at least one launcher.';
      return;
    }
    switchTo(ctx.profile.data.blueprints[0].id);
  }

  // ---------------------------------------------------------------- right column
  right.append(
    verdict,
    h('div', { class: 'body stack tight' }, scope.el, h('div', { class: 'spread' }, h('h3', null, 'Predicted shot'), calcStatus)),
    predict,
    violations,
    ledgerHost,
  );

  fillPicker();
  renderLeft();
  renderControls();
  changed();
  if ((draft.kind as string) === 'coilgun') right.append(timingWrap);
  const ensureTiming = (): void => {
    if ((draft.kind as string) === 'coilgun') {
      if (!timingWrap.isConnected) right.append(timingWrap);
    } else timingWrap.remove();
  };
  const unsub = ctx.profile.onSave(() => undefined);
  const iv = setInterval(ensureTiming, 400);

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    clearInterval(iv);
    unsub();
    scope.dispose();
    calc.close();
    ctx.profile.flush();
    clear(root);
  };
}
