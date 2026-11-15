type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | null | undefined>;

/** Create an element. `on*` attributes are event listeners, `class` sets the class list, booleans toggle attributes. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of kids) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...kids: Array<Node | string>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids) el.append(c);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Engineering notation with a fixed number of significant digits. */
export function eng(value: number, unit: string, digits = 3): string {
  if (!Number.isFinite(value)) return `– ${unit}`;
  if (value === 0) return `0 ${unit}`;
  const prefixes = [
    [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'],
  ] as const;
  const a = Math.abs(value);
  for (const [f, p] of prefixes) {
    if (a >= f * 0.9995) {
      const v = value / f;
      const dec = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(v))));
      return `${v.toFixed(Math.min(dec, 6))} ${p}${unit}`;
    }
  }
  return `${value.toExponential(2)} ${unit}`;
}

export function pct(x: number, d = 1): string {
  return `${(x * 100).toFixed(d)} %`;
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
