/* Final handoff screenshot set (fresh at HEAD) + palette pixel-verify. */
import { chromium } from 'playwright';
import sharp from 'sharp';

const BASE = 'http://localhost:5199';
const browser = await chromium.launch();

async function newPage(w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.setDefaultTimeout(90000);
  p.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  return p;
}
/* the box is heavily loaded — goto retries until 'load' settles */
async function goto(p, url) {
  for (let i = 0; i < 3; i++) {
    try { await p.goto(url, { waitUntil: 'load', timeout: 60000 }); return; }
    catch (e) { console.log('goto retry', i + 1, url); await p.waitForTimeout(1500); }
  }
  throw new Error('goto failed: ' + url);
}

/* Home 1440 — full page + hero crop */
let p = await newPage(1440, 900);
await p.goto(`${BASE}/#/`, { waitUntil: 'load' });
await p.waitForSelector('.brand-lockup');
await p.waitForTimeout(1500);
await p.screenshot({ path: 'final-home-1440-full.png', fullPage: true });
await p.screenshot({ path: 'final-header-logo-1440.png', clip: { x: 0, y: 0, width: 720, height: 68 } });
await p.evaluate(() => document.querySelector('.hero')?.scrollIntoView());
await p.waitForTimeout(500);
await p.screenshot({ path: 'final-home-hero-1440.png' });

/* Play 1366×768 */
await p.setViewportSize({ width: 1366, height: 768 });
await p.goto(`${BASE}/#/play`, { waitUntil: 'load' });
await p.waitForTimeout(1200);
if (await p.locator('button:has-text("Start game")').count()) {
  await p.locator('button:has-text("Start game")').click();
  await p.waitForSelector('.board-surface', { timeout: 15000 });
  await p.waitForTimeout(2200);
}
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(300);
await p.screenshot({ path: 'final-play-1366x768.png' });

/* Analysis 1440×900 */
await p.setViewportSize({ width: 1440, height: 900 });
await p.goto(`${BASE}/#/analysis`, { waitUntil: 'load' });
await p.waitForSelector('.workspace-layout .board-surface', { timeout: 20000 });
await p.waitForTimeout(3500);
await p.evaluate(() => window.scrollTo(0, 0));
await p.waitForTimeout(300);
await p.screenshot({ path: 'final-analysis-1440x900.png' });

/* Review with a real selected move — FRESH page (the analysis page's
   Stockfish session otherwise keeps the tab busy and starves the
   review mount), fresh game, drag e4, resign */
await p.close();
p = await newPage(1440, 900);
await goto(p, `${BASE}/#/play`);
await p.waitForTimeout(800);
await p.evaluate(() => localStorage.removeItem('gambit.activeGame'));
await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1200);
if (await p.locator('button:has-text("Start game")').count()) {
  await p.locator('button:has-text("Start game")').click();
  await p.waitForSelector('.board-surface', { timeout: 15000 });
  await p.waitForTimeout(1200);
  // drag e2→e4 (the setup's Start leaves a live 0-ply game)
  const from = await p.evaluate(() => { const c = document.querySelector('[data-square="e2"]').getBoundingClientRect(); return { x: c.x + c.width / 2, y: c.y + c.height / 2 }; });
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  const to = await p.evaluate(() => { const c = document.querySelector('[data-square="e4"]').getBoundingClientRect(); return { x: c.x + c.width / 2, y: c.y + c.height / 2 }; });
  await p.mouse.move(to.x, to.y, { steps: 8 });
  await p.mouse.up();
  await p.waitForFunction(() => document.querySelectorAll('.move-list td.mv').length >= 2, null, { timeout: 45000, polling: 300 });
}
await p.click('button:has-text("Resign")');
const danger = p.locator('.btn-danger:visible').last();
if (await danger.count()) await danger.click().catch(() => {});
await p.waitForTimeout(900);
const gid = await p.evaluate(() => JSON.parse(localStorage.getItem('gambit.profile') ?? '{}').games[0]?.id);
if (!gid) throw new Error('no saved game for review capture');
await p.goto(`${BASE}/#/review/${gid}`, { waitUntil: 'load' });
await p.waitForSelector('.move-list td.mv', { timeout: 90000 });
await p.waitForTimeout(1200);
const cells = p.locator('.move-list td.mv.selectable');
if (await cells.count()) await cells.first().click();
await p.waitForTimeout(500);
await p.evaluate(() => document.querySelector('.move-list')?.scrollIntoView({ block: 'center' }));
await p.waitForTimeout(300);
await p.screenshot({ path: 'final-review-selected-move.png' });
/* hover-state proof: pointer ON the selected cell — the fill must stay
   the solid blue-gray (the washed 1.41:1 defect is fixed) */
