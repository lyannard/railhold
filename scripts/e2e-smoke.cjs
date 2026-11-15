// Drives the built site in Chromium. Usage: node scripts/e2e-smoke.cjs [baseUrl] [shotDir]
const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:5173';
const dir = process.argv[3] || '/tmp';
(async () => {
  const browser = await chromium.launch({ args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(base);
  await page.screenshot({ path: `${dir}/01-welcome.png` });
  await page.fill('#w-name', 'Ada');
  await page.click('text=Start');
  await page.waitForSelector('.menu');
  await page.screenshot({ path: `${dir}/02-menu.png` });
  await page.click('text=Blueprints');
  await page.waitForSelector('.editor');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${dir}/03-editor.png` });
  console.log('errors so far:', errors);
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
