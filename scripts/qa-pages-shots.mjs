/* Final page inventory screenshots for the review report. */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

async function shot(route, name, act) {
  await page.goto(`${BASE}/#${route}`, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  if (act) await act();
  await page.screenshot({ path: `ui-page-${name}.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  console.log(`${name}: overflow=${overflow}`);
}

await shot('/', 'home');
await shot('/play', 'play', async () => {
  if (await page.locator('button:has-text("Start game")').count()) { await page.locator('button:has-text("Start game")').click(); await page.waitForSelector('.board-surface', { timeout: 15000 }); await page.waitForTimeout(1500); }
});
await shot('/analysis', 'analysis');
await shot('/puzzles', 'puzzles');
await shot('/training', 'training');
await shot('/library', 'library');
await shot('/profile', 'profile');
await shot('/endgames', 'endgames');
await shot('/repertoire', 'repertoire');
await shot('/studies', 'studies');
// mobile nav drawer
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${BASE}/#/`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
await page.locator('.menu-btn').click();
await page.waitForTimeout(600);
await page.screenshot({ path: 'ui-page-mobile-nav.png' });
console.log('console errors:', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();
