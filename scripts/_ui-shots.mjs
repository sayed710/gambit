import { chromium } from 'playwright';
const BASE = 'http://localhost:4173';
const WIDTHS = [1440, 1024, 768, 390];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/#/training`);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForTimeout(500);

for (const w of WIDTHS) {
  await page.setViewportSize({ width: w, height: 1000 });
  await page.goto(`${BASE}/#/`);
  await page.waitForTimeout(900);
  // horizontal overflow check
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  // brand font actually loaded?
  const font = await page.evaluate(() => ({
    bilgeon: document.fonts.check('20px "Bilgeon Script"'),
    word: getComputedStyle(document.querySelector('.brand-word')).fontFamily.slice(0, 30),
  }));
  console.log(`home ${w}: overflow=${overflow} bilgeon=${font.bilgeon}`);
  await page.screenshot({ path: `ui-home-${w}.png`, fullPage: false });
  if (w === 1440) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'ui-home-1440-features.png' });
    await page.evaluate(() => window.scrollTo(0, 0));
  }
}
// product pages at desktop + mobile
for (const [route, name] of [['#/play', 'play'], ['#/review/x', 'review'], ['#/library', 'library']]) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/${route}`);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `ui-${name}-1440.png` });
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log(`${name} 390: overflow=${overflow}`);
  await page.screenshot({ path: `ui-${name}-390.png` });
}
console.log('PAGEERRORS:', errors.length, errors.slice(0, 2));
await browser.close();
console.log('SHOTS DONE');
