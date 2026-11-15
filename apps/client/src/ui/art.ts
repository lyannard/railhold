/**
 * World art for Railhold: a soft, hazy toy diorama drawn with Canvas 2D.
 * Shapes are flat-shaded in two or three tones with soft shadows, no outlines in the world
 * (the UI carries the thick ink outlines). Everything here is deterministic for a given seed.
 */

export const W = {
  ink: '#26314D', paper: '#FFF8EA', sky: '#CFE0EE', skyDeep: '#9DBAD2', haze: '#DCE7EE',
  sand: '#EBCB92', sandLight: '#F3DDAE', sandDark: '#D4AB6B', grass: '#8FB852', grassDark: '#6F9A3C', grassLight: '#A9CC6E',
  stone: '#C4C6BF', stoneLight: '#DCDDD6', stoneDark: '#8F938E', wood: '#A56B3B', woodDark: '#7C4C27', woodLight: '#C48650',
  volt: '#FFB000', voltDark: '#D98E00', spark: '#2F9BEA', sparkLight: '#8FD0FF', fault: '#E2483D', ok: '#3FB57F', steel: '#AEB9CA', steelDark: '#76829A', copper: '#C9803F',
} as const;

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a: string, b: string, f: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - f) + ((pb >> 16) & 255) * f);
  const g = Math.round(((pa >> 8) & 255) * (1 - f) + ((pb >> 8) & 255) * f);
  const bl = Math.round((pa & 255) * (1 - f) + (pb & 255) * f);
  return `rgb(${r},${g},${bl})`;
}
export { mix };

export function shadow(g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, a = 0.22): void {
  g.fillStyle = `rgba(38,49,77,${a})`;
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
}

/** Low-poly faceted rock: a lit top-left face, a mid face and a shaded base. */
export function rock(g: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, tone: string = W.stone): void {
  const rnd = rng(seed);
  const n = 7;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
    const rr = r * (0.78 + rnd() * 0.3);
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.78]);
  }
  shadow(g, x + r * 0.1, y + r * 0.62, r * 1.05, r * 0.32, 0.2);
  g.fillStyle = mix(tone, '#26314D', 0.28);
  g.beginPath();
  pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
  g.closePath();
  g.fill();
  const top = pts.slice(0, 5);
  g.fillStyle = tone;
  g.beginPath();
  g.moveTo(x, y - r * 0.05);
  top.forEach((p) => g.lineTo(p[0], p[1] - r * 0.1));
  g.closePath();
  g.fill();
  g.fillStyle = mix(tone, '#FFFFFF', 0.45);
  g.beginPath();
  g.moveTo(x - r * 0.1, y - r * 0.2);
  g.lineTo(pts[3][0], pts[3][1] - r * 0.12);
  g.lineTo(pts[4][0], pts[4][1] - r * 0.12);
  g.lineTo(pts[5][0], pts[5][1] - r * 0.1);
  g.closePath();
  g.fill();
}

