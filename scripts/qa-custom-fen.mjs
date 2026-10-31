/* PR-C browser QA — custom-FEN correctness.
   Flow: a Position Editor deep link starts a game from a non-standard FEN.
   Verifies: black-to-move lifecycle (human plays the side to move), record
   metadata + PGN SetUp/FEN headers, reload-resume from the custom position,
   rematch, Review replay from the actual start, K-vs-K termination, and a
   backup export/import round trip that keeps the custom start.
   Uncaught page errors fail the run. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:4173';
const FEN_BLACK = 'rnbqkbnr/pppp1ppp/8/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'; // black to move, no e-pawns
const K_VS_K = '8/8/8/8/8/8/8/K6k w - - 0 1';
const results = [];
const pageErrors = [];
const log = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

function dragOn(page) {
  return async (from, to) => {
    // wait for the square to be visible: boundingBox() is null on elements
    // still mounting (the game screen renders right after the deep link)
    const fromLoc = page.locator(`[data-square="${from}"]`).first();
    await fromLoc.waitFor({ state: 'visible', timeout: 10000 });
    let a = await fromLoc.boundingBox();
    const toLoc = page.locator(`[data-square="${to}"]`).first();
    await toLoc.waitFor({ state: 'visible', timeout: 10000 });
    let b = await toLoc.boundingBox();
    if (!a || !b) {
      // the orientation flips after mount (playerColor state settles 'b' for
      // black-to-move starts) and react-chessboard re-mounts its squares —
      // retry the box read instead of failing on the transient
      for (let attempt = 0; attempt < 20 && (!a || !b); attempt += 1) {
        await page.waitForTimeout(150);
        const a2 = a ?? (await fromLoc.boundingBox());
        const b2 = b ?? (await toLoc.boundingBox());
        if (a2) {
          a = a2;
        }
        if (b2) {
          b = b2;
        }
      }
    }
    if (!a || !b) {
      const diag = await page.evaluate(() => ({
        hash: location.hash,
        squares: document.querySelectorAll('[data-square]').length,
        g8: document.querySelectorAll('[data-square="g8"]').length,
        moveRows: document.querySelectorAll('.move-list td.mv').length,
        body: document.body.innerText.slice(0, 160).split(String.fromCharCode(10)).join(' | '),
      }));
      throw new Error(`drag target missing: ${from}->${to} — ${JSON.stringify(diag)}`);
    }
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
}

/** Start a game from a custom FEN through the real Editor deep link.
 *  The Editor also renders a board with [data-square], so the wait must be
 *  for the ROUTE first — a selector-only wait races the navigation. */
async function startFromEditor(page, fen) {
  await page.goto(`${BASE}/#/editor`);
  await page.fill('#ed-fen', fen);
  await page.press('#ed-fen', 'Enter');
  await page.click('a:has-text("Play vs engine")');
  await page.waitForFunction(() => location.hash.startsWith('#/play'), null, { timeout: 10000, polling: 100 });
  await page.waitForSelector('[data-square="e2"]', { timeout: 10000 });
}

async function resignGame(page) {
  await page.click('button:has-text("Resign")');
  try {
    const danger = page.locator('.btn-danger:visible').last();
    await danger.waitFor({ state: 'visible', timeout: 3000 });
    await danger.click();
  } catch {}
  await page.waitForTimeout(700);
}

/** Real played plies: text-bearing move cells only (a black-to-move game
    renders an empty white column in the first row). Node functions are
    serialized into the page by Playwright — string expressions are NOT
    invoked by waitForFunction, so everything uses functions. */
