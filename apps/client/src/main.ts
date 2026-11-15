import type { AppCtx, Route } from './app-ctx.ts';
import { Audio } from './audio.ts';
import { clear, h } from './dom.ts';
import { Profile, type SaveState } from './profile.ts';
import type { Session } from './session.ts';
import { mountEditor } from './ui/editor.ts';
import { mountPlay } from './ui/play.ts';
import { mountRange } from './ui/range.ts';
import { mountLogbook, mountMenu, mountNotes, mountSettings, mountWelcome, mountWorkshop } from './ui/screens.ts';
import { icon } from './ui/widgets.ts';
import { titleScene } from './ui/art.ts';

const app = document.getElementById('app') as HTMLElement;
const audio = new Audio();
let profile: Profile | null = null;
let dispose: (() => void) | null = null;
let current: Route = { name: 'welcome' };
let previousForNotes: Route = { name: 'menu' };
let navToken = 0;
const joinParam = new URLSearchParams(location.search).get('join');

const topbar = h('header', { class: 'topbar' });
const body = h('main', { class: 'screen', id: 'main' });
const bg = h('canvas', { class: 'scene', 'aria-hidden': 'true' }) as HTMLCanvasElement;
bg.style.position = 'fixed';
app.append(bg, topbar, body);
let bgRaf = 0;
function setScene(on: boolean): void {
  cancelAnimationFrame(bgRaf);
  bg.style.display = on ? 'block' : 'none';
  if (!on) return;
  const g = bg.getContext('2d');
  if (!g) return;
  const t0 = performance.now();
  let last = 0;
  const frame = (now: number): void => {
    bgRaf = requestAnimationFrame(frame);
    if (now - last < 33) return; // 30 fps is plenty for slow clouds
    last = now;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const hh = window.innerHeight;
    if (bg.width !== Math.round(w * dpr) || bg.height !== Math.round(hh * dpr)) {
      bg.width = Math.round(w * dpr);
      bg.height = Math.round(hh * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    titleScene(g, w, hh, reduced() ? 0 : (now - t0) / 1000);
  };
  bgRaf = requestAnimationFrame(frame);
}

function reduced(): boolean {
  return profile?.data.settings.reducedMotion ?? (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

const ctx: AppCtx = {
  get profile() {
    if (!profile) throw new Error('Profile not loaded');
    return profile;
  },
  audio,
  go: (r) => void navigate(r),
  toast: () => undefined,
  reducedMotion: reduced,
  openNotes: () => {
    previousForNotes = current.name === 'notes' ? previousForNotes : current;
    void navigate({ name: 'notes' });
  },
};

const crumbs: Record<Route['name'], string> = { welcome: '', menu: 'Menu', editor: 'Launcher', range: 'Practice range', lobby: 'Defense', workshop: 'Shop', logbook: 'Logbook', settings: 'Settings', notes: 'Physics notes' };

let saveEl: HTMLElement | null = null;
function renderTopbar(): void {
  clear(topbar);
  const brand = h('button', { class: 'brand', type: 'button', 'aria-label': 'Railhold, back to menu', onclick: () => { if (profile && current.name !== 'welcome') void navigate({ name: 'menu' }); } }, logo(), 'Railhold');
  if (current.name !== 'welcome' && current.name !== 'menu') topbar.append(brand);
  if (current.name !== 'welcome' && current.name !== 'menu') topbar.append(h('span', { class: 'crumb' }, '/'), h('span', null, crumbs[current.name]));
  topbar.append(h('span', { class: 'grow' }));
  if (profile && current.name !== 'welcome') {
    saveEl = h('span', { class: 'save', role: 'status' });
    paintSave(profile.state);
    topbar.append(saveEl, h('span', { class: 'credits' }, `${profile.data.credits.toLocaleString()} cr`), h('span', { class: 'who' }, profile.data.name));
    if (current.name !== 'menu') topbar.append(h('button', { class: 'btn small', type: 'button', onclick: () => void navigate({ name: 'menu' }) }, 'Menu'));
  }
}

function logo(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<rect width="32" height="32" rx="9" fill="#FFB000" stroke="#26314D" stroke-width="2.5"/><path d="M5 11.5h22M5 20.5h22" stroke="#26314D" stroke-width="3" stroke-linecap="round"/><rect x="11" y="13" width="9" height="6" rx="2" fill="#FFF8EA" stroke="#26314D" stroke-width="2"/>';
  return svg;
}

function paintSave(s: SaveState): void {
  const cr = topbar.querySelector('.credits');
  if (cr && profile) cr.textContent = `${profile.data.credits.toLocaleString()} cr`;
  if (!saveEl) return;
  clear(saveEl);
  const text = s === 'saved' ? 'Saved on this device' : s === 'saving' ? 'Saving' : s === 'unsaved' ? 'Saving soon' : 'Not saved: browser storage is blocked';
  saveEl.append(s === 'blocked' ? icon('warn', 14) : s === 'saved' ? icon('check', 14) : icon('clock', 14), text);
}

async function navigate(r: Route): Promise<void> {
  const token = ++navToken;
  dispose?.();
  dispose = null;
  audio.setCharge(0);
  current = r;
  document.title = r.name === 'welcome' || r.name === 'menu' ? 'Railhold' : `${crumbs[r.name]} · Railhold`;
  renderTopbar();
  setScene(r.name === 'welcome' || r.name === 'menu');
  if (r.name !== 'lobby') audio.music('menu'); // the match screen picks its own track
  clear(body);
  if (r.name === 'welcome') {
    const blocked = !storageWorks();
    dispose = mountWelcome(body, (name) => {
      profile = blocked ? Profile.memoryOnly(name) : Profile.create(name);
      profile.onSave(paintSave);
      void navigate({ name: 'menu' });
    }, blocked ? 'This browser blocks storage for the site, so progress cannot be saved. You can still play; it is lost when you close the tab.' : null);
    return;
  }
  if (!profile) return void navigate({ name: 'welcome' });
  switch (r.name) {
    case 'menu':
      dispose = mountMenu(body, ctx, joinParam && !joined ? joinParam : null);
      joined = true;
      break;
    case 'editor': {
      const id = r.id && profile.blueprint(r.id) ? r.id : profile.data.blueprints[0].id;
      try { localStorage.setItem('railhold.lastBp', id); } catch { /* storage blocked */ }
      const back = r.back;
      dispose = mountEditor(body, {
        profile, reducedMotion: reduced(), openNotes: () => ctx.openNotes(),
        toRange: (bid) => void navigate({ name: 'range', id: bid }),
        sfx: (n) => audio.sfx(n), toast: (t, k) => ctx.toast(t, k),
      }, id);
      if (back) topbar.insertBefore(h('button', { class: 'btn small', type: 'button', onclick: () => void navigate(back) }, 'Back'), topbar.querySelector('.grow'));
      break;
    }
    case 'range': {
      try { localStorage.setItem('railhold.lastBp', r.id); } catch { /* storage blocked */ }
      const d = await mountRange(body, ctx, r.id, r.tutorial === true);
      if (token !== navToken) d();
      else dispose = d;
      break;
    }
    case 'lobby':
      dispose = mountPlay(body, ctx, r.session as Session, r.blueprintId);
      break;
    case 'workshop':
      dispose = mountWorkshop(body, ctx);
      break;
    case 'logbook':
      dispose = mountLogbook(body, ctx);
      break;
    case 'settings':
      dispose = mountSettings(body, ctx, () => undefined);
      break;
    case 'notes': {
      dispose = mountNotes(body);
      topbar.insertBefore(h('button', { class: 'btn small', type: 'button', onclick: () => void navigate(previousForNotes) }, 'Back'), topbar.querySelector('.grow'));
      break;
    }
  }
}

let joined = false;

function storageWorks(): boolean {
  try {
    localStorage.setItem('railhold.probe', '1');
    localStorage.removeItem('railhold.probe');
    return true;
  } catch {
    return false;
  }
}

function applyAudioSettings(): void {
  if (!profile) return;
  const st = profile.data.settings;
  audio.setVolume(st.volume);
  audio.setMusicVolume(st.musicVolume);
  audio.setSfxVolume(st.sfxVolume);
}

// Interface sounds by delegation, so every button, tab, toggle and slider is covered in one place.
document.addEventListener('click', (e) => {
  const t = (e.target as HTMLElement | null)?.closest('button, summary, .menu-item, select, input[type=checkbox]');
  if (!t || (t as HTMLButtonElement).disabled) return;
  if (t.matches('input[type=checkbox], select')) return;
  if (t.hasAttribute('data-nosound')) return;
  audio.sfx(t.classList.contains('quiet') || t.getAttribute('aria-label') === 'Close' || /^(Back|Leave|Cancel|Close)/.test(t.textContent ?? '') ? 'back' : 'click');
}, true);
document.addEventListener('change', (e) => {
  const t = e.target as HTMLElement;
  if (t.matches('input[type=checkbox], select')) audio.sfx('toggle');
}, true);

// Unlock audio on the first gesture, and save when the tab is hidden.
window.addEventListener('pointerdown', () => audio.unlock(), { once: false, passive: true });
window.addEventListener('keydown', () => audio.unlock(), { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') profile?.flush();
});
window.addEventListener('pagehide', () => profile?.flush());
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection', e.reason);
});

const stored = Profile.load();
if (stored) {
  profile = stored;
  profile.onSave(paintSave);
  applyAudioSettings();
  void navigate({ name: 'menu' });
} else {
  void navigate({ name: 'welcome' });
}
