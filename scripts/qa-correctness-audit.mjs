/* Correctness-audit browser QA: verifies the FIXED behaviors end to end.
   1. Practice-now starts at the position BEFORE the critical move.
   2. Timing bars jump to the true ply.
   3. Motif-stats wiring runs once per game (training.v1 marker idempotent).
   4. Practice runner: assisted vs clean solves persist; wrong moves hold.
   5. Undo+replay leaves exactly one timing per ply. */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173';
const results = [];
const log = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

function dragOn(page) {
  return async (from, to) => {
    const a = await page.locator(`[data-square="${from}"]`).first().boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    const b = await page.locator(`[data-square="${to}"]`).first().boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
}

async function startPassGame(page) {
  await page.goto(`${BASE}/#/play`);
  try {
    await page.waitForSelector('.mode-switch .mode-row', { timeout: 6000 });
  } catch {
    await page.reload();
    await page.waitForSelector('.mode-switch .mode-row', { timeout: 15000 });
  }
  await page.click('.mode-switch .mode-row:nth-child(2)');
  await page.click('form button.btn-accent');
  await page.waitForSelector('[data-square="e2"]');
}

async function resign(page) {
  await page.click('button:has-text("Resign")');
  try {
    const danger = page.locator('.btn-danger:visible, .modal .btn-danger').last();
    await danger.waitFor({ state: 'visible', timeout: 3000 });
    await danger.click();
  } catch {
    /* confirm disabled */
  }
}

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });

  /* ---------- game 1: fool's mate (g4?? = the critical move) ---------- */
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/training`);
  await page.evaluate(() => localStorage.clear());
  const drag = dragOn(page);
  await startPassGame(page);
  await page.waitForTimeout(1000);
  await drag('f2', 'f3');
  await page.waitForTimeout(900);
  await drag('e7', 'e5');
  await page.waitForTimeout(700);
  await drag('g2', 'g4'); // the blunder
  await page.waitForTimeout(700);
  await drag('d8', 'h4'); // mate
  await page.waitForTimeout(500);
  await page.click('text=Review game');
  await page.waitForSelector('text=What to take from this game', { timeout: 90000 });

  // (1) jump to the blunder via its time bar, then Practice now
  await page.locator('.time-bar').nth(1).click(); // white's 2nd move = ply 3 (g4)
  await page.waitForTimeout(300);
  const moveLabel = await page.locator('.move-position').first().textContent().catch(() => '');
  await page.click('button:has-text("Practice now")');
  await page.waitForTimeout(600);
  // BEFORE the mistake: pawn still on g2, knight on g1, and WHITE to move
  const practiceBoard = await page.evaluate(() => {
    const piece = (sq) => {
      const el = document.querySelector(`[data-square="${sq}"]`);
      return el && el.querySelectorAll('svg').length > 0;
    };
    return { g2: piece('g2'), g1: piece('g1'), g4: piece('g4'), f3: piece('f3') };
  });
  log(
    'practice starts BEFORE the mistake (g2 pawn present, g4 empty)',
    practiceBoard.g2 === true && practiceBoard.g4 === false,
    JSON.stringify(practiceBoard),
  );

  // wrong move in the drill: board gives "Not the best" with the pre-move eval
  // (click-move path: the first drag after mount doesn't activate dnd-kit)
  await page.locator('[data-square="b1"]').first().click();
  await page.waitForTimeout(140);
  await page.locator('[data-square="c3"]').first().click();
  await page.waitForTimeout(400);
  const graded = await page.evaluate(() => document.body.textContent.includes('Not the best, Stockfish preferred'));
  log('drill grades against the pre-move engine best', graded);

  // exit practice
  await page.click('button:has-text("Exit practice")').catch(async () => {
    await page.click('button:has-text("Exit")');
  });
  await page.waitForTimeout(300);

  // (2) timing bar jumps: bar n must land on white's n-th move ply
  await page.locator('.time-bar').nth(0).click();
  await page.waitForTimeout(250);
  const label1 = await page.locator('.move-position').first().textContent().catch(() => '');
  await page.locator('.time-bar').nth(1).click();
  await page.waitForTimeout(250);
  const label2 = await page.locator('.move-position').first().textContent().catch(() => '');
  const ok2 = (label1 ?? '').trim() === '1 / 4' && (label2 ?? '').trim() === '3 / 4';
  log('timing bars jump to the true ply (1 then 3 of 4)', ok2, `bar1="${(label1 ?? '').trim()}" bar2="${(label2 ?? '').trim()}"`);

  // (3) motif wiring: training.v1 carries the per-game marker exactly once
  const gameId = await page.evaluate(() => JSON.parse(localStorage.getItem('gambit.profile') ?? '{}').games[0]?.id);
  const marker1 = await page.evaluate((gid) => {
    const t = JSON.parse(localStorage.getItem('gambit.training.v1') ?? '{}');
    return t.motifGames?.[gid] ?? null;
  }, gameId);
  // reopen the review (cached report path) — marker and stats must not change
  await page.goto(`${BASE}/#/profile`);
  await page.waitForTimeout(400);
  await page.goto(`${BASE}/#/review/${gameId}`);
  await page.waitForSelector('text=What to take from this game', { timeout: 90000 });
  await page.waitForTimeout(800);
  const trainingAfter = await page.evaluate((gid) => {
    const t = JSON.parse(localStorage.getItem('gambit.training.v1') ?? '{}');
    return { marker: t.motifGames?.[gid] ?? null, motifs: t.motifs ?? {} };
  }, gameId);
  log(
    'motif stats: marker written once, reopening Review never re-counts',
    marker1 !== null && marker1 !== undefined && trainingAfter.marker === marker1,
    `marker=${marker1} afterReopen=${trainingAfter.marker}`,
  );
  const motifsBeforeBackfill = JSON.stringify(trainingAfter.motifs);
  // backfill: wipe the marker (simulates a report cached before contributions
  // existed), reload the CACHED review — it must re-contribute exactly once
  await page.evaluate((gid) => {
    const t = JSON.parse(localStorage.getItem('gambit.training.v1') ?? '{}');
    delete t.motifGames?.[gid];
    localStorage.setItem('gambit.training.v1', JSON.stringify(t));
  }, gameId);
  await page.reload();
  await page.waitForSelector('text=What to take from this game', { timeout: 90000 });
  await page.waitForTimeout(800);
  const backfill = await page.evaluate((gid) => {
    const t = JSON.parse(localStorage.getItem('gambit.training.v1') ?? '{}');
    return { marker: t.motifGames?.[gid] ?? null, motifs: JSON.stringify(t.motifs ?? {}) };
  }, gameId);
  log(
    'cached report backfills a missing contribution exactly once',
    backfill.marker !== null && backfill.motifs === motifsBeforeBackfill,
    `marker=${backfill.marker} sameTotals=${backfill.motifs === motifsBeforeBackfill}`,
  );
  const reviewUrl = page.url();

  // (4) runner persistence: save from review, solve assisted then clean
  await page.locator('.time-bar').nth(1).click();
  await page.waitForTimeout(200);
  await page.click('button:has-text("Save for later")');
  await page.waitForTimeout(300);
  const savedItem = await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('gambit.practice.v1') ?? '[]');
    const it = list[list.length - 1];
    return it ? { id: it.id, expected: it.expectedSan, ply: it.ply } : null;
  });
  log('save-for-later stores the mistake item', savedItem !== null, JSON.stringify(savedItem));
  await page.close();

  const t2 = await ctx.newPage();
  await t2.goto(`${BASE}/`);
  await t2.goto(`${BASE}/#/training`);
  await t2.waitForSelector('text=Saved practice', { timeout: 10000 });
  await t2.locator('.study-card', { hasText: 'mistake' }).locator('button:has-text("Practice")').first().click();
  await t2.waitForSelector('[data-square="e2"]');
  const clickMove = async (from, to) => {
    await t2.locator(`[data-square="${from}"]`).first().click();
    await t2.waitForTimeout(140);
    await t2.locator(`[data-square="${to}"]`).first().click();
    await t2.waitForTimeout(350);
  };
  // assisted solve: reveal, then play the answer
  await t2.click('button:has-text("Reveal")');
  await t2.waitForTimeout(150);
  const answerSan = savedItem?.expected ?? 'g3';
  const KNIGHT_MAP = { Nf3: ['g1', 'f3'], Nc3: ['b1', 'c3'], Ne2: ['g1', 'e2'], Na3: ['b1', 'a3'], Nh3: ['g1', 'h3'] };
  const pawnSquares = /^[a-h][1-8]$/.test(answerSan)
    ? [answerSan[0] + '2', answerSan.slice(0, 2)] // white pawn push: file2 -> target
    : null;
  const sq2 = KNIGHT_MAP[answerSan] ?? pawnSquares ?? ['g2', 'g3'];
  await clickMove(sq2[0], sq2[1]);
  const assistedMsg = await t2.evaluate(() => document.body.textContent.includes('assisted attempt, not a clean solve'));
  const afterAssisted = await t2.evaluate((id) => {
    const it = JSON.parse(localStorage.getItem('gambit.practice.v1') ?? '[]').find((x) => x.id === id);
    return it ? { attempts: it.attempts, solved: it.solved } : null;
  }, savedItem.id);
  log(
    'assisted solve recorded, not counted as clean',
    assistedMsg && afterAssisted?.attempts === 1 && afterAssisted?.solved === 0,
    JSON.stringify(afterAssisted),
  );
  await t2.click('button:has-text("Exit")');
  await t2.waitForTimeout(300);
  // second session: clean first-try solve — the expected SAN is stable
  await t2.locator('.study-card', { hasText: 'mistake' }).locator('button:has-text("Practice")').first().click();
  await t2.waitForSelector('[data-square="e2"]');
  await clickMove(sq2[0], sq2[1]);
  const afterClean = await t2.evaluate((id) => {
    const it = JSON.parse(localStorage.getItem('gambit.practice.v1') ?? '[]').find((x) => x.id === id);
    return it ? { attempts: it.attempts, solved: it.solved } : null;
  }, savedItem.id);
  const listShows = await t2.evaluate(() => document.body.textContent.includes('attempts 2'));
  log(
    'clean first-try solve increments solved; queue UI refreshes',
    afterClean?.attempts === 2 && afterClean?.solved === 1 && listShows,
    JSON.stringify(afterClean),
  );
  await t2.click('button:has-text("Exit")');
  await t2.waitForTimeout(300);
  // third session: wrong guess first, then the correct move — an attempt, never a clean solve
  await t2.locator('.study-card', { hasText: 'mistake' }).locator('button:has-text("Practice")').first().click();
  await t2.waitForSelector('[data-square="e2"]');
  await clickMove('b1', 'c3'); // wrong guess (board holds)
  await clickMove(sq2[0], sq2[1]); // then the target move, no hint used
  const afterWrongThenRight = await t2.evaluate((id) => {
    const it = JSON.parse(localStorage.getItem('gambit.practice.v1') ?? '[]').find((x) => x.id === id);
    return it ? { attempts: it.attempts, solved: it.solved } : null;
  }, savedItem.id);
  const afterWrongMsg = await t2.evaluate(() => document.body.textContent.includes('after wrong tries'));
  log(
    'correct-after-wrong counts as attempt, not a clean solve',
    afterWrongThenRight?.attempts === 3 && afterWrongThenRight?.solved === 1 && afterWrongMsg,
    JSON.stringify(afterWrongThenRight),
  );
  await t2.close();

  /* ---------- (5) undo + replay leaves one timing per ply ---------- */
  const page2 = await ctx.newPage();
  await page2.goto(`${BASE}/#/training`);
  await page2.evaluate(() => localStorage.removeItem('gambit.lastConfig'));
  await page2.evaluate(() => localStorage.removeItem('gambit.activeGame'));
  const drag2 = dragOn(page2);
  await startPassGame(page2);
  await page2.waitForTimeout(800);
  await drag2('e2', 'e4');
  await page2.waitForTimeout(600);
  await drag2('e7', 'e5');
  await page2.waitForTimeout(500);
  await page2.click('button[title*="Take back"], button:has-text("Undo")').catch(() => {});
  await page2.waitForTimeout(400);
  const undoOk = await page2.evaluate(() => {
    const e5 = document.querySelector('[data-square="e5"]');
    return e5 && e5.querySelectorAll('svg').length === 0; // black pawn back on e7
  });
  await drag2('e7', 'e6'); // replay a different reply
  await page2.waitForTimeout(400);
  const timings = await page2.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('gambit.activeGame') ?? 'null');
    return p; // timings live in the hook, not the autosave — check below
  });
  void timings;
  await resign(page2);
  await page2.waitForTimeout(400);
  const record = await page2.evaluate(() => {
    const g = JSON.parse(localStorage.getItem('gambit.profile') ?? '{}').games[0];
    const t = g?.moveTimings ?? [];
    return { plies: g?.moves, timings: t.map((x) => x.ply), colors: t.map((x) => x.color) };
  });
  log(
    'undo+replay: exactly one timing per ply (1,2), replayed move included',
    undoOk && record.timings.length === 2 && record.timings[0] === 1 && record.timings[1] === 2,
    JSON.stringify(record),
  );
  void reviewUrl;
  await page2.close();

  /* ---------- (6) PracticeRunner lifecycle: fresh session per item id ---------- */
  const page3 = await ctx.newPage();
  await page3.goto(`${BASE}/`);
  await page3.evaluate(() => {
    localStorage.clear();
    const FEN = 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPPPPPP/RNBQKBNR w KQkq - 0 2';
    const mk = (id, expectedSan, objective) => ({
      id, kind: 'mistake', fen: FEN, side: 'w', objective, expectedSan,
      createdAt: Date.now(), attempts: 0, solved: 0, lastPracticed: null,
    });
    localStorage.setItem(
      'gambit.practice.v1',
      JSON.stringify([mk('qa-a', 'Nf3', 'Find Nf3 (A)'), mk('qa-b', 'Nc3', 'Find Nc3 (B)')]),
    ); // same FEN, different ids — the keying must still remount
  });
  await page3.goto(`${BASE}/#/training`);
  await page3.waitForSelector('text=Saved practice', { timeout: 10000 });
  const readItem = (id) =>
    page3.evaluate((i) => {
      const it = JSON.parse(localStorage.getItem('gambit.practice.v1') ?? '[]').find((x) => x.id === i);
      return it ? { attempts: it.attempts, solved: it.solved } : null;
    }, id);
  const openCard = async (label) => {
    await page3.locator('.study-card', { hasText: label }).locator('button:has-text("Practice")').first().click();
    await page3.waitForTimeout(400);
  };
  const clickMove3 = async (from, to) => {
    await page3.locator(`[data-square="${from}"]`).first().click();
    await page3.waitForTimeout(140);
    await page3.locator(`[data-square="${to}"]`).first().click();
    await page3.waitForTimeout(350);
  };

  // 1) solve A cleanly
  await openCard('Find Nf3 (A)');
  await clickMove3('g1', 'f3');
  let a = await readItem('qa-a');
  let b = await readItem('qa-b');
  log('lifecycle 1: A solves clean', a?.attempts === 1 && a?.solved === 1 && b?.attempts === 0, JSON.stringify({ a, b }));

  // 2+3) switch WITHOUT exiting, solve B first-try
  await openCard('Find Nc3 (B)');
  await clickMove3('b1', 'c3');
  a = await readItem('qa-a');
  b = await readItem('qa-b');
  const bCleanMsg = await page3.evaluate(() => document.body.textContent.includes('Clean first-try solve'));
  log(
    'lifecycle 2+3: B records its own clean solve; A untouched',
    a?.attempts === 1 && a?.solved === 1 && b?.attempts === 1 && b?.solved === 1 && bCleanMsg,
    JSON.stringify({ a, b }),
  );

  // 5) hint on A, switch to B — B still counts clean (no assisted leak)
  await openCard('Find Nf3 (A)');
  await page3.click('button:has-text("Hint")'); // assisted flag on A's session only
  await openCard('Find Nc3 (B)');
  await clickMove3('b1', 'c3');
  b = await readItem('qa-b');
  const bCleanAgain = await page3.evaluate(() => document.body.textContent.includes('Clean first-try solve'));
  log(
    'lifecycle 5: hint on A does not stain B (B clean)',
    b?.attempts === 2 && b?.solved === 2 && bCleanAgain,
    JSON.stringify(b),
  );

  // 7) completed session: replaying moves records nothing further
  await clickMove3('b1', 'c3');
  await clickMove3('g1', 'f3');
  await page3.waitForTimeout(300);
  b = await readItem('qa-b');
  log(
    'lifecycle 7: completed runner never records another attempt',
    b?.attempts === 2 && b?.solved === 2,
    JSON.stringify(b),
  );
  await page3.close();

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed === 0 ? 'ALL CORRECTNESS QA PASS' : `${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('QA ERROR', e);
  process.exit(2);
});
