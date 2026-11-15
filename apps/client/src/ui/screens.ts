import { GAME, normalizeRoomCode, isValidRoomCode } from '@railhold/shared';
import type { AppCtx } from '../app-ctx.ts';
import { clear, eng, h, pct } from '../dom.ts';
import { multiplayerAvailable, NetError } from '../net.ts';
import { DEFAULT_SETTINGS } from '../profile.ts';
import { GuestSession, HostSession } from '../session.ts';
import { renderShop } from './garage.ts';
import { icon, ledgerBar, plot, Scope, COLORS } from './widgets.ts';
import { notesContent } from './notes.ts';

// ------------------------------------------------------------------ welcome

function lockup(sub: string): HTMLElement {
  return h('div', { class: 'logo-lockup rise' }, h('h1', null, 'Railhold'), h('p', null, sub));
}

export function mountWelcome(root: HTMLElement, onName: (name: string) => void, storageNote: string | null): () => void {
  const input = h('input', { id: 'w-name', type: 'text', maxlength: '20', placeholder: 'Type a name', autocomplete: 'nickname', 'aria-label': 'Your name' });
  const go = (): void => onName(input.value.trim() || 'Player');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') go();
  });
  root.append(h('div', { class: 'title-screen' },
    lockup('Build a real railgun. Defend the keep.'),
    h('div', { class: 'sheet rise', style: 'margin-top:clamp(16px,4vh,40px);animation-delay:.1s' },
      h('div', { class: 'field' }, h('label', { for: 'w-name' }, 'What should your team call you?'), input),
      storageNote ? h('div', { class: 'banner fault' }, icon('warn'), h('span', null, storageNote)) : null,
      h('button', { class: 'btn primary big', type: 'button', onclick: go }, icon('play', 20), 'Start'),
      h('span', { class: 'hint' }, 'No account needed. Your progress is saved in this browser.'))));
  queueMicrotask(() => input.focus());
  return () => clear(root);
}

// ------------------------------------------------------------------ menu

