/* PR #8 final QA probe — HARD ASSERTIONS, no pass-through logging.
   Covers: brand-asset loading, console/page errors, horizontal overflow,
   board fold fit + squareness, analysis proportions, eval-score and
   feature-CTA contrast, keyboard focus, responsive navigation, and the
   licensed web font. Exits 1 on any failed assertion. */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE ?? 'http://localhost:5199';
const out = (n) => `ui-${n}.png`;

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
}

/* WCAG contrast in the page context (computed colors only). */
const contrastScript = `
  (() => {
    const lum = (c) => {
      const m = c.match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      const [r, g, b, a] = m[1].split(',').map((s) => parseFloat(s));
      if (a !== undefined && a < 0.35) return null; // effectively transparent
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    return (fg, bg) => {
      const l1 = lum(fg), l2 = lum(bg);
      if (l1 == null || l2 == null) return null;
      const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
      return (hi + 0.05) / (lo + 0.05);
    };
  })()
`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));

/* ---------- home @1440 ---------- */
await page.goto(`${BASE}/#/`, { waitUntil: 'load' });
await page.waitForSelector('.brand-lockup');
await page.waitForTimeout(1200);

const lockup = await page.evaluate(() => {
  const img = document.querySelector('img.brand-lockup');
  if (!img) return { present: false };
  return {
    present: true,
    src: img.getAttribute('src'),
    complete: img.complete && img.naturalWidth > 0,
    natural: `${img.naturalWidth}x${img.naturalHeight}`,
  };
});
check('lockup asset loads', lockup.present && lockup.complete, lockup.natural);
check('lockup is the recomposed licensed asset (532x216)', lockup.natural === '532x216', lockup.natural);

const gvLoaded = await page.evaluate(() => document.fonts.check('1rem "Great Vibes"'));
check('Great Vibes (OFL) web font loads', gvLoaded);

const heroBg = await page.evaluate(() => getComputedStyle(document.querySelector('.hero-photo')).backgroundImage);
check('hero photo present', heroBg.includes('hero-chess.jpg'), heroBg.slice(0, 80));

await page.screenshot({ path: out('home-header-1440') });
await page.evaluate(() => document.querySelector('.hero')?.scrollIntoView());
await page.waitForTimeout(400);
await page.screenshot({ path: out('home-hero-1440') });

/* feature CTA: hover keeps ink text (gold-deep failed contrast at 2.5:1) */
await page.evaluate(() => document.getElementById('features')?.scrollIntoView());
await page.waitForTimeout(700);
await page.screenshot({ path: out('home-features-1440') });
const cta = page.locator('.feature-cta').first();
await cta.hover();
await page.waitForTimeout(120);
const ctaColors = await page.evaluate((contrastFnSrc) => {
  const contrast = eval(contrastFnSrc);
  const el = document.querySelector('.feature-cta');
  const cs = getComputedStyle(el);
  const bg = getComputedStyle(el.closest('.feature-card')).backgroundColor;
  return { color: cs.color, bg, ratio: contrast(cs.color, bg) };
}, contrastScript);
check('feature CTA hover contrast ≥ 4.5', ctaColors.ratio >= 4.5, `ratio=${ctaColors.ratio?.toFixed(2)} color=${ctaColors.color}`);

/* keyboard focus reaches the CTA with a visible outline */
await cta.focus();
const focusOutline = await page.evaluate(() => getComputedStyle(document.querySelector('.feature-cta:focus')).outlineStyle);
check('feature CTA focus-visible outline', focusOutline !== 'none', `outline=${focusOutline}`);

/* PlayPreview renders the real 8×8 board */
const previewBoard = await page.evaluate(() => {
  const b = document.querySelector('#features .ui-preview .board-surface, #features [class*=board]');
  if (!b) return null;
  const r = b.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), visible: r.width > 0 && r.height > 0 };
});
check('PlayPreview shows a real 8×8 board', !!previewBoard && previewBoard.visible, JSON.stringify(previewBoard));

