import { clear, h } from '../dom.ts';

export interface CoachStep {
  /** CSS selector of the element to point at. Omit for a centred card. */
  target?: string;
  title: string;
  text: string;
  /** Label of the forward button. Defaults to "Next". */
  next?: string;
}

export interface CoachOpts {
  steps: CoachStep[];
  onDone(skipped: boolean): void;
  sfx?(name: 'click' | 'confirm'): void;
}

/**
 * A short guided tour: a ring around the thing being explained and one small card.
 * Never blocks the page (clicks pass through the dim layer) and can be skipped at any step.
 */
export function runCoach(opts: CoachOpts): () => void {
  const layer = h('div', { class: 'coach', role: 'dialog', 'aria-label': 'Quick tutorial' });
  const ring = h('div', { class: 'coach-ring', hidden: true });
  const card = h('div', { class: 'coach-card' });
  layer.append(ring, card);
  document.body.append(layer);
  let i = 0;
  let closed = false;

  const place = (): void => {
    if (closed) return;
    const step = opts.steps[i];
    const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    if (!el) {
      ring.hidden = true;
      card.style.cssText = '';
      card.classList.add('center');
      return;
    }
    card.classList.remove('center');
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const vh = window.innerHeight;
    const r = el.getBoundingClientRect();
    ring.hidden = false;
    ring.style.cssText = `left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px`;
    const cw = Math.min(340, vw - 16);
    const left = Math.max(8, Math.min(vw - cw - 8, r.left + r.width / 2 - cw / 2));
    card.style.cssText = `left:${left}px;width:${cw}px;top:0;visibility:hidden`;
    const ch = card.offsetHeight;
    let top: number;
    let x = left;
    if (r.bottom + 14 + ch <= vh - 8) top = r.bottom + 14;
    else if (r.top - 14 - ch >= 8) top = r.top - 14 - ch;
    else if (vw - r.right - 14 >= cw + 8) {
      x = r.right + 14; // beside the target, on the right
      top = r.top + r.height / 2 - ch / 2;
    } else if (r.left - 14 >= cw + 8) {
      x = r.left - 14 - cw; // beside the target, on the left
      top = r.top + r.height / 2 - ch / 2;
    } else top = r.top + r.height / 2 > vh / 2 ? 8 : vh - ch - 8; // no room anywhere: dock at the far screen edge
    top = Math.max(8, Math.min(vh - ch - 8, top));
    card.style.cssText = `left:${x}px;width:${cw}px;top:${top}px`;
  };

  const reveal = (): void => {
    const step = opts.steps[i];
    const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      const tall = r.height > window.innerHeight * 0.55;
      try {
        el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest' });
      } catch {
        /* old browsers: the card still docks on screen */
      }
    }
    place();
  };

  const finish = (skipped: boolean): void => {
    if (closed) return;
    closed = true;
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    layer.remove();
    opts.onDone(skipped);
  };

  const show = (): void => {
    const step = opts.steps[i];
    clear(card);
    const last = i === opts.steps.length - 1;
    card.append(
      h('div', { class: 'coach-count' }, `Step ${i + 1} of ${opts.steps.length}`),
      h('h3', null, step.title),
      h('p', null, step.text),
      h('div', { class: 'spread' },
        h('button', { class: 'btn quiet small', type: 'button', onclick: () => finish(true) }, 'Skip tutorial'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => { opts.sfx?.('confirm'); if (last) finish(false); else { i++; show(); } } }, step.next ?? (last ? 'Done' : 'Next'))));
    reveal();
  };
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  show();
  return () => finish(true);
}