export function mountMenu(root: HTMLElement, ctx: AppCtx, joinCode: string | null): () => void {
  const p = ctx.profile.data;
  const err = h('div', { class: 'err-text', role: 'alert', hidden: true });
  const joinStatus = h('div', { class: 'hint', role: 'status' }, '');
  const code = h('input', { id: 'join-code', class: 'code-input', type: 'text', maxlength: '9', placeholder: 'ABC234', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', 'aria-label': 'Room code', value: joinCode ?? '' });
  const joinBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => void join() }, 'Join');
  let busy = false;

  const firstBp = (): string => p.blueprints[0].id;
  const lastBp = (): string => localStorage.getItem('railhold.lastBp') ?? firstBp();
  const validBp = (id: string): string => (ctx.profile.blueprint(id) ? id : firstBp());

  function showErr(msg: string): void {
    clear(err);
    err.append(icon('warn', 14), h('span', null, msg));
    err.hidden = false;
  }

  async function join(): Promise<void> {
    if (busy) return;
    err.hidden = true;
    const c = normalizeRoomCode(code.value);
    if (!isValidRoomCode(c)) {
      showErr('A room code has 6 characters: the digits 2 to 9 and the letters A to Z, without I, L and O.');
      code.focus();
      return;
    }
    busy = true;
    joinBtn.disabled = true;
    const sess = new GuestSession(p.clientId, c, p.name, p.unlocked);
    try {
      await sess.connect((t) => {
        joinStatus.textContent = `${t}…`;
      });
      ctx.go({ name: 'lobby', session: sess, blueprintId: validBp(lastBp()) });
    } catch (e) {
      sess.close();
      showErr(e instanceof NetError ? e.message : 'Could not join the room.');
      joinStatus.textContent = '';
      busy = false;
      joinBtn.disabled = false;
    }
  }

  async function host(mode: 'host' | 'solo'): Promise<void> {
    if (busy) return;
    busy = true;
    err.hidden = true;
    const sess = new HostSession(mode, p.clientId, 'SOLO', p.name, p.unlocked);
    try {
      await sess.start();
      ctx.go({ name: 'lobby', session: sess, blueprintId: validBp(lastBp()) });
    } catch (e) {
      sess.close();
      showErr(e instanceof NetError ? e.message : 'Could not open a room.');
      busy = false;
    }
  }

  const big = (ic: Parameters<typeof icon>[0], title: string, sub: string, cls: string, onclick: () => void): HTMLButtonElement =>
    h('button', { class: `btn big ${cls}`, type: 'button', onclick }, h('span', { class: 'ico' }, icon(ic, 20)), title, h('span', { class: 'sub' }, sub)) as HTMLButtonElement;

  const hostBtn = h('button', { class: 'btn big primary', type: 'button', onclick: () => void host('host') }, icon('users', 20), 'Host a room') as HTMLButtonElement;
  const mpNote = h('div', { class: 'banner', hidden: true }, icon('warn'), h('span'));
  const friends = h('div', { class: 'overlay', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Play with friends' },
    h('div', { class: 'sheet' },
      h('div', { class: 'spread' }, h('h2', null, 'Play with friends'), h('button', { class: 'btn small', type: 'button', 'aria-label': 'Close', onclick: () => { friends.hidden = true; } }, icon('cross', 14))),
      h('p', { class: 'muted' }, 'Up to 4 players share one base. One of you hosts and shares the 6-character code.'),
      hostBtn,
      mpNote,
      h('div', { class: 'spread muted', style: 'justify-content:center' }, '— or join a friend —'),
      h('div', { class: 'join-row' }, h('div', { class: 'field' }, h('label', { for: 'join-code' }, 'Room code'), code), joinBtn),
      joinStatus, err));
  const openFriends = (): void => {
    friends.hidden = false;
    code.focus();
  };

  const guide = p.campaign.tutorialDone ? null : h('div', { class: 'howto rise', style: 'animation-delay:.25s' },
    h('div', null, h('b', null, 'New here?'), 'A one-minute guided tour of the launcher.'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => ctx.go({ name: 'range', id: validBp(lastBp()), tutorial: true }) }, icon('play', 14), 'Start the tutorial'));

  root.append(h('div', { class: 'title-screen' },
    lockup('Build a real railgun. Defend the keep.'),
    h('div', { class: 'menu-main rise', style: 'animation-delay:.1s' },
      big('play', 'Play', 'Solo, 10 waves', 'primary', () => void host('solo')),
      big('users', 'Play with friends', 'Room code', '', openFriends),
      big('target', 'Practice range', 'Learn your launcher', '', () => ctx.go({ name: 'range', id: validBp(lastBp()) }))),
    guide,
    h('div', { class: 'dock rise', style: 'animation-delay:.2s' },
      h('button', { class: 'btn small', type: 'button', onclick: () => ctx.go({ name: 'editor', id: validBp(lastBp()) }) }, icon('wrench', 14), 'Build launcher'),
      h('button', { class: 'btn small', type: 'button', onclick: () => ctx.go({ name: 'workshop' }) }, icon('lock', 14), 'Shop'),
      h('button', { class: 'btn small', type: 'button', onclick: () => ctx.go({ name: 'logbook' }) }, icon('book', 14), 'Logbook'),
      h('button', { class: 'btn small', type: 'button', onclick: () => ctx.go({ name: 'settings' }) }, icon('gear', 14), 'Settings'),
      h('button', { class: 'btn small', type: 'button', onclick: () => ctx.go({ name: 'range', id: validBp(lastBp()), tutorial: true }) }, icon('play', 14), 'Tutorial'),
      h('button', { class: 'btn small', type: 'button', onclick: () => ctx.openNotes() }, icon('info', 14), 'How it works')),
    h('div', { class: 'pilot rise', style: 'animation-delay:.3s' },
      h('span', { class: 'avatar' }, p.name.slice(0, 1).toUpperCase()),
      h('span', null, p.name), h('span', { class: 'stat num' }, `${p.credits.toLocaleString()} credits`), h('span', { class: 'stat num' }, `best wave ${p.campaign.bestWave}/${GAME.WAVES}`)),
    friends));
  if (joinCode) {
    friends.hidden = false;
    queueMicrotask(() => code.focus());
  }
  code.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void join();
  });
  const onEsc = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') friends.hidden = true;
  };
  window.addEventListener('keydown', onEsc);

  void multiplayerAvailable().then((r) => {
    if (!r.ok) {
      hostBtn.disabled = true;
      const t = mpNote.querySelector('span');
      if (t) t.textContent = `Hosting is off on this site. ${r.reason} You can still join a room.`;
      mpNote.hidden = false;
    }
  });
  void pct;
  return () => {
    window.removeEventListener('keydown', onEsc);
    clear(root);
  };
}

// ------------------------------------------------------------------ workshop

