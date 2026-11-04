/* Final UI-redesign verification pass on the lockup HEAD (d220e2e).
   Regenerates the ui-*.png acceptance set (gitignored) and asserts
   the approved lockup asset actually loads in the running app. */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199';
const out = (n) => `ui-${n}.png`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERROR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE-ERROR:', e.message));

await page.goto(`${BASE}/#/`, { waitUntil: 'load' });
await page.waitForTimeout(1200);

// 1 — Lockup integrity: the brand <img> must be the lockup asset and loaded.
const lockup = await page.evaluate(() => {
  const img = document.querySelector('img.brand-lockup');
  if (!img) return { present: false };
  return {
    present: true,
    src: img.getAttribute('src'),
    complete: img.complete,
    natural: `${img.naturalWidth}x${img.naturalHeight}`,
    box: JSON.parse(JSON.stringify(img.getBoundingClientRect())),
  };
});
console.log('LOCKUP:', JSON.stringify(lockup));
if (!lockup.present || !lockup.complete || lockup.natural !== '671x216') {
  console.log('FAIL: lockup asset did not load as expected');
  process.exitCode = 1;
}

// 2 — Header with lockup on cream navbar.
await page.screenshot({ path: out('home-header-1440') });

// 3 — Hero band.
await page.evaluate(() => document.querySelector('.hero')?.scrollIntoView());
await page.waitForTimeout(400);
await page.screenshot({ path: out('home-hero-1440') });

// 4 — Feature cards (scroll the #features section into view).
await page.evaluate(() => document.getElementById('features')?.scrollIntoView());
await page.waitForTimeout(700);
await page.screenshot({ path: out('home-features-1440') });

// 5 — Closing band.
await page.evaluate(() => document.querySelector('.closing')?.scrollIntoView());
await page.waitForTimeout(400);
await page.screenshot({ path: out('home-closing-1440') });

// 6 — Play page: the board must fit above the fold (no clipping).
// The play route starts the Stockfish WASM worker, so networkidle never
// settles there — 'load' plus a fixed settle is the reliable wait.
await page.goto(`${BASE}/#/play`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
// The setup screen gates the board; start a game to measure the real layout.
const startBtn = page.locator('button:has-text("Start game")');
if (await startBtn.count()) {
  await startBtn.click();
  await page.waitForSelector('.board-surface', { timeout: 15000 });
}
await page.waitForTimeout(2500);
// The setup form scrolls the page; measure the board from scroll-top 0.
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
const board = await page.evaluate(() => {
  const el = document.querySelector('.board-surface');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), viewportH: innerHeight };
});
console.log('PLAY-BOARD:', JSON.stringify(board));
await page.screenshot({ path: out('play-1440') });

// 7 — Responsive set: home at 1024 / 768 / 390.
for (const [w, h] of [[1024, 768], [768, 1024], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}/#/`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: out(`home-${w}`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log(`RESPONSIVE ${w}: horizontal-overflow=${overflow}`);
}

await browser.close();
console.log('DONE');
