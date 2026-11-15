import { runCoach } from './coach.ts';
import { analyzeBlueprint, GAME, RANGE, type Blueprint } from '@railhold/shared';
import { Flight, flightParamsFor } from '@railhold/physics';
import type { GameEvent, ShotReport, Snapshot } from '@railhold/engine';
import type { AppCtx } from '../app-ctx.ts';
import { clamp, clear, eng, h, pct } from '../dom.ts';
import { HostSession } from '../session.ts';
import { cannonSide, W } from './art.ts';
import { icon, needleMeter, Scope, segBar, status } from './widgets.ts';

interface Tracer {
  id: number;
  pts: Array<[number, number]>;
  t0: number;
  duration: number;
  done: boolean;
}

interface BoardRow {
  distance: number;
  x: number;
  y: number;
  t: number;
  speed: number;
  hit: boolean;
}

export async function mountRange(root: HTMLElement, ctx: AppCtx, blueprintId: string, tutorial = false): Promise<() => void> {
  const rec = ctx.profile.blueprint(blueprintId);
  if (!rec) {
    ctx.go({ name: 'menu' });
    return () => undefined;
  }
  const bp: Blueprint = rec.bp;
  const analysis = analyzeBlueprint(bp);
  const session = new HostSession('range', ctx.profile.data.clientId, 'RANGE', ctx.profile.data.name, ctx.profile.data.unlocked);
  await session.start();
  session.send({ t: 'loadout', blueprint: bp });

  const reduced = ctx.reducedMotion();
  const scope = new Scope(0.5, 'Rail current, slow motion');
  const vMeter = needleMeter('Bank voltage', 0, 1, reduced);
  const tMeter = needleMeter('Launcher temperature', 290, 400, reduced);
  const cMeter = needleMeter('Stored energy', 0, 1, reduced);
  const chargeBar = segBar(20);

  const canvas = h('canvas', { class: 'world', role: 'img', 'aria-label': 'Side view of the range: launcher, target boards at 50, 100, 200 and 400 metres, and the slug path' });
  const stage = h('div', { class: 'stage' }, canvas);

  const chrono = h('div', { class: 'hudplate plate stack tight', 'aria-live': 'polite' });
  const boardsTable = h('div', { class: 'hudplate plate' });
  const msg = h('div', { class: 'hint', role: 'status' }, '');
  let elevation = 0;
  let target = 1;
  const shots: ShotReport[] = [];
  const boards = new Map<number, BoardRow>();
  const tracers: Tracer[] = [];
  let snap: Snapshot | null = null;
  let lastReport: ShotReport | null = null;
  let maxH = 6;
  let disposed = false;

  const elInput = h('input', { type: 'range', min: String(RANGE.ELEVATION_MRAD.min), max: String(RANGE.ELEVATION_MRAD.max), step: '0.5', value: '0', 'aria-label': 'Elevation in milliradians' });
  const elNum = h('input', { type: 'number', min: String(RANGE.ELEVATION_MRAD.min), max: String(RANGE.ELEVATION_MRAD.max), step: '0.5', value: '0', 'aria-label': 'Elevation value' });
  const setEl = (v: number): void => {
    elevation = clamp(Number.isFinite(v) ? v : 0, RANGE.ELEVATION_MRAD.min, RANGE.ELEVATION_MRAD.max);
    elInput.value = String(elevation);
    elNum.value = String(elevation);
    session.send({ t: 'aim', elevation_mrad: elevation });
  };
  elInput.addEventListener('input', () => setEl(Number(elInput.value)));
  elNum.addEventListener('input', () => setEl(Number(elNum.value)));

  const chInput = h('input', { type: 'range', min: String(GAME.MIN_CHARGE_TARGET * 100), max: '100', step: '1', value: '100', 'aria-label': 'Charge target in percent of blueprint voltage' });
  const chOut = h('span', { class: 'num' }, '100 %');
  chInput.addEventListener('input', () => {
    target = Number(chInput.value) / 100;
    chOut.textContent = `${chInput.value} %`;
    session.send({ t: 'chargeTarget', fraction: target });
  });

  const fireBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => doFire() }, icon('bolt', 14), 'Fire');
  const fireKey = (): string => ctx.profile.data.settings.fireKey;

  function doFire(): void {
    ctx.audio.unlock();
    session.send({ t: 'fire' });
  }

  const onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT') && e.code !== fireKey()) return;
    if (e.code === fireKey() && !e.repeat) {
      e.preventDefault();
      doFire();
    }
  };
  window.addEventListener('keydown', onKey);

  const unsubEv = session.onEvent((e: GameEvent) => {
    if (e.e === 'err') {
      msg.textContent = e.message;
      if (e.code === 'overheated') ctx.audio.fault();
    } else if (e.e === 'fire') {
      boards.clear();
      const spec = { material: e.material as never, frontalArea_m2: e.area_m2, length_m: e.length_m };
      const fl = new Flight(flightParamsFor(spec, e.mass_kg));
      fl.reset(e.x0, e.y0, e.z0, e.vx, e.vy, e.vz);
      const pts: Array<[number, number]> = [[0, e.y0]];
      let t = 0;
      let prevZ = fl.s[2];
      let prevY = fl.s[1];
      let landed = false;
      for (let i = 0; i < 12 * 240; i++) {
        fl.step(1 / 240);
        t += 1 / 240;
        if (fl.s[1] <= 0) {
          // interpolate to the exact ground crossing instead of overshooting by up to one step
          const f = prevY > 0 ? prevY / (prevY - fl.s[1]) : 0;
          pts.push([prevZ + f * (fl.s[2] - prevZ), 0]);
          t -= (1 - f) / 240;
          landed = true;
          break;
        }
        if (i % 6 === 0) pts.push([fl.s[2], fl.s[1]]);
        prevZ = fl.s[2];
        prevY = fl.s[1];
        if (fl.s[2] > RANGE.BOARD_DISTANCES_M[RANGE.BOARD_DISTANCES_M.length - 1] + 60) break;
      }
      if (!landed) pts.push([fl.s[2], Math.max(0, fl.s[1])]);
      maxH = Math.max(6, Math.min(90, Math.max(...pts.map((p) => p[1])) * 1.2));
      tracers.push({ id: e.shotId, pts, t0: performance.now(), duration: t, done: false });
      if (tracers.length > 4) tracers.shift();
    } else if (e.e === 'board') {
      boards.set(e.distance_m, { distance: e.distance_m, x: e.x, y: e.y, t: e.t, speed: e.speed, hit: e.hit });
      renderBoards();
    } else if (e.e === 'ground') {
      const tr = tracers.find((q) => q.id === e.shotId);
      if (tr) tr.done = true;
      renderBoards(e.z);
    } else if (e.e === 'shot') {
      lastReport = e.report;
      shots.push(e.report);
      if (shots.length > 10) shots.shift();
      ctx.profile.addShot(e.report, bp, 'range');
      ctx.audio.fire(e.report.muzzleEnergy_J);
      scope.play(e.report, 2.5 / Math.max(e.report.t_end_s, 1e-4), reduced, e.report.status === 'MUZZLE_EXIT' ? e.report.t_end_s : 0);
      msg.textContent = e.report.status === 'MUZZLE_EXIT' ? '' : e.report.status === 'FIZZLE' ? 'The armature did not leave the launcher. Check the editor for the reason.' : 'A rating failed during the shot. Check the editor for details.';
      for (const f of e.report.failures) msg.textContent += ` ${f.message}`;
      renderChrono();
    }
  });
  const unsubSnap = session.onSnap((s) => {
    snap = s;
    renderMeters();
  });

  let landing: number | null = null;
  function renderBoards(land?: number): void {
    if (land !== undefined) landing = land;
    clear(boardsTable);
    const rows = RANGE.BOARD_DISTANCES_M.map((d) => {
      const r = boards.get(d);
      return h('tr', null,
        h('td', { class: 'num' }, `${d} m`),
        h('td', { class: 'num' }, r ? `${r.y.toFixed(2)} m` : '–'),
        h('td', { class: 'num' }, r ? `${r.x >= 0 ? '+' : ''}${r.x.toFixed(2)} m` : '–'),
        h('td', { class: 'num' }, r ? `${r.speed.toFixed(0)} m/s` : '–'),
        h('td', null, r ? status(r.hit ? 'on' : 'off', r.hit ? 'Hit' : 'Miss') : ''));
    });
    boardsTable.append(h('h3', { style: 'font-size:var(--t-0);margin-bottom:4px' }, 'Target boards'),
      h('table', null, h('thead', null, h('tr', null, h('th', { class: 'num' }, 'Board'), h('th', { class: 'num' }, 'Height'), h('th', { class: 'num' }, 'Offset'), h('th', { class: 'num' }, 'Speed'), h('th', null, 'Result'))), h('tbody', null, ...rows)),
      h('p', { class: 'hint' }, `Bore line is ${GAME.MUZZLE_HEIGHT_M.toFixed(2)} m. Boards are ${RANGE.BOARD_HEIGHT_M} m tall and ${RANGE.BOARD_HALF_WIDTH_M * 2} m wide.`),
      h('p', { class: 'hint num' }, landing !== null ? `Slug landed at ${landing.toFixed(0)} m.` : ''));
  }

  function renderChrono(): void {
    clear(chrono);
    const r = lastReport;
    chrono.append(h('h3', { style: 'font-size:var(--t-0)' }, 'Chronograph'));
    if (!r) {
      chrono.append(h('div', { class: 'muted' }, 'Fire a shot to read the muzzle velocity.'));
      return;
    }
    const v = shots.filter((s) => s.status === 'MUZZLE_EXIT').map((s) => s.muzzleSpeed_m_s);
    const mean = v.reduce((a, b) => a + b, 0) / (v.length || 1);
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length || 1));
    chrono.append(
      h('div', { class: 'readout', style: 'font-size:var(--t-3);line-height:1.1' }, r.status === 'MUZZLE_EXIT' ? `${r.muzzleSpeed_m_s.toFixed(1)} m/s` : 'No exit'),
      h('div', { class: 'cluster' }, h('span', { class: 'num' }, eng(r.muzzleEnergy_J, 'J')), h('span', { class: 'muted' }, 'energy'), h('span', { class: 'num' }, pct(r.efficiency)), h('span', { class: 'muted' }, 'efficiency')),
      h('div', { class: 'hint num' }, `Last ${v.length} shots: mean ${mean.toFixed(1)} m/s, spread ${sd.toFixed(2)} m/s. Peak ${eng(r.I_peak_A, 'A')}.`));
  }

  function renderMeters(): void {
    const me = snap?.players[0];
    if (!me) return;
    const kv = bp.kind === 'railgun' ? bp.banks[0].charge_V : bp.stages[0].charge_V;
    vMeter.set(me.charge.voltage_fraction, `${eng(kv * me.charge.voltage_fraction, 'V')}`);
    tMeter.set(me.heat.hottest_K, `${me.heat.hottest_K.toFixed(0)} K`, !me.heat.canFire);
    cMeter.set(me.charge.stored_J / Math.max(1, me.charge.full_J), eng(me.charge.stored_J, 'J'));
    chargeBar.set(me.charge.voltage_fraction, me.charge.ready ? 'live' : 'on');
    ctx.audio.setCharge(0);
    fireBtn.disabled = !me.heat.canFire;
    fireBtn.className = me.charge.ready && me.heat.canFire ? 'btn armed' : 'btn primary';
  }

  // ---------------------------------------------------------------- drawing
  const c2 = canvas.getContext('2d');
  let raf = 0;
  function draw(): void {
    if (disposed || !c2) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth;
    const hh = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hh * dpr);
    }
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const L = 76, R = 24, B = 64, T = 48;
    const xMax = 440;
    const px = (x: number): number => L + (x / xMax) * (w - L - R);
    const py = (y: number): number => hh - B - (y / maxH) * (hh - T - B);
    const sky = c2.createLinearGradient(0, 0, 0, py(0));
    sky.addColorStop(0, '#A9C8E0');
    sky.addColorStop(1, '#E6EEF2');
    c2.fillStyle = sky;
    c2.fillRect(0, 0, w, hh);
    // hazy hills behind the range
    c2.fillStyle = '#C3D3DD';
    c2.beginPath();
    c2.moveTo(0, py(0));
    for (let x = 0; x <= w; x += 30) c2.lineTo(x, py(0) - 50 - Math.sin(x * 0.007 + 1) * 26 - Math.sin(x * 0.02) * 6);
    c2.lineTo(w, py(0));
    c2.closePath();
    c2.fill();
    // ground
    const gr = c2.createLinearGradient(0, py(0), 0, hh);
    gr.addColorStop(0, W.sandLight);
    gr.addColorStop(1, W.sandDark);
    c2.fillStyle = gr;
    c2.fillRect(0, py(0), w, hh - py(0));
    c2.font = '800 11px "Nunito", system-ui, sans-serif';
    c2.lineWidth = 1;
    c2.strokeStyle = 'rgba(255,255,255,.6)';
    c2.fillStyle = W.ink;
    c2.textAlign = 'center';
    c2.textBaseline = 'top';
    for (let x = 0; x <= xMax; x += 50) {
      c2.beginPath();
      c2.moveTo(Math.round(px(x)) + 0.5, T);
      c2.lineTo(Math.round(px(x)) + 0.5, py(0));
      c2.stroke();
      c2.fillText(`${x}`, px(x), py(0) + 8);
    }
    c2.textAlign = 'right';
    c2.textBaseline = 'middle';
    const ystep = maxH > 40 ? 10 : maxH > 16 ? 5 : maxH > 8 ? 2 : 1;
    for (let y = 0; y <= maxH; y += ystep) {
      c2.beginPath();
      c2.moveTo(L, Math.round(py(y)) + 0.5);
      c2.lineTo(w - R, Math.round(py(y)) + 0.5);
      c2.stroke();
      c2.fillText(`${y}`, L - 10, py(y));
    }
    c2.fillStyle = W.ink;
    c2.textAlign = 'left';
    c2.textBaseline = 'alphabetic';
    // axis titles, and an honest statement of how much the height axis is stretched
    const kx = (w - L - R) / xMax;
    const ky = (hh - T - B) / maxH;
    c2.font = '800 12px "Nunito", system-ui, sans-serif';
    c2.fillStyle = W.ink;
    c2.textAlign = 'center';
    c2.textBaseline = 'alphabetic';
    c2.fillText('Distance from the launcher (m)', L + (w - L - R) / 2, hh - 14);
    c2.save();
    c2.translate(18, T + (py(0) - T) / 2);
    c2.rotate(-Math.PI / 2);
    c2.fillText('Height above ground (m)', 0, 0);
    c2.restore();
    c2.textAlign = 'left';
    const stretch = Math.max(1, Math.round(ky / kx));
    c2.fillText(w < 560 ? `Height stretched ${stretch}×; real slopes are flatter.` : `Height is stretched ${stretch}× so the arc is visible. Real slopes are much flatter.`, L, T - 18);
    // bore line
    c2.setLineDash([6, 6]);
    c2.strokeStyle = 'rgba(38,49,77,.45)';
    c2.lineWidth = 1.5;
    c2.beginPath();
    c2.moveTo(L, py(GAME.MUZZLE_HEIGHT_M));
    c2.lineTo(w - R, py(GAME.MUZZLE_HEIGHT_M));
    c2.stroke();
    c2.setLineDash([]);
    // launcher, drawn small and not to scale
    cannonSide(c2, px(0) + 6, py(0), 3.4, 0.12, 0);
    // boards: post, round target with rings
    let lastLabelX = -1e9;
    for (const d of RANGE.BOARD_DISTANCES_M) {
      const r = boards.get(d);
      const top = py(RANGE.BOARD_HEIGHT_M);
      const bottom = py(0);
      c2.fillStyle = W.woodDark;
      c2.fillRect(px(d) - 3, top, 6, bottom - top);
      c2.fillStyle = W.wood;
      c2.fillRect(px(d) - 3, top, 3, bottom - top);
      const cy = (top + bottom) / 2;
      const rr = Math.min(20, Math.max(9, (bottom - top) / 2));
      for (const [k, col] of [[1, W.fault], [0.7, '#fff'], [0.4, W.fault], [0.16, '#fff']] as const) {
        c2.fillStyle = col;
        c2.beginPath();
        c2.arc(px(d) + 8, cy, rr * k, 0, Math.PI * 2);
        c2.fill();
      }
      c2.fillStyle = W.ink;
      c2.font = '800 12px "Nunito", system-ui, sans-serif';
      c2.textAlign = 'center';
      c2.textBaseline = 'bottom';
      if (px(d) - lastLabelX >= 48) {
        c2.fillText(`${d} m`, px(d), top - 8);
        lastLabelX = px(d);
      }
      if (r) {
        c2.fillStyle = r.hit ? W.ok : W.volt;
        c2.strokeStyle = W.ink;
        c2.lineWidth = 3;
        c2.beginPath();
        c2.arc(px(d), py(r.y), 5, 0, Math.PI * 2);
        c2.stroke();
        c2.fill();
      }
    }
    // tracers
    const now = performance.now();
    for (const tr of tracers) {
      const age = reduced ? tr.duration : Math.min(tr.duration, (now - tr.t0) / 1000);
      const frac = age / Math.max(tr.duration, 1e-6);
      const n = Math.max(2, Math.floor(tr.pts.length * frac));
      c2.lineCap = 'round';
      c2.strokeStyle = tr === tracers[tracers.length - 1] ? W.volt : 'rgba(38,49,77,.4)';
      c2.lineWidth = tr === tracers[tracers.length - 1] ? 4 : 2;
      c2.beginPath();
      for (let i = 0; i < n; i++) (i === 0 ? c2.moveTo(px(tr.pts[i][0]), py(tr.pts[i][1])) : c2.lineTo(px(tr.pts[i][0]), py(tr.pts[i][1])));
      c2.stroke();
    }
    raf = requestAnimationFrame(draw);
  }

  // ---------------------------------------------------------------- layout
  const picker = h('div', { class: 'cluster' }, h('strong', null, bp.name), h('span', { class: 'muted' }, `${bp.kind}, ${eng(analysis.bankEnergy_J, 'J')} stored`));
  const controls = h('div', { class: 'plate', 'data-coach': 'controls' },
    h('div', { class: 'body', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--s2);align-items:end' },
      h('div', { class: 'field' }, h('label', null, 'Elevation'), h('div', { class: 'row' }, elInput, elNum, h('span', { class: 'unit' }, 'mrad'))),
      h('div', { class: 'field' }, h('label', null, 'Charge target'), h('div', { class: 'row' }, chInput, chOut)),
      h('div', { class: 'cluster' }, fireBtn, h('span', { class: 'hint' }, 'or press ', h('span', { class: 'kbd' }, fireKey())), h('button', { class: 'btn', type: 'button', onclick: () => ctx.go({ name: 'editor', id: blueprintId, back: { name: 'range', id: blueprintId } }) }, 'Edit launcher')),
    ), msg);
  const instruments = h('details', { class: 'adv', style: 'grid-column:auto' },
    h('summary', null, 'Instruments'),
    h('div', { style: 'display:block;padding:0 14px 14px' }, h('div', { class: 'stack tight' }, scope.el, h('div', { class: 'meters' }, vMeter.el, cMeter.el, tMeter.el), h('div', null, h('div', { class: 'hint' }, 'Charge'), chargeBar.el))));
  const aside = h('aside', { class: 'range-aside' }, chrono, boardsTable, instruments);
  const bar = h('div', { class: 'range-bar' }, picker, controls);
  const main = h('div', { class: 'range-main' }, stage, bar);
  const screen = h('div', { class: 'range-layout' }, aside, main);
  root.append(screen);
  renderChrono();
  renderBoards();
  scope.show(null);
  raf = requestAnimationFrame(draw);

  let stopCoach: (() => void) | null = null;
  if (tutorial) {
    stopCoach = runCoach({
      sfx: (n) => ctx.audio.sfx(n),
      onDone: () => {
        ctx.profile.data.campaign.tutorialDone = true;
        ctx.profile.touch();
        ctx.profile.flush();
        ctx.go({ name: 'menu' });
      },
      steps: [
        { title: 'Welcome to the practice range', text: 'Your launcher throws a metal slug at target boards. Learn three things here: charge, aim and speed. It takes about a minute.' },
        { target: '[data-coach=controls]', title: '1. Charge, then fire', text: 'Your launcher stores energy in capacitors. Wait until the Charge bar is full, then press Fire (or the key shown). A recharge takes a couple of seconds.' },
        { target: '[data-coach=controls]', title: '2. Aim with elevation', text: 'Gravity pulls the slug down. Raise Elevation a little to reach the far boards. Try 6 to 12 mrad and watch the line on the graph.' },
        { target: '.range-aside', title: '3. Read the result', text: 'Each shot reports speed and where it crossed every board. Faster slugs fly flatter and hit harder. Open Instruments to see the current pulse.' },
        { target: '[data-coach=controls] .btn:not(.primary):not(.armed)', title: 'Make it stronger', text: 'Edit launcher lets you change parts and buy upgrades in the Shop, right there. You can also do it between waves in a real match.' },
        { title: 'You are ready', text: 'Press Play on the menu to defend the keep. Between waves you can upgrade without leaving the game, and if the keep falls you can retry the wave.', next: 'Back to menu' },
      ],
    });
  }

  return () => {
    stopCoach?.();
    disposed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey);
    unsubEv();
    unsubSnap();
    scope.dispose();
    session.close();
    ctx.audio.setCharge(0);
    ctx.profile.flush();
    clear(root);
  };
}
