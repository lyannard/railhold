import type { ShotReport } from '@railhold/engine';
import { clamp, eng, h, s } from '../dom.ts';

export const COLORS = {
  porcelain: '#FFF8EA', graphite: '#26314D', aluminum: '#55607C', slate: '#55607C', amber: '#FFB000', fault: '#E2483D', copper: '#A56B3B', glass: '#0F1A17', trace: '#6FD08C', line: 'rgba(38,49,77,0.16)', plate: '#FFF8EA',
  ink: '#26314D', paper: '#FFF8EA', volt: '#FFB000', spark: '#2F9BEA', ok: '#3FB57F',
} as const;

export type IconName = 'lamp' | 'warn' | 'lock' | 'check' | 'bolt' | 'clock' | 'cross' | 'arrow' | 'plug' | 'play' | 'users' | 'target' | 'wrench' | 'book' | 'gear' | 'info' | 'home';

/** Small inline icons, rounded and chunky to match the UI. Status is always an icon plus words, never colour alone. */
export function icon(name: IconName, size = 16): SVGSVGElement {
  const svg = s('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
  const p = (d: string, extra: Record<string, string | number> = {}): void => void svg.append(s('path', { d, ...extra }));
  switch (name) {
    case 'lamp': svg.append(s('circle', { cx: 8, cy: 8, r: 4.5, fill: 'currentColor', stroke: COLORS.graphite })); break;
    case 'warn': p('M8 2 L15 14 H1 Z'); p('M8 6.5 V10'); p('M8 12 V12.2'); break;
    case 'lock': svg.append(s('rect', { x: 3, y: 7, width: 10, height: 7, rx: 2 })); p('M5 7 V5 a3 3 0 0 1 6 0 V7'); break;
    case 'check': p('M2.5 8.5 L6.5 12.5 L13.5 3.5'); break;
    case 'bolt': p('M9 1 L3 9 H8 L7 15 L13 7 H8 Z', { fill: 'currentColor' }); break;
    case 'clock': svg.append(s('circle', { cx: 8, cy: 8, r: 6 })); p('M8 4 V8 L11 10'); break;
    case 'cross': p('M3 3 L13 13 M13 3 L3 13'); break;
    case 'arrow': p('M2 8 H13 M9 4 L13 8 L9 12'); break;
    case 'plug': p('M5 1 V5 M11 1 V5'); svg.append(s('rect', { x: 3, y: 5, width: 10, height: 4, rx: 1.5 })); p('M8 9 V15'); break;
    case 'play': p('M4.5 2.5 L13 8 L4.5 13.5 Z', { fill: 'currentColor' }); break;
    case 'users': svg.append(s('circle', { cx: 6, cy: 5.5, r: 2.5 })); p('M1.5 14 a4.5 4.5 0 0 1 9 0'); svg.append(s('circle', { cx: 11.5, cy: 6.5, r: 2 })); p('M11.5 10 a3.8 3.8 0 0 1 3.5 4'); break;
    case 'target': svg.append(s('circle', { cx: 8, cy: 8, r: 6 })); svg.append(s('circle', { cx: 8, cy: 8, r: 2.2, fill: 'currentColor' })); break;
    case 'wrench': p('M10.5 2.5 a3.5 3.5 0 0 0 -3.2 4.8 L2 12.6 3.4 14 8.7 8.7 a3.5 3.5 0 0 0 4.8 -3.2 l-2 2 -2 -.6 -.6 -2 z'); break;
    case 'book': p('M2 3 H7 a1 1 0 0 1 1 1 V14 a1 1 0 0 0 -1 -1 H2 Z M14 3 H9 a1 1 0 0 0 -1 1 V14 a1 1 0 0 1 1 -1 H14 Z'); break;
    case 'gear': svg.append(s('circle', { cx: 8, cy: 8, r: 2.5 })); p('M8 1.5 V3.5 M8 12.5 V14.5 M1.5 8 H3.5 M12.5 8 H14.5 M3.4 3.4 L4.8 4.8 M11.2 11.2 L12.6 12.6 M12.6 3.4 L11.2 4.8 M4.8 11.2 L3.4 12.6'); break;
    case 'info': svg.append(s('circle', { cx: 8, cy: 8, r: 6 })); p('M8 7.5 V11'); p('M8 5 V5.2'); break;
    case 'home': p('M2 8 L8 2.5 L14 8 M3.5 7 V13.5 H12.5 V7'); break;
  }
  return svg;
}

export function status(kind: 'on' | 'off' | 'fault', text: string): HTMLElement {
  const ic = kind === 'fault' ? icon('warn', 14) : kind === 'on' ? icon('lamp', 12) : icon('lamp', 12);
  const wrap = h('span', { class: 'status' }, ic, text);
  if (kind === 'on') (ic as SVGElement).style.color = COLORS.amber;
  else if (kind === 'fault') (ic as SVGElement).style.color = COLORS.fault;
  else (ic as SVGElement).style.color = COLORS.porcelain;
  return wrap;
}

// ------------------------------------------------------------------ scope

export interface ScopeSeries {
  x: readonly number[];
  y: readonly number[];
}

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/**
 * Oscilloscope: graphite bezel, glass screen, graticule, current trace with a persistence trail.
 * `play` replays a trace in slow motion; each frame fades the previous ones so the head leaves a trail.
 */
export class Scope {
  readonly el: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly cap: HTMLElement;
  private readonly capL: HTMLElement;
  private readonly capR: HTMLElement;
  private raf = 0;
  private trace: ScopeSeries | null = null;
  private vel: ScopeSeries | null = null;
  private readonly aspect: number;

  constructor(aspect = 0.58, label = 'Rail current') {
    this.aspect = aspect;
    this.canvas = h('canvas', { role: 'img', 'aria-label': `${label} against time` });
    this.capL = h('span', null, label);
    this.capR = h('span', null, '');
    this.cap = h('div', { class: 'cap' }, this.capL, this.capR);
    this.el = h('div', { class: 'bezel dark' }, this.canvas, this.cap);
  }

  private size(): { w: number; h: number; dpr: number } {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(200, Math.round(this.canvas.clientWidth || 340));
    const hh = Math.round(w * this.aspect);
    if (this.canvas.width !== w * dpr || this.canvas.height !== hh * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = hh * dpr;
      this.canvas.style.height = `${hh}px`;
    }
    return { w, h: hh, dpr };
  }

  private frame(
    ctx: CanvasRenderingContext2D, w: number, hh: number, tMax: number, yMax: number,
  ): { px: (t: number) => number; py: (v: number) => number } {
    const L = 44, R = 8, T = 8, B = 20;
    ctx.fillStyle = COLORS.glass;
    ctx.fillRect(0, 0, w, hh);
    ctx.lineWidth = 1;
    ctx.font = '10px "B612", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(111,208,140,0.75)';
    ctx.strokeStyle = 'rgba(111,208,140,0.18)';
    const px = (t: number): number => L + (t / tMax) * (w - L - R);
    const py = (v: number): number => hh - B - (v / yMax) * (hh - T - B);
    const ys = niceStep(yMax, 4);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let v = 0; v <= yMax * 1.001; v += ys) {
      ctx.beginPath();
      ctx.moveTo(L, Math.round(py(v)) + 0.5);
      ctx.lineTo(w - R, Math.round(py(v)) + 0.5);
      ctx.stroke();
      ctx.fillText(eng(v, 'A', 2).replace(' ', ''), L - 4, py(v));
    }
    const xs = niceStep(tMax, 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (let t = 0; t <= tMax * 1.001; t += xs) {
      ctx.beginPath();
      ctx.moveTo(Math.round(px(t)) + 0.5, T);
      ctx.lineTo(Math.round(px(t)) + 0.5, hh - B);
      ctx.stroke();
      ctx.fillText(eng(t, 's', 2).replace(' ', ''), px(t), hh - B + 4);
    }
    return { px, py };
  }

  /** Draw a finished trace, with muzzle-exit time marked. */
  show(report: ShotReport | null, exitT_s?: number): void {
    cancelAnimationFrame(this.raf);
    this.trace = report ? { x: report.trace.t_s, y: report.trace.I_A } : null;
    this.vel = report ? { x: report.trace.t_s, y: report.trace.v_m_s } : null;
    this.draw(1, exitT_s);
  }

  private draw(progress: number, exitT_s?: number): void {
    const { w, h: hh, dpr } = this.size();
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tr = this.trace;
    if (!tr || tr.x.length < 2) {
      this.frame(ctx, w, hh, 1e-3, 1000);
      ctx.fillStyle = 'rgba(111,208,140,0.75)';
      ctx.textAlign = 'center';
      ctx.fillText('No trace yet', w / 2, hh / 2);
      this.capR.textContent = '';
      return;
    }
    const tMax = tr.x[tr.x.length - 1];
    const yMax = Math.max(...tr.y) * 1.1 || 1;
    const { px, py } = this.frame(ctx, w, hh, tMax, yMax);
    const n = Math.max(2, Math.floor(tr.x.length * progress));
    ctx.strokeStyle = COLORS.trace;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < n; i++) (i === 0 ? ctx.moveTo(px(tr.x[i]), py(tr.y[i])) : ctx.lineTo(px(tr.x[i]), py(tr.y[i])));
    ctx.stroke();
    if (exitT_s !== undefined && exitT_s > 0) {
      ctx.strokeStyle = 'rgba(111,208,140,0.6)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px(exitT_s), 8);
      ctx.lineTo(px(exitT_s), hh - 20);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(111,208,140,0.85)';
      ctx.textAlign = 'left';
      ctx.fillText('muzzle exit', px(exitT_s) + 4, 14);
    }
    const peak = Math.max(...tr.y);
    this.capR.textContent = `peak ${eng(peak, 'A')}  ·  ${eng(tMax, 's')}`;
  }

  /** Replay the trace at `slow` times real time (a 1 ms shot takes slow ms on screen). */
  play(report: ShotReport, slow: number, reduced: boolean, exitT_s?: number): void {
    cancelAnimationFrame(this.raf);
    this.trace = { x: report.trace.t_s, y: report.trace.I_A };
    if (reduced) {
      this.draw(1, exitT_s);
      return;
    }
    const total = Math.max(0.4, report.t_end_s * slow);
    const t0 = performance.now();
    const step = (): void => {
      const p = clamp((performance.now() - t0) / 1000 / total, 0, 1);
      this.drawTrail(p, exitT_s);
      if (p < 1) this.raf = requestAnimationFrame(step);
      else this.draw(1, exitT_s);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** Persistence: draw the whole trace dimmed, then the part reached so far at full brightness. */
  private drawTrail(progress: number, exitT_s?: number): void {
    const { w, h: hh, dpr } = this.size();
    const ctx = this.canvas.getContext('2d');
    const tr = this.trace;
    if (!ctx || !tr) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tMax = tr.x[tr.x.length - 1];
    const yMax = Math.max(...tr.y) * 1.1 || 1;
    const { px, py } = this.frame(ctx, w, hh, tMax, yMax);
    const n = Math.max(2, Math.floor(tr.x.length * progress));
    const trail = 24;
    const from = Math.max(0, n - trail);
    ctx.lineWidth = 2;
    for (let i = 1; i < n; i++) {
      const age = i < from ? 0.14 : 0.14 + 0.86 * ((i - from) / trail);
      ctx.strokeStyle = `rgba(111,208,140,${age.toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(px(tr.x[i - 1]), py(tr.y[i - 1]));
      ctx.lineTo(px(tr.x[i]), py(tr.y[i]));
      ctx.stroke();
    }
    if (exitT_s !== undefined && exitT_s > 0 && tr.x[n - 1] >= exitT_s) {
      ctx.strokeStyle = 'rgba(111,208,140,0.6)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px(exitT_s), 8);
      ctx.lineTo(px(exitT_s), hh - 20);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    this.capR.textContent = `t ${eng(tr.x[n - 1], 's')}  ·  v ${this.vel ? (this.vel.y[n - 1] ?? 0).toFixed(0) : '0'} m/s`;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
  }
}

// ------------------------------------------------------------------ meters

export interface NeedleMeter {
  el: HTMLElement;
  set(value: number, text: string, danger?: boolean): void;
}

/** Needle panel meter on a 240 degree arc. The needle settles with a short ease unless motion is reduced. */
export function needleMeter(label: string, min: number, max: number, reduced: boolean): NeedleMeter {
  const W = 120;
  const cx = 60, cy = 62, r = 46;
  const a0 = (150 * Math.PI) / 180;
  const sweep = (240 * Math.PI) / 180;
  const pt = (f: number, rr: number): [number, number] => [cx + Math.cos(a0 + f * sweep) * rr, cy + Math.sin(a0 + f * sweep) * rr];
  const svg = s('svg', { viewBox: `0 0 ${W} 96`, role: 'img', 'aria-label': label });
  const arc = (f0: number, f1: number, rr: number, stroke: string, wd: number): SVGElement => {
    const [x0, y0] = pt(f0, rr);
    const [x1, y1] = pt(f1, rr);
    return s('path', { d: `M${x0} ${y0} A${rr} ${rr} 0 ${(f1 - f0) * 240 > 180 ? 1 : 0} 1 ${x1} ${y1}`, fill: 'none', stroke, 'stroke-width': wd });
  };
  svg.append(arc(0, 1, r, COLORS.aluminum, 2));
  for (let i = 0; i <= 10; i++) {
    const [x0, y0] = pt(i / 10, r - 2);
    const [x1, y1] = pt(i / 10, r + (i % 5 === 0 ? 6 : 3));
    svg.append(s('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: COLORS.slate, 'stroke-width': i % 5 === 0 ? 1.6 : 1 }));
  }
  const needle = s('line', { x1: cx, y1: cy, x2: pt(0, r - 6)[0], y2: pt(0, r - 6)[1], stroke: COLORS.graphite, 'stroke-width': 2, 'stroke-linecap': 'round' });
  svg.append(needle, s('circle', { cx, cy, r: 4, fill: COLORS.graphite }));
  const val = h('div', { class: 'val' }, '–');
  const el = h('div', { class: 'meter' }, svg, val, h('div', { class: 'lbl' }, label));
  let shown = 0;
  let target = 0;
  let raf = 0;
  const apply = (f: number): void => {
    const [x, y] = pt(clamp(f, 0, 1), r - 6);
    needle.setAttribute('x2', String(x));
    needle.setAttribute('y2', String(y));
  };
  return {
    el,
    set(value, text, danger = false) {
      target = clamp((value - min) / (max - min), 0, 1);
      val.textContent = text;
      val.style.fontWeight = danger ? '700' : '400';
      if (reduced) {
        shown = target;
        apply(shown);
        return;
      }
      cancelAnimationFrame(raf);
      const tick = (): void => {
        shown += (target - shown) * 0.25;
        apply(shown);
        if (Math.abs(target - shown) > 0.002) raf = requestAnimationFrame(tick);
        else apply(target);
      };
      raf = requestAnimationFrame(tick);
    },
  };
}

/** Segmented bar. `live` segments are amber (energised), `bad` segments are fault red. */
export function segBar(n: number): { el: HTMLElement; set(frac: number, mode?: 'on' | 'live' | 'bad'): void } {
  const segs = Array.from({ length: n }, () => h('i'));
  const el = h('div', { class: 'segbar', role: 'presentation' }, ...segs);
  return {
    el,
    set(frac, mode = 'on') {
      const k = Math.round(clamp(frac, 0, 1) * n);
      segs.forEach((sg, i) => {
        sg.className = i < k ? mode : '';
      });
    },
  };
}

// ------------------------------------------------------------------ energy ledger

export interface LedgerSlice {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function ledgerSlices(l: ShotReport['ledger']): LedgerSlice[] {
  const rest = Math.max(0, l.E_cap_end_J);
  return [
    { key: 'ke', label: 'Projectile kinetic energy gained', value: Math.max(0, l.KE_J - l.KE0_J), color: COLORS.amber },
    { key: 'ohm', label: 'Heat in conductors', value: l.E_ohm_J, color: COLORS.copper },
    { key: 'drop', label: 'Switch drop and clamp', value: l.E_drop_J, color: COLORS.slate },
    { key: 'dump', label: 'Magnetic energy dumped at the muzzle', value: l.E_muzzle_dump_J, color: COLORS.aluminum },
    { key: 'fric', label: 'Friction', value: l.E_fric_J, color: '#C9CDD0' },
    { key: 'fail', label: 'Lost to failures', value: l.E_fail_J, color: COLORS.fault },
    { key: 'rest', label: 'Left in capacitors', value: rest, color: COLORS.porcelain },
  ];
}

/** Stacked bar plus a key with exact joules. The pieces add up to the bank energy within the 0.1 % ledger check. */
export function ledgerBar(l: ShotReport['ledger']): HTMLElement {
  const slices = ledgerSlices(l);
  const total = slices.reduce((a, b) => a + b.value, 0) || 1;
  const bar = h('div', { class: 'ledger', role: 'img', 'aria-label': 'Where the stored energy went' });
  for (const sl of slices) {
    const seg = h('i');
    seg.style.width = `${(sl.value / total) * 100}%`;
    seg.style.background = sl.color;
    if (sl.value / total > 0.0005) bar.append(seg);
  }
  const key = h('div', { class: 'ledger-key' });
  for (const sl of slices) {
    if (sl.value <= 0) continue;
    const sw = h('span', { class: 'sw' });
    sw.style.background = sl.color;
    key.append(h('div', null, sw, h('span', null, sl.label), h('span', { class: 'num' }, eng(sl.value, 'J')), h('span', { class: 'num muted' }, `${((sl.value / total) * 100).toFixed(1)} %`)));
  }
  return h('div', null, bar, key);
}

// ------------------------------------------------------------------ plain line plot

export interface PlotSeries {
  x: readonly number[];
  y: readonly number[];
  color: string;
  label: string;
}

/** Minimal line plot with axes and a legend. Used where a debrief or logbook needs a graph. */
export function plot(canvas: HTMLCanvasElement, series: PlotSeries[], xLabel: string, yUnit: string): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(240, canvas.clientWidth || 400);
  const hh = Math.max(160, canvas.clientHeight || 200);
  canvas.width = w * dpr;
  canvas.height = hh * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = COLORS.plate;
  ctx.fillRect(0, 0, w, hh);
  const L = 56, R = 12, T = 22, B = 30;
  const xMax = Math.max(...series.flatMap((q) => q.x), 1e-9);
  const yMax = Math.max(...series.flatMap((q) => q.y), 1e-9) * 1.08;
  const px = (x: number): number => L + (x / xMax) * (w - L - R);
  const py = (y: number): number => hh - B - (y / yMax) * (hh - T - B);
  ctx.font = '11px "B612", system-ui, sans-serif';
  ctx.strokeStyle = COLORS.line;
  ctx.fillStyle = COLORS.slate;
  ctx.lineWidth = 1;
  const ys = niceStep(yMax, 4);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= yMax; v += ys) {
    ctx.beginPath();
    ctx.moveTo(L, Math.round(py(v)) + 0.5);
    ctx.lineTo(w - R, Math.round(py(v)) + 0.5);
    ctx.stroke();
    ctx.fillText(eng(v, yUnit, 2).replace(' ', ''), L - 6, py(v));
  }
  const xs = niceStep(xMax, 5);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let x = 0; x <= xMax * 1.001; x += xs) ctx.fillText(eng(x, xLabel, 2).replace(' ', ''), px(x), hh - B + 6);
  let lx = L;
  for (const q of series) {
    ctx.strokeStyle = q.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    q.x.forEach((x, i) => (i === 0 ? ctx.moveTo(px(x), py(q.y[i])) : ctx.lineTo(px(x), py(q.y[i]))));
    ctx.stroke();
    ctx.fillStyle = q.color;
    ctx.fillRect(lx, 6, 14, 3);
    ctx.fillStyle = COLORS.graphite;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(q.label, lx + 20, 8);
    lx += 28 + ctx.measureText(q.label).width + 12;
  }
}