/** Stone keep seen from the front. `s` is one unit; the keep is about 8 units wide and 6.5 tall. */
export function keep(g: CanvasRenderingContext2D, x: number, y: number, s: number, flagT = 0): void {
  shadow(g, x + s * 0.8, y + s * 0.15, s * 4.8, s * 0.7, 0.22);
  const wall = (cx: number, w: number, h: number, tone: string): void => {
    g.fillStyle = mix(tone, W.ink, 0.22);
    g.fillRect(cx - w / 2, y - h, w, h);
    g.fillStyle = tone;
    g.fillRect(cx - w / 2, y - h, w * 0.78, h);
    g.fillStyle = mix(tone, '#FFFFFF', 0.35);
    g.fillRect(cx - w / 2, y - h, w * 0.78, s * 0.28);
    // courses of stone
    g.strokeStyle = mix(tone, W.ink, 0.18);
    g.lineWidth = Math.max(1, s * 0.07);
    for (let row = 1; row * s * 0.75 < h - s * 0.4; row++) {
      const yy = y - row * s * 0.75;
      g.beginPath();
      g.moveTo(cx - w / 2, yy);
      g.lineTo(cx + w / 2, yy);
      g.stroke();
    }
    // crenellations
    const n = Math.max(3, Math.round(w / (s * 0.9)) | 1);
    const cw = w / (n * 2 - 1);
    for (let i = 0; i < n; i++) {
      const bx = cx - w / 2 + i * cw * 2;
      g.fillStyle = mix(tone, W.ink, 0.22);
      g.fillRect(bx, y - h - s * 0.5, cw, s * 0.55);
      g.fillStyle = tone;
      g.fillRect(bx, y - h - s * 0.5, cw * 0.78, s * 0.55);
    }
  };
  wall(x, s * 5.2, s * 3.6, W.stone);
  wall(x - s * 3.1, s * 2.2, s * 5.4, W.stoneLight);
  wall(x + s * 3.1, s * 2.2, s * 5.4, W.stoneLight);
  // roofs on the towers
  for (const tx of [x - s * 3.1, x + s * 3.1]) {
    g.fillStyle = W.woodDark;
    g.beginPath();
    g.moveTo(tx - s * 1.35, y - s * 5.9);
    g.lineTo(tx, y - s * 8.1);
    g.lineTo(tx + s * 1.35, y - s * 5.9);
    g.closePath();
    g.fill();
    g.fillStyle = W.woodLight;
    g.beginPath();
    g.moveTo(tx - s * 1.35, y - s * 5.9);
    g.lineTo(tx, y - s * 8.1);
    g.lineTo(tx - s * 0.1, y - s * 5.9);
    g.closePath();
    g.fill();
    g.fillStyle = W.ink;
    g.beginPath();
    g.roundRect(tx - s * 0.22, y - s * 4.1, s * 0.44, s * 0.9, s * 0.2);
    g.fill();
  }
  // gate
  g.fillStyle = W.woodDark;
  g.beginPath();
  g.moveTo(x - s * 0.95, y);
  g.lineTo(x - s * 0.95, y - s * 1.6);
  g.arc(x, y - s * 1.6, s * 0.95, Math.PI, 0);
  g.lineTo(x + s * 0.95, y);
  g.closePath();
  g.fill();
  g.fillStyle = W.wood;
  g.fillRect(x - s * 0.85, y - s * 1.6, s * 0.78, s * 1.6);
  // flag
  const fx = x - s * 3.1;
  const fy = y - s * 8.1;
  g.strokeStyle = W.woodDark;
  g.lineWidth = s * 0.14;
  g.beginPath();
  g.moveTo(fx, fy);
  g.lineTo(fx, fy - s * 1.5);
  g.stroke();
  g.fillStyle = W.volt;
  g.beginPath();
  const wv = Math.sin(flagT * 3) * s * 0.12;
  g.moveTo(fx, fy - s * 1.5);
  g.quadraticCurveTo(fx + s * 0.6, fy - s * 1.6 + wv, fx + s * 1.1, fy - s * 1.35);
  g.quadraticCurveTo(fx + s * 0.6, fy - s * 1.2 - wv, fx, fy - s * 0.95);
  g.closePath();
  g.fill();
}

export type CritterKind = 'walker' | 'plated' | 'swarm' | 'shield' | 'jammer';

export const CRITTER_COLOR: Record<CritterKind, string> = { walker: '#EF7B5C', plated: '#7E8CA8', swarm: '#B8D95A', shield: '#45BDBD', jammer: '#9C5E9A' };

/**
 * A chunky creature. (x, y) is where its feet touch the ground. `u` is its size in pixels.
 * `look` is a unit vector toward what it is walking at; `t` is seconds, for the waddle.
 */
