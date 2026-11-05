/* PR #9 final QA probe — HARD ASSERTIONS only (exit 1 on any failure).

   Covers: brand assets actually LOADING (not merely referenced), the
   licensed web font being genuinely fetched and used, real chessboard
   output in the Play preview (64 squares, 32 starting pieces, square
   geometry), board anti-collapse sizing across short viewports and
   zoom-equivalents, contrast of the re-pointed text tokens, overflow,
   mobile navigation, and zero console errors. Negative regressions for
   the hero image and the preview board prove the assertions can fail. */
import { chromium } from 'playwright';

const BASE = process.env.QA_BASE ?? 'http://localhost:5199';
const out = (n) => `ui-${n}.png`;
const LOCKUP_NATURAL = process.env.QA_LOCKUP ?? '480x190';

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
}

/* WCAG contrast + hero/preview inspectors, evaluated in page context. */
const HELPERS = `
  (() => {
    const lum = (c) => {
      const m = c.match(/rgba?\\(([^)]+)\\)/);
      if (!m) return null;
      const [r, g, b, a] = m[1].split(',').map((s) => parseFloat(s));
      if (a !== undefined && a < 0.35) return null;
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const contrast = (fg, bg) => {
      const l1 = lum(fg), l2 = lum(bg);
      if (l1 == null || l2 == null) return null;
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    /* Hero: resolve the CSS background URL and actually decode the image. */
    const heroCheck = async () => {
      const el = document.querySelector('.hero-photo');
      if (!el) return { ok: false, reason: 'no .hero-photo' };
      const url = (getComputedStyle(el).backgroundImage.match(/url\\("?([^")]+)"?\\)/) || [])[1];
      if (!url) return { ok: false, reason: 'no background url' };
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const r = el.getBoundingClientRect();
        return { ok: img.naturalWidth > 0 && r.width > 200 && r.height > 100, w: img.naturalWidth, h: img.naturalHeight, box: Math.round(r.width) + 'x' + Math.round(r.height) };
      } catch (e) {
        return { ok: false, reason: 'decode failed: ' + e.message };
      }
    };
    /* PlayPreview: the REAL react-chessboard output, not the wrapper.
       64 [data-square] cells a8..h1, 32 [data-piece] nodes on their
       exact standard-start squares, square geometry, visible. */
    const previewCheck = (rootSelector) => {
      const root = document.querySelector(rootSelector);
      if (!root) return { ok: false, reason: 'no root ' + rootSelector };
      const squares = [...root.querySelectorAll('[data-square]')];
      const labels = squares.map((s) => s.getAttribute('data-square'));
      const pieces = [...root.querySelectorAll('[data-piece]')];
      const first = root.querySelector('[data-square]');
      const boardEl = first ? first.parentElement.parentElement : null;
      const rect = boardEl ? boardEl.getBoundingClientRect() : { width: 0, height: 0 };
      const START = {
        a8: 'bR', b8: 'bN', c8: 'bB', d8: 'bQ', e8: 'bK', f8: 'bB', g8: 'bN', h8: 'bR',
        a7: 'bP', b7: 'bP', c7: 'bP', d7: 'bP', e7: 'bP', f7: 'bP', g7: 'bP', h7: 'bP',
        a2: 'wP', b2: 'wP', c2: 'wP', d2: 'wP', e2: 'wP', f2: 'wP', g2: 'wP', h2: 'wP',
        a1: 'wR', b1: 'wN', c1: 'wB', d1: 'wQ', e1: 'wK', f1: 'wB', g1: 'wN', h1: 'wR',
      };
      const pieceAt = (sq) => {
        const cell = root.querySelector('[data-square="' + sq + '"]');
        const p = cell && cell.querySelector('[data-piece]');
        return p ? p.getAttribute('data-piece') : null;
      };
      const mismatches = Object.entries(START).filter(([sq, pc]) => pieceAt(sq) !== pc).map(([sq]) => sq);
      const ok =
        squares.length === 64 &&
        labels[0] === 'a8' && labels[63] === 'h1' &&
        pieces.length === 32 &&
        mismatches.length === 0 &&
        Math.abs(rect.width - rect.height) <= 2 &&
        rect.width > 120;
      return { ok, squares: squares.length, pieces: pieces.length, geom: Math.round(rect.width) + 'x' + Math.round(rect.height), mismatches };
    };
    return { contrast, heroCheck, previewCheck };
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
    headerW: Math.round(img.getBoundingClientRect().width),
  };
});
check('lockup asset loads', lockup.present && lockup.complete, lockup.natural);
check('lockup is the recomposed licensed asset', lockup.natural === LOCKUP_NATURAL, lockup.natural);

/* P2-8: the OFL font must be genuinely FETCHED and USED — a resource
   timing entry for the TTF plus document.fonts.load resolution plus a
   glyph-width difference against the serif fallback. */
const font = await page.evaluate(async () => {
  const entry = performance.getEntriesByType('resource').find((e) => /GreatVibes-Regular\.ttf/.test(e.name));
  const loaded = await document.fonts.load('1rem "Great Vibes"', 'Gambit');
  const probe = document.createElement('span');
  probe.textContent = 'Gambit Gg';
  probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font-size:40px;';
  document.body.appendChild(probe);
  probe.style.fontFamily = '"Great Vibes"';
  const wBrand = probe.getBoundingClientRect().width;
  probe.style.fontFamily = 'Georgia, serif';
  const wFallback = probe.getBoundingClientRect().width;
  probe.remove();
  return {
    fetched: !!entry && entry.decodedBodySize > 100000,
    fontsLoad: loaded.length > 0,
    glyphsDiffer: Math.abs(wBrand - wFallback) > 8,
    widths: [Math.round(wBrand), Math.round(wFallback)],
  };
});
check('Great Vibes TTF actually fetched over network', font.fetched, String(font.fetched));
check('Font Loading API resolves Great Vibes', font.fontsLoad);
check('rendered glyphs differ from serif fallback', font.glyphsDiffer, `widths=${font.widths}`);

/* P2-5: hero photo must actually decode (negative regression follows). */
const hero2 = await page.evaluate(async (h) => { const { heroCheck } = eval(h); return await heroCheck(); }, HELPERS);
check('hero photo decodes with real dimensions', hero2.ok === true, JSON.stringify(hero2));

const heroBg = await page.evaluate(() => getComputedStyle(document.querySelector('.hero-photo')).backgroundImage);
check('hero references the CC0 queen asset', heroBg.includes('hero-chess.jpg'), heroBg.slice(0, 80));

await page.screenshot({ path: out('home-header-1440') });
await page.evaluate(() => document.querySelector('.hero')?.scrollIntoView());
await page.waitForTimeout(400);
await page.screenshot({ path: out('home-hero-1440') });

/* feature CTA hover contrast */
await page.evaluate(() => document.getElementById('features')?.scrollIntoView());
await page.waitForTimeout(700);
await page.screenshot({ path: out('home-features-1440') });
const cta = page.locator('.feature-cta').first();
await cta.hover();
await page.waitForTimeout(120);
const ctaColors = await page.evaluate((h) => {
  const { contrast } = eval(h);
  const el = document.querySelector('.feature-cta');
  const cs = getComputedStyle(el);
  return { ratio: contrast(cs.color, getComputedStyle(el.closest('.feature-card')).backgroundColor) };
}, HELPERS);
check('feature CTA hover contrast ≥ 4.5', ctaColors.ratio >= 4.5, `ratio=${ctaColors.ratio?.toFixed(2)}`);
await cta.focus();
const focusOutline = await page.evaluate(() => getComputedStyle(document.querySelector('.feature-cta:focus')).outlineStyle);
check('feature CTA focus-visible outline', focusOutline !== 'none');

/* P2-6: PlayPreview real board (negative regression follows). */
const preview = await page.evaluate((h) => { const { previewCheck } = eval(h); return previewCheck('#features .feature-card.wide .ui-review-board'); }, HELPERS);
check('PlayPreview renders a real 8×8 board', preview.ok === true, JSON.stringify({ squares: preview.squares, pieces: preview.pieces, geom: preview.geom }));
check('all 32 pieces on their exact standard-start squares', preview.ok === true && preview.mismatches.length === 0, 'mismatches=' + JSON.stringify(preview.mismatches));

/* ---------- play: board sizing + fold ---------- */
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
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height), viewportH: innerHeight, docH: document.documentElement.scrollHeight };
});
check('play board visible', !!playBoard && playBoard.w > 200, JSON.stringify(playBoard));
check('play board is square', !!playBoard && Math.abs(playBoard.w - playBoard.h) <= 2, `w=${playBoard?.w} h=${playBoard?.h}`);
check('play board fits above the fold @1440x900', !!playBoard && playBoard.bottom <= playBoard.viewportH, `bottom=${playBoard?.bottom}`);
await page.screenshot({ path: out('play-1440') });

/* ---------- analysis: proportions + eval-score chip ---------- */
await page.goto(`${BASE}/#/analysis`, { waitUntil: 'load' });
await page.waitForSelector('.workspace-layout .board-surface', { timeout: 20000 });
await page.waitForTimeout(3500);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
const analysis = await page.evaluate(() => {
  const b = document.querySelector('.workspace-layout .board-surface');
  const aside = document.querySelector('.workspace-layout aside');
  const r = b.getBoundingClientRect();
  return {
    board: { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) },
    asideW: aside ? Math.round(aside.getBoundingClientRect().width) : null,
    viewportH: innerHeight,
  };
});
check('analysis board square and large', analysis.board.w > 250 && Math.abs(analysis.board.w - analysis.board.h) <= 2, JSON.stringify(analysis.board));
check('analysis side panel bounded (≤ 410px)', analysis.asideW <= 410, `asideW=${analysis.asideW}`);
const scoreRatio = await page.evaluate((h) => {
  const { contrast } = eval(h);
  const cs = getComputedStyle(document.querySelector('.eval-bar .eval-score b'));
  return { ratio: contrast(cs.color, cs.backgroundColor), color: cs.color, bg: cs.backgroundColor };
}, HELPERS);
check('eval-score chip contrast ≥ 4.5', scoreRatio.ratio >= 4.5, `ratio=${scoreRatio.ratio?.toFixed(2)}`);
await page.screenshot({ path: out('analysis-1440') });

