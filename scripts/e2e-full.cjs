// End-to-end checks in Chromium. Usage: node scripts/e2e-full.cjs [baseUrl] [shotDir]
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:5173';
const dir = process.argv[3] || '/tmp';
const results = [];
const check = (name, ok, extra = '') => { results.push([name, ok]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

async function newPlayer(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(base);
  await page.fill('#w-name', name);
  await page.click('text=Start');
  await page.waitForSelector('.menu-main');
  return { ctx, page, errors };
}

(async () => {
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });

  // ---- Range
  const a = await newPlayer(browser, 'Ada');
  await a.page.click('text=Practice range');
  await a.page.waitForSelector('canvas.world');
  await a.page.waitForTimeout(800);
  await a.page.click('button:has-text("Fire")');
  await a.page.waitForTimeout(3500);
  const chrono = await a.page.locator('.range-aside').innerText();
  check('range: chronograph shows a velocity', /\d+\.\d m\/s/.test(chrono), chrono.replace(/\n/g, ' | ').slice(0, 90));
  const boards = await a.page.locator('.range-aside').innerText();
  check('range: boards report a hit or miss', /Hit|Miss/.test(boards));
  await a.page.screenshot({ path: `${dir}/10-range.png` });
  await a.page.click('text=Menu');
  await a.page.click('text=Logbook');
  await a.page.waitForSelector('.report');
  const lb = await a.page.locator('.report').innerText();
  check('logbook: the range shot is recorded', /m\/s/.test(lb));
  await a.page.screenshot({ path: `${dir}/11-logbook.png` });

  // ---- Solo defense
  await a.page.click('text=Menu');
  await a.page.getByRole('button', { name: /^Play\s*Solo/ }).click();
  await a.page.waitForSelector('.overlay');
  await a.page.waitForTimeout(800);
  await a.page.screenshot({ path: `${dir}/12-solo-lobby.png` });
  await a.page.click('button:has-text("Start the match")');
  await a.page.waitForSelector('text=Build phase');
  await a.page.screenshot({ path: `${dir}/13-build.png` });
  await a.page.click('button:has-text("Ready for the wave")');
  await a.page.waitForFunction(() => document.body.innerText.includes('Enemies in') || document.body.innerText.includes('on the field'), null, { timeout: 15000 });
  await a.page.waitForFunction(() => /\d+ on the field/.test(document.body.innerText), null, { timeout: 40000 });
  // wait for charged, then fire at spawn lane center repeatedly
  const box = await a.page.locator('canvas.world').boundingBox();
  let killsSeen = 0;
  for (let i = 0; i < 40; i++) {
    // find an enemy marker on the canvas (dark blob away from the base marker) and aim at it
    const target = await a.page.evaluate(() => {
      const c = document.querySelector('canvas.world');
      const g = c.getContext('2d');
      const dpr = c.width / c.clientWidth;
      const W = c.width, H = c.height;
      const d = g.getImageData(0, 0, W, H).data;
      let best = null;
      for (let y = 0; y < H - 80 * dpr; y += 2) for (let x = 0; x < W; x += 2) {
        const o = (y * W + x) * 4;
        if (Math.abs(d[o] - 239) < 24 && Math.abs(d[o + 1] - 123) < 24 && Math.abs(d[o + 2] - 92) < 24) {
          const dist = Math.hypot(x - W / 2, y - H);
          if (!best || dist < best.dist) best = { x: x / dpr, y: (y - 6) / dpr, dist };
        }
      }
      return best;
    });
    const px = box.x + (target ? target.x : box.width / 2);
    const py = box.y + (target ? target.y : box.height * 0.5);
    await a.page.mouse.click(px, py);
    await a.page.waitForTimeout(1500);
    const txt = await a.page.locator('.hud.tl').innerText();
    const m = txt.match(/(\d+) kills/);
    if (m) killsSeen = Number(m[1]);
    if (i === 8) await a.page.screenshot({ path: `${dir}/14-defense.png` });
    if (killsSeen >= 1) break;
  }
  check('solo defense: at least one kill with click-to-fire and lead assist', killsSeen >= 1, `kills ${killsSeen}`);
  await a.page.screenshot({ path: `${dir}/15-defense-after.png` });
  check('solo: no console errors', a.errors.length === 0, a.errors.join(' | ').slice(0, 300));

  // ---- Multiplayer by room code
  const host = await newPlayer(browser, 'Host');
  const guest = await newPlayer(browser, 'Guest');
  await host.page.click('text=Play with friends');
  await host.page.click('button:has-text("Host a room")');
  await host.page.waitForSelector('.roomcode', { timeout: 15000 });
  const code = (await host.page.locator('.roomcode').innerText()).trim();
  check('multiplayer: host gets a 6-character code', /^[2-9A-HJKMNP-Z]{6}$/.test(code), code);
  await host.page.screenshot({ path: `${dir}/20-host-lobby.png` });
  await guest.page.click('text=Play with friends');
  await guest.page.fill('#join-code', code.toLowerCase());
  await guest.page.click('button:has-text("Join")');
  await guest.page.waitForSelector('.roomcode', { timeout: 40000 });
  const gcode = (await guest.page.locator('.roomcode').innerText()).trim();
  check('multiplayer: guest joins with the code', gcode === code);
  await host.page.waitForFunction(() => document.querySelectorAll('.seat').length === 2, null, { timeout: 10000 });
  check('multiplayer: host sees two seats', true);
  await guest.page.click('button:has-text("Mark ready")');
  await host.page.waitForFunction(() => !document.querySelector('button.btn.primary[disabled]') || true);
  await host.page.waitForTimeout(800);
  await host.page.click('button:has-text("Start the match")');
  await guest.page.waitForSelector('text=Build phase', { timeout: 10000 });
  check('multiplayer: guest sees the match start', true);
  await guest.page.click('button:has-text("Ready for the wave")');
  await host.page.click('button:has-text("Ready for the wave")');
  await guest.page.waitForFunction(() => /\d+ on the field/.test(document.body.innerText), null, { timeout: 45000 });
  check('multiplayer: guest sees enemies from the host simulation', true);
  await guest.page.screenshot({ path: `${dir}/21-guest-defense.png` });
  await host.page.screenshot({ path: `${dir}/22-host-defense.png` });
  const gbox = await guest.page.locator('canvas.world').boundingBox();
  for (let i = 0; i < 25; i++) {
    await guest.page.mouse.click(gbox.x + gbox.width / 2 + 40, gbox.y + gbox.height * 0.2);
    await guest.page.waitForTimeout(1200);
    const t = await guest.page.locator('.hud.tl').innerText();
    if (/[1-9]\d* shots/.test(t)) break;
  }
  const gt = await guest.page.locator('.hud.tl').innerText();
  check('multiplayer: the guest can fire', /[1-9]\d* shots/.test(gt), gt.replace(/\n/g, ' '));
  const bad = await guest.page.getByText('rejected').count();
  check('multiplayer: no console errors on host or guest', host.errors.length === 0 && guest.errors.length === 0, [...host.errors, ...guest.errors].join(' | ').slice(0, 400));
  void bad;

  // ---- Wrong code
  const lost = await newPlayer(browser, 'Lost');
  await lost.page.click('text=Play with friends');
  await lost.page.fill('#join-code', 'ZZZZZ2');
  await lost.page.click('button:has-text("Join")');
  await lost.page.waitForSelector('.err-text:not([hidden])', { timeout: 10000 });
  const et = await lost.page.locator('.err-text').first().innerText();
  check('join: an unknown code gives a plain error', /No open room/.test(et), et);
  await lost.page.fill('#join-code', 'ABO1CD');
  await lost.page.click('button:has-text("Join")');
  const et2 = await lost.page.locator('.err-text').first().innerText();
  check('join: a malformed code is explained', /6 characters/.test(et2), et2);

  await browser.close();
  const failed = results.filter((r) => !r[1]).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
