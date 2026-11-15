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
    const r = el.getBoundingClientRect();
    ring.hidden = false;
    ring.style.cssText = `left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px`;
    const cw = Math.min(340, window.innerWidth - 24);
    const left = Math.max(12, Math.min(window.innerWidth - cw - 12, r.left + r.width / 2 - cw / 2));
    const below = r.bottom + 14 + 170 < window.innerHeight;
    card.style.cssText = `left:${left}px;width:${cw}px;${below ? `top:${r.bottom + 14}px` : `bottom:${window.innerHeight - r.top + 14}px`}`;
  };

  const finish = (skipped: boolean): void => {
    if (closed) return;
    closed = true;
    window.removeEventListener('resize', place);
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
    place();
  };
  window.addEventListener('resize', place);
  show();
  return () => finish(true);
}
