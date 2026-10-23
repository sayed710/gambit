/* Phases 5–8 QA: timed game → review (timing panel, coach, practice buttons,
   motifs only when justified), repertoire deviation → save for training →
   practice runner (retry holds, hint, reveal, success), insights sections,
   empty states, responsive 1440/1280/tablet/mobile. Real flows only. */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173';
const results = [];
const log = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const node = (id, san, from, to, fenAfter, color, moveNumber, parentIds = {}) => null;

function repJson() {
  const mk = (id, san, from, to, fenBefore, fenAfter, color, moveNumber) => ({
    id, san, from, to, fenBefore, fenAfter, moveNumber, color, nags: [], children: [],
  });
  const afterE4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';
  const afterE5 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2';
  const afterNf3 = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPPPP1P/RNBQKB1R b KQkq - 1 2';
  const n1 = mk('n1', 'e4', 'e2', 'e4', START, afterE4, 'w', 1);
  const n2 = mk('n2', 'e5', 'e7', 'e5', afterE4, afterE5, 'b', 1);
  const n3 = mk('n3', 'Nf3', 'g1', 'f3', afterE5, afterNf3, 'w', 2);
  n1.children.push(n2);
  n2.children.push(n3);
  return [
    {
      id: 'rep-qa', name: 'QA White', side: 'w', createdAt: 1, updatedAt: 1,
      lines: [
        {
          id: 'l1', name: 'Main line',
          tree: { startFen: START, moves: [n1] },
          preferred: { __root__: 'n1', n1: 'n2', n2: 'n3' },
        },
      ],
    },
  ];
}

async function startPassGame(page) {
  await page.goto(`${BASE}/#/play`);
  try {
    await page.waitForSelector('.mode-switch .mode-row', { timeout: 6000 });
  } catch {
    await page.reload(); // hash-only nav can land mid-boot — hard reload
    await page.waitForSelector('.mode-switch .mode-row', { timeout: 15000 });
  }
  await page.click('.mode-switch .mode-row:nth-child(2)'); // pass & play
  await page.click('form button.btn-accent'); // Start game (default 10+0 = timed)
  await page.waitForSelector('[data-square="e2"]');
}

function dragOn(page) {
  return async (from, to) => {
    const a = await page.locator(`[data-square="${from}"]`).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    const b = await page.locator(`[data-square="${to}"]`).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(320);
  };
}

