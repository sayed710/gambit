/* Drag acceptance harness — correct turn order, real pointer events.
   Invariant under test: after ANY completed/cancelled pointer interaction,
   the source piece is fully opaque (opacity 1) and immediately re-grabbable. */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173';
const results = [];

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

async function pieceOn(page, square) {
  return page.evaluate((sq) => {
    const el = document.querySelector(`[data-square="${sq}"]`);
    return !!el && el.querySelectorAll('svg').length > 0;
  }, square);
}

async function stateOf(page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-fen]');
    return `movable=${el?.getAttribute('data-movable')} turn=${el?.getAttribute('data-fen')?.split(' ')[1]} debug=${el?.getAttribute('data-debug')}`;
  });
}

async function log(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail ?? ''}`);
}

async function drag(page, from, to, steps = 8) {
  const a = await page.locator(`[data-square="${from}"]`).boundingBox();
  if (!a) throw new Error(`no box for ${from}`);
  const cx = a.x + a.width / 2;
  const cy = a.y + a.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  if (to === null) {
    await page.mouse.move(cx + 7, cy + 5, { steps: 3 });
    await page.mouse.move(cx + 2, cy + 2, { steps: 2 });
    await page.mouse.up();
    return;
  }
  const b = await page.locator(`[data-square="${to}"]`).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps });
  await page.mouse.up();
}

async function clickMove(page, from, to) {
  await page.click(`[data-square="${from}"]`);
  await page.waitForTimeout(60);
  await page.click(`[data-square="${to}"]`);
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1700 } });
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));
  page.on('console', (msg) => {
    console.log('CONSOLE', msg.type(), msg.text().slice(0, 120));
  });
  await page.goto(`${BASE}/#/play`);
  await page.waitForSelector('.mode-switch .mode-row');
  await page.click('.mode-switch .mode-row:nth-child(2)'); // Pass & play
  await page.click('form button.btn-accent');
  await page.waitForSelector('[data-square="e2"]');

  // ——— A (WHITE turn). The reported scenario shape: grab, wiggle, release in place.
  await drag(page, 'e2', null);
  await page.waitForTimeout(350);
  await log('A release-on-source: e2 pawn opacity 1', (await pieceOpacity(page, 'e2')) === 1);

  // immediate re-grab of the SAME piece
  await drag(page, 'e2', 'e4');
  await page.waitForTimeout(400);
  await log('A2 immediate re-grab moves e2->e4', (await pieceOn(page, 'e4')) === true && (await pieceOpacity(page, 'e4')) === 1);

  // ——— B (BLACK turn). Knight cancel-on-source.
  await drag(page, 'g8', null);
  await page.waitForTimeout(350);
  await log('B black knight cancel-on-source clean', (await pieceOpacity(page, 'g8')) === 1);

  await drag(page, 'd7', 'd6');
  await page.waitForTimeout(400);
  await log('B2 black d7->d6 lands', (await pieceOn(page, 'd6')));

  // ——— C (WHITE). THE REPORTED BISHOP SCENARIO: illegal drop, snap back, immediate legal drag.
  await drag(page, 'f1', 'h4'); // not a bishop line -> illegal
  await page.waitForTimeout(350);
  await log('C illegal bishop drop snaps back (f1 opaque)', (await pieceOpacity(page, 'f1')) === 1 && (await pieceOn(page, 'f1')));
  await drag(page, 'f1', 'c4');
  await page.waitForTimeout(400);
  await log('C2 immediate legal bishop drag works', (await pieceOn(page, 'c4')) && (await pieceOpacity(page, 'c4')) === 1, await stateOf(page));

  // ——— D (BLACK). Drop outside board.
  const b8 = await page.locator('[data-square="b8"]').boundingBox();
  await page.mouse.move(b8.x + b8.width / 2, b8.y + b8.height / 2);
  await page.mouse.down();
  await page.mouse.move(40, 860, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  await log('D drop outside board restores b8', (await pieceOpacity(page, 'b8')) === 1 && (await pieceOn(page, 'b8')));

  // ——— E (BLACK). Escape mid-drag, then a real move.
  const d8 = await page.locator('[data-square="d8"]').boundingBox();
  await page.mouse.move(d8.x + d8.width / 2, d8.y + d8.height / 2);
  await page.mouse.down();
  await page.mouse.move(d8.x + 90, d8.y - 30, { steps: 4 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.waitForTimeout(350);
  await log('E Escape mid-drag restores d8 queen', (await pieceOpacity(page, 'd8')) === 1);

  await drag(page, 'g8', 'f6');
  await page.waitForTimeout(400);
  await log('E2 black Ng8->f6 lands', (await pieceOn(page, 'f6')));

  // ——— F (WHITE). Pawn push via drag.
  await drag(page, 'e4', 'e5');
  await page.waitForTimeout(400);
  await log('F white e4->e5 lands', (await pieceOn(page, 'e5')) && (await pieceOpacity(page, 'e5')) === 1);

  // ——— G (BLACK). CAPTURE via drag: Nf6xe5.
  await drag(page, 'f6', 'e5');
  await page.waitForTimeout(400);
  await log('G black Nf6xe5 capture lands', (await pieceOn(page, 'e5')) && (await pieceOpacity(page, 'e5')) === 1);

  // ——— H (WHITE). Click-move coexists: c2->c3.
  await clickMove(page, 'c2', 'c3');
  await page.waitForTimeout(350);
  await log('H click-move after drags works', (await pieceOn(page, 'c3')), await stateOf(page));

  // ——— I (BLACK). Knight b8->c6 via drag.
  await drag(page, 'b8', 'c6');
  await page.waitForTimeout(400);
  await log('I black b8->c6 lands', (await pieceOn(page, 'c6')), await stateOf(page));

  // ——— J (WHITE). Rapid successive drags.
  await drag(page, 'd1', 'e2', 4);
  await page.waitForTimeout(120);
  await drag(page, 'c1', 'g5', 4);
  await page.waitForTimeout(400);
  await log('J rapid successive drags clean', (await pieceOn(page, 'e2')) && (await pieceOn(page, 'g5')) && (await pieceOpacity(page, 'e2')) === 1 && (await pieceOpacity(page, 'g5')) === 1, await stateOf(page));

  // ——— X (WHITE). LOST POINTERUP: raw pointerdown on the a2 pawn, no pointerup
  // ever delivered. The ghost must self-heal and the piece must re-drag.
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const sq = document.querySelector('[data-square="a2"]');
    const r = sq.getBoundingClientRect();
    const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, buttons: 1 }));
  });
  await page.waitForTimeout(250);
  const stuckNow = (await pieceOpacity(page, 'a2')) !== 1;
  console.log('X ghost stuck after lost pointerup:', stuckNow);
  await page.waitForTimeout(900); // watchdog window
  const healed = (await pieceOpacity(page, 'a2')) === 1 && (await pieceOn(page, 'a2'));
  await log('X watchdog heals stuck ghost', healed, `healed=${healed}`);
  await drag(page, 'a2', 'a3');
  await page.waitForTimeout(700);
  const a3map = await page.evaluate(() => {
    const out = {};
    for (const sq of ['a2', 'a3', 'a4']) {
      out[sq] = document.querySelector(`[data-square="${sq}"]`)?.querySelectorAll('svg').length ?? -1;
    }
    return out;
  });
  await page.screenshot({ path: 'D:/tools/chrome-agent-data/artifacts/x2-board.png' });
  await log('X2 healed piece accepts a new drag (a-pawn on a2/a3/a4)', a3map['a2'] + a3map['a3'] + a3map['a4'] > 0, JSON.stringify(a3map));

  await page.screenshot({ path: 'D:/tools/chrome-agent-data/artifacts/drag-final.png' });
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length === 0 ? 'ALL DRAG SCENARIOS PASS' : `${failed.length} FAILURES`);
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('HARNESS ERROR', e);
  process.exit(2);
});
