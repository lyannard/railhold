const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.goto(process.argv[2] || 'http://localhost:5173');
  await page.fill('#w-name', 'Perf'); await page.click('text=Start'); await page.waitForSelector('.menu-main');
  await page.click('text=Solo, 10 waves'); await page.waitForSelector('.overlay');
  await page.click('button:has-text("Start the match")'); await page.waitForSelector('text=Build phase');
  await page.click('button:has-text("Ready for the wave")');
  await page.waitForFunction(() => /\d+ on the field/.test(document.body.innerText), null, { timeout: 60000 });
  await page.evaluate(() => { window.__ft = []; let l = performance.now(); const f = (t) => { window.__ft.push(t - l); l = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const box = await page.locator('canvas.world').boundingBox();
  for (let i = 0; i < 12; i++) { await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.4); await page.waitForTimeout(1000); }
  const ft = await page.evaluate(() => window.__ft.slice(5));
  ft.sort((a, b) => a - b);
  const q = (p) => ft[Math.floor(p * (ft.length - 1))].toFixed(1);
  console.log(`frames ${ft.length}  median ${q(0.5)} ms  p95 ${q(0.95)} ms  p99 ${q(0.99)} ms  max ${ft[ft.length - 1].toFixed(1)} ms`);
  await b.close();
})();