async function resign(page) {
  await page.click('button:has-text("Resign")');
  const danger = page.locator('.btn-danger:visible, .modal .btn-danger').last();
  try {
    await danger.waitFor({ state: 'visible', timeout: 3000 });
    await danger.click();
  } catch {
    /* confirm-resign disabled — already resigned */
  }
}

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });

  /* ============ GAME 1: timed, real mate (fool's mate as White) ============ */
  {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/training`);
    await page.evaluate(() => localStorage.clear());
    const drag = dragOn(page);
    await startPassGame(page);
    await page.waitForTimeout(1100); // real think time on f3
    await drag('f2', 'f3');
    await page.waitForTimeout(1100);
    await drag('e7', 'e5');
    await page.waitForTimeout(900);
    await drag('g2', 'g4');
    await page.waitForTimeout(900);
    await drag('d8', 'h4');
    await page.waitForTimeout(600);
    const over = await page.locator('text=Checkmate').first().isVisible().catch(() => false);
    const overText = await page.evaluate(() => document.body.innerText);
    log('game1: checkmate ended the game', over || /checkmate/i.test(overText), overText.slice(0, 60));

    const timingOk = await page.evaluate(() => {
      const raw = localStorage.getItem('gambit.profile');
      if (!raw) return { err: 'no profile key' };
      const p = JSON.parse(raw);
      const g = (p.games ?? [])[0];
      if (!g) return { err: 'no game stored' };
      const t = g.moveTimings ?? [];
      const white = t.filter((m) => m.color === 'w');
      return {
        n: t.length,
        whiteN: white.length,
        thinkMin: Math.min(...t.map((m) => m.thinkMs)),
        clockBefore: white[0]?.clockBeforeMs,
        clockAfter: white[0]?.clockAfterMs,
      };
    });
    const t = timingOk;
    log('game1: moveTimings persisted (real thinkMs > 0, clocks captured)',
      !t.err && t.n === 4 && t.whiteN === 2 && t.thinkMin > 0 && t.clockBefore > 0 && t.clockAfter > 0,
      JSON.stringify(timingOk));

    await page.click('text=Review game');
    await page.waitForSelector('text=What to take from this game', { timeout: 90000 });
    const lessons = await page.locator('.coach-list > li, .coach-list li').count();
    log('game1: coach panel with 1–5 evidence-based lessons', lessons >= 1 && lessons <= 5, `lessons=${lessons}`);

    const timeBars = await page.locator('.time-bar').count();
    const moveTime = await page.locator('.section-label', { hasText: 'Move time' }).count();
    log('game1: move-time panel with a bar per player move (2 white moves)', timeBars === 2 && moveTime === 1, `bars=${timeBars} panel=${moveTime}`);

    // practice buttons on a critical player move: jump to g4?? via its time bar
    await page.locator('.time-bar').nth(1).click();
    await page.waitForTimeout(300);
    const btns = await page.locator('button', { hasText: 'Save for later' }).count();
    log('game1: Save-for-later offered on critical mistakes', btns >= 1, `count=${btns}`);
    if (btns > 0) {
      await page.locator('text=Save for later').first().click();
      const saved = await page.evaluate(() => {
        const list = JSON.parse(localStorage.getItem('gambit.practice.v1') ?? '[]');
        return list.length;
      });
      log('game1: Save-for-later wrote practice.v1', saved === 1, `items=${saved}`);
    }

    // motifs must not be invented: fool's mate has no fork/pin/skewer
    const motifText = await page.evaluate(() => {
      const t = document.body.innerText.toLowerCase();
      const hits = ['fork', 'pin ', 'skewer', 'discovered', 'back rank'].filter((k) => t.includes(k));
      return hits;
    });
    log('game1: no unjustified motif claims', motifText.length === 0, `found=${JSON.stringify(motifText)}`);
    await page.close();
  }

  /* ============ GAME 2: repertoire deviation → save → practice runner ============ */
  {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/training`);
    await page.evaluate((r) => {
      localStorage.setItem('gambit.repertoire.v1', JSON.stringify(r));
      // Play auto-loads lastConfig and jumps straight into a game — clear
      // both keys so the setup screen (pass & play, timed) shows again.
      localStorage.removeItem('gambit.lastConfig');
      localStorage.removeItem('gambit.activeGame');
    }, repJson());
    const drag = dragOn(page);
    await startPassGame(page);
    await page.waitForTimeout(1000);
    await drag('e2', 'e4'); // in book
    await page.waitForTimeout(1000);
    await drag('e7', 'e5'); // in book
    await page.waitForTimeout(1000);
    await drag('d2', 'd4'); // DEVIATION — repertoire prefers Nf3
    await page.waitForTimeout(800);
    await drag('e5', 'd4'); // exd4
    await page.waitForTimeout(800);
    await drag('d1', 'd4'); // Qxd4
    await page.waitForTimeout(400);
    await resign(page);
    await page.waitForTimeout(400);
    await page.click('text=Review game');
    await page.waitForSelector('text=What to take from this game', { timeout: 90000 });

    const dev = await page.locator('text=your repertoire prefers').count();
    log('game2: deviation panel names preferred move', dev >= 1, `count=${dev}`);
    const coachDev = await page.evaluate(() => document.body.innerText.includes('repertoire'));
    log('game2: coach mentions repertoire', coachDev);

    await page.locator('text=Save for training').first().click();
    await page.waitForTimeout(300);
    const practice = await page.evaluate(() => {
      const list = JSON.parse(localStorage.getItem('gambit.practice.v1') ?? '[]');
      const it = list[list.length - 1];
      return it ? { kind: it.kind, san: it.expectedSan, side: it.side, n: list.length } : null;
    });
    log('game2: Save for training stored repertoire item (expected Nf3, side w)',
      practice?.kind === 'repertoire' && practice?.san === 'Nf3' && practice?.side === 'w',
      JSON.stringify(practice));
    const reviewUrl = page.url();
    await page.close();

    /* practice runner on Training — SAME context so localStorage carries over */
    const t2 = await ctx.newPage();
    await t2.goto(`${BASE}/#/training`);
    await t2.waitForSelector('text=Saved practice', { timeout: 10000 });
    const entries = await t2.locator('.study-card').count();
    log('training: saved practice listed', entries >= 1, `entries=${entries}`);
    await t2.locator('.study-card', { hasText: 'repertoire' }).locator('button:has-text("Practice")').first().click();
    await t2.waitForSelector('[data-square="e2"]', { timeout: 10000 });
    // click-move path (the first drag after mount doesn't activate dnd-kit;
    // drags are regression-covered separately on the Play page)
    const clickMove = async (from, to) => {
      await t2.locator(`[data-square="${from}"]`).first().click();
      await t2.waitForTimeout(140);
      await t2.locator(`[data-square="${to}"]`).first().click();
      await t2.waitForTimeout(320);
    };
    // wrong try: Nc3 — board must hold (pawn still on d2 before the target move)
    await clickMove('b1', 'c3');
    const wrong = await t2.locator('text=is not it').count();
    const d2Held = await t2.evaluate(() => {
      const sq = document.querySelector('[data-square="d2"]');
      return !!sq && sq.querySelectorAll('svg').length > 0;
    });
    log('runner: wrong move rejected, board holds', wrong >= 1 && d2Held, `feedback=${wrong} d2pawn=${d2Held}`);
    await t2.click('button:has-text("Hint")');
    const hint = await t2.locator('text=Look for the move').count();
    await t2.click('button:has-text("Reveal")');
    const reveal = await t2.locator('text=Answer: Nf3').count();
    log('runner: hint + reveal honest', hint >= 1 && reveal >= 1, `hint=${hint} reveal=${reveal}`);
    await clickMove('g1', 'f3');
    await t2.waitForTimeout(400);
    const found = await t2.locator('text=Found it — Nf3').count();
    log('runner: finding Nf3 succeeds', found >= 1, `found=${found}`);

    // responsive: insights + review across widths
    for (const [w, h, label] of [[1280, 900, '1280'], [768, 1024, 'tablet'], [390, 844, 'mobile']]) {
      await t2.setViewportSize({ width: w, height: h });
      await t2.goto(`${BASE}/#/insights`);
      await t2.waitForTimeout(700);
      const overflowIns = await t2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await t2.goto(reviewUrl);
      await t2.waitForTimeout(700);
      const overflowRev = await t2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      log(`responsive ${label}: no horizontal overflow (insights ${overflowIns}px, review ${overflowRev}px)`,
        overflowIns <= 1 && overflowRev <= 1);
    }

    /* insights sections */
    await t2.setViewportSize({ width: 1440, height: 1200 });
    await t2.goto(`${BASE}/#/insights`);
    await t2.waitForTimeout(700);
    const sections = await t2.evaluate(() => {
      const t = document.body.innerText.toUpperCase();
      return ['OVERVIEW', 'OPENINGS', 'TACTICS', 'TIME MANAGEMENT', 'GAME PHASES'].filter((s) => t.includes(s));
    });
    log('insights: all five sections present', sections.length === 5, JSON.stringify(sections));
    const openingRows = await t2.locator('.table-wrap tbody tr').count();
    const hasEco = await t2.evaluate(() => document.body.textContent.includes('C20')); // Open Game (1.e4 e5)
    log('insights: openings tabulated from real games', openingRows >= 1 && hasEco, `rows=${openingRows} ecoC20=${hasEco}`);
    await t2.close();
  }

  /* ============ insights empty state (fresh profile) ============ */
  {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/training`);
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${BASE}/#/insights`); // hash-only nav keeps in-memory profile — hard reload
    await page.reload();
    await page.waitForTimeout(900);
    const empty = await page.locator('text=No games yet').count();
    log('insights: honest empty state with no games', empty >= 1, `count=${empty}`);
    await page.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed === 0 ? 'ALL PHASES 5-8 QA PASS' : `${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('QA ERROR', e);
  process.exit(2);
});
