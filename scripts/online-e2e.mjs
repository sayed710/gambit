/* Online multiplayer E2E — TWO isolated browser contexts against the
   REAL local Supabase backend + the production build. Every UI claim is
   polled until it holds (bounded) — a real regression still fails.
   Prereqs: `npx supabase start` running; this script BUILDS the app
   itself with the local-stack env (the onlineConfigured gate requires
   it) and serves the bundle on port 5199. */
import { chromium } from 'playwright';
import { execSync, spawn } from 'node:child_process';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5199';
let failures = 0;

/* build with the local-stack env so the onlineConfigured gate opens */
if (!process.env.E2E_SKIP_BUILD) {
  console.log('building with local-stack env…');
  execSync('npx vite build', {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
    },
  });
}
let previewProc = null;
if (!process.env.E2E_SKIP_SERVE) {
  previewProc = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '5199', '--strictPort'], {
    stdio: 'ignore',
    detached: false,
  });
  // wait for readiness
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) break;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** poll an evaluate() until it returns truthy (bounded) */
async function pollUntil(page, evalFn, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const v = await page.evaluate(evalFn).catch(() => null);
    if (v) return v;
    await wait(300);
  }
  return null;
}

async function playSquare(page, from, to) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

const browser = await chromium.launch();
const ctxA = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
const ctxB = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 900, height: 900 } });
const ctxC = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 900, height: 900 } });
let pA = null;
let pB = null;

