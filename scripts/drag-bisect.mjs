/* Bisect v2 — legal-move-correct drag probes.
   Sequence: 1.e4 (drag) d6 (drag) 2.Bc4 (probe: first white bishop drag)
             ... f6 (drag) 3.Bc4-illegal->h4 (drag) probe: Bc4-b3 (legal) */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173';

async function center(page, square) {
  const a = await page.locator(`[data-square="${square}"]`).boundingBox();
  return { x: a.x + a.width / 2, y: a.y + a.height / 2 };
}

async function dragSq(page, from, to, steps = 8) {
  const a = await center(page, from);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  if (to === null) {
    await page.mouse.move(a.x + 7, a.y + 5, { steps: 3 });
    await page.mouse.move(a.x + 2, a.y + 2, { steps: 2 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    return;
  }
  const b = await center(page, to);
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

async function pieceOn(page, square) {
  return page.evaluate((sq) => {
    const el = document.querySelector(`[data-square="${sq}"]`);
    return !!el && el.querySelectorAll('svg').length > 0;
  }, square);
}

async function pieceOpacity(page, square) {
  return page.evaluate((sq) => {
    const el = document.querySelector(`[data-square="${sq}"] svg`);
    if (!el) return null;
    let opacity = 1;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const o = getComputedStyle(n).opacity;
      if (o !== '1') opacity = Math.min(opacity, parseFloat(o));
    }
    return opacity;
  }, square);
}

async function orientation(page) {
  // notation glyphs: alpha files render at the BOTTOM row for white orientation
  return page.evaluate(() => {
    const board = document.querySelector('[class*="board"]');
    const nums = document.querySelectorAll('[style*="padding-top"]');
    void nums;
    const pieces = {};
    for (const sq of document.querySelectorAll('[data-square]')) {
      if (sq.querySelector('svg')) pieces[sq.dataset.square] = true;
    }
    // white king position tells orientation only if we track moves; instead check
    // the first row rendered: in white orientation a8 is top-left
    const firstSq = document.querySelector('[data-square]');
    void firstSq;
    return Object.keys(pieces).slice(0, 4).join(',');
  });
}

async function fenOf(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-fen]');
    return `${el?.getAttribute('data-fen') ?? 'none'} | movable=${el?.getAttribute('data-movable')} | orient=${el?.getAttribute('data-orientation')}`;
  });
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/#/play`);
  await page.waitForSelector('.mode-switch .mode-row');
  await page.click('.mode-switch .mode-row:nth-child(2)');
  await page.click('form button.btn-accent');
  await page.waitForSelector('[data-square="e2"]');

  // 1. e4 — known-good baseline drag
  await dragSq(page, 'e2', 'e4');
  console.log('1.e4 landed:', await pieceOn(page, 'e4'), '| fen:', await fenOf(page));

  // 1... d6 — black baseline
  await dragSq(page, 'd7', 'd6');
  console.log('1...d6 landed:', await pieceOn(page, 'd6'), '| fen:', await fenOf(page));
  console.log('    turn marker: player bar above');

  // 2. Bc4 — THE REAL BISHOP DRAG (legal: e2 now empty)
  await dragSq(page, 'f1', 'c4');
  console.log('2.Bc4 landed:', await pieceOn(page, 'c4'), 'opacity:', await pieceOpacity(page, 'c4'), '| fen:', await fenOf(page));
  await page.screenshot({ path: 'D:/tools/chrome-agent-data/artifacts/bisect-before-bc4.png' });

  // decisive: what element sits on top at f1's center, and does a synthetic
  // pointerdown on the piece element reach the dnd activator?
  const topEl = await page.evaluate(() => {
    const sq = document.querySelector('[data-square="f1"]');
    if (!sq) return ['NO f1 SQUARE'];
    const r = sq.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const el = document.elementFromPoint(x, y);
    const chain = [];
    for (let n = el; n && chain.length < 5; n = n.parentElement) {
      chain.push(`${n.tagName} cls="${String(n.className).slice(0, 40)}" piece=${n.getAttribute('data-piece') ?? '-'} sq=${n.getAttribute('data-square') ?? '-'}`);
    }
    const pieceEls = sq.querySelectorAll('[data-piece]').length;
    return { rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`, pieceEls, chain };
  });
  console.log('TOP AT f1:', JSON.stringify(topEl));

  // 1... f6 — black
  await dragSq(page, 'g8', 'f6');
  console.log('1...f6 landed:', await pieceOn(page, 'f6'));

  // wiggle-cancel on the black rook h8
  await dragSq(page, 'h8', null);
  console.log('wiggle h8 clean:', (await pieceOpacity(page, 'h8')) === 1);

  // 3. Bc4->h4 ILLEGAL drag, immediate snap-back check
  await dragSq(page, 'c4', 'h4');
  console.log('illegal Bc4-h4: bishop still c4:', await pieceOn(page, 'c4'), 'opacity:', await pieceOpacity(page, 'c4'));

  // immediate legal Bc4->b3 — THE USER'S EXACT RECOVERY SCENARIO
  await dragSq(page, 'c4', 'b3');
  const recovered = (await pieceOn(page, 'b3')) && (await pieceOpacity(page, 'b3')) === 1;
  console.log('IMMEDIATE RECOVERY Bc4->b3:', recovered, 'opacity:', await pieceOpacity(page, 'b3'));

  // black reply g6, white Bd3? b3->d5? — just verify board sanity: g7->g6 drag
  await dragSq(page, 'g7', 'g6');
  console.log('...g6 landed:', await pieceOn(page, 'g6'));

  await page.screenshot({ path: 'D:/tools/chrome-agent-data/artifacts/bisect-v2-end.png' });
  await browser.close();
}

run().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