export function critter(g: CanvasRenderingContext2D, x: number, y: number, u: number, kind: CritterKind, t: number, hurt: number, moving = true): void {
  const base = CRITTER_COLOR[kind];
  const bob = moving ? Math.sin(t * 9 + x * 0.05) : 0;
  const lift = kind === 'swarm' ? u * 1.1 : 0;
  shadow(g, x, y + u * 0.05, u * (kind === 'swarm' ? 0.55 : 0.8), u * 0.22, kind === 'swarm' ? 0.16 : 0.24);
  const cy = y - lift - u * 0.8 + bob * u * 0.05;
  const sq = 1 + bob * 0.04;
  // feet
  if (kind !== 'swarm') {
    g.fillStyle = mix(base, W.ink, 0.35);
    const fo = moving ? Math.sin(t * 9 + x * 0.05) * u * 0.18 : 0;
    g.beginPath();
    g.ellipse(x - u * 0.3, y - u * 0.08 + fo * 0.3, u * 0.24, u * 0.14, 0, 0, Math.PI * 2);
    g.ellipse(x + u * 0.3, y - u * 0.08 - fo * 0.3, u * 0.24, u * 0.14, 0, 0, Math.PI * 2);
    g.fill();
  }
  // body
  const bw = u * (kind === 'plated' ? 0.82 : kind === 'swarm' ? 0.62 : 0.7);
  const bh = u * (kind === 'plated' ? 0.82 : kind === 'swarm' ? 0.55 : 0.78) * sq;
  if (kind === 'swarm') {
    const flap = Math.sin(t * 38 + x) * 0.5 + 0.5;
    g.fillStyle = 'rgba(255,255,255,.75)';
    g.beginPath();
    g.ellipse(x - bw * 0.95, cy - bh * 0.55, bw * 0.62, bh * (0.25 + 0.3 * flap), -0.5, 0, Math.PI * 2);
    g.ellipse(x + bw * 0.95, cy - bh * 0.55, bw * 0.62, bh * (0.25 + 0.3 * flap), 0.5, 0, Math.PI * 2);
    g.fill();
  }
  const body = hurt > 0 ? mix(base, '#FFFFFF', Math.min(0.7, hurt)) : base;
  g.fillStyle = mix(base, W.ink, 0.28);
  g.beginPath();
  g.ellipse(x, cy + bh * 0.08, bw, bh, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = body;
  g.beginPath();
  g.ellipse(x - bw * 0.05, cy - bh * 0.02, bw * 0.94, bh * 0.92, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,.38)';
  g.beginPath();
  g.ellipse(x - bw * 0.35, cy - bh * 0.45, bw * 0.34, bh * 0.2, -0.5, 0, Math.PI * 2);
  g.fill();
  // kind specific
  if (kind === 'plated') {
    g.fillStyle = W.stoneDark;
    g.beginPath();
    g.roundRect(x - bw * 0.95, cy - bh * 0.98, bw * 1.9, bh * 0.5, u * 0.14);
    g.fill();
    g.fillStyle = W.stone;
    g.beginPath();
    g.roundRect(x - bw * 0.95, cy - bh * 1.0, bw * 1.9, bh * 0.38, u * 0.14);
    g.fill();
    g.fillStyle = W.stoneDark;
    g.fillRect(x - bw * 0.06, cy - bh * 0.98, bw * 0.12, bh * 0.45);
  } else if (kind === 'jammer') {
    g.strokeStyle = W.steelDark;
    g.lineWidth = Math.max(1.5, u * 0.07);
    g.beginPath();
    g.moveTo(x, cy - bh * 0.85);
    g.lineTo(x, cy - bh * 1.5);
    g.stroke();
    g.fillStyle = W.fault;
    g.beginPath();
    g.arc(x, cy - bh * 1.55, u * 0.14, 0, Math.PI * 2);
    g.fill();
  } else if (kind === 'shield') {
    g.fillStyle = W.steel;
    g.beginPath();
    g.roundRect(x - bw * 1.25, cy - bh * 0.35, bw * 0.55, bh * 1.1, u * 0.12);
    g.fill();
    g.fillStyle = W.sparkLight;
    g.fillRect(x - bw * 1.12, cy - bh * 0.15, bw * 0.28, bh * 0.1);
  }
  // eyes
  const ey = cy - bh * 0.18;
  const ex = bw * 0.36;
  g.fillStyle = '#fff';
  g.beginPath();
  g.ellipse(x - ex, ey, u * 0.17, u * 0.2, 0, 0, Math.PI * 2);
  g.ellipse(x + ex, ey, u * 0.17, u * 0.2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = W.ink;
  g.beginPath();
  g.arc(x - ex, ey + u * 0.06, u * 0.085, 0, Math.PI * 2);
  g.arc(x + ex, ey + u * 0.06, u * 0.085, 0, Math.PI * 2);
  g.fill();
  if (hurt > 0.4) {
    g.strokeStyle = W.ink;
    g.lineWidth = Math.max(1.2, u * 0.06);
    g.beginPath();
    g.moveTo(x - ex - u * 0.12, ey - u * 0.2);
    g.lineTo(x - ex + u * 0.1, ey - u * 0.12);
    g.moveTo(x + ex + u * 0.12, ey - u * 0.2);
    g.lineTo(x + ex - u * 0.1, ey - u * 0.12);
    g.stroke();
  }
}

/** Railgun seen from above: platform, two rails along `ang` (radians, 0 = up the screen), coils, capacitor drums. */
export function cannonTop(g: CanvasRenderingContext2D, x: number, y: number, s: number, ang: number, tint: string, charge: number, t: number): void {
  shadow(g, x, y + s * 0.5, s * 2.1, s * 0.8, 0.22);
  g.fillStyle = W.woodDark;
  g.beginPath();
  g.ellipse(x, y + s * 0.15, s * 1.8, s * 1.25, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = W.wood;
  g.beginPath();
  g.ellipse(x, y - s * 0.05, s * 1.8, s * 1.2, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = tint;
  g.beginPath();
  g.ellipse(x, y - s * 0.05, s * 1.25, s * 0.82, 0, 0, Math.PI * 2);
  g.fill();
  // capacitor drums, rear
  for (const dx of [-0.7, 0.7]) {
    g.fillStyle = W.voltDark;
    g.beginPath();
    g.ellipse(x + dx * s, y + s * 0.18, s * 0.42, s * 0.3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = W.volt;
    g.fillRect(x + dx * s - s * 0.42, y - s * 0.28, s * 0.84, s * 0.46);
    g.beginPath();
    g.ellipse(x + dx * s, y - s * 0.28, s * 0.42, s * 0.3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.45)';
    g.beginPath();
    g.ellipse(x + dx * s - s * 0.1, y - s * 0.32, s * 0.2, s * 0.1, 0, 0, Math.PI * 2);
    g.fill();
  }
  // barrel
  g.save();
  g.translate(x, y - s * 0.35);
  g.rotate(ang);
  const L = s * 4.6;
  const half = s * 0.3;
  for (const side of [-1, 1]) {
    g.fillStyle = W.steelDark;
    g.beginPath();
    g.roundRect(side * half - s * 0.14, -L, s * 0.28, L, s * 0.12);
    g.fill();
    g.fillStyle = W.steel;
    g.beginPath();
    g.roundRect(side * half - s * 0.14, -L, s * 0.16, L, s * 0.08);
    g.fill();
  }
  // glow between the rails scales with charge, coil rings along the barrel
  g.fillStyle = `rgba(143,208,255,${0.25 + 0.65 * charge})`;
  g.fillRect(-half + s * 0.14, -L, half * 2 - s * 0.28, L);
  for (let i = 1; i <= 4; i++) {
    const yy = -L * (i / 5);
    g.fillStyle = W.copper;
    g.beginPath();
    g.roundRect(-half - s * 0.28, yy - s * 0.12, half * 2 + s * 0.56, s * 0.24, s * 0.1);
    g.fill();
  }
  if (charge >= 0.999) {
    g.fillStyle = W.volt;
    g.beginPath();
    g.arc(0, -L - s * 0.1 + Math.sin(t * 14) * s * 0.04, s * 0.2, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Railgun in side view for the title scene. */
export function cannonSide(g: CanvasRenderingContext2D, x: number, y: number, s: number, ang: number, t: number): void {
  shadow(g, x + s * 0.5, y + s * 0.1, s * 5, s * 0.55, 0.22);
  // wheels and carriage
  g.fillStyle = W.woodDark;
  g.beginPath();
  g.roundRect(x - s * 3.2, y - s * 1.5, s * 6.4, s * 1.1, s * 0.3);
  g.fill();
  g.fillStyle = W.wood;
  g.beginPath();
  g.roundRect(x - s * 3.2, y - s * 1.65, s * 6.4, s * 0.95, s * 0.3);
  g.fill();
  for (const wx of [-2.2, 2.2]) {
    g.fillStyle = W.woodDark;
    g.beginPath();
    g.arc(x + wx * s, y - s * 0.55, s * 0.95, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = W.woodLight;
    g.beginPath();
    g.arc(x + wx * s, y - s * 0.55, s * 0.68, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = W.woodDark;
    g.beginPath();
    g.arc(x + wx * s, y - s * 0.55, s * 0.2, 0, Math.PI * 2);
    g.fill();
  }
  // capacitor bank
  for (let i = 0; i < 3; i++) {
    const cx = x - s * 2.5 + i * s * 0.95;
    g.fillStyle = W.voltDark;
    g.beginPath();
    g.roundRect(cx - s * 0.4, y - s * 3.2, s * 0.8, s * 1.7, s * 0.25);
    g.fill();
    g.fillStyle = W.volt;
    g.beginPath();
    g.roundRect(cx - s * 0.4, y - s * 3.2, s * 0.55, s * 1.7, s * 0.25);
    g.fill();
    g.fillStyle = W.steelDark;
    g.fillRect(cx - s * 0.15, y - s * 3.45, s * 0.3, s * 0.3);
  }
  // barrel
  g.save();
  g.translate(x - s * 0.4, y - s * 2.2);
  g.rotate(-ang);
  const L = s * 8.2;
  g.fillStyle = W.steelDark;
  g.beginPath();
  g.roundRect(0, -s * 0.5, L, s * 0.95, s * 0.35);
  g.fill();
  g.fillStyle = W.steel;
  g.beginPath();
  g.roundRect(0, -s * 0.5, L, s * 0.5, s * 0.25);
  g.fill();
  g.fillStyle = 'rgba(143,208,255,.9)';
  g.fillRect(s * 0.4, -s * 0.12, L - s * 0.9, s * 0.2);
  for (let i = 1; i <= 5; i++) {
    const cx = (L * i) / 6;
    g.fillStyle = W.copper;
    g.beginPath();
    g.roundRect(cx - s * 0.2, -s * 0.8, s * 0.4, s * 1.55, s * 0.18);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)';
    g.fillRect(cx - s * 0.12, -s * 0.72, s * 0.1, s * 1.3);
  }
  const pulse = 0.5 + 0.5 * Math.sin(t * 5);
  g.fillStyle = `rgba(255,176,0,${0.55 + 0.4 * pulse})`;
  g.beginPath();
  g.arc(L + s * 0.15, -s * 0.05, s * 0.3 + s * 0.1 * pulse, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

export function cloud(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.beginPath();
  g.ellipse(x, y, s * 1.7, s * 0.55, 0, 0, Math.PI * 2);
  g.ellipse(x - s * 0.7, y - s * 0.3, s * 0.8, s * 0.6, 0, 0, Math.PI * 2);
  g.ellipse(x + s * 0.35, y - s * 0.45, s * 1.0, s * 0.75, 0, 0, Math.PI * 2);
  g.fill();
}

/** Full title backdrop. Call every frame with t in seconds; it is cheap enough for that. */
export function titleScene(g: CanvasRenderingContext2D, w: number, h: number, t: number): void {
  const hz = h * 0.5;
  const sky = g.createLinearGradient(0, 0, 0, hz + 40);
  sky.addColorStop(0, '#A9C8E0');
  sky.addColorStop(1, '#E6EEF2');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, hz + 40);
  const u = Math.max(0.55, Math.min(1.25, w / 1280));
  for (const [cx, cy, cs, sp] of [[0.12, 0.14, 46, 6], [0.5, 0.08, 34, 4], [0.78, 0.2, 56, 5], [0.95, 0.1, 30, 7]] as const) {
    cloud(g, ((cx * w + t * sp) % (w + 240)) - 120, cy * h, cs * u);
  }
  // hazy far hills and a far castle line
  g.fillStyle = '#C3D3DD';
  g.beginPath();
  g.moveTo(0, hz);
  for (let x = 0; x <= w; x += 40) g.lineTo(x, hz - 40 * u - Math.sin(x * 0.006 + 1) * 28 * u - Math.sin(x * 0.017) * 8 * u);
  g.lineTo(w, hz + 40);
  g.lineTo(0, hz + 40);
  g.closePath();
  g.fill();
  g.globalAlpha = 0.55;
  keep(g, w * 0.66, hz - 6 * u, 16 * u);
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(207,224,238,.55)';
  g.fillRect(0, hz - 140 * u, w, 160 * u);
  g.fillStyle = '#B5CDC0';
  g.beginPath();
  g.moveTo(0, hz + 10);
  for (let x = 0; x <= w; x += 40) g.lineTo(x, hz - 14 * u - Math.sin(x * 0.01 + 3) * 16 * u);
  g.lineTo(w, hz + 50);
  g.lineTo(0, hz + 50);
  g.closePath();
  g.fill();
  // ground
  const gr = g.createLinearGradient(0, hz, 0, h);
  gr.addColorStop(0, '#E8D4A4');
  gr.addColorStop(0.55, W.sand);
  gr.addColorStop(1, W.sandDark);
  g.fillStyle = gr;
  g.fillRect(0, hz, w, h - hz);
  // grass bank, right
  g.fillStyle = W.grass;
  g.beginPath();
  g.moveTo(w, hz + 30 * u);
  g.bezierCurveTo(w * 0.8, hz + 40 * u, w * 0.74, h * 0.72, w * 0.84, h);
  g.lineTo(w, h);
  g.closePath();
  g.fill();
  g.fillStyle = W.grassLight;
  g.beginPath();
  g.moveTo(w, hz + 30 * u);
  g.bezierCurveTo(w * 0.8, hz + 40 * u, w * 0.77, h * 0.7, w * 0.86, h * 0.95);
  g.lineTo(w, h * 0.95);
  g.closePath();
  g.globalAlpha = 0.4;
  g.fill();
  g.globalAlpha = 1;
  // near keep on the left
  keep(g, w * 0.17, hz + 70 * u, 20 * u, t);
  // creatures marching toward the keep, small and hazy by distance
  const kinds: CritterKind[] = ['walker', 'swarm', 'plated', 'walker', 'shield', 'jammer'];
  for (let i = 0; i < 6; i++) {
    const p = ((t * 0.035 + i * 0.17) % 1);
    const px = w * (0.95 - p * 0.62);
    const py = hz + 50 * u + (i % 3) * 24 * u + p * 40 * u;
    critter(g, px, py, (15 + (i % 3) * 3) * u, kinds[i], t + i, 0);
  }
  // foreground rocks
  const r = rng(11);
  const rockSet: Array<[number, number, number]> = [[0.04, 0.9, 70], [0.12, 0.96, 58], [0.2, 0.9, 40], [0.9, 0.93, 52], [0.97, 0.88, 44], [0.55, 0.96, 38]];
  rockSet.forEach(([rx, ry, rs], i) => rock(g, rx * w, ry * h, rs * u, 100 + i + Math.floor(r() * 3)));
  cannonSide(g, w * 0.8, h * 0.84, 20 * u, 0.42 + Math.sin(t * 0.6) * 0.03, t);
  // near haze
  const fog = g.createLinearGradient(0, hz - 60, 0, hz + 120);
  fog.addColorStop(0, 'rgba(230,238,242,0)');
  fog.addColorStop(0.5, 'rgba(230,238,242,.35)');
  fog.addColorStop(1, 'rgba(230,238,242,0)');
  g.fillStyle = fog;
  g.fillRect(0, hz - 60, w, 180);
}
