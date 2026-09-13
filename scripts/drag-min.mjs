/* Minimal: e4 → d6 → Bc4 with long waits. Does the third drag start? */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173';

async function center(page, square) {
  const a = await page.locator(`[data-square="${square}"]`).boundingBox();
  return { x: a.x + a.width / 2, y: a.y + a.height / 2 };
}

async function dragSq(page, from, to, wait = 1500) {
  const a = await center(page, from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const b = await center(page, to);
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(wait);
  const landed = await page.evaluate((sq) => {
    const el = document.querySelector(`[data-square="${sq}"]`);
    return !!el && el.querySelectorAll('svg').length > 0;
  }, to);
  console.log(`drag ${from}->${to} landed:`, landed);
  return landed;
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('[drag]') || t.includes('[movable]')) console.log('CONSOLE', t.slice(0, 120));
  });
  await page.goto(`${BASE}/#/play`);
  await page.waitForSelector('.mode-switch .mode-row');
  await page.click('.mode-switch .mode-row:nth-child(2)');
  await page.click('form button.btn-accent');
  await page.waitForTimeout(800);

  await dragSq(page, 'e2', 'e4');
  await dragSq(page, 'd7', 'd6');
  console.log('— now the bishop —');
  await dragSq(page, 'f1', 'c4', 2500);

  // retry once after a click elsewhere
  await page.click('[data-square="a1"]');
  await page.waitForTimeout(300);
  await dragSq(page, 'f1', 'c4', 1500);

  await browser.close();
}

run().catch((e) => {
  console.error('ERR', e);
  process.exit(2);
});