/* ---------- board anti-collapse matrix (P2-4) ---------- */
for (const [w, h, label] of [[1366, 768, 'laptop'], [1024, 600, 'short-laptop'], [1280, 500, 'short-desktop'], [720, 450, 'zoom200-equivalent']]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}/#/play`, { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  if (await page.locator('button:has-text("Start game")').count()) {
    await page.locator('button:has-text("Start game")').click();
    await page.waitForSelector('.board-surface', { timeout: 15000 });
  }
  await page.waitForTimeout(1800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  const m = await page.evaluate(() => {
    const el = document.querySelector('.board-surface');
    const r = el.getBoundingClientRect();
    return {
      w: Math.round(r.width), h: Math.round(r.height),
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollableY: document.documentElement.scrollHeight > innerHeight,
    };
  });
  await page.screenshot({ path: out(`play-${w}x${h}`) });
  check(`board ≥ 400px @${label} ${w}x${h}`, m.w >= 400, `board=${m.w}x${m.h}`);
  check(`square board @${label}`, Math.abs(m.w - m.h) <= 2, `board=${m.w}x${m.h}`);
  check(`no horizontal overflow @${label}`, !m.overflowX);
  check(`vertical scroll available when board exceeds fold @${label}`, m.w + 220 > h ? m.scrollableY : true, `docScrolls=${m.scrollableY}`);
}

