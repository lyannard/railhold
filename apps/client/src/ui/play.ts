import { analyzeBlueprint, ENEMIES, ENEMY_ORDER, enemyPath, GAME, type Blueprint } from '@railhold/shared';
import { Flight, flightParamsFor } from '@railhold/physics';
import type { DebriefPlayer, GameEvent, ShotReport, Snapshot } from '@railhold/engine';
import type { AppCtx } from '../app-ctx.ts';
import { Calc } from '../calc.ts';
import { mountEditor } from './editor.ts';
import { clamp, clear, eng, h, pct } from '../dom.ts';
import type { Session } from '../session.ts';
import { icon, ledgerBar, needleMeter, Scope, segBar, status } from './widgets.ts';
import { cannonTop, critter, keep, mix, rng, rock, shadow, W, type CritterKind } from './art.ts';

const SEAT_COLORS = [W.volt, W.spark, W.ok, '#E8739B'];

interface Tracer {
  shotId: number;
  seat: number;
  flight: Flight;
  t: number;
  trail: Array<[number, number]>;
  done: boolean;
}

interface Mark {
  x: number;
  z: number;
  t: number;
  kind: 'hit' | 'kill' | 'ground' | 'flash' | 'base';
  text?: string;
}

const WORLD_X = 340;
const WORLD_Z0 = -40;
const WORLD_Z1 = 585;