export function mountWorkshop(root: HTMLElement, ctx: AppCtx): () => void {
  const host = h('div', { class: 'shop-body', style: 'width:100%' });
  root.append(h('div', { class: 'scroll', style: 'flex:1' }, h('div', { class: 'report', style: 'width:min(1040px,100%);margin:0 auto;padding:0 var(--s3) var(--s4)' }, h('h1', null, 'Shop'), host)));
  renderShop(host, { profile: ctx.profile, sfx: (n) => ctx.audio.sfx(n), toast: (t, k) => ctx.toast(t, k) });
  return () => clear(root);
}

// ------------------------------------------------------------------ logbook

export function mountLogbook(root: HTMLElement, ctx: AppCtx): () => void {
  const shots = [...ctx.profile.data.shots].reverse();
  const scope = new Scope(0.5, 'Rail current');
  const detail = h('div', { class: 'stack' });
  const velCanvas = h('canvas', { class: 'chart', role: 'img', 'aria-label': 'Projectile speed against time' });
  let selected = shots[0]?.id ?? '';

  function show(id: string): void {
    selected = id;
    renderList();
    const s = ctx.profile.data.shots.find((x) => x.id === id);
    clear(detail);
    if (!s) return;
    const r = s.report;
    detail.append(
      h('h2', null, s.blueprint?.name ?? 'Shot'),
      h('p', { class: 'muted num' }, `${new Date(s.at).toLocaleString()} · physics ${s.physicsVersion} · ${s.source}`),
      h('div', { class: 'cluster' }, h('span', { class: 'readout', style: 'font-size:var(--t-3)' }, r.status === 'MUZZLE_EXIT' ? `${r.muzzleSpeed_m_s.toFixed(1)} m/s` : 'No exit'), h('span', { class: 'num' }, eng(r.muzzleEnergy_J, 'J')), h('span', { class: 'num' }, pct(r.efficiency)), h('span', { class: 'num' }, `${eng(r.I_peak_A, 'A')} peak`)),
      scope.el, velCanvas, h('h3', null, 'Energy ledger'), ledgerBar(r.ledger),
      ...r.failures.map((f) => h('div', { class: 'violation' }, icon('warn'), h('div', null, h('strong', null, f.message), h('span', { class: 'hint num' }, `Limit ${eng(f.limit, f.unit)}, reached ${eng(f.value, f.unit)}`)))));
    scope.show(r, r.status === 'MUZZLE_EXIT' ? r.t_end_s : 0);
    requestAnimationFrame(() => plot(velCanvas, [{ x: r.trace.t_s, y: r.trace.v_m_s, color: COLORS.graphite, label: 'Speed' }], 's', 'm/s'));
  }

  const listEl = h('div', { class: 'stack tight' });
  function renderList(): void {
    clear(listEl);
    if (shots.length === 0) listEl.append(h('p', { class: 'muted' }, 'No shots yet. Fire in the Range or a defense match and they appear here.'));
    for (const s of shots) {
      listEl.append(h('button', { class: 'menu-item', type: 'button', 'aria-current': String(s.id === selected), onclick: () => show(s.id) },
        h('span', { class: 'title num' }, s.report.status === 'MUZZLE_EXIT' ? `${s.report.muzzleSpeed_m_s.toFixed(0)} m/s` : s.report.status),
        h('span', { class: 'tail num' }, eng(s.report.muzzleEnergy_J, 'J')),
        h('span', { class: 'desc' }, `${s.blueprint?.name ?? 'Launcher'} · ${new Date(s.at).toLocaleTimeString()}`)));
    }
  }
  root.append(h('div', { class: 'scroll', style: 'flex:1' }, h('div', { class: 'report' }, h('h1', null, 'Logbook'), h('div', { style: 'display:grid;grid-template-columns:minmax(240px,340px) 1fr;gap:var(--s3)' }, listEl, detail))));
  renderList();
  if (selected) show(selected);
  return () => {
    scope.dispose();
    clear(root);
  };
}

// ------------------------------------------------------------------ settings

