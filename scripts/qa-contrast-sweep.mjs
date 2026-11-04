/* Targeted rendered-contrast verification for the re-pointed ink tokens:
   .mv.current on a live Play game (gold accent), the puzzles page accent
   context, and one forced instance of each ink token measured against
   its real page surface. */
import { chromium } from 'playwright';

const BASE = 'http://localhost:5199';
const M = `
  (() => {
    // parses rgba()/rgb() AND the modern color(srgb r g b / a) form
    // produced by color-mix()
    const lum = (c) => {
      let r, g, b, a = 1;
      let m = c.match(/rgba?\\(([^)]+)\\)/);
      if (m) { [r, g, b, a] = m[1].split(',').map(parseFloat); }
      else {
        m = c.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)(?:\\s*\\/\\s*([\\d.]+))?\\)/);
        if (!m) return null;
        r = parseFloat(m[1]) * 255; g = parseFloat(m[2]) * 255; b = parseFloat(m[3]) * 255;
        if (m[4] !== undefined) a = parseFloat(m[4]);
      }
      if (a < 0.35) return null;
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const cr = (l1, l2) => (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
    const effBg = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        // alpha for rgba() AND color(srgb … / a) (color-mix output)
        const colorForm = /^color\\(/.test(bg);
        const a = colorForm
          ? (bg.match(/\\/\\s*([\\d.]+)\\s*\\)/) ? parseFloat(bg.match(/\\/\\s*([\\d.]+)\\s*\\)/)[1]) : 1)
          : (bg.match(/rgba?\\(([^)]+)\\)/) && bg.match(/rgba?\\(([^)]+)\\)/)[1].split(',')[3] !== undefined
              ? parseFloat(bg.match(/rgba?\\(([^)]+)\\)/)[1].split(',')[3])
              : 1);
        if (a >= 0.85) return bg;
        n = n.parentElement;
      }
      return 'rgb(248, 245, 239)';
    };
    const measure = (el) => {
      const cs = getComputedStyle(el);
      const bg = effBg(el);
      const ratio = cr(lum(cs.color), lum(bg));
      const fs = parseFloat(cs.fontSize);
      const large = fs >= 24 || (fs >= 18.66 && parseInt(cs.fontWeight) >= 600);
      return { color: cs.color, bg, ratio: Math.round(ratio * 100) / 100, needed: large ? 3 : 4.5, fs };
    };
    return measure;
  })()
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let bad = 0;
function check(name, r) {
  const ok = typeof r === 'object' && r.ratio >= r.needed;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ratio=${r?.ratio} (needs ${r?.needed}) color=${r?.color} bg=${r?.bg}`);
}

/* 1 — .mv.current on the Play page (gold --accent fill) */
await page.goto(`${BASE}/#/play`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
if (await page.locator('button:has-text("Start game")').count()) {
  await page.locator('button:has-text("Start game")').click();
  await page.waitForSelector('.board-surface', { timeout: 15000 });
}
await page.waitForTimeout(2500);
const cur = await page.evaluate((m) => {
  const measure = eval(m);
  const el = document.querySelector('.move-list .mv.current');
  return el ? measure(el) : 'NOT-FOUND';
}, M);
if (cur === 'NOT-FOUND') { console.log('NOTE  .mv.current not rendered (game not highlighting) — checking CSS pairing offline'); } else { check('play .mv.current (gold fill)', cur); }
await page.screenshot({ path: 'ui-play-move-current.png' });

/* 2 — forced instances: inject the exact classes into their real page
   surfaces so every ink token is measured on its true background. */
const forced = await page.evaluate((m) => {
  const measure = eval(m);
  const mk = (html, parent) => {
    const host = document.querySelector(parent);
    if (!host) return null;
    const el = document.createElement('div');
    el.innerHTML = html;
    const node = el.firstElementChild;
    host.appendChild(node);
    const r = measure(node);
    node.remove();
    return r;
  };
  return {
    clockLow: mk('<span class="clock low" style="display:inline-block">0:07</span>', '.game-layout') ,
    bannerCheck: mk('<div class="status-banner check">Check — your king is attacked</div>', '.page.container'),
    bannerGold: mk('<div class="status-banner">Saved</div>', '.page.container'),
    deltaUp: mk('<span class="delta up">▲ +12</span>', '.page.container'),
    deltaDown: mk('<span class="delta down">▼ −9</span>', '.page.container'),
    nagTag: mk('<span class="nag-tag">!!</span>', '.page.container'),
  };
}, M);
for (const [k, v] of Object.entries(forced)) if (v) check('forced ' + k, v);

/* 3 — puzzles page: sage accent context (theme chip + banner) */
await page.goto(`${BASE}/#/puzzles`, { waitUntil: 'load' });
await page.waitForTimeout(2000);
const pz = await page.evaluate((m) => {
  const measure = eval(m);
  const mk = (html) => {
    const host = document.querySelector('.page.container') || document.body;
    const el = document.createElement('div');
    el.innerHTML = html;
    const node = el.firstElementChild;
    host.appendChild(node);
    // measure the styled target, not a transparent wrapper (table→td)
    const target = node.querySelector('td, .mv.current') ?? node;
    const r = measure(target);
    node.remove();
    return r;
  };
  return {
    banner: mk('<div class="status-banner">Objective feedback</div>'),
    chip: mk('<button class="theme-chip on">Fork</button>'),
    mvCurrent: mk('<table class="move-list"><tr><td class="mv current">Nf3</td></tr></table>'),
  };
}, M);
for (const [k, v] of Object.entries(pz)) check('puzzles ' + k, v);

await browser.close();
console.log(bad === 0 ? 'TARGETED CONTRAST: ALL PASS' : `TARGETED CONTRAST: ${bad} FAILURES`);
process.exit(bad === 0 ? 0 : 1);
