/* Backup & Restore browser round-trip:
   context A (populated) → export → context B (clean) → import (replace)
   → verify data; then merge semantics + rejection cases, no internet
   needed (all local). Uses real UI flows. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:4173';
const results = [];
const log = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1';

function profileWith(gameId, extra = {}) {
  return {
    name: 'ContextA',
    rating: 1420,
    games: [
      {
        id: gameId,
        date: 1792000000000,
        mode: 'ai',
        timeControl: { id: '10+0', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 },
        playerColor: 'w',
        opponentName: 'Engine · Club',
        opponentRating: 1300,
        result: 'win',
        reason: 'checkmate',
        moves: ['e4', 'e5', 'Nf3'],
        pgn: '1. e4 e5 2. Nf3',
        ratingBefore: 1400,
        ratingAfter: 1420,
        moveTimings: [
          { ply: 1, color: 'w', thinkMs: 2100, clockBeforeMs: 600000, clockAfterMs: 597900 },
          { ply: 3, color: 'w', thinkMs: 800, clockBeforeMs: 598000, clockAfterMs: 597200 },
        ],
        ...extra,
      },
    ],
  };
}

async function run() {
  const browser = await chromium.launch();

  /* ---------- context A: seed real data, export via the UI ---------- */
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const pageA = await ctxA.newPage();
  await pageA.goto(`${BASE}/`);
  await pageA.evaluate((p) => {
    localStorage.clear();
    localStorage.setItem('gambit.profile', JSON.stringify(p));
    localStorage.setItem('gambit.settings', JSON.stringify({ boardTheme: 'glacier' }));
    localStorage.setItem('gambit.repertoire.v1', JSON.stringify([
      { id: 'rep-1', name: 'QA Rep', side: 'w', createdAt: 1, updatedAt: 1, lines: [{ id: 'l1', name: 'Main', tree: { startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [{ id: 'rn1', san: 'e4', from: 'e2', to: 'e4', fenBefore: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', fenAfter: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1', moveNumber: 1, color: 'w', nags: [], children: [] }] }, preferred: { __root__: 'rn1' } }] },
    ]));
    localStorage.setItem('gambit.training.v1', JSON.stringify({ version: 1, endgame: {}, repScheduling: { 'rep-1:l1:rn1': { lastRating: 'good', dueAt: 1792900000000, intervalDays: 4, reps: 2 } }, motifs: { fork: { opportunities: 6, found: 2, missed: 4, lastSeen: 1, recentMisses: [] } }, motifGames: { 'g-qa-1': 1792000003000 }, adaptive: { queue: [], lastGenerated: null } }));
    localStorage.setItem('gambit.practice.v1', JSON.stringify([{ id: 'p1', kind: 'mistake', sourceGameId: 'g-qa-1', ply: 3, fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', side: 'w', objective: 'Find Nf3', expectedSan: 'Nf3', createdAt: 1, attempts: 2, solved: 1, lastPracticed: null }]));
    localStorage.setItem('gambit.review.g-qa-1', JSON.stringify({ reviews: [{ san: 'e4', color: 'w', cpl: 0, classification: 'best' }], evals: [{ cp: 20, mateIn: null, bestSan: 'e4' }, null], accuracy: { w: 96, b: 90 }, counts: { w: {}, b: {} }, avgCpl: { w: 0, b: 0 } }));
  }, profileWith('g-qa-1'));

  const downloadPromise = pageA.waitForEvent('download');
  await pageA.goto(`${BASE}/#/profile`);
  await pageA.waitForSelector('text=Backup &');
  const exportBtn = pageA.locator('button', { hasText: 'Export all Gambit data' });
  await exportBtn.click();
  const download = await downloadPromise;
  const suggested = download.suggestedFilename();
  const backupText = readFileSync(await download.path(), 'utf-8');
  log('export: UI downloads a dated backup file', /^gambit-backup-\d{4}-\d{2}-\d{2}\.json$/.test(suggested), suggested);
  const parsed = JSON.parse(backupText);
  log('export: envelope carries all domains', parsed.app === 'gambit' && parsed.format === 1 && parsed.sections.profile.games.length === 1 && parsed.sections.reviews['g-qa-1'] !== undefined);
  const lastExport = await pageA.locator('text=Last export:').count();
  log('export: last-export summary shown', lastExport === 1);
  await ctxA.close();

  /* ---------- context B: clean profile, import via the UI ---------- */
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const pageB = await ctxB.newPage();
  await pageB.goto(`${BASE}/`);
  await pageB.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('unrelated.foreign.key', 'must survive');
  });
  await pageB.goto(`${BASE}/#/profile`);
  await pageB.waitForSelector('text=Backup &');

  const chooser = pageB.waitForEvent('filechooser');
  await pageB.locator('input[type="file"]').click();
  const fc = await chooser;
  await fc.setFiles({ name: suggested, mimeType: 'application/json', buffer: Buffer.from(backupText, 'utf-8') });
  await pageB.waitForSelector('text=Backup from', { timeout: 5000 });
  const previewShown = 1;
  log('restore: preview shown after picking the file', previewShown === 1);

  // REPLACE mode
  await pageB.locator('button', { hasText: 'Replace current data' }).click();
  await pageB.locator('button', { hasText: 'Replace everything' }).click();
  await pageB.waitForSelector('text=verified', { timeout: 8000 });
  await pageB.waitForTimeout(1400); // reload
  await pageB.goto(`${BASE}/#/profile`);
  await pageB.waitForSelector('text=Backup &');

  const restored = await pageB.evaluate(() => ({
    profile: JSON.parse(localStorage.getItem('gambit.profile') ?? 'null'),
    rep: JSON.parse(localStorage.getItem('gambit.repertoire.v1') ?? 'null'),
    training: JSON.parse(localStorage.getItem('gambit.training.v1') ?? 'null'),
    practice: JSON.parse(localStorage.getItem('gambit.practice.v1') ?? 'null'),
    review: JSON.parse(localStorage.getItem('gambit.review.g-qa-1') ?? 'null'),
    foreign: localStorage.getItem('unrelated.foreign.key'),
  }));
  log(
    'restore: full round-trip — game id, timings, review, preferred map, SR due, motif marker, practice',
    restored.profile?.games?.[0]?.id === 'g-qa-1' &&
      JSON.stringify(restored.profile.games[0].moveTimings[1]).includes('"ply":3') &&
      restored.review?.accuracy?.w === 96 &&
      restored.rep?.[0]?.lines?.[0]?.preferred?.__root__ === 'rn1' &&
      restored.training?.repScheduling?.['rep-1:l1:rn1']?.dueAt === 1792900000000 &&
      restored.training?.motifGames?.['g-qa-1'] === 1792000003000 &&
      restored.practice?.[0]?.attempts === 2,
  );
  log('restore: unrelated foreign key untouched', restored.foreign === 'must survive');

  /* ---------- merge: same backup twice changes nothing ---------- */
  const chooser2 = pageB.waitForEvent('filechooser');
  await pageB.locator('input[type="file"]').click();
  const fc2 = await chooser2;
  await fc2.setFiles({ name: suggested, mimeType: 'application/json', buffer: Buffer.from(backupText, 'utf-8') });
  await pageB.waitForSelector('text=Backup from', { timeout: 5000 });
  await pageB.locator('button', { hasText: 'Merge this backup' }).click();
  await pageB.waitForSelector('role=status', { timeout: 8000 });
  const afterDouble = await pageB.evaluate(() => JSON.parse(localStorage.getItem('gambit.profile') ?? '{}'));
  log('merge: importing the same backup twice adds no duplicate games', afterDouble.games?.length === 1, `games=${afterDouble.games?.length}`);

  /* ---------- rejection: tampered file ---------- */
  const chooser3 = pageB.waitForEvent('filechooser');
  await pageB.locator('input[type="file"]').click();
  const fc3 = await chooser3;
  const tampered = JSON.parse(backupText);
  tampered.sections.profile.games[0].moves = ['e4', 'Ke9']; // illegal SAN
  await fc3.setFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tampered), 'utf-8') });
  await pageB.waitForTimeout(400);
  const rejected = await pageB.locator('role=alert').count();
  const rejectText = await pageB.evaluate(() => document.querySelector('[role="alert"]')?.textContent ?? '');
  log('restore: illegal move list rejected with a specific reason', rejected === 1 && /illegal SAN/i.test(rejectText), rejectText.slice(0, 60));

  /* ---------- interrupted restore: durable recovery across a "crash" ---------- */
  // simulate: restore began, wrote partial data, browser died before rollback
  await pageB.evaluate(() => {
    localStorage.setItem('gambit.restore.recovery.v1', JSON.stringify({
      savedAt: Date.now(),
      mode: 'replace',
      data: {
        'gambit.profile': localStorage.getItem('gambit.profile'), // pre-restore value captured above
        'gambit.review.g-qa-1': null, // this key did not exist before the interrupted restore
      },
    }));
    localStorage.setItem('gambit.review.g-qa-1', 'partial-garbage'); // mid-restore write
  });
  await pageB.reload(); // "next app boot"
  await pageB.waitForSelector('text=Backup &');
  const banner = await pageB.locator('text=Interrupted restore detected').count();
  log('recovery: interrupted restore detected on next load', banner === 1);

  // pending guard: a new restore must be blocked while the snapshot waits
  const chooserG = pageB.waitForEvent('filechooser');
  await pageB.locator('input[type="file"]').click();
  (await chooserG).setFiles({ name: 'bk.json', mimeType: 'application/json', buffer: Buffer.from(backupText, 'utf-8') });
  await pageB.waitForSelector('text=Backup from', { timeout: 5000 });
  await pageB.locator('button', { hasText: 'Merge this backup' }).click();
  await pageB.waitForTimeout(400);
  const blockedMsg = await pageB.evaluate(() => document.body.textContent.includes('still waiting'));
  const markerUntouched = await pageB.evaluate(() => localStorage.getItem('gambit.restore.recovery.v1') !== null);
  log('recovery: new restore blocked while a snapshot is pending', blockedMsg && markerUntouched);

  // FAILURE flow: silently corrupt profile writes, Recover must fail honestly
  await pageB.evaluate(() => {
    const real = Storage.prototype.setItem;
    window.__faultActive = true;
    Storage.prototype.setItem = function (key, value) {
      if (window.__faultActive && key === 'gambit.profile') return real.call(this, key, String(value).slice(0, 5));
      return real.call(this, key, value);
    };
  });
  await pageB.click('button:has-text("Recover pre-restore data")');
  await pageB.waitForTimeout(600);
  const failState = await pageB.evaluate(() => ({
    kept: localStorage.getItem('gambit.restore.recovery.v1') !== null,
    errorText: Array.from(document.querySelectorAll('[role="alert"]')).some((e) => (e.textContent ?? '').includes('could not fully restore')),
    noSuccess: !document.body.textContent.includes('recovered and verified'),
  }));
  log(
    'recovery: FAILED recover keeps the snapshot, names keys, claims no success',
    failState.kept && failState.errorText && failState.noSuccess,
    JSON.stringify(failState),
  );

  // SUCCESS flow: remove the fault, Recover verifies and discards
  await pageB.evaluate(() => {
    window.__faultActive = false;
  });
  await pageB.click('button:has-text("Recover pre-restore data")');
  await pageB.waitForTimeout(1600); // verified success -> reload
  await pageB.goto(`${BASE}/#/profile`);
  await pageB.waitForSelector('text=Backup &');
  const recovered = await pageB.evaluate(() => ({
    profile: JSON.parse(localStorage.getItem('gambit.profile') ?? 'null'),
    partial: localStorage.getItem('gambit.review.g-qa-1'),
    marker: localStorage.getItem('gambit.restore.recovery.v1'),
  }));
  log(
    'recovery: verified recover restores data and discards the snapshot',
    recovered.profile?.games?.length === 1 && recovered.partial === null && recovered.marker === null,
    JSON.stringify({ games: recovered.profile?.games?.length, partial: recovered.partial, marker: recovered.marker }),
  );

  await ctxB.close();
  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed === 0 ? 'ALL BACKUP QA PASS' : `${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('QA ERROR', e);
  process.exit(2);
});