export function mountSettings(root: HTMLElement, ctx: AppCtx, applyReduced: () => void): () => void {
  const render = (): void => {
    clear(root);
    const p = ctx.profile.data;
    const st = p.settings;
    const row = (label: string, ctrl: HTMLElement, hint?: string): HTMLElement => h('div', { class: 'field' }, h('div', { class: 'label' }, label), ctrl, hint ? h('span', { class: 'hint' }, hint) : null);
    const name = h('input', { type: 'text', maxlength: '20', value: p.name, 'aria-label': 'Callsign', oninput: (e: Event) => { p.name = (e.target as HTMLInputElement).value.trim() || 'Player'; ctx.profile.touch(); } });
    const slider = (key: 'volume' | 'musicVolume' | 'sfxVolume', label: string, apply: (v: number) => void): HTMLInputElement =>
      h('input', { type: 'range', min: '0', max: '1', step: '0.05', value: String(st[key]), 'aria-label': label, oninput: (e: Event) => {
        st[key] = Number((e.target as HTMLInputElement).value);
        apply(st[key]);
        ctx.profile.touch();
      }, onchange: () => ctx.audio.sfx('slider') }) as HTMLInputElement;
    const vol = slider('volume', 'Master volume', (v) => ctx.audio.setVolume(v));
    const musicVol = slider('musicVolume', 'Music volume', (v) => ctx.audio.setMusicVolume(v));
    const sfxVol = slider('sfxVolume', 'Effects volume', (v) => ctx.audio.setSfxVolume(v));
    const q = h('select', { 'aria-label': 'Graphics quality', onchange: (e: Event) => { st.quality = (e.target as HTMLSelectElement).value as 'high' | 'low'; ctx.profile.touch(); } },
      h('option', { value: 'high', selected: st.quality === 'high' }, 'High: sharp on dense screens'), h('option', { value: 'low', selected: st.quality === 'low' }, 'Low: lighter on slow devices'));
    const rm = h('input', { type: 'checkbox', checked: st.reducedMotion, onchange: (e: Event) => { st.reducedMotion = (e.target as HTMLInputElement).checked; ctx.profile.touch(); applyReduced(); } });
    const keyBtn = h('button', { class: 'btn', type: 'button' }, `Fire key: ${st.fireKey}`);
    keyBtn.addEventListener('click', () => {
      keyBtn.textContent = 'Press a key…';
      const once = (e: KeyboardEvent): void => {
        e.preventDefault();
        if (e.code !== 'Escape') {
          st.fireKey = e.code;
          ctx.profile.touch();
        }
        keyBtn.textContent = `Fire key: ${st.fireKey}`;
        window.removeEventListener('keydown', once, true);
      };
      window.addEventListener('keydown', once, true);
    });
    root.append(h('div', { class: 'scroll', style: 'flex:1' }, h('div', { class: 'report', style: 'max-width:620px' },
      h('h1', null, 'Settings'),
      row('Callsign', name), row('Master volume', vol), row('Music', musicVol), row('Sound effects', sfxVol),
      row('Graphics', q),
      h('label', { class: 'check' }, rm, 'Reduce motion (no needle easing, no scope replay)'),
      row('Controls', keyBtn, 'Click in the field also fires. Escape cancels while rebinding.'),
      h('hr'),
      h('h3', null, 'Saved data'),
      h('p', { class: 'muted' }, 'Everything lives in this browser: blueprints, credits, unlocks and your logbook.'),
      h('div', { class: 'cluster' },
        h('button', { class: 'btn', type: 'button', onclick: () => download() }, 'Download backup'),
        h('button', { class: 'btn danger', type: 'button', onclick: () => confirmReset() }, icon('warn', 14), 'Erase all data')))));
  };
  function download(): void {
    const blob = new Blob([JSON.stringify(ctx.profile.data, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'railhold-backup.json' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function confirmReset(): void {
    const box = h('div', { class: 'overlay', style: 'position:fixed' }, h('div', { class: 'panel', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'body stack' },
      h('h2', null, 'Erase everything?'), h('p', null, 'Launchers, credits, unlocks and the logbook are deleted from this browser. This cannot be undone. A backup download is available first.'),
      h('div', { class: 'cluster' },
        h('button', { class: 'btn danger', type: 'button', onclick: () => { try { localStorage.clear(); } catch { /* blocked */ } location.reload(); } }, 'Erase'),
        h('button', { class: 'btn', type: 'button', onclick: () => box.remove() }, 'Cancel')))));
    document.body.append(box);
  }
  render();
  void DEFAULT_SETTINGS;
  return () => clear(root);
}

// ------------------------------------------------------------------ notes

export function mountNotes(root: HTMLElement): () => void {
  root.append(h('div', { class: 'scroll', style: 'flex:1' }, notesContent()));
  return () => clear(root);
}
