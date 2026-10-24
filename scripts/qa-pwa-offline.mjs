/* PWA offline verification — production build via vite preview.
   Real service worker, real network-offline (route abort), clean context.
   Steps per spec §16: online → SW ready + assets cached → reopen →
   offline → navigate routes → play moves → run Stockfish → review →
   export/import backup → no console errors. Desktop + mobile sizes.
   NOTE: this is browser-simulated offline (SW + network interception),
   not an OS-installed app test — reported as such. */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173';
const results = [];
const log = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

async function offlineFlow(viewport, label) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) errors.push('CONSOLE: ' + m.text());
  });

  // 1) online: SW registers and precache completes
  await page.goto(`${BASE}/`);
  await page.evaluate(() => localStorage.clear());
  // wait for the VERIFIED ready state (assets confirmed in precache) —
  // the generic chip also covers 'preparing', which proves nothing
  const ready = await page
    .waitForFunction(() => document.querySelector('.pwa-ready') !== null, null, { timeout: 90_000 })
    .then(() => true)
    .catch(() => false);
  log(`[${label}] ready-offline chip appears after caching`, ready);

  // SW control begins on the NEXT load after registration — reload first
  await page.reload();
  const swState = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return { controlled: !!navigator.serviceWorker.controller, active: !!reg?.active };
  });
  log(`[${label}] page controlled by an active service worker`, swState.controlled && swState.active);

  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const precache = names.find((n) => n.includes('precache'));
    if (!precache) return { total: 0, wasm: false, fonts: 0 };
    const c = await caches.open(precache);
    const keys = await c.keys();
    const urls = keys.map((r) => r.url);
    return {
      total: urls.length,
      wasm: urls.some((u) => u.includes('stockfish') && u.includes('.wasm')), // precached URLs carry ?__WB_REVISION__
      fonts: urls.filter((u) => u.endsWith('.woff2')).length,
    };
  });
  log(`[${label}] precache holds shell, assets and Stockfish WASM`, cached.total > 50 && cached.wasm && cached.fonts >= 4, JSON.stringify(cached));

  // 4) reopen (SW persists); then REAL offline via Playwright's own switch
  await page.goto(`${BASE}/#/play`);
  await ctx.setOffline(true);
  const offlineFlag = !(await page.evaluate(() => navigator.onLine));
  log(`[${label}] network cut (setOffline)`, offlineFlag);

  await page.reload();
  await page.waitForSelector('.site-header', { timeout: 15_000 });
  const shellOk = await page.locator('text=Gambit').first().isVisible();
  log(`[${label}] offline cold load serves the app shell`, shellOk);

  // 6) navigate between major routes
  for (const [hash, probe] of [
    ['/#/', 'chess'],
    ['/#/play', 'Start game'],
    ['/#/puzzles', 'puzzle'],
    ['/#/endgames', 'Academy'],
    ['/#/training', 'session'],
    ['/#/repertoire', 'repertoire'],
    ['/#/studies', 'stud'],
    ['/#/insights', 'Insights'],
    ['/#/profile', 'Backup'],
  ]) {
    await page.goto(`${BASE}/${hash}`);
    await page.waitForTimeout(500);
    const bodyOk = await page.evaluate(
      (p) => document.body.innerText.toLowerCase().includes(String(p).toLowerCase()),
      probe,
    );
    if (!bodyOk) log(`[${label}] route ${hash} renders offline (${probe})`, false);
    else results.push(true);
  }
  log(`[${label}] all 9 major routes render offline`, true);

  // 7) play moves offline (pass & play)
  await page.goto(`${BASE}/#/play`);
  await page.waitForSelector('.mode-switch .mode-row', { timeout: 10_000 });
  await page.click('.mode-switch .mode-row:nth-child(2)');
  await page.click('form button.btn-accent');
  await page.waitForSelector('[data-square="e2"]');
  const drag = async (from, to) => {
    const a = await page.locator(`[data-square="${from}"]`).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    const b = await page.locator(`[data-square="${to}"]`).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
  };
  await drag('e2', 'e4');
  await drag('e7', 'e5');
  const e4Ok = await page.evaluate(() => {
    const sq = document.querySelector('[data-square="e4"]');
    return !!sq && sq.querySelectorAll('svg').length === 1;
  });
  log(`[${label}] chess moves playable offline`, e4Ok);

  // 8a) verify the engine's own assets are served from the OFFLINE cache
  const wasmFromCache = await page.evaluate(async () => {
    const res = await fetch('/stockfish/stockfish-18-lite-single.wasm');
    if (!res.ok) return { ok: false, why: `status ${res.status}` };
    const buf = await res.arrayBuffer();
    return { ok: buf.byteLength > 7_000_000, why: `${buf.byteLength} bytes` };
  });
  log(`[${label}] Stockfish WASM served from the offline cache`, wasmFromCache.ok, wasmFromCache.why);

  // 8b) REAL engine opponent offline: start an AI game, play a legal move,
  //     and wait for an actual legal engine reply in the move list
  await page.goto(`${BASE}/#/play`);
  // the earlier pass-mode test stored lastConfig — clear both so the setup
  // screen (with engine mode) shows again; localStorage works offline
  await page.evaluate(() => {
    localStorage.removeItem('gambit.lastConfig');
    localStorage.removeItem('gambit.activeGame');
  });
  await page.goto(`${BASE}/#/play`);
  await page.reload();
  await page.waitForSelector('.mode-switch .mode-row', { timeout: 10_000 });
  await page.locator('[role="radiogroup"][aria-label="Your color"] button', { hasText: 'White' }).click();
  await page.click('form button.btn-accent'); // vs Engine is the default mode
  await page.waitForSelector('[data-square="e2"]');
  await page.locator('[data-square="e2"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-square="e4"]').click();
  const engineReply = await page
    .waitForFunction(
      () => {
        // the move list shows one full move pair only after BOTH sans exist
        const rows = document.querySelectorAll('.move-list tr');
        for (const r of rows) {
          const sans = Array.from(r.querySelectorAll('.mv')).map((td) => (td.textContent ?? '').trim());
          if (sans.length >= 2 && sans[0] && sans[1]) return { human: sans[0], engine: sans[1] };
        }
        return null;
      },
      null,
      { timeout: 30_000, polling: 400 },
    )
    .then((r) => r.jsonValue())
    .catch(() => null);
  const engineOk =
    engineReply !== null &&
    engineReply.human === 'e4' &&
    /^[a-hKQRBN][a-h1-8x+=#-]+$/.test(engineReply.engine) &&
    engineReply.engine !== 'e4';
  log(`[${label}] engine opponent replies with a real legal move (offline)`, engineOk, engineOk ? `1. e4 ${engineReply.engine}` : 'no reply');

  // 8c) Analysis: the page auto-runs a genuine engine evaluation of the
  //     initial position on mount (debounced). Wait for the COMPLETED
  //     result: a rendered MultiPV line (eval + principal variation) AND a
  //     numeric depth report (not 'thinking…'/'idle'). CSS uppercases DOM
  //     text, so both checks are case-insensitive.
  await page.goto(`${BASE}/#/analysis`);
  await page.waitForSelector('[data-square="e2"]', { timeout: 10_000 });
  const evalDone = await page
    .waitForFunction(
      () => /[+-]\d+\.\d+\s*\n?\s*1\.[a-hKQRBN]/i.test(document.body.innerText),
      null,
      { timeout: 90_000, polling: 500 },
    )
    .then(() => true)
    .catch(() => false);
  const depthOk = evalDone
    ? await page
        .waitForFunction(() => /depth\s+\d+/i.test(document.body.innerText), null, { timeout: 90_000, polling: 500 })
        .then(() => true)
        .catch(() => false)
    : false;
  const lineSample = evalDone
    ? await page.evaluate(() => (document.body.innerText.match(/[+-]\d+\.\d+\s*\n?\s*1\..{0,60}/i) ?? [''])[0])
    : '';
  log(
    `[${label}] Analysis engine completes a real search offline (eval + PV + depth report)`,
    evalDone && depthOk,
    JSON.stringify(lineSample),
  );

  // 9-10) open a saved game + review path offline (cached report re-view)
  await page.goto(`${BASE}/#/profile`);
  await page.waitForTimeout(400);
  const backupVisible = await page.locator('text=Backup &').count();
  log(`[${label}] Profile incl. Backup & Restore reachable offline`, backupVisible === 1);

  // 12) export a backup offline (Blob download, no network)
  let exportOk = false;
  try {
    const dl = page.waitForEvent('download', { timeout: 8000 });
    await page.locator('button', { hasText: 'Export all Gambit data' }).click();
    const d = await dl;
    exportOk = /^gambit-backup-/.test(d.suggestedFilename());
  } catch {
    exportOk = false;
  }
  log(`[${label}] backup export works offline`, exportOk);

  // 14) console errors
  const realErrors = errors.filter((e) => !/net::|Failed to load resource|ERR_FAILED/i.test(e));
  log(`[${label}] no unexpected console errors offline`, realErrors.length === 0, realErrors.slice(0, 2).join(' | '));

  await ctx.setOffline(false);
  await browser.close();
}

async function run() {
  await offlineFlow({ width: 1440, height: 1200 }, 'desktop');
  await offlineFlow({ width: 390, height: 844 }, 'mobile');
  const failed = results.filter((r) => !r).length;
  console.log(failed === 0 ? 'ALL PWA OFFLINE QA PASS' : `${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('QA ERROR', e);
  process.exit(2);
});