const curBox = await p.locator('.move-list .mv.current').first().boundingBox();
await p.mouse.move(curBox.x + curBox.width / 2, curBox.y + curBox.height / 2);
await p.waitForTimeout(300);
await p.screenshot({ path: 'final-review-selected-move-hover.png' });
const hoverBg = await p.evaluate(() => {
  const el = document.querySelector('.move-list .mv.current');
  const cs = getComputedStyle(el);
  return { bg: cs.backgroundColor, color: cs.color };
});
console.log('hover-state cell:', JSON.stringify(hoverBg));
await p.close();

/* Home 390 — full page */
p = await newPage(390, 844);
await goto(p, `${BASE}/#/`);
await p.waitForTimeout(1400);
await p.screenshot({ path: 'final-home-390-full.png', fullPage: true });
await p.close();

/* Palette verification — authoritative form: read the LIVE computed
   styles (not pixel-coordinate guesses) and HARD-ASSERT against the
   approved tokens. Exit 1 on any drift. Card tone expects the
   documented intentional raised-sand #F1ECE2. */
{
  const vp = await newPage(1440, 900);
  await goto(vp, `${BASE}/#/`);
  await vp.waitForSelector('.feature-card');
  await vp.waitForTimeout(1200);
  const APPROVED = {
    'body cream': ['#F8F5EF', 'body'],
    'feature card (raised sand)': ['#F1ECE2', '.feature-card'],
    'hero band charcoal': ['#0F1720', '.hero-band'],
    'gold CTA': ['#C9B896', '.btn-gold'],
    'sage Play button': ['#597D5B', '.ui-play-btn'],
  };
  const rendered = await vp.evaluate((sels) => {
    const out = {};
    for (const [label, sel] of Object.entries(sels)) {
      const el = document.querySelector(sel);
      out[label] = el ? getComputedStyle(el).backgroundColor : 'MISSING';
    }
    return out;
  }, Object.fromEntries(Object.entries(APPROVED).map(([k, [, sel]]) => [k, sel])));
  await vp.close();
  const hexOf = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return c;
    const [r, g, b] = m[1].split(',').map((x) => Math.round(parseFloat(x)));
    return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  };
  const parse = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
  let drift = 0;
  console.log('PALETTE ASSERTIONS (live computed vs approved):');
  for (const [label, [expected]] of Object.entries(APPROVED)) {
    const gotC = rendered[label];
    const got = hexOf(gotC).toLowerCase();
    const [er, eg, eb] = parse(expected);
    const [gr, gg, gb] = parse(got);
    const delta = Math.round(Math.sqrt((gr - er) ** 2 + (gg - eg) ** 2 + (gb - eb) ** 2));
    const ok = gotC !== 'MISSING' && delta <= 2;
    if (!ok) drift++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label} — got=${got} expected=${expected} delta=${delta}`);
  }
  if (drift > 0) { console.log(`${drift} PALETTE DRIFT FAILURE(S)`); process.exitCode = 1; }
}
await browser.close();
console.log('DONE');