/* ---------- responsive home + mobile nav ---------- */
for (const [w, h] of [[1024, 768], [768, 1024], [390, 844]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}/#/`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: out(`home-${w}`), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(`no horizontal overflow @${w}`, !overflow);
  if (w === 390) {
    check('mobile menu button visible @390', await page.locator('.menu-btn').isVisible());
    const footLockup = await page.evaluate(() => {
      const img = document.querySelector('.footer-brand .brand-lockup, footer .brand-lockup');
      if (!img) return 'missing';
      const r = img.getBoundingClientRect();
      return img.complete && r.width > 20 && r.height > 8 ? `${Math.round(r.width)}x${Math.round(r.height)}` : 'unrendered';
    });
    check('footer lockup renders @390', typeof footLockup === 'string' && /\d+x\d+/.test(footLockup), footLockup);
  }
}
await page.setViewportSize({ width: 768, height: 1024 });
await page.goto(`${BASE}/#/analysis`, { waitUntil: 'load' });
await page.waitForTimeout(2500);
check('no horizontal overflow on analysis @768', !(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)));

/* ---------- negative regressions ---------- */
{
  // hero: block the request — the checker must fail (proving it inspects
  // the real image, not the CSS declaration).
  const blocked = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await blocked.route('**/assets/hero-chess.jpg', (route) => route.abort());
  await blocked.goto(`${BASE}/#/`, { waitUntil: 'load' });
  await blocked.waitForTimeout(800);
  const heroBlocked = await blocked.evaluate(async (h) => { const { heroCheck } = eval(h); return await heroCheck(); }, HELPERS);
  check('NEGATIVE: blocked hero image fails the hero check', heroBlocked.ok === false, JSON.stringify(heroBlocked));
  await blocked.close();

  // preview: an empty wrapper must fail the board check.
  const previewNegative = await page.evaluate((h) => {
    const { previewCheck } = eval(h);
    const fake = document.createElement('div');
    fake.className = 'ui-review-board';
    fake.id = 'negative-preview-probe';
    document.body.appendChild(fake);
    const r = previewCheck('#negative-preview-probe');
    fake.remove();
    return r;
  }, HELPERS);
  check('NEGATIVE: placeholder wrapper fails the board check', previewNegative.ok === false && previewNegative.squares === 0, JSON.stringify({ squares: previewNegative.squares, pieces: previewNegative.pieces }));
}

/* ---------- console errors ---------- */
check('zero console/page errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');

await browser.close();
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