async function realPlies(page) {
  return page.evaluate(() => [...document.querySelectorAll('.move-list td.mv')].filter((e) => e.textContent?.trim()).length);
}

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    pageErrors.push(e.message);
    console.log('PAGEERROR:', e.message.slice(0, 300));
  });
  const drag = dragOn(page);

  await page.goto(`${BASE}/#/training`);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => {
    localStorage.setItem(
      'gambit.profile',
      JSON.stringify({ joined: 1, rating: 1200, peakRating: 1200, ratingHistory: [1200], games: [], puzzle: { rating: 1200, solved: 0, failed: 0, bestStreak: 0 } }),
    );
  });
  await page.reload();
  await page.waitForTimeout(600);

  /* ---- 1. black-to-move custom start: lifecycle ---- */
  await startFromEditor(page, FEN_BLACK);
  const startState = await page.evaluate(() => ({
    e2Empty: !document.querySelector('[data-square="e2"] [data-piece]'),
    e7Empty: !document.querySelector('[data-square="e7"] [data-piece]'),
  }));
  log('custom start: board shows the custom position (no e-pawns)', startState.e2Empty && startState.e7Empty, JSON.stringify(startState));
  // black (the human) is the side to move: the first move is BLACK's
  await drag('g8', 'f6');
  await page.waitForFunction(() => [...document.querySelectorAll('.move-list td.mv')].filter((e) => e.textContent?.trim()).length >= 2, null, { timeout: 45000, polling: 300 });
  const pliesAfterOpening = await realPlies(page);
  log('black-to-move: human plays the first move, engine answers as white', pliesAfterOpening === 2, `plies=${pliesAfterOpening}`);

  /* ---- 2. record metadata + PGN headers ---- */
  await resignGame(page);
  const record1 = await page.evaluate(() => {
    const games = JSON.parse(localStorage.getItem('gambit.profile')).games;
    return games[0] ?? null;
  });
  const recordOk =
    record1 && record1.initialFen === FEN_BLACK && record1.pgn.includes('[FEN "' + FEN_BLACK + '"]') && record1.pgn.includes('[SetUp "1"]');
  log('record: initialFen stored + PGN carries SetUp/FEN headers', !!recordOk, record1 ? `id=${record1.id}` : 'none');
  const customId = record1?.id;

  /* ---- 3. reload-resume from the custom position ---- */
  await startFromEditor(page, FEN_BLACK);
  await drag('g8', 'f6');
  await page.waitForFunction(() => [...document.querySelectorAll('.move-list td.mv')].filter((e) => e.textContent?.trim()).length >= 2, null, { timeout: 45000, polling: 300 });
  await page.reload(); // BOTH lastConfig and activeGame present, nothing deleted
  await page.waitForTimeout(700);
  const panel = await page.evaluate(() => {
    const t = document.body.textContent;
    return {
      panel: t.includes('Game in progress'),
      autoStarted: !!document.querySelector('[data-square="e2"]') && !t.includes('Game in progress'),
    };
  });
  log('reload with both keys: recovery panel, not auto-start', panel.panel && !panel.autoStarted, JSON.stringify(panel));
  await page.click('button:has-text("Resume")');
  await page.waitForTimeout(600);
  const resumed = {
    plies: await realPlies(page),
    e2Empty: await page.evaluate(() => !document.querySelector('[data-square="e2"] [data-piece]')),
  };
  log('resume: position and plies restored from the custom start', resumed.plies === 2 && resumed.e2Empty, JSON.stringify(resumed));
  await resignGame(page);

  /* ---- 4. rematch keeps the custom start ---- */
  const rematchVisible = await page.locator('button:has-text("Rematch")').isVisible().catch(() => false);
  if (rematchVisible) {
    await page.click('button:has-text("Rematch")');
    // the remount + engine's first move take a moment; wait for the CUSTOM
    // board to be live instead of a fixed sleep (e7 is empty in FEN_BLACK)
    await page
      .waitForFunction(() => !document.querySelector('[data-square="e2"] [data-piece]'), null, { timeout: 6000, polling: 150 })
      .catch(() => {});
    await page.waitForTimeout(400);
    // A black-to-move rematch hands the FIRST move to the engine (the human
    // was swapped to white), so the fresh game legitimately shows 1 real ply
    // — never the previous game's moves. e2 is the position probe: neither
    // side can place a piece there in one move from the custom start.
    const rematch = {
      plies: await realPlies(page),
      e2Empty: await page.evaluate(() => !document.querySelector('[data-square="e2"] [data-piece]')),
      overGone: await page.evaluate(() => !document.body.textContent.includes('Game over') && !document.body.textContent.includes('You lose')),
    };
    log('rematch: fresh custom-start game (custom position, old game gone)', rematch.plies <= 1 && rematch.e2Empty && rematch.overGone, JSON.stringify(rematch));
    await resignGame(page);
  } else {
    log('rematch: fresh custom-start game (empty move list, custom position)', false, 'Rematch button not visible');
  }

  /* ---- 5. review replay from the actual start ---- */
  await page.goto(`${BASE}/#/review/${customId}`);
  await page.waitForSelector('[data-square="e2"]', { timeout: 10000 });
  // walk back to the start position
  for (let i = 0; i < 4; i += 1) {
    await page.click('button[aria-label*="revious" i], button:has-text("‹")').catch(() => {});
    await page.waitForTimeout(150);
  }
  const reviewStart = await page.evaluate(() => ({
    e2Empty: !document.querySelector('[data-square="e2"] [data-piece]'),
    e7Empty: !document.querySelector('[data-square="e7"] [data-piece]'),
    whiteRookH1: !!document.querySelector('[data-square="h1"] [data-piece]'),
  }));
  log('review: replays from the actual custom start (e-pawns absent, standard pieces intact)', reviewStart.e2Empty && reviewStart.e7Empty && reviewStart.whiteRookH1, JSON.stringify(reviewStart));

  /* ---- 6. termination from a custom position (K vs K) ---- */
  await startFromEditor(page, K_VS_K);
  await drag('a1', 'a2');
  await page.waitForTimeout(700);
  const ended = await page.evaluate(() => document.body.textContent.includes('Insufficient material'));
  const recordKvK = await page.evaluate(() => {
    const games = JSON.parse(localStorage.getItem('gambit.profile')).games;
    return games[0] ?? null;
  });
  log(
    'K-vs-K start: any move ends the game as insufficient material + record saved',
    ended && recordKvK?.initialFen === K_VS_K,
    `ended=${ended} initialFen=${recordKvK?.initialFen === K_VS_K}`,
  );

  /* ---- 7. backup round trip keeps the custom start ---- */
  await page.goto(`${BASE}/#/profile`);
  await page.waitForSelector('text=Backup &', { timeout: 10000 });
  const dl = page.waitForEvent('download');
  await page.locator('button', { hasText: 'Export all Gambit data' }).click();
  const d = await dl;
  const backupText = readFileSync(await d.path(), 'utf-8');
  const backup = JSON.parse(backupText);
  const backupCustom = backup.sections.profile.games.filter((g) => g.initialFen);
  log('backup: export contains the custom-start records verbatim', backupCustom.length >= 2 && backupCustom.some((g) => g.initialFen === FEN_BLACK), `${backupCustom.length} custom records`);

  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector('text=Backup &', { timeout: 10000 });
  await page.setInputFiles('input[type="file"]', {
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(backupText, 'utf-8'),
  });
  await page.waitForTimeout(500);
  await page.locator('button', { hasText: 'Replace current data' }).click();
  await page.locator('button', { hasText: 'Replace everything' }).click();
  // the restore flow navigates/reloads — settle before reading storage
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/#/profile`);
  await page.waitForSelector('text=Backup &', { timeout: 10000 });
  const restored = await page.evaluate((fen) => {
    const games = JSON.parse(localStorage.getItem('gambit.profile') ?? '{}').games ?? [];
    return { count: games.length, custom: games.filter((g) => g.initialFen === fen).length };
  }, FEN_BLACK);
  log('restore: custom-start records survive a full backup round trip (validators accept them)', restored.custom >= 1, JSON.stringify(restored));

  await ctx.close();
  await browser.close();
  const failed = results.filter((r) => !r).length;
  if (pageErrors.length > 0) console.log(`UNCAUGHT PAGE ERRORS: ${pageErrors.length}`);
  const verdict = failed === 0 && pageErrors.length === 0;
  console.log(verdict ? 'ALL CUSTOM-FEN QA PASS' : `${failed} FAILURES${pageErrors.length ? `, ${pageErrors.length} uncaught page errors` : ''}`);
  process.exit(verdict ? 0 : 1);
}

run().catch((e) => {
  console.error('QA ERROR', e);
  process.exit(2);
});