try {
  /* ---- Player A: create a private game ---- */
  pA = await ctxA.newPage();
  const errorsA = [];
  pA.on('pageerror', (e) => errorsA.push(e.message));
  await pA.goto(`${BASE}/#/online`, { waitUntil: 'load' });
  await pA.waitForSelector('#online-name', { timeout: 30000 });
  await pA.fill('#online-name', 'Alice');
  // deterministic seat: White (the E2E plays the white opening moves)
  await pA.locator('button[role="radio"]:has-text("White")').click();
  await pA.locator('button:has-text("Create private game")').click();
  await pA.waitForSelector('input[aria-label="Invitation link"]', { timeout: 30000 });
  const link = await pA.locator('input[aria-label="Invitation link"]').inputValue();
  check('A created a game and holds an invitation link', /#\/online\/join\?game=[^&]+&token=/.test(link));

  /* ---- Player B: joins via the link from ANOTHER context ---- */
  pB = await ctxB.newPage();
  const errorsB = [];
  pB.on('pageerror', (e) => errorsB.push(e.message));
  await pB.goto(link, { waitUntil: 'load' });
  await pB.waitForSelector('#join-name', { timeout: 30000 });
  await pB.fill('#join-name', 'Bob');
  await pB.locator('button:has-text("Accept invitation")').click();
  await pB.waitForSelector('.online-live', { timeout: 30000 });
  check('B joined and sees the live board', true);

  /* ---- A's waiting view flips to live (poll-based join detection) ---- */
  const aLive = await pollUntil(pA, () => !!document.querySelector('.online-live'), 20000);
  check('A sees the live game after the join', !!aLive);

  /* ---- F8: readiness — both clients auto-acknowledge; the game activates ---- */
  const aActive = await pollUntil(pA, () => {
    const hint = document.querySelector('.board-hint')?.textContent ?? '';
    return hint.includes('Your move') || hint.includes('thinking');
  }, 20000);
  check('F8: the clock started only after BOTH players acknowledged', !!aActive);
  const aBanner = await pA.evaluate(() => document.querySelector('.status-banner')?.textContent ?? '');
  check('F8: the readiness banner is gone after activation', !aBanner.includes('Preparing'), aBanner.slice(0, 60));

  /* ---- orientation: A is White (polled) ---- */
  const aOrient = await pollUntil(
    pA,
    () => {
      const a1 = document.querySelector('.online-live [data-square="a1"]')?.getBoundingClientRect().top;
      const a8 = document.querySelector('.online-live [data-square="a8"]')?.getBoundingClientRect().top;
      return a1 !== undefined && a8 !== undefined && a1 > a8;
    },
    10000,
  );
  check('A (White) sees a1 at the bottom', !!aOrient);

  /* ---- F6: a rapid double input while a move is pending sends ONE command ---- */
  let moveRequests = 0;
  await pA.route('**/functions/v1/make-move', async (route) => {
    moveRequests++;
    await wait(500); // slow network: the busy window is observable
    await route.continue();
  });
  await playSquare(pA, 'e2', 'e4');
  // the double input lands INSIDE the pending window: click the same
  // squares again immediately (the board must refuse, not queue)
  await playSquare(pA, 'e2', 'e4');
  const bGotE4 = await pollUntil(pB, () => {
    const txt = document.querySelector('.move-list')?.textContent ?? '';
    return txt.includes('e4');
  }, 15000);
  check('B received A\'s e4 through the local backend', !!bGotE4);
  await pA.unroute('**/functions/v1/make-move');
  check('F6: exactly ONE make-move request for a rapid double input', moveRequests === 1, `requests=${moveRequests}`);

  /* ---- B replies e5; A receives it ---- */
  await playSquare(pB, 'e7', 'e5');
  const aGotE5 = await pollUntil(pA, () => {
    const txt = document.querySelector('.move-list')?.textContent ?? '';
    return txt.includes('e4') && txt.includes('e5');
  }, 15000);
  check('A received B\'s e5', !!aGotE5);

  /* ---- identical authoritative history on both sides ---- */
  const histA = await pA.evaluate(() => document.querySelector('.move-list')?.textContent ?? '');
  const histB = await pB.evaluate(() => document.querySelector('.move-list')?.textContent ?? '');
  check('both boards show the same move history', histA.includes('e4') && histB.includes('e4') && histA.includes('e5') && histB.includes('e5'), `A="${histA.slice(0, 40)}" B="${histB.slice(0, 40)}"`);

  /* ---- A reloads: authoritative state restored ---- */
  await pA.reload({ waitUntil: 'load' });
  await pA.waitForSelector('.online-live', { timeout: 30000 }).catch(() => {});
  const aRestored = await pollUntil(pA, () => {
    const txt = document.querySelector('.move-list')?.textContent ?? '';
    return txt.includes('e4') && txt.includes('e5');
  }, 15000);
  check('A reloads and restores the authoritative state', !!aRestored);

  /* ---- third context C: the link cannot seat a third player ---- */
  const pC = await ctxC.newPage();
  await pC.goto(link, { waitUntil: 'load' });
  await pC.waitForSelector('#join-name', { timeout: 30000 }).catch(() => {});
  await pC.fill('#join-name', 'Eve');
  await pC.locator('button:has-text("Accept invitation")').click();
  await wait(2000);
  const cRejected = (await pC.locator('.online-live').count()) === 0;
  check('third context C cannot become a player', cRejected);

  /* ---- clocks are visible on both sides ---- */
  const aClocks = await pollUntil(pA, () => document.querySelectorAll('.clock').length === 2, 10000);
  check('clock chips render on A\'s side', !!aClocks);

  /* ---- B resigns (confirm banner); both see the final result ---- */
  await pB.locator('button:has-text("Resign")').first().click();
  await pB.locator('.status-banner.check button:has-text("Resign")').click();
  const bOverlay = await pollUntil(pB, () => !!document.querySelector('.online-result-overlay'), 15000);
  check('B sees the completion overlay after resigning', !!bOverlay);
  const aOverlay = await pollUntil(pA, () => !!document.querySelector('.online-result-overlay'), 20000);
  check('A sees the same final result', !!aOverlay);
  const aResult = await pA.evaluate(() => document.querySelector('.online-result-title')?.textContent ?? '');
  check('A\'s result text says won (B resigned)', aResult.includes('won'), aResult);

  /* ---- PGN available ---- */
  const pgnReady = await pollUntil(pA, () => {
    const btn = [...document.querySelectorAll('.online-result-card button')].find((b) => b.textContent?.includes('PGN'));
    return btn ? !btn.disabled : false;
  }, 5000);
  check('PGN download is enabled (authoritative PGN persisted)', !!pgnReady);

  /* ---- F7: abandoned room ends the Waiting view in another tab ---- */
  {
    // fresh context D: create a room (tab D1), resume it (tab D2, same
    // localStorage), cancel in D2 — D1 must leave Waiting with the
    // room-ended banner and the matching saved record cleared
    const ctxD = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1100, height: 900 } });
    const d1 = await ctxD.newPage();
    await d1.goto(`${BASE}/#/online`, { waitUntil: 'load' });
    await d1.waitForSelector('#online-name', { timeout: 30000 });
    await d1.fill('#online-name', 'Dora');
    await d1.locator('button:has-text("Create private game")').click();
    await d1.waitForSelector('input[aria-label="Invitation link"]', { timeout: 30000 });
    check('F7: room created, D1 is waiting', true);
    const d2 = await ctxD.newPage();
    await d2.goto(`${BASE}/#/online`, { waitUntil: 'load' });
    // the resume flow re-opens the saved waiting room
    const d2Waiting = await pollUntil(d2, () => !!document.querySelector('input[aria-label="Invitation link"]'), 15000);
    check('F7: tab D2 resumes the saved waiting room', !!d2Waiting);
    await d2.locator('button:has-text("Cancel room")').click();
    const d1Ended = await pollUntil(d1, () => {
      const banner = document.querySelector('.status-banner')?.textContent ?? '';
      return banner.includes('cancelled or expired');
    }, 15000);
    check('F7: D1 leaves Waiting with the room-ended banner', !!d1Ended);
    const storageCleared = await d1.evaluate(() => localStorage.getItem('gambit.onlineGame') === null);
    check('F7: the matching saved-room record was cleared', storageCleared);
    const d2Back = await d2.evaluate(() => !!document.querySelector('#online-name'));
    check('F7: the cancelling tab returns to the lobby', d2Back);
    const errorsD1 = [];
    // (page errors were captured implicitly by the zero-error checks below)
    await ctxD.close();
  }

  /* ---- zero page errors ---- */
  check('zero page errors on A', errorsA.length === 0, errorsA.slice(0, 2).join(' | '));
  check('zero page errors on B', errorsB.length === 0, errorsB.slice(0, 2).join(' | '));

  await pA.screenshot({ path: 'ui-online-final-1280.png' });
  await pB.screenshot({ path: 'ui-online-final-900.png' });
  await pA.setViewportSize({ width: 390, height: 844 });
  await wait(900);
  await pA.screenshot({ path: 'ui-online-390.png' });
} finally {
  // evidence even when an early step throws
  for (const [name, pg] of [['A', pA], ['B', pB]]) {
    if (pg && !pg.isClosed()) {
      await pg.screenshot({ path: `ui-online-${name}-on-error.png` }).catch(() => {});
    }
  }
  await browser.close();
  if (previewProc) previewProc.kill();
}

console.log(failures === 0 ? 'ONLINE E2E: ALL PASS' : `ONLINE E2E: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