export function mountPlay(root: HTMLElement, ctx: AppCtx, session: Session, initialBlueprintId: string): () => void {
  const reduced = ctx.reducedMotion();
  const calc = new Calc();
  let blueprintId = initialBlueprintId;
  let snap: Snapshot | null = session.snap;
  let disposed = false;
  let leadAssist = true;
  let target = 1;
  let zoom = 1;
  let viewCx = 0;
  let viewCz = (WORLD_Z0 + WORLD_Z1) / 2;
  let mouse = { x: 0, y: 0, inside: false };
  let aimWorld = { x: 0, z: 150 };
  let lastAimSent = 0;
  let lastReport: ShotReport | null = null;
  const tracers: Tracer[] = [];
  const marks: Mark[] = [];
  const names = new Map<string, string>();
  let timeTable: Array<[number, number]> = [];
  let debrief: { wave: number; players: DebriefPlayer[]; efficiency: number; score: number; baseHp: number } | null = null;
  let ended: { result: 'victory' | 'defeat'; score: number; wave: number; bonusCredits: number } | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPhase = snap?.phase ?? 'lobby';

  const myBp = (): Blueprint | undefined => ctx.profile.blueprint(blueprintId)?.bp;

  // ---------------------------------------------------------------- flight-time table for the crosshair
  function buildTimeTable(muzzleSpeed: number, bp: Blueprint): void {
    const a = analyzeBlueprint(bp);
    const fl = new Flight(flightParamsFor(a.projectile, a.projectileMass_kg));
    fl.reset(0, GAME.MUZZLE_HEIGHT_M, 0, muzzleSpeed, 0, 0);
    // A flat shot keeps the path almost level; the elevation needed is small, so range along the path is range along the ground.
    const table: Array<[number, number]> = [[0, 0]];
    let t = 0;
    let next = 10;
    for (let i = 0; i < 12 * 240 && table[table.length - 1][0] < 600; i++) {
      fl.step(1 / 240);
      t += 1 / 240;
      if (fl.s[0] >= next) {
        table.push([fl.s[0], t]);
        next += 10;
      }
    }
    timeTable = table;
  }

  function flightTime(range: number): number | null {
    if (timeTable.length < 2) return null;
    for (let i = 1; i < timeTable.length; i++) {
      if (timeTable[i][0] >= range) {
        const [r0, t0] = timeTable[i - 1];
        const [r1, t1] = timeTable[i];
        return t0 + ((range - r0) / (r1 - r0)) * (t1 - t0);
      }
    }
    return null;
  }

  async function primeTable(): Promise<void> {
    const bp = myBp();
    if (!bp) return;
    const { result } = await calc.preview(bp);
    if (disposed || !result.ok || result.report.status !== 'MUZZLE_EXIT') return;
    if (lastReport === null) buildTimeTable(result.report.muzzleSpeed_m_s * target, bp);
  }

  // ---------------------------------------------------------------- layout
  const canvas = h('canvas', { class: 'world', role: 'img', 'aria-label': 'Plan view of the defense. The base is at the bottom. Enemies approach from the top along four lanes.' });
  const stage = h('div', { class: 'stage' }, canvas);
  const topCenter = h('div', { class: 'hud tc' });
  const topLeft = h('div', { class: 'hud tl' });
  const topRight = h('div', { class: 'hud tr' });
  const consoleEl = h('div', { class: 'hud bl' });
  const overlay = h('div');
  const toast = h('div');
  stage.append(topCenter, topLeft, topRight, consoleEl, overlay, toast);
  root.append(h('div', { class: 'screen' }, stage));

  // console widgets
  const scope = new Scope(0.45, 'Rail current, slow motion');
  const vMeter = needleMeter('Bank voltage', 0, 1, reduced);
  const tMeter = needleMeter('Launcher temp', 290, 400, reduced);
  const gMeter = needleMeter('Grid load', 0, 1, reduced);
  const chargeBar = segBar(20);
  const chargeText = h('span', { class: 'num hint' }, '');
  const heatBar = segBar(20);
  const fireBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => fire() }, icon('bolt', 14), 'Fire');
  const leadBtn = h('button', { class: 'btn small', type: 'button', 'aria-pressed': 'true', onclick: () => setLead(!leadAssist) }, 'Lead assist on');
  const targetInput = h('input', { type: 'range', min: String(GAME.MIN_CHARGE_TARGET * 100), max: '100', step: '1', value: '100', 'aria-label': 'Charge target in percent' });
  const targetOut = h('span', { class: 'num' }, '100 %');
  targetInput.addEventListener('input', () => {
    target = Number(targetInput.value) / 100;
    targetOut.textContent = `${targetInput.value} %`;
    session.send({ t: 'chargeTarget', fraction: target });
  });
  const msgLine = h('div', { class: 'hint', role: 'status', style: 'min-height:1.4em;text-align:center' }, '');
  const fireLabel = h('span', null, 'Fire');
  fireBtn.replaceChildren(icon('bolt', 22), fireLabel);
  fireBtn.classList.add('big');
  fireBtn.style.width = '100%';
  const instruments = h('div', { class: 'plate', hidden: true, style: 'width:min(400px,92vw)' }, h('div', { class: 'body stack tight' },
    scope.el,
    h('div', { class: 'meters' }, vMeter.el, tMeter.el, gMeter.el),
    h('div', { class: 'field' }, h('label', null, 'Power per shot'), h('div', { class: 'row' }, targetInput, targetOut)),
    h('div', { class: 'hint' }, 'Less power charges faster and runs cooler. The scope replays your last shot.')));
  const instBtn = h('button', { class: 'btn small', type: 'button', 'aria-expanded': 'false', onclick: () => {
    instruments.hidden = !instruments.hidden;
    instBtn.setAttribute('aria-expanded', String(!instruments.hidden));
  } }, icon('gear', 14), 'Instruments');
  consoleEl.append(h('div', { class: 'stack tight' }, instruments, h('div', { class: 'cluster' }, instBtn, leadBtn)));
  const firepad = h('div', { class: 'hud br' }, h('div', { class: 'firepad' },
    h('div', { class: 'bars' },
      h('div', null, h('div', { class: 'lab' }, h('span', null, 'Charge'), chargeText), chargeBar.el),
      h('div', null, h('div', { class: 'lab' }, h('span', null, 'Heat')), heatBar.el)),
    fireBtn,
    h('div', { class: 'hint', style: 'text-align:center' }, 'Click the field or press ', h('span', { class: 'kbd' }, ctx.profile.data.settings.fireKey), ' to fire. ', h('span', { class: 'kbd' }, 'L'), ' lead assist. Wheel zooms.'),
    msgLine));
  stage.append(firepad);

  function setLead(v: boolean): void {
    leadAssist = v;
    leadBtn.textContent = `Lead assist ${v ? 'on' : 'off'}`;
    leadBtn.setAttribute('aria-pressed', String(v));
    session.send({ t: 'aim', lead: v });
  }

  function showToast(text: string, fault = false): void {
    clear(toast);
    toast.append(h('div', { class: 'toast', role: 'status' }, fault ? icon('warn') : icon('check'), h('span', null, text)));
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => clear(toast), 4500);
  }

  // ---------------------------------------------------------------- input
  function toWorld(px: number, py: number): { x: number; z: number } {
    const v = view();
    return { x: viewCx + (px - v.w / 2) / v.scale, z: viewCz - (py - v.h / 2) / v.scale };
  }

  function view(): { w: number; h: number; scale: number } {
    const w = canvas.clientWidth || 800;
    const hh = canvas.clientHeight || 600;
    const base = Math.min(w / (2 * WORLD_X), hh / (WORLD_Z1 - WORLD_Z0));
    return { w, h: hh, scale: base * zoom };
  }

  function toScreen(x: number, z: number): [number, number] {
    const v = view();
    return [v.w / 2 + (x - viewCx) * v.scale, v.h / 2 - (z - viewCz) * v.scale];
  }

  function sendAim(force = false): void {
    const now = performance.now();
    if (!force && now - lastAimSent < 50) return;
    lastAimSent = now;
    session.send({ t: 'aim', x: aimWorld.x, z: aimWorld.z, lead: leadAssist });
  }

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top, inside: true };
    aimWorld = toWorld(mouse.x, mouse.y);
    sendAim();
  });
  canvas.addEventListener('pointerleave', () => {
    mouse.inside = false;
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = canvas.getBoundingClientRect();
    mouse = { x: e.clientX - r.left, y: e.clientY - r.top, inside: true };
    aimWorld = toWorld(mouse.x, mouse.y);
    fire();
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const before = toWorld(mx, my);
    zoom = clamp(zoom * (e.deltaY < 0 ? 1.25 : 0.8), 1, 8);
    const v = view();
    viewCx = before.x - (mx - v.w / 2) / v.scale;
    viewCz = before.z + (my - v.h / 2) / v.scale;
    if (zoom === 1) {
      viewCx = 0;
      viewCz = (WORLD_Z0 + WORLD_Z1) / 2;
    }
    aimWorld = toWorld(mx, my);
  }, { passive: false });

  function fire(): void {
    ctx.audio.unlock();
    sendAim(true);
    session.send({ t: 'fire' });
  }

  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') && e.code !== ctx.profile.data.settings.fireKey) return;
    if (e.code === ctx.profile.data.settings.fireKey && !e.repeat) {
      e.preventDefault();
      if (snap && (snap.phase === 'defense' || snap.phase === 'charge')) fire();
    } else if (e.code === 'KeyL' && !e.repeat) setLead(!leadAssist);
    else if (e.code === 'Digit0') {
      zoom = 1;
      viewCx = 0;
      viewCz = (WORLD_Z0 + WORLD_Z1) / 2;
    }
  };
  window.addEventListener('keydown', onKey);

  // ---------------------------------------------------------------- events
  const unsubEv = session.onEvent((e: GameEvent) => {
    switch (e.e) {
      case 'err':
        msgLine.textContent = e.message;
        if (e.code === 'overheated' || e.code === 'jammed' || e.code === 'launcher_disabled') ctx.audio.fault();
        if (e.code === 'over_budget' || e.code === 'parts_locked' || e.code === 'blueprint_invalid') showToast(e.message, true);
        break;
      case 'fire': {
        const spec = { material: e.material as never, frontalArea_m2: e.area_m2, length_m: e.length_m };
        const fl = new Flight(flightParamsFor(spec, e.mass_kg));
        fl.reset(e.x0, e.y0, e.z0, e.vx, e.vy, e.vz);
        tracers.push({ shotId: e.shotId, seat: e.seat, flight: fl, t: e.t, trail: [[e.x0, e.z0]], done: false });
        marks.push({ x: e.x0, z: e.z0, t: performance.now(), kind: 'flash' });
        if (e.seat === mySeat()) ctx.audio.fire(0.5 * e.mass_kg * (e.vx ** 2 + e.vy ** 2 + e.vz ** 2));
        else ctx.audio.fire(2000);
        if (tracers.length > 60) tracers.shift();
        break;
      }
      case 'shot':
        lastReport = e.report;
        ctx.profile.addShot(e.report, myBp() ?? ({} as Blueprint), 'defense');
        scope.play(e.report, 2.5 / Math.max(e.report.t_end_s, 1e-4), reduced, e.report.status === 'MUZZLE_EXIT' ? e.report.t_end_s : 0);
        if (e.report.status === 'MUZZLE_EXIT') {
          const bp = myBp();
          if (bp) buildTimeTable(e.report.muzzleSpeed_m_s, bp);
          msgLine.textContent = `${e.report.muzzleSpeed_m_s.toFixed(0)} m/s, ${eng(e.report.muzzleEnergy_J, 'J')}, flight ${e.report.flightTime_s.toFixed(2)} s${e.report.reachable ? '' : ', out of reach'}`;
        } else msgLine.textContent = e.report.status === 'FIZZLE' ? 'Fizzle: the armature did not leave the launcher.' : 'A rating failed during the shot.';
        break;
      case 'hit': {
        const tr = tracers.find((q) => q.shotId === e.shotId);
        if (tr) tr.done = true;
        marks.push({ x: e.x, z: e.z, t: performance.now(), kind: e.killed ? 'kill' : 'hit', text: `${eng(e.damage_J, 'J', 2)}${e.penetrated ? '' : ' blocked'}` });
        ctx.audio.sfx(e.killed ? 'kill' : 'hit');
        break;
      }
      case 'ground': {
        const tr = tracers.find((q) => q.shotId === e.shotId);
        if (tr) tr.done = true;
        marks.push({ x: e.x, z: e.z, t: performance.now(), kind: 'ground' });
        break;
      }
      case 'baseHit':
        marks.push({ x: 0, z: 0, t: performance.now(), kind: 'base', text: `-${e.damage}` });
        ctx.audio.sfx('baseHit');
        break;
      case 'failure':
        showToast(`${names.get(String(e.seat)) ?? 'A launcher'}: ${e.message}`, true);
        ctx.audio.fault();
        break;
      case 'jam':
        if (e.seat === mySeat()) showToast(e.on ? 'Your electrical trigger link is jammed.' : 'Trigger link restored.', e.on);
        break;
      case 'waveEnd': {
        debrief = { wave: e.wave, players: [...e.players], efficiency: e.efficiency, score: e.score, baseHp: e.baseHp };
        const mine = e.players.find((p) => p.id === session.myId);
        if (mine) {
          ctx.profile.addCredits(mine.credits);
          ctx.profile.data.campaign.bestWave = Math.max(ctx.profile.data.campaign.bestWave, e.wave);
          ctx.profile.touch();
        }
        ctx.audio.sfx('waveClear');
        renderOverlay();
        break;
      }
      case 'runEnd': {
        ended = { result: e.result, score: e.score, wave: e.wave, bonusCredits: e.bonusCredits };
        const c = ctx.profile.data.campaign;
        c.runs += 1;
        if (e.result === 'victory') {
          c.victories += 1;
          ctx.profile.addCredits(e.bonusCredits);
        }
        c.bestScore = Math.max(c.bestScore, e.score);
        ctx.profile.touch();
        ctx.audio.music('off');
        ctx.audio.sfx(e.result === 'victory' ? 'victory' : 'defeat');
        renderOverlay();
        break;
      }
      case 'phase':
        debrief = e.phase === 'debrief' ? debrief : null;
        if (e.phase !== 'defeat' && e.phase !== 'victory') {
          ended = null;
          overlayKey = '';
        }
        if (e.phase === 'charge') ctx.audio.sfx('waveStart');
        ctx.audio.music(e.phase === 'charge' || e.phase === 'defense' ? 'battle' : e.phase === 'victory' || e.phase === 'defeat' ? 'off' : 'menu');
        break;
      case 'spawn':
      case 'lobby':
        break;
    }
  });

  function mySeat(): number {
    return snap?.players.find((p) => p.id === session.myId)?.seat ?? -1;
  }

  const unsubSnap = session.onSnap((s) => {
    queueMicrotask(updateGarageTimer);
    snap = s;
    for (const p of s.players) names.set(String(p.seat), p.name);
    if (s.phase !== lastPhase) {
      lastPhase = s.phase;
      renderOverlay();
    }
    renderHud();
    renderOverlay(true);
  });

  const unsubLink = session.onLink((l, text) => {
    if (l === 'lost') {
      showToast(text || 'Connection lost.', true);
      renderOverlay();
    }
  });

  // ---------------------------------------------------------------- HUD
  function me(): Snapshot['players'][number] | undefined {
    return snap?.players.find((p) => p.id === session.myId);
  }

  function renderHud(): void {
    const s = snap;
    if (!s) return;
    const m = me();
    clear(topCenter);
    if (s.mode === 'defense' && s.wave >= 1) {
      const timer = s.phase === 'build' ? (s.phaseLength_s > 0 ? `Build time ${Math.ceil(s.phaseLeft_s)} s` : 'Build at your own pace') : s.phase === 'charge' ? `Enemies arrive in ${Math.ceil(s.phaseLeft_s)} s` : s.phase === 'debrief' ? (s.phaseLength_s > 0 ? `Next wave in ${Math.ceil(s.phaseLeft_s)} s` : 'Wave cleared') : s.phase === 'defense' ? `${s.enemies.length} on the field, ${s.spawnedRemaining} still to come` : '';
      const hp = segBar(20);
      hp.set(s.baseHp / s.baseHpMax, s.baseHp / s.baseHpMax < 0.3 ? 'bad' : 'on');
      topCenter.append(h('div', { class: 'wavecard' },
        h('div', { class: 'w' }, `Wave ${Math.min(s.wave, GAME.WAVES)} of ${GAME.WAVES}`),
        h('div', { class: 'hint' }, s.waveLabel),
        h('div', { class: 'spread', style: 'margin-top:6px' }, h('span', { class: 'hint' }, 'Keep health'), h('span', { class: 'num' }, `${Math.round(s.baseHp)} / ${s.baseHpMax}`)),
        hp.el,
        h('div', { class: 'hint num', style: 'margin-top:6px' }, timer)));
    }
    clear(topLeft);
    topLeft.append(h('div', { class: 'stack tight', style: 'justify-items:start' },
      h('button', { class: 'btn small', type: 'button', onclick: () => confirmLeave() }, icon('cross', 12), 'Leave'),
      h('div', { class: 'pill' }, h('span', { class: 'hint' }, 'Score'), h('span', { class: 'readout', style: 'font-size:var(--t-1)' }, String(s.score))),
      m ? h('div', { class: 'pill hint num' }, `${m.stats.kills} kills · ${m.stats.shots} shots`) : null));
    clear(topRight);
    const rows = s.players.map((p) => {
      const warn = p.jammed ? 'Jammed' : p.disabled ? 'Disabled' : !p.heat.canFire ? 'Too hot' : p.charge.brownout ? 'Low power' : '';
      return h('div', { class: 'seatchip' },
        h('span', { class: 'dot', style: `background:${SEAT_COLORS[p.seat % 4]}` }),
        h('span', null, `${p.name}${p.id === session.myId ? ' (you)' : ''}`),
        !p.connected ? status('fault', 'Offline') : warn ? status('fault', warn) : status(p.charge.ready ? 'on' : 'off', p.charge.ready ? 'Ready' : `${Math.round(p.charge.voltage_fraction * 100)}%`));
    });
    const gBuf = segBar(14);
    gBuf.set(s.grid.alloc_W / Math.max(1, s.grid.gen_W), s.grid.alloc_W > s.grid.gen_W ? 'bad' : 'on');
    topRight.append(h('div', { class: 'plate hudplate', style: 'min-width:250px' },
      h('div', { class: 'spread' }, h('strong', null, 'Team power'), h('span', { class: 'num hint' }, `${eng(s.grid.alloc_W, 'W', 3)} of ${eng(s.grid.gen_W, 'W', 3)}`)),
      gBuf.el,
      h('div', { class: 'hint', style: 'margin:4px 0 6px' }, `Battery ${eng(s.grid.buffer_J, 'J', 3)}${s.grid.bufferFlow_W > 1 ? ', draining' : s.grid.bufferFlow_W < -1 ? ', filling' : ''}`),
      ...rows));
    if (m) {
      vMeter.set(m.charge.voltage_fraction, pct(m.charge.voltage_fraction, 0));
      tMeter.set(m.heat.hottest_K, `${m.heat.hottest_K.toFixed(0)} K`, !m.heat.canFire);
      gMeter.set(s.grid.alloc_W / Math.max(1, s.grid.gen_W + 120000), eng(s.grid.alloc_W, 'W', 3));
      chargeBar.set(m.charge.voltage_fraction, m.charge.ready ? 'live' : 'on');
      chargeText.textContent = `${eng(m.charge.stored_J, 'J')} of ${eng(m.charge.target_J, 'J')}`;
      heatBar.set(clamp((m.heat.hottest_K - 290) / (m.heat.limit_K - 290), 0, 1), m.heat.canFire ? 'on' : 'bad');
      ctx.audio.setCharge(s.phase === 'charge' || s.phase === 'defense' ? m.charge.voltage_fraction : 0);
      const live = s.phase === 'defense' || s.phase === 'charge';
      firepad.hidden = !live;
      consoleEl.hidden = !live;
      const blocked = m.disabled ? 'Launcher disabled' : m.jammed ? 'Jammed' : !m.heat.canFire ? 'Too hot' : '';
      const armed = m.charge.ready && !blocked && live;
      fireBtn.className = `btn big ${armed ? 'armed' : 'primary'}`;
      fireBtn.disabled = !live;
      fireLabel.textContent = blocked || (m.charge.ready ? 'Fire' : 'Charging…');
    }
  }

  function confirmLeave(): void {
    clear(overlay);
    overlay.append(h('div', { class: 'overlay' }, h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Leave match' }, h('div', { class: 'body stack' },
      h('h2', null, 'Leave this match?'),
      h('p', null, session.kind === 'host' ? 'You are the host. Leaving ends the match for everyone.' : 'Your progress this run is kept only for waves already cleared.'),
      h('div', { class: 'cluster' }, h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go({ name: 'menu' }) }, 'Leave'), h('button', { class: 'btn', type: 'button', onclick: () => { clear(overlay); renderOverlay(); } }, 'Stay'))))));
  }

  // ---------------------------------------------------------------- overlays (lobby, build, debrief, end)
  let overlayKey = '';
  function renderOverlay(light = false): void {
    const s = snap;
    const key = `${s?.phase}|${s?.wave}|${debrief?.wave ?? 0}|${ended ? 1 : 0}|${session.link}|${s?.players.map((p) => `${p.id}${p.ready}${p.connected}${p.hasLoadout}${p.bpName}`).join(',')}|${s?.players.find((p) => p.id === session.myId)?.cost ?? 0}`;
    if (light && key === overlayKey) return;
    overlayKey = key;
    if (overlay.querySelector('[data-keep]')) return;
    clear(overlay);
    if (session.link === 'lost' && session.kind === 'guest') {
      overlay.append(panel(h('div', { class: 'stack' }, h('h2', null, 'Connection lost'), h('p', null, 'The link to the host dropped. Your seat is held for 60 seconds. Rejoin with the same code to take it back.'),
        h('div', { class: 'cluster' }, h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go({ name: 'menu' }) }, 'Back to menu')))));
      return;
    }
    if (!s) {
      overlay.append(panel(h('p', null, 'Waiting for the host')));
      return;
    }
    if (ended) {
      const victory = ended.result === 'victory';
      const isHost = session.kind !== 'guest';
      const lost = ended.wave;
      overlay.append(panel(h('div', { class: 'stack' },
        h('h2', null, victory ? 'Campaign complete' : `The keep fell on wave ${lost}`),
        h('div', { class: 'readout', style: 'font-size:var(--t-3)' }, `${ended.score.toLocaleString()} points`),
        victory ? h('p', null, `Campaign bonus: ${ended.bonusCredits.toLocaleString()} credits added to your balance.`)
          : h('p', null, lost > 1 ? `You cleared ${lost - 1} wave${lost > 2 ? 's' : ''}. Credits from cleared waves are yours to keep. Choose how to go on.` : 'Credits from cleared waves are yours to keep. Upgrade your launcher and try again.'),
        victory ? h('div', { class: 'cluster' }, h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go({ name: 'menu' }) }, 'Back to menu'))
          : h('div', { class: 'stack tight' },
            isHost
              ? h('button', { class: 'btn primary big', type: 'button', 'data-coach': 'retry', onclick: () => { ended = null; session.send({ t: 'retry', wave: lost }); } }, icon('play', 20), lost > 1 ? `Continue from wave ${lost}` : 'Try again')
              : h('p', { class: 'hint' }, 'The host chooses how to continue.'),
            isHost && lost > 1 ? h('button', { class: 'btn', type: 'button', onclick: () => { ended = null; session.send({ t: 'retry', wave: 1 }); } }, 'Restart from wave 1') : null,
            h('button', { class: 'btn quiet', type: 'button', onclick: () => ctx.go({ name: 'menu' }) }, 'Back to menu')))));
      return;
    }
    if (s.phase === 'lobby') overlay.append(lobbyPanel(s));
    else if (s.phase === 'build') overlay.append(buildPanel(s));
    else if (s.phase === 'debrief' && debrief) overlay.append(debriefPanel(s, debrief));
  }

  function panel(inner: HTMLElement, wide = false): HTMLElement {
    return h('div', { class: 'overlay' }, h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'false', style: wide ? 'width:min(760px,100%)' : '' }, h('div', { class: 'body' }, inner)));
  }

  function loadoutPicker(s: Snapshot): HTMLElement {
    const m = s.players.find((p) => p.id === session.myId);
    const sel = h('select', { 'aria-label': 'Launcher for this match', onchange: (e: Event) => { blueprintId = (e.target as HTMLSelectElement).value; sendLoadout(); } },
      ...ctx.profile.data.blueprints.map((b) => h('option', { value: b.id, selected: b.id === blueprintId }, `${b.bp.name} (${b.bp.kind})`)));
    const budget = m?.budget ?? 0;
    const over = m ? m.cost > budget && budget > 0 : false;
    return h('div', { class: 'stack tight' },
      h('div', { class: 'field' }, h('label', null, 'Your launcher'), sel),
      m && m.hasLoadout ? h('div', { class: over ? 'err-text' : 'hint num' }, over ? icon('warn', 14) : null, `Cost ${Math.round(m.cost).toLocaleString()} of ${budget > 0 ? budget.toLocaleString() : 'unlimited'} credits${over ? '. Over budget.' : ''}`) : h('div', { class: 'hint' }, 'Sending your launcher to the host'),
      h('button', { class: 'btn', style: 'justify-self:start', type: 'button', 'data-coach': 'garage', onclick: () => openGarage() }, icon('wrench', 14), 'Upgrade or edit launcher'));
  }

  function sendLoadout(): void {
    const bp = myBp();
    if (bp) {
      session.send({ t: 'loadout', blueprint: bp });
      void primeTable();
    }
  }

  function seatList(s: Snapshot): HTMLElement {
    return h('div', { class: 'seats' }, ...s.players.map((p) => h('div', { class: 'seat' },
      h('span', { class: p.ready ? 'lamp on' : 'lamp' }),
      h('div', null, h('strong', null, p.name), p.host ? h('span', { class: 'muted' }, ' · host') : null, p.id === session.myId ? h('span', { class: 'muted' }, ' · you') : null, h('div', { class: 'hint' }, p.hasLoadout ? `${p.bpName} (${p.kind})` : 'No launcher yet')),
      p.connected ? status(p.ready ? 'on' : 'off', p.ready ? 'Ready' : 'Not ready') : status('fault', 'Disconnected'),
      h('span', { class: 'hint num' }, `Seat ${p.seat + 1}`))));
  }

  function lobbyPanel(s: Snapshot): HTMLElement {
    const m = s.players.find((p) => p.id === session.myId);
    const isHost = session.kind !== 'guest';
    const solo = session.kind === 'solo';
    const everyoneReady = s.players.every((p) => p.id === session.myId || p.ready || !p.connected) && !!m?.hasLoadout;
    const codeBlock = session.kind === 'host' || session.kind === 'guest'
      ? h('div', { class: 'stack tight' }, h('div', { class: 'hint' }, session.kind === 'host' ? 'Room code. Friends choose Play with friends and type this.' : 'Room code'),
        h('div', { class: 'cluster' }, h('span', { class: 'roomcode', 'aria-label': `Room code ${s.code.split('').join(' ')}` }, s.code),
          session.kind === 'host' ? h('button', { class: 'btn small', type: 'button', onclick: () => void copy(s.code) }, 'Copy code') : null,
          session.kind === 'host' ? h('button', { class: 'btn small', type: 'button', onclick: () => void copy(`${location.origin}${location.pathname}?join=${s.code}`, 'Link copied') }, 'Copy invite link') : null))
      : null;
    return panel(h('div', { class: 'stack' },
      h('h2', null, solo ? 'Solo defense' : isHost ? 'Your room' : 'Waiting in the room'),
      codeBlock,
      seatList(s),
      loadoutPicker(s),
      h('div', { class: 'cluster' },
        solo ? null : h('button', { class: m?.ready ? 'btn armed' : 'btn', type: 'button', disabled: !m?.hasLoadout, onclick: () => session.send({ t: 'ready', value: !m?.ready }) }, m?.ready ? 'Ready. Click to cancel' : 'Mark ready'),
        isHost ? h('button', { class: 'btn primary', type: 'button', disabled: !(solo ? m?.hasLoadout : everyoneReady), onclick: () => session.send({ t: 'start' }) }, 'Start the match') : h('span', { class: 'hint' }, 'The host starts the match.'),
        h('button', { class: 'btn quiet', type: 'button', onclick: () => ctx.go({ name: 'menu' }) }, 'Leave')),
      isHost && !solo && !everyoneReady ? h('p', { class: 'hint' }, 'Everyone needs a launcher and must mark ready.') : null,
      session.kind === 'host' ? h('p', { class: 'hint' }, 'Guests connect straight to this browser tab. Keep it open and in the foreground while you play.') : null), true);
  }

  async function copy(text: string, ok = 'Copied'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      showToast(ok);
    } catch {
      showToast(`Copy blocked by the browser. Select and copy: ${text}`, true);
    }
  }

  // ---------------------------------------------------------------- garage inside the match
  let garage: { host: HTMLElement; dispose: () => void; timer: HTMLElement } | null = null;

  function openGarage(): void {
    if (garage) return;
    const s = snap;
    const wave = Math.max(1, s?.wave ?? 1);
    const timer = h('span', { class: 'hint num' }, '');
    const edRoot = h('div', { style: 'flex:1;min-height:0;display:flex;flex-direction:column' });
    const host = h('div', { class: 'garage-layer' },
      h('div', { class: 'spread', style: 'padding:8px var(--s2)' },
        h('strong', { style: 'font-family:var(--font-display);font-size:var(--t-1)' }, `Garage, wave ${wave}`),
        h('span', { class: 'hint' }, 'The match waits for you in solo. With friends the build timer keeps running.'), timer),
      edRoot);
    const stop = mountEditor(edRoot, {
      profile: ctx.profile, reducedMotion: reduced, openNotes: () => ctx.openNotes(), toRange: () => undefined,
      sfx: (n) => ctx.audio.sfx(n), toast: (t, k) => showToast(t, k === 'fault'),
      budget: GAME.BUILD_BUDGET + GAME.BUILD_BUDGET_PER_WAVE * (wave - 1), wave,
      done: (id) => {
        closeGarage();
        blueprintId = id;
        sendLoadout();
        overlayKey = '';
        renderOverlay();
      },
    }, blueprintId);
    garage = { host, dispose: stop, timer };
    root.append(host);
    updateGarageTimer();
  }

  function closeGarage(): void {
    if (!garage) return;
    garage.dispose();
    garage.host.remove();
    garage = null;
  }

  function updateGarageTimer(): void {
    if (!garage || !snap) return;
    garage.timer.textContent = snap.phase === 'build' && snap.phaseLength_s > 0 ? `${Math.ceil(snap.phaseLeft_s)} s left in this build phase` : '';
  }

  function buildPanel(s: Snapshot): HTMLElement {
    const m = s.players.find((p) => p.id === session.myId);
    return h('div', { class: 'hud', style: 'top:50%;left:50%;transform:translate(-50%,-50%)' }, h('div', { class: 'plate', style: 'width:min(460px,92vw)' }, h('div', { class: 'body stack' },
      h('h2', null, `Build phase, wave ${s.wave}`),
      h('p', { class: 'hint' }, `Wave ${s.wave} is next. Your launcher can cost up to ${(GAME.BUILD_BUDGET + GAME.BUILD_BUDGET_PER_WAVE * (s.wave - 1)).toLocaleString()} credits. Repairs are free. Spend your credits on a better launcher, then press Ready.`),
      seatList(s),
      loadoutPicker(s),
      h('div', { class: 'cluster' },
        h('button', { class: m?.ready ? 'btn armed' : 'btn primary', type: 'button', disabled: !m?.hasLoadout, onclick: () => session.send({ t: 'ready', value: !m?.ready }) }, m?.ready ? 'Ready. Click to cancel' : 'Ready for the wave'),
        h('span', { class: 'hint num' }, s.phaseLength_s > 0 ? `${Math.ceil(s.phaseLeft_s)} s left` : 'No time limit')))));
  }

  function debriefPanel(s: Snapshot, d: NonNullable<typeof debrief>): HTMLElement {
    const m = d.players.find((p) => p.id === session.myId);
    const isHost = session.kind !== 'guest';
    return panel(h('div', { class: 'stack' },
      h('h2', null, `Wave ${d.wave} cleared`),
      h('div', { class: 'cluster' }, h('span', { class: 'num' }, `Base ${Math.round(d.baseHp)} / ${GAME.BASE_HP}`), h('span', { class: 'num' }, `Efficiency ${pct(d.efficiency)}`), h('span', { class: 'num' }, `Score ${d.score}`)),
      h('table', null, h('thead', null, h('tr', null, h('th', null, 'Player'), h('th', { class: 'num' }, 'Kills'), h('th', { class: 'num' }, 'Shots'), h('th', { class: 'num' }, 'Damage'), h('th', { class: 'num' }, 'Credits'))),
        h('tbody', null, ...d.players.map((p) => h('tr', null, h('td', null, p.name), h('td', { class: 'num' }, p.stats.kills), h('td', { class: 'num' }, p.stats.shots), h('td', { class: 'num' }, eng(p.stats.damage_J, 'J', 3)), h('td', { class: 'num' }, `+${p.credits.toLocaleString()}`))))),
      m ? h('p', { class: 'hint' }, `You earned ${m.credits.toLocaleString()} credits, including ${m.efficiencyBonus.toLocaleString()} for efficiency. Spend them in the garage before the next wave.`) : null,
      lastReport ? h('div', null, h('h3', null, 'Your last shot, where the energy went'), ledgerBar(lastReport.ledger)) : null,
      h('div', { class: 'cluster' }, isHost ? h('button', { class: 'btn primary', type: 'button', onclick: () => session.send({ t: 'next' }) }, 'Start the next build phase') : h('span', { class: 'hint' }, 'The host starts the next phase, or it starts by itself.'), s.phaseLength_s > 0 ? h('span', { class: 'hint num' }, `${Math.ceil(s.phaseLeft_s)} s`) : null)), true);
  }

  // ---------------------------------------------------------------- canvas drawing
  const c2 = canvas.getContext('2d');
  let raf = 0;
  let lastFrame = performance.now();

  function draw(): void {
    if (disposed || !c2) return;
    const now = performance.now();
    const dtReal = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;
    const dpr = Math.min(ctx.profile.data.settings.quality === 'low' ? 1 : 2, window.devicePixelRatio || 1);
    const v = view();
    if (canvas.width !== Math.round(v.w * dpr) || canvas.height !== Math.round(v.h * dpr)) {
      canvas.width = Math.round(v.w * dpr);
      canvas.height = Math.round(v.h * dpr);
    }
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const anim = reduced ? 0 : now / 1000;
    drawGround(v, anim);
    const simT = session.simNow();
    drawKeepAndGuns(v, anim);
    drawEnemies(simT, now, anim);
    stepTracers(simT, dtReal);
    drawMarks(now);
    drawCrosshair(simT);
    drawFog(v);
    raf = requestAnimationFrame(draw);
  }

  // scenery is generated once from a fixed seed, in world metres, away from the four lanes
  const scenery: Array<{ x: number; z: number; r: number; seed: number }> = [];
  {
    const rnd = rng(2024);
    let guard = 0;
    while (scenery.length < 46 && guard++ < 2000) {
      const x = (rnd() * 2 - 1) * (WORLD_X - 10);
      const z = WORLD_Z0 + 30 + rnd() * (WORLD_Z1 - WORLD_Z0 - 40);
      const d = Math.hypot(x, z);
      if (d < 45 || d > GAME.SPAWN_DISTANCE_M + 20) continue;
      const bearing = (Math.atan2(x, z) * 180) / Math.PI;
      if (GAME.LANE_BEARINGS_DEG.some((lb) => Math.abs(lb - bearing) < 7.5 + 900 / Math.max(60, d) * 0.4)) continue;
      scenery.push({ x, z, r: 4 + rnd() * 7, seed: Math.floor(rnd() * 1e6) });
    }
  }

  function drawGround(v: { w: number; h: number; scale: number }, anim: number): void {
    if (!c2) return;
    const [bx, bz] = toScreen(0, 0);
    const sky = c2.createLinearGradient(0, 0, 0, v.h);
    sky.addColorStop(0, '#C9DCC0');
    sky.addColorStop(0.35, '#E6D6A6');
    sky.addColorStop(1, W.sand);
    c2.fillStyle = sky;
    c2.fillRect(0, 0, v.w, v.h);
    // grass banks on both sides, wavy edge
    c2.fillStyle = W.grass;
    for (const side of [-1, 1]) {
      c2.beginPath();
      const [ex] = toScreen(side * (WORLD_X * 0.8), 0);
      c2.moveTo(side < 0 ? 0 : v.w, 0);
      for (let i = 0; i <= 12; i++) {
        const yy = (i / 12) * v.h;
        const wob = Math.sin(i * 1.3 + side) * 18 + Math.sin(i * 0.5) * 10;
        c2.lineTo(ex + side * (-0.2 * v.w * (1 - i / 12) * 0.6) + wob - side * 0, yy);
      }
      c2.lineTo(side < 0 ? 0 : v.w, v.h);
      c2.closePath();
      c2.globalAlpha = 0.5;
      c2.fill();
      c2.globalAlpha = 1;
    }
    // lane paths
    c2.lineCap = 'round';
    for (const b of GAME.LANE_BEARINGS_DEG) {
      const a = (b * Math.PI) / 180;
      const [ex, ez] = toScreen(Math.sin(a) * GAME.SPAWN_DISTANCE_M, Math.cos(a) * GAME.SPAWN_DISTANCE_M);
      c2.strokeStyle = 'rgba(212,171,107,.55)';
      c2.lineWidth = Math.max(18, 38 * v.scale);
      c2.beginPath();
      c2.moveTo(bx, bz);
      c2.lineTo(ex, ez);
      c2.stroke();
      c2.strokeStyle = 'rgba(243,221,174,.55)';
      c2.lineWidth = Math.max(12, 26 * v.scale);
      c2.beginPath();
      c2.moveTo(bx, bz);
      c2.lineTo(ex, ez);
      c2.stroke();
    }
    c2.lineCap = 'butt';
    // range rings with small labels
    c2.font = '800 11px "Nunito", system-ui, sans-serif';
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    for (const r of [100, 200, 300, 400, 500]) {
      c2.strokeStyle = 'rgba(255,248,234,.7)';
      c2.lineWidth = 2;
      c2.setLineDash([2, 9]);
      c2.lineCap = 'round';
      c2.beginPath();
      c2.arc(bx, bz, r * v.scale, Math.PI, 2 * Math.PI);
      c2.stroke();
      c2.setLineDash([]);
      c2.lineCap = 'butt';
      const lx = bx;
      const ly = bz - r * v.scale;
      if (ly > 12 && ly < v.h) {
        const tw = c2.measureText(`${r} m`).width + 14;
        c2.fillStyle = 'rgba(255,248,234,.92)';
        c2.beginPath();
        c2.roundRect(lx - tw / 2, ly - 10, tw, 20, 10);
        c2.fill();
        c2.fillStyle = W.ink;
        c2.fillText(`${r} m`, lx, ly + 0.5);
      }
    }
    // scenery, far to near
    const vis = scenery.map((o) => ({ o, p: toScreen(o.x, o.z) })).sort((m, n) => m.p[1] - n.p[1]);
    for (const { o, p } of vis) {
      if (p[0] < -40 || p[0] > v.w + 40 || p[1] < -40 || p[1] > v.h + 40) continue;
      rock(c2, p[0], p[1], Math.max(7, o.r * v.scale * 1.3), o.seed);
    }
    // spawn gates
    for (const b of GAME.LANE_BEARINGS_DEG) {
      const a = (b * Math.PI) / 180;
      const [gx, gz] = toScreen(Math.sin(a) * GAME.SPAWN_DISTANCE_M, Math.cos(a) * GAME.SPAWN_DISTANCE_M);
      if (gz < -30 || gz > v.h + 30) continue;
      const k = Math.max(0.8, Math.min(1.6, v.scale * 1.1));
      shadow(c2, gx, gz + 2, 26 * k, 5 * k, 0.2);
      for (const sx of [-1, 1]) {
        c2.fillStyle = W.woodDark;
        c2.fillRect(gx + sx * 20 * k - 3 * k, gz - 34 * k, 6 * k, 36 * k);
        c2.fillStyle = W.wood;
        c2.fillRect(gx + sx * 20 * k - 3 * k, gz - 34 * k, 3.5 * k, 36 * k);
      }
      c2.fillStyle = W.woodDark;
      c2.fillRect(gx - 24 * k, gz - 36 * k, 48 * k, 6 * k);
      c2.fillStyle = W.fault;
      c2.beginPath();
      c2.moveTo(gx - 16 * k, gz - 30 * k);
      c2.lineTo(gx + 16 * k, gz - 30 * k);
      c2.lineTo(gx + 16 * k, gz - 20 * k + Math.sin(anim * 3 + b) * 1.5 * k);
      c2.lineTo(gx, gz - 15 * k);
      c2.lineTo(gx - 16 * k, gz - 20 * k - Math.sin(anim * 3 + b) * 1.5 * k);
      c2.closePath();
      c2.fill();
    }
  }

  function drawFog(v: { w: number; h: number }): void {
    if (!c2) return;
    const f = c2.createLinearGradient(0, 0, 0, v.h * 0.4);
    f.addColorStop(0, 'rgba(207,224,238,.75)');
    f.addColorStop(1, 'rgba(207,224,238,0)');
    c2.fillStyle = f;
    c2.fillRect(0, 0, v.w, v.h * 0.4);
  }

  function drawKeepAndGuns(v: { w: number; h: number; scale: number }, anim: number): void {
    if (!c2) return;
    const [bx, bz] = toScreen(0, -22);
    const ks = clamp(v.scale * 8.5, 9, 18);
    keep(c2, bx, bz, ks, anim);
    if (!snap) return;
    for (const p of snap.players) {
      const [x, z] = toScreen(p.x_m, 6);
      const mine = p.id === session.myId;
      let ang = 0;
      if (mine) {
        const dx = aimWorld.x - p.x_m;
        const dz = aimWorld.z;
        ang = Math.atan2(dx, dz);
      }
      const gs = clamp(v.scale * 4.2, 6, 11);
      cannonTop(c2, x, z, gs, ang, SEAT_COLORS[p.seat % 4], p.charge.voltage_fraction, anim);
      // name tag
      c2.font = '800 11px "Nunito", system-ui, sans-serif';
      c2.textAlign = 'center';
      c2.textBaseline = 'middle';
      const label = mine ? 'You' : p.name;
      const tw = c2.measureText(label).width + 14;
      c2.fillStyle = 'rgba(255,248,234,.95)';
      c2.beginPath();
      c2.roundRect(x - tw / 2, z + gs * 1.55, tw, 17, 8.5);
      c2.fill();
      c2.fillStyle = W.ink;
      c2.fillText(label, x, z + gs * 1.55 + 9);
    }
  }

  const hurtAt = new Map<number, { hp: number; t: number }>();
  const SIZE: Record<string, number> = { walker: 1, plated: 1.25, swarm: 0.8, shield: 1.2, jammer: 1 };

  function drawEnemies(simT: number, now: number, anim: number): void {
    if (!c2 || !snap) return;
    const v = view();
    const zf = Math.min(1.9, 0.85 + 0.3 * zoom);
    const list: Array<{ x: number; y: number; type: string; hp: number; id: number; wx: number; wz: number; age: number }> = [];
    for (const e of snap.enemies) {
      const type = ENEMY_ORDER[e[1]];
      const p = enemyPath(e[0], type, e[2]);
      const age = Math.max(0, simT - e[3]);
      const wx = p.x0 + p.dx * p.speed_m_s * age;
      const wz = p.z0 + p.dz * p.speed_m_s * age;
      const [x, y] = toScreen(wx, wz);
      if (x < -30 || y < -40 || x > v.w + 30 || y > v.h + 40) continue;
      list.push({ x, y, type, hp: e[4], id: e[0], wx, wz, age });
    }
    list.sort((a, b) => a.y - b.y);
    for (const e of list) {
      const def = ENEMIES[e.type as keyof typeof ENEMIES];
      const u = 18 * (SIZE[e.type] ?? 1) * zf;
      const prev = hurtAt.get(e.id);
      if (prev && e.hp < prev.hp - 1) hurtAt.set(e.id, { hp: e.hp, t: now });
      else if (!prev) hurtAt.set(e.id, { hp: e.hp, t: -1e9 });
      const hurt = Math.max(0, 1 - (now - (hurtAt.get(e.id)?.t ?? -1e9)) / 220);
      if (e.type === 'shield') {
        c2.save();
        c2.fillStyle = 'rgba(47,155,234,.14)';
        c2.strokeStyle = 'rgba(47,155,234,.7)';
        c2.lineWidth = 2;
        c2.setLineDash([5, 6]);
        c2.beginPath();
        c2.arc(e.x, e.y - u * 0.5, GAME.SHIELD.RADIUS_M * v.scale, 0, Math.PI * 2);
        c2.fill();
        c2.stroke();
        c2.restore();
      }
      critter(c2, e.x, e.y, u, e.type as CritterKind, anim, hurt, !reduced);
      if (e.type === 'jammer') {
        // the engine jams for DURATION_S at the start of every PERIOD_S (from the first period on)
        const k = Math.floor(e.age / GAME.JAMMER.PERIOD_S);
        const inPeriod = e.age - k * GAME.JAMMER.PERIOD_S;
        if (k >= 1 && inPeriod < GAME.JAMMER.DURATION_S) {
          const ph = inPeriod / GAME.JAMMER.DURATION_S;
          c2.strokeStyle = `rgba(226,72,61,${0.7 * (1 - ph)})`;
          c2.lineWidth = 3;
          c2.beginPath();
          c2.arc(e.x, e.y - u * 0.8, u * (0.8 + ph * 1.8), 0, Math.PI * 2);
          c2.stroke();
        }
      }
      if (e.hp < def.hp_J) {
        const f = clamp(e.hp / def.hp_J, 0, 1);
        const bw = u * 1.3;
        const by = e.y - u * (e.type === 'swarm' ? 2.3 : 1.95) - (e.type === 'jammer' ? u * 0.5 : 0);
        c2.fillStyle = 'rgba(38,49,77,.85)';
        c2.beginPath();
        c2.roundRect(e.x - bw / 2 - 2, by - 2, bw + 4, 8, 4);
        c2.fill();
        c2.fillStyle = f < 0.35 ? W.fault : W.ok;
        c2.beginPath();
        c2.roundRect(e.x - bw / 2, by, Math.max(2, bw * f), 4, 2);
        c2.fill();
      }
    }
  }

  function stepTracers(simT: number, dt: number): void {
    if (!c2) return;
    void dt;
    const live: Tracer[] = [];
    for (const tr of tracers) {
      let guard = 0;
      while (tr.t < simT && guard++ < 30 && !tr.done) {
        tr.flight.step(1 / 240);
        tr.t += 1 / 240;
        tr.trail.push([tr.flight.s[0], tr.flight.s[2]]);
        if (tr.trail.length > 9) tr.trail.shift();
        if (tr.flight.s[1] <= 0 || tr.t > simT + 12) tr.done = true;
      }
      if (tr.t - simT > 12 || (tr.done && tr.trail.length <= 1)) continue;
      const col = SEAT_COLORS[tr.seat % 4];
      c2.lineCap = 'round';
      c2.lineJoin = 'round';
      const pts = tr.trail.map((p) => toScreen(p[0], p[1]));
      for (let i = 1; i < pts.length; i++) {
        const f = i / pts.length;
        c2.strokeStyle = mix(col, '#FFFFFF', 0.2);
        c2.globalAlpha = 0.15 + 0.85 * f;
        c2.lineWidth = 2 + 4 * f;
        c2.beginPath();
        c2.moveTo(pts[i - 1][0], pts[i - 1][1]);
        c2.lineTo(pts[i][0], pts[i][1]);
        c2.stroke();
      }
      c2.globalAlpha = 1;
      if (pts.length) {
        const [hx, hy] = pts[pts.length - 1];
        c2.fillStyle = '#fff';
        c2.beginPath();
        c2.arc(hx, hy, 3.2, 0, Math.PI * 2);
        c2.fill();
      }
      c2.lineCap = 'butt';
      if (tr.done) tr.trail.shift();
      live.push(tr);
    }
    tracers.length = 0;
    tracers.push(...live);
  }

  function outlined(text: string, x: number, y: number, size: number, fill: string): void {
    if (!c2) return;
    c2.font = `800 ${size}px "Fredoka", "Nunito", system-ui, sans-serif`;
    c2.textAlign = 'center';
    c2.textBaseline = 'bottom';
    c2.lineJoin = 'round';
    c2.lineWidth = 5;
    c2.strokeStyle = W.ink;
    c2.strokeText(text, x, y);
    c2.fillStyle = fill;
    c2.fillText(text, x, y);
  }

  function drawMarks(now: number): void {
    if (!c2) return;
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i];
      const age = (now - m.t) / 1000;
      const life = m.kind === 'ground' ? 1.5 : m.kind === 'flash' ? 0.14 : 0.9;
      if (age > life) {
        marks.splice(i, 1);
        continue;
      }
      const [x, y] = toScreen(m.x, m.z);
      const f = age / life;
      if (m.kind === 'flash') {
        c2.globalAlpha = 1 - f;
        c2.fillStyle = W.volt;
        c2.beginPath();
        c2.arc(x, y - 6, 8 + 20 * f, 0, Math.PI * 2);
        c2.fill();
        c2.fillStyle = '#fff';
        c2.beginPath();
        c2.arc(x, y - 6, 4 + 8 * f, 0, Math.PI * 2);
        c2.fill();
      } else if (m.kind === 'ground') {
        // a puff of dust and a small crater, honest about where the slug came down
        c2.globalAlpha = 0.7 * (1 - f);
        c2.fillStyle = W.sandDark;
        c2.beginPath();
        c2.ellipse(x, y, 5 + 10 * f, 3 + 5 * f, 0, 0, Math.PI * 2);
        c2.fill();
        c2.fillStyle = W.woodDark;
        c2.beginPath();
        c2.ellipse(x, y, 3, 1.8, 0, 0, Math.PI * 2);
        c2.fill();
      } else {
        c2.globalAlpha = 1 - f * f;
        const col = m.kind === 'base' ? W.fault : m.kind === 'kill' ? W.volt : '#fff';
        // star burst
        c2.fillStyle = col;
        c2.beginPath();
        const R = 8 + 20 * f;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const rr = k % 2 ? R * 0.55 : R;
          c2.lineTo(x + Math.cos(a) * rr, y - 8 + Math.sin(a) * rr);
        }
        c2.closePath();
        c2.fill();
        if (m.text) outlined(m.text, x, y - 20 - 18 * f, 15, m.kind === 'kill' ? W.volt : '#fff');
      }
      c2.globalAlpha = 1;
    }
  }

  function drawCrosshair(simT: number): void {
    if (!c2 || !mouse.inside) return;
    const w = aimWorld;
    const m = me();
    const ex = m ? m.x_m : 0;
    const range = Math.hypot(w.x - ex, w.z);
    const T = flightTime(range);
    const { x, y } = mouse;
    c2.lineCap = 'round';
    c2.strokeStyle = W.ink;
    c2.lineWidth = 5;
    const reticle = (): void => {
      c2?.beginPath();
      c2?.arc(x, y, 11, 0, Math.PI * 2);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        c2?.moveTo(x + dx * 7, y + dy * 7);
        c2?.lineTo(x + dx * 18, y + dy * 18);
      }
      c2?.stroke();
    };
    reticle();
    c2.strokeStyle = '#fff';
    c2.lineWidth = 2.4;
    reticle();
    outlined(`${range.toFixed(0)} m${T !== null ? ` · ${T.toFixed(2)} s` : ''}`, x, y - 22, 13, '#fff');
    if (leadAssist && snap && T !== null) {
      let best: { x: number; z: number } | null = null;
      let bd = 30 * 30;
      for (const e of snap.enemies) {
        const p = enemyPath(e[0], ENEMY_ORDER[e[1]], e[2]);
        const age = simT - e[3];
        const cx = p.x0 + p.dx * p.speed_m_s * age;
        const cz = p.z0 + p.dz * p.speed_m_s * age;
        const d2 = (cx - w.x) ** 2 + (cz - w.z) ** 2;
        if (d2 < bd) {
          bd = d2;
          best = { x: p.x0 + p.dx * p.speed_m_s * (age + T), z: p.z0 + p.dz * p.speed_m_s * (age + T) };
        }
      }
      if (best) {
        const [lx, ly] = toScreen(best.x, best.z);
        c2.strokeStyle = W.ink;
        c2.lineWidth = 6;
        c2.beginPath();
        c2.arc(lx, ly, 9, 0, Math.PI * 2);
        c2.stroke();
        c2.strokeStyle = W.volt;
        c2.lineWidth = 3;
        c2.beginPath();
        c2.arc(lx, ly, 9, 0, Math.PI * 2);
        c2.stroke();
        outlined('lead', lx, ly - 14, 11, W.volt);
      }
    }
    c2.lineCap = 'butt';
  }

  // ---------------------------------------------------------------- start
  scope.show(null);
  sendLoadout();
  session.send({ t: 'aim', x: aimWorld.x, z: aimWorld.z, lead: true });
  renderHud();
  renderOverlay();
  raf = requestAnimationFrame(draw);

  return () => {
    disposed = true;
    closeGarage();
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    unsubEv();
    unsubSnap();
    unsubLink();
    scope.dispose();
    calc.close();
    session.close();
    ctx.audio.setCharge(0);
    ctx.audio.stopAll();
    if (toastTimer) clearTimeout(toastTimer);
    ctx.profile.flush();
    clear(root);
  };
}
