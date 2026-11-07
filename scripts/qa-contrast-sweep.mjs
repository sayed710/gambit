/* Rendered-contrast verification for the ink tokens AND every page's
   ACTUAL current-move treatment. A real selected move is exercised on
   Review (full game → /review/:id → click a move) and on Analysis
   (tree navigation); Play's live list is intentionally non-selecting,
   so its pairing is measured through the page's real CSS context;
   Puzzles through its real [data-page] scope. Assertions fail (exit 1)
   when a required element cannot be rendered — no silent skips. */
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
    const alphaOf = (bg) => {
      if (/^color\\(/.test(bg)) { const m = bg.match(/\\/\\s*([\\d.]+)\\s*\\)/); return m ? parseFloat(m[1]) : 1; }
      const m = bg.match(/rgba?\\(([^)]+)\\)/);
      if (!m) return 1;
      const parts = m[1].split(',');
      return parts[3] !== undefined ? parseFloat(parts[3]) : 1;
    };
    const effBg = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (alphaOf(bg) >= 0.85) return bg;
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
function check(name, r, extra = '') {
  const ok = typeof r === 'object' && r !== null && r.ratio !== undefined && r.ratio >= r.needed;
  if (!ok) bad++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${typeof r === 'object' && r ? `ratio=${r.ratio} (needs ${r.needed}) color=${r.color} bg=${r.bg}` : r}${extra ? ' ' + extra : ''}`);
}
/* helper: measure an element (or a selector that may not exist) */
async function measureSel(selector) {
  return page.evaluate(([m, sel]) => {
    const measure = eval(m);
    const el = document.querySelector(sel);
    return el ? measure(el) : 'NOT-FOUND';
  }, [M, selector]);
}
/* helper: measure a freshly injected node inside a real parent (the
   page's real CSS scope applies — same stylesheet, same data-page) */
async function measureInjected(html, parentSel) {
  return page.evaluate(([m, html, parentSel]) => {
    const measure = eval(m);
    const host = document.querySelector(parentSel);
    if (!host) return 'NO-PARENT';
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const node = wrap.firstElementChild;
    host.appendChild(node);
    const target = node.querySelector('td, .mv.current') ?? node;
    const r = measure(target);
    node.remove();
    return r;
  }, [M, html, parentSel]);
}

/* ---------------- Play: gold fill, live list never selects ---------------- */
await page.goto(`${BASE}/#/play`, { waitUntil: 'load' });
await page.waitForTimeout(1200);
const startBtn = page.locator('button:has-text("Start game")');
if (await startBtn.count()) {
  await startBtn.click();
  await page.waitForSelector('.board-surface', { timeout: 15000 });
  await page.waitForTimeout(2200);
}
const playSelectable = await page.evaluate(() => !!document.querySelector('.move-list .mv.selectable'));
const playCur = await measureInjected('<table class="move-list"><tr><td class="mv current">Nf3</td></tr></table>', '.move-list') ;
check('play .mv.current pairing (charcoal on gold fill)', playCur, playSelectable ? '' : '[live list is non-selecting by design — measured in the page\'s real CSS scope]');

/* ---------------- Review: REAL selected move ---------------- */
// create a finished record with an engine report, then open its review
await page.goto(`${BASE}/#/play`, { waitUntil: 'load' });
await page.waitForTimeout(800);
if (await page.locator('button:has-text("Start game")').count()) {
  await page.locator('button:has-text("Start game")').click();
  await page.waitForSelector('.board-surface', { timeout: 15000 });
}
await page.waitForTimeout(1500);
// play e4 + engine reply via the board's click-move path
await page.evaluate(() => {
  const fire = (sq) => {
    const cell = document.querySelector(`[data-square="${sq}"]`);
    cell?.querySelector('[data-piece], [role="button"]')?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    cell?.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
  };
  fire('e2');
});
const hasMoves = await page.evaluate(() => document.querySelectorAll('.move-list td.mv').length);
if (hasMoves < 2) {
  // fall back to the drag path used by the other QA suites
  const vp = await page.evaluate(() => {
    const c = document.querySelector('[data-square="e2"]').getBoundingClientRect();
    return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
  });
  await page.mouse.move(vp.x, vp.y);
  await page.mouse.down();
  const to = await page.evaluate(() => {
    const c = document.querySelector('[data-square="e4"]').getBoundingClientRect();
    return { x: c.x + c.width / 2, y: c.y + c.height / 2 };
  });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(2500);
}
const pliesNow = await page.evaluate(() => document.querySelectorAll('.move-list td.mv').length);
if (pliesNow < 2) { console.log('FAIL  review setup: could not create a 2-ply game'); bad++; }
else {
  // resign so the record is durable, then open its review
  await page.click('button:has-text("Resign")');
  const danger = page.locator('.btn-danger:visible').last();
  if (await danger.count()) { await danger.click().catch(() => {}); }
  await page.waitForTimeout(900);
  const gameId = await page.evaluate(() => JSON.parse(localStorage.getItem('gambit.profile') ?? '{}').games[0]?.id);
  if (!gameId) { console.log('FAIL  review setup: no saved game id'); bad++; }
  else {
    await page.goto(`${BASE}/#/review/${gameId}`, { waitUntil: 'load' });
    await page.waitForSelector('.move-list td.mv', { timeout: 90000 });
    await page.waitForTimeout(1200);
    let reviewCur = await measureSel('.move-list .mv.current');
    if (reviewCur === 'NOT-FOUND') {
      // select the first move explicitly (valid selection)
      await page.locator('.move-list td.mv.selectable').first().click();
      await page.waitForTimeout(400);
      reviewCur = await measureSel('.move-list .mv.current');
    }
    // park the pointer OFF the cell so hover state cannot contaminate
    // the resting measurement (the hover wash was the 1.41:1 defect)
    await page.mouse.move(5, 5);
    await page.waitForTimeout(250);
    reviewCur = await measureSel('.move-list .mv.current');
    check('review .mv.current (REAL selected move, blue-gray fill)', reviewCur);
    /* PIXEL TRUTH: screenshot the cell itself at this instant and sample
       its ink-free edge — the blended pixel background must still pair
       with the computed foreground at ≥ 4.5:1. */
    const cur = page.locator('.move-list .mv.current').first();
    await cur.screenshot({ path: 'ui-review-selected-move-cell.png' });
    const pixel = await page.evaluate(() => {
      const el = document.querySelector('.move-list .mv.current');
      return { color: getComputedStyle(el).color, box: el.getBoundingClientRect() };
    });
    const sharpMod = await import('sharp');
    const { data, info } = await sharpMod.default('ui-review-selected-move-cell.png').raw().toBuffer({ resolveWithObject: true });
    // sample a text-free strip (top 6px) for the blended background
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 1; y < 6; y++) for (let x = 2; x < info.width - 2; x += 2) {
      const i = (y * info.width + x) * info.channels;
      r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
    }
    const blend = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
    const pixelCheck = await page.evaluate(([fg, bg]) => {
      const lum = (c) => { const mm = c.match(/rgba?\(([^)]+)\)/); if (!mm) return null; const [R, G, B, A] = mm[1].split(',').map(parseFloat); if (A !== undefined && A < 0.35) return null; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(R) + 0.7152 * f(G) + 0.0722 * f(B); };
      const l1 = lum(fg), l2 = lum(bg);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    }, [pixel.color, blend]);
    check('review current-cell PIXEL background contrast ≥ 4.5', { ratio: pixelCheck, needed: 4.5, color: pixel.color, bg: blend });
    /* HOVER STATE: hovering the selected cell must keep the solid pairing */
    const box = await cur.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(250);
    const hoverCur = await measureSel('.move-list .mv.current');
    check('review .mv.current HOVER keeps accessible pairing', hoverCur);
    // selection remains visually clear: current bg must differ from a normal mv bg
    const distinct = await page.evaluate(() => {
      const cur = document.querySelector('.move-list .mv.current');
      const plain = document.querySelector('.move-list td.mv:not(.current)');
      return cur && plain ? getComputedStyle(cur).backgroundColor !== getComputedStyle(plain).backgroundColor : false;
    });
    if (!distinct) bad++;
    console.log(`${distinct ? 'PASS' : 'FAIL'}  review current-move visually distinct from ordinary moves`);
    await page.screenshot({ path: 'ui-review-selected-move.png' });
  }
}