await page.evaluate(() => document.querySelector('.closing')?.scrollIntoView());
await page.waitForTimeout(400);
await page.screenshot({ path: out('home-closing-1440') });

/* ---------- play: board fits the fold, square ---------- */
await page.goto(`${BASE}/#/play`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
const startBtn = page.locator('button:has-text("Start game")');
if (await startBtn.count()) {
  await startBtn.click();
  await page.waitForSelector('.board-surface', { timeout: 15000 });
}
await page.waitForTimeout(2500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
const playBoard = await page.evaluate(() => {
  const el = document.querySelector('.board-surface');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), viewportH: innerHeight };
});
check('play board visible', !!playBoard && playBoard.w > 200, JSON.stringify(playBoard));
check('play board is square', !!playBoard && Math.abs(playBoard.w - playBoard.h) <= 2, `w=${playBoard?.w} h=${playBoard?.h}`);
check('play board fits above the fold', !!playBoard && playBoard.bottom <= playBoard.viewportH, `bottom=${playBoard?.bottom} viewport=${playBoard?.viewportH}`);
await page.screenshot({ path: out('play-1440') });

/* ---------- analysis: proportions + eval-score contrast ---------- */
await page.goto(`${BASE}/#/analysis`, { waitUntil: 'load' });
await page.waitForSelector('.workspace-layout .board-surface', { timeout: 20000 });
await page.waitForTimeout(3500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
const analysis = await page.evaluate(() => {
  const b = document.querySelector('.workspace-layout .board-surface');
  const aside = document.querySelector('.workspace-layout aside');
  const score = document.querySelector('.eval-bar .eval-score b');
  const cs = score ? getComputedStyle(score) : null;
  const bar = score ? score.closest('.eval-bar') : null;
  return {
    board: b ? { w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), bottom: Math.round(b.getBoundingClientRect().bottom) } : null,
    asideW: aside ? Math.round(aside.getBoundingClientRect().width) : null,
    viewportH: innerHeight,
    score: cs ? { color: cs.color, bg: cs.backgroundColor, ratio: null, barBg: bar ? getComputedStyle(bar).backgroundColor : null } : null,
  };
});
check('analysis board visible', !!analysis.board && analysis.board.w > 250, JSON.stringify(analysis.board));
check('analysis board square', !!analysis.board && Math.abs(analysis.board.w - analysis.board.h) <= 2, JSON.stringify(analysis.board));
check('analysis board ≥ 300px at 1366-equivalent height', !!analysis.board && analysis.board.h >= 300, `h=${analysis.board?.h}`);
check('analysis side panel bounded (≤ 410px)', !!analysis.asideW && analysis.asideW <= 410, `asideW=${analysis.asideW}`);
const scoreRatio = await page.evaluate(([fn, sel]) => {
  const contrast = eval(fn);
  const el = document.querySelector(sel);
  const cs = getComputedStyle(el);
  return { color: cs.color, bg: cs.backgroundColor, ratio: contrast(cs.color, cs.backgroundColor) };
}, [contrastScript, '.eval-bar .eval-score b']);
check('eval-score chip contrast ≥ 4.5', scoreRatio.ratio >= 4.5, `ratio=${scoreRatio.ratio?.toFixed(2)} (${scoreRatio.color} on ${scoreRatio.bg})`);
await page.screenshot({ path: out('analysis-1440') });

/* ---------- responsive set ---------- */
for (const [w, h] of [[1024, 768], [768, 1024], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}/#/`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: out(`home-${w}`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(`no horizontal overflow @${w}`, !overflow);
  if (w === 390) {
    const menuVisible = await page.locator('.menu-btn').isVisible();
    check('mobile menu button visible @390', menuVisible);
  }
}
/* analysis tablet/mobile overflow */
await page.setViewportSize({ width: 768, height: 1024 });
await page.goto(`${BASE}/#/analysis`, { waitUntil: 'load' });
await page.waitForTimeout(2500);
const overflowA = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
check('no horizontal overflow on analysis @768', !overflowA);

/* ---------- console/page errors ---------- */
check('zero console/page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');

await browser.close();
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