/* ---------------- Analysis: REAL current tree node (.tmv.cur) ---------------- */
await page.goto(`${BASE}/#/analysis`, { waitUntil: 'load' });
await page.waitForSelector('.workspace-layout .board-surface', { timeout: 20000 });
await page.waitForTimeout(1500);
// make a move on the analysis board so the tree has a current node
const treeNodes = await page.locator('.tree-view .tmv').count();
if (!treeNodes) {
  // play e2e4 via drag on the analysis board
  const from = await page.evaluate(() => { const c = document.querySelector('.workspace-layout [data-square="e2"]').getBoundingClientRect(); return { x: c.x + c.width / 2, y: c.y + c.height / 2 }; });
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const to = await page.evaluate(() => { const c = document.querySelector('.workspace-layout [data-square="e4"]').getBoundingClientRect(); return { x: c.x + c.width / 2, y: c.y + c.height / 2 }; });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
}
const analysisCur = await measureSel('.tree-view .tmv.cur');
check('analysis .tmv.cur (REAL current tree move, gold --sea fill)', analysisCur);
await page.screenshot({ path: 'ui-analysis-selected-move.png' });

/* ---------------- Puzzles: real [data-page] scope ---------------- */
await page.goto(`${BASE}/#/puzzles`, { waitUntil: 'load' });
await page.waitForTimeout(1800);
const pzCur = await measureInjected('<table class="move-list"><tr><td class="mv current">Nf3</td></tr></table>', '.page.container');
check('puzzles .mv.current pairing (cream on deep-sage fill)', pzCur);

/* ---------------- keyboard/selection clarity on Review ---------------- */
// selectable cells expose onSelect; ensure the current cell keeps its
// highlight after keyboard-independent selection changes (already
// asserted above). Focus visibility: the cells are <td>s without
// tabindex (pre-existing debt, not part of this contrast finding) —
// the selection itself must remain visible, asserted via distinctness.

await browser.close();
console.log(bad === 0 ? 'SELECTED-MOVE CONTRAST: ALL PASS' : `SELECTED-MOVE CONTRAST: ${bad} FAILURES`);
process.exit(bad === 0 ? 0 : 1);
