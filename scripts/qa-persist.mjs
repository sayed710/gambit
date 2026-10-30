/* PR-A browser QA — data-loss protection under real storage failures.
   Sections:
   1. seeded 50-game history + quota fault on the profile key: banner honesty,
      emergency export content, normal backup exclusion, verified recovery,
      import under quota (file kept + no success claim), idempotent re-imports
   2. total quota (profile + status store both blocked): banner still renders
      from actual application behavior, the status key is NOT persisted,
      real reload keeps the durable data intact
   3. double failure (active-game removal AND finished-marker write): after a
      real reload the stale snapshot is flagged unverified and the ordinary
      Resume is replaced by a labeled recovery action; a confirmed completed
      game (finishedId) offers no resume action at all; with BOTH lastConfig
      and activeGame present the recovery panel outranks auto-start and
      normal resume / explicit discard both work; a FAILED discard keeps the
      panel with a truthful error; Acknowledge dismisses warnings and
      unsaved-game tracking but PRESERVES active-game reliability evidence
      across a real reload (snapshot stays unverified)
   4. beforeunload: live game warns (game screen), finished-durable game does
      not warn, finished-unpersisted game warns through the APP-LEVEL guard —
      including from Profile after SPA navigation; a real reload from Profile
      fires the dialog and forcing through genuinely loses the data
   Uncaught page errors fail the run. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:4173';
const results = [];
const pageErrors = [];
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

/** Return to the configuration screen. `gambit.lastConfig` auto-starts a game
    on boot, so the cleanup + reload path is the normal route back. Call this
    BEFORE installing any storage faults — it may remove storage keys. */
async function resetToModeSwitch(page) {
  try {
    await page.waitForSelector('.mode-switch .mode-row', { timeout: 4000 });
    return;
  } catch {}
  await page.evaluate(() => {
    try {
      localStorage.removeItem('gambit.lastConfig');
    } catch {}
    try {
      localStorage.removeItem('gambit.activeGame');
    } catch {}
  });
  await page.reload();
  await page.waitForSelector('.mode-switch .mode-row', { timeout: 10000 });
}

/** Start a white-vs-engine game, make e4, wait for the engine reply. */
async function startAndPlayOpening(page) {
  await page.locator('[role="radiogroup"][aria-label="Your color"] button', { hasText: 'White' }).click();
  await page.click('form button.btn-accent');
  await page.waitForSelector('[data-square="e2"]');
  const drag = dragOn(page);
  await drag('e2', 'e4');
  await page.waitForFunction(() => document.querySelectorAll('.move-list td.mv').length >= 2, null, { timeout: 45000, polling: 300 });
}

/** Resign through the confirm dialog. */
async function resignGame(page) {
  await page.click('button:has-text("Resign")');
  try {
    const danger = page.locator('.btn-danger:visible').last();
    await danger.waitFor({ state: 'visible', timeout: 3000 });
    await danger.click();
  } catch {}
  await page.waitForTimeout(700);
}

/** Dispatch a cancelable beforeunload through the real app handler. */
async function beforeUnloadVetoed(page) {
  return page.evaluate(() => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
}

const faultSetItem = (keys) => `
  (() => {
    const real = Storage.prototype.setItem;
    const blocked = new Set(${JSON.stringify(keys)});
    Storage.prototype.setItem = function (key, value) {
      if (blocked.has(key)) throw new DOMException('quota', 'QuotaExceededError');
      return real.call(this, key, value);
    };
  })()`;

const faultRemoveItem = (keys) => `
  (() => {
    const real = Storage.prototype.removeItem;
    const blocked = new Set(${JSON.stringify(keys)});
    Storage.prototype.removeItem = function (key) {
      if (blocked.has(key)) throw new DOMException('quota', 'QuotaExceededError');
      return real.call(this, key);
    };
  })()`;

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    pageErrors.push(e.message);
    console.log('PAGEERROR:', e.message.slice(0, 300));
  });

  /* ================= section 1: profile-key quota ================= */
  await page.goto(`${BASE}/#/training`);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => {
    const gameRecord = (id, i) => ({
      id,
      date: Date.now() - i * 1000,
      mode: 'ai',
      timeControl: { id: '10+0', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 },
      playerColor: 'w',
      opponentName: 'Engine · Club',
      opponentRating: 1900,
      result: 'win',
      reason: 'checkmate',
      moves: ['e4', 'e5', 'Nf3'],
      pgn: '1. e4 e5 2. Nf3',
      ratingBefore: 1200,
      ratingAfter: 1200,
    });
    const games = Array.from({ length: 50 }, (_, i) => gameRecord(`seed-${i + 1}`, i));
    localStorage.setItem('gambit.profile', JSON.stringify({ joined: 1, rating: 1200, peakRating: 1200, ratingHistory: [1200], games, puzzle: { rating: 1200, solved: 0, failed: 0, bestStreak: 0 } }));
  });

  await page.goto(`${BASE}/#/training`);
  await page.reload();
  await page.waitForTimeout(700);
  const seededCount = await page.evaluate(() => JSON.parse(localStorage.getItem('gambit.profile')).games.length);
  log('seed: 50-game history loaded', seededCount === 50, `${seededCount}`);

  // inject quota failure for the profile key (real Storage.prototype fault)
  await page.evaluate(faultSetItem(['gambit.profile']));

  await page.goto(`${BASE}/#/play`);
  await resetToModeSwitch(page);
  await page.evaluate(faultSetItem(['gambit.profile']));
  await startAndPlayOpening(page);
  await resignGame(page);

  const banner = await page.evaluate(() => {
    const el = document.querySelector('.persist-banner[role="alert"]');
    const t = el?.textContent ?? '';
    return {
      present: !!el,
      saysNotSaved: t.includes('may NOT be saved'),
      saysBackupReadsSaved: t.includes('Backup export reads durable storage only'),
      mentionsQuota: t.includes('Storage is full'),
    };
  });
  log('banner: persistent alert states what is not saved + backup honesty', banner.present && banner.saysNotSaved && banner.saysBackupReadsSaved && banner.mentionsQuota, JSON.stringify(banner));

  // the emergency export lives on the game screen (in-session state), so it
  // runs in the SAME session, with the fault still active — the download
  // itself does not need storage and the record must stay absent durably

  /* emergency export contains exactly the finished game */
  const dl = page.waitForEvent('download');
  await page.click('button:has-text("Emergency export this game")');
  const download = await dl;
  const raw = readFileSync(await download.path(), 'utf-8');
  const emergency = JSON.parse(raw);
  const emergencyId = emergency.game.id;
  const storedIds = await page.evaluate(() => JSON.parse(localStorage.getItem('gambit.profile')).games.map((g) => g.id));
  log(
    'emergency file: kind + exactly the unsaved game (absent from storage)',
    emergency.kind === 'emergency-game' && emergency.app === 'gambit' && typeof emergency.game?.id === 'string' && !storedIds.includes(emergencyId),
    `${emergency.game?.id} moves=${emergency.game?.moves?.length}`,
  );

  /* normal backup export stays valid and excludes the unsaved game
     (SPA navigation — the session store survives, durable storage does not change) */
  await page.goto(`${BASE}/#/profile`);
  await page.waitForSelector('text=Backup &', { timeout: 10000 });
  const dl2 = page.waitForEvent('download');
  await page.locator('button', { hasText: 'Export all Gambit data' }).click();
  const d2 = await dl2;
  const backupText = readFileSync(await d2.path(), 'utf-8');
  const backup = JSON.parse(backupText);
  const backupIds = backup.sections.profile.games.map((g) => g.id);
  log(
    'normal backup: valid, unchanged 50 games, no unsaved game inside',
    backup.app === 'gambit' && backupIds.length === 50 && !backupIds.includes(emergencyId),
    `${backupIds.length} games`,
  );

  /* free space (reload lifts the fault), then the emergency game imports back */
  await page.reload();
  await page.waitForSelector('text=Backup &', { timeout: 10000 });
  await page.setInputFiles('input[type="file"]', {
    name: 'emergency.json',
    mimeType: 'application/json',
    buffer: Buffer.from(raw, 'utf-8'),
  });
  await page.waitForSelector('text=Emergency game file', { timeout: 6000 });
  await page.click('button:has-text("Import emergency game")');
  await page.waitForTimeout(600);
  const imported = await page.evaluate((eid) => {
    const games = JSON.parse(localStorage.getItem('gambit.profile')).games;
    return { count: games.length, has: games.some((g) => g.id === eid) };
  }, emergencyId);
  log('recovery: emergency game imported into history (51 games now)', imported.count === 51 && imported.has, `${imported.count} games`);

  /* emergency import with quota STILL exhausted */
  await page.reload();
  await page.waitForSelector('text=Backup &', { timeout: 10000 });
  // remove the imported game from durable storage so the import is meaningful
  // (test-side seeding while storage WORKS — no fault installed here)
  await page.evaluate((eid) => {
    const profile = JSON.parse(localStorage.getItem('gambit.profile'));
    profile.games = profile.games.filter((g) => g.id !== eid);
    localStorage.setItem('gambit.profile', JSON.stringify(profile));
  }, emergencyId);
  await page.evaluate(faultSetItem(['gambit.profile']));
  await page.setInputFiles('input[type="file"]', {
    name: 'emergency.json',
    mimeType: 'application/json',
    buffer: Buffer.from(raw, 'utf-8'),
  });
  await page.waitForSelector('text=Emergency game file', { timeout: 6000 });
  await page.click('button:has-text("Import emergency game")');
  await page.waitForTimeout(600);
  const failState = await page.evaluate(() => ({
    kept: document.body.textContent.includes('Emergency import FAILED'),
    noSuccess: !document.body.textContent.includes('imported AND verified'),
    gameCount: JSON.parse(localStorage.getItem('gambit.profile')).games.length,
  }));
  log('emergency import under quota: failure shown, file kept, no success claim', failState.kept && failState.noSuccess && failState.gameCount === 50, JSON.stringify(failState));

  /* duplicate import idempotence (quota lifted via reload) */
  await page.reload();
  await page.waitForSelector('text=Backup &', { timeout: 10000 });
  await page.setInputFiles('input[type="file"]', {
    name: 'emergency.json',
    mimeType: 'application/json',
    buffer: Buffer.from(raw, 'utf-8'),
  });
  await page.waitForSelector('text=Emergency game file', { timeout: 6000 });
  await page.click('button:has-text("Import emergency game")');
  await page.waitForTimeout(500);
  await page.setInputFiles('input[type="file"]', {
    name: 'emergency.json',
    mimeType: 'application/json',
    buffer: Buffer.from(raw, 'utf-8'),
  });
  await page.waitForSelector('text=Emergency game file', { timeout: 6000 });
  await page.click('button:has-text("Import emergency game")');
  await page.waitForTimeout(500);
  const dup = await page.evaluate((eid) => JSON.parse(localStorage.getItem('gambit.profile')).games.filter((g) => g.id === eid).length, emergencyId);
  log('emergency import: repeated imports stay idempotent (one record)', dup === 1, `${dup} record(s)`);

  /* ================= section 2: total quota (profile + status store) ================= */
  await page.reload(); // native setItem restored; fresh app state
  await page.waitForSelector('text=Backup &', { timeout: 10000 });
  // durable state for this section: 50 games (no emergency record)
  await page.evaluate((eid) => {
    const profile = JSON.parse(localStorage.getItem('gambit.profile'));
    profile.games = profile.games.filter((g) => g.id !== eid);
    localStorage.setItem('gambit.profile', JSON.stringify(profile));
  }, emergencyId);
  const statusBefore = await page.evaluate(() => localStorage.getItem('gambit.persistStatus.v1'));
  // BOTH the profile and the status-store writes are blocked — a genuine
  // application-side failure (the import below) must still surface in the UI
  await page.evaluate(faultSetItem(['gambit.profile', 'gambit.persistStatus.v1']));
  await page.setInputFiles('input[type="file"]', {
    name: 'emergency.json',
    mimeType: 'application/json',
    buffer: Buffer.from(raw, 'utf-8'),
  });
  await page.waitForSelector('text=Emergency game file', { timeout: 6000 });
  await page.click('button:has-text("Import emergency game")');
  await page.waitForTimeout(600);
  const totalQuota = await page.evaluate(() => ({
    banner: !!document.querySelector('.persist-banner[role="alert"]'),
    kept: document.body.textContent.includes('Emergency import FAILED'),
    noSuccess: !document.body.textContent.includes('imported AND verified'),
    gameCount: JSON.parse(localStorage.getItem('gambit.profile')).games.length,
    statusOnDisk: localStorage.getItem('gambit.persistStatus.v1'),
  }));
  log(
    'total quota: banner renders from app behavior, import refused, status key NOT persisted',
    totalQuota.banner && totalQuota.kept && totalQuota.noSuccess && totalQuota.gameCount === 50 && totalQuota.statusOnDisk === statusBefore,
    `banner=${totalQuota.banner} kept=${totalQuota.kept} games=${totalQuota.gameCount} statusUnchanged=${totalQuota.statusOnDisk === statusBefore}`,
  );
  // real reload: durable data intact, the memory-only warning honestly gone
  await page.reload();
  await page.waitForTimeout(800);
  const afterReload = await page.evaluate(() => ({
    gameCount: JSON.parse(localStorage.getItem('gambit.profile')).games.length,
    statusOnDisk: localStorage.getItem('gambit.persistStatus.v1'),
  }));
  log(
    'total quota after real reload: data intact, status file byte-identical',
    afterReload.gameCount === 50 && afterReload.statusOnDisk === statusBefore,
    `games=${afterReload.gameCount}`,
  );

  /* ================= section 3: double failure on the active game ================= */
  // play to a point where a snapshot IS on disk, then block BOTH removal and
  // the finished-marker write; the stale snapshot must never present as a
  // safely resumable game after a real reload
  await page.goto(`${BASE}/#/play`);
  await resetToModeSwitch(page);
  await page.evaluate(faultRemoveItem(['gambit.activeGame']));
  await startAndPlayOpening(page);
  // snapshot (2 plies) is now durably written; block further snapshot writes
  await page.evaluate(faultSetItem(['gambit.activeGame']));
  const countBeforeResign = await page.evaluate(() => JSON.parse(localStorage.getItem('gambit.profile')).games.length);
  await resignGame(page);
  const dbl = await page.evaluate(() => ({
    banner: !!document.querySelector('.persist-banner[role="alert"]'),
    snapshotStillThere: !!localStorage.getItem('gambit.activeGame'),
    gameCount: JSON.parse(localStorage.getItem('gambit.profile')).games.length,
  }));
  log(
    'double failure: banner shows, stale snapshot survives on disk, record still saved',
    dbl.banner && dbl.snapshotStillThere && dbl.gameCount === countBeforeResign + 1,
    `banner=${dbl.banner} snapshot=${dbl.snapshotStillThere} games=${dbl.gameCount}`,
  );
  // SPA navigation: the failure stays visible away from the game screen
  await page.click('.main-nav a:has-text("Profile")');
  await page.waitForTimeout(400);
  const spaBanner = await page.evaluate(() => !!document.querySelector('.persist-banner[role="alert"]'));
  log('double failure: failure banner survives SPA navigation to Profile', spaBanner);
  // real reload → the stale snapshot must be labeled unverified, never resumable-safe.
  // BOTH lastConfig and activeGame remain in storage: the snapshot must
  // outrank lastConfig (no auto-start) and present the recovery panel.
  await page.reload();
  await page.goto(`${BASE}/#/play`);
  await page.waitForTimeout(600);
  const resumePanel = await page.evaluate(() => {
    const t = document.body.textContent;
    const buttons = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim());
    return {
      panel: t.includes('Game in progress'),
      unverified: t.includes('could not be verified'),
      plainResume: buttons.includes('Resume'),
      recoverLabeled: buttons.some((b) => b?.startsWith('Recover anyway')),
    };
  });
  log(
    'double failure after real reload: snapshot flagged unverified, plain Resume replaced by a labeled recovery action',
    resumePanel.panel && resumePanel.unverified && !resumePanel.plainResume && resumePanel.recoverLabeled,
    JSON.stringify(resumePanel),
  );
  // cleanup: discard the stale snapshot and lift faults via reload
  await page.click('button:has-text("Discard")');
  await page.reload();
  await page.waitForTimeout(500);

  /* ---------- confirmed completed game (finishedId): never resumable ---------- */
  // only the REMOVAL fails; the finished-marker write succeeds, so the
  // snapshot is explicitly marked finished — after a real reload the panel
  // must offer neither Resume nor Recover-anyway
  await resetToModeSwitch(page);
  await page.evaluate(faultRemoveItem(['gambit.activeGame']));
  await startAndPlayOpening(page);
  await resignGame(page);
  await page.reload(); // lifts faults; finishedId snapshot survives
  await page.waitForTimeout(600);
  const finishedPanel = await page.evaluate(() => {
    const t = document.body.textContent;
    const buttons = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim());
    return {
      finished: t.includes('Finished game snapshot'),
      notResumable: t.includes('NOT resumable'),
      anyResume: buttons.includes('Resume') || buttons.some((b) => b?.startsWith('Recover anyway')),
    };
  });
  log(
    'confirmed completed game after reload: NOT resumable, no resume action offered',
    finishedPanel.finished && finishedPanel.notResumable && !finishedPanel.anyResume,
    JSON.stringify(finishedPanel),
  );
  await page.click('button:has-text("Discard")');
  await page.waitForTimeout(300);

  /* ---------- lastConfig + activeGame together: resume and discard ---------- */
  // a real reload with BOTH keys present and nothing deleted: the recovery
  // panel must take precedence over auto-start, resume must restore the game
  await resetToModeSwitch(page);
  await startAndPlayOpening(page); // writes lastConfig AND the activeGame snapshot
  await page.reload(); // no key deleted
  await page.waitForTimeout(600);
  const resumeFlow = await page.evaluate(() => {
    const t = document.body.textContent;
    const buttons = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim());
    return {
      panel: t.includes('Game in progress'),
      plainResume: buttons.includes('Resume'),
      autoStarted: !!document.querySelector('[data-square="e2"]') && !t.includes('Game in progress'),
    };
  });
  log(
    'lastConfig+activeGame after reload: recovery panel, not auto-start; plain Resume for verified snapshot',
    resumeFlow.panel && resumeFlow.plainResume && !resumeFlow.autoStarted,
    JSON.stringify(resumeFlow),
  );
  // normal resume restores the played position
  await page.click('button:has-text("Resume")');
  await page.waitForTimeout(500);
  const resumedPlies = await page.evaluate(() => document.querySelectorAll('.move-list td.mv').length);
  log('normal resume: the snapshot restores the played moves', resumedPlies >= 2, `plies=${resumedPlies}`);
  // explicit discard: reload → panel → Discard → configuration screen
  await page.reload();
  await page.waitForTimeout(600);
  await page.click('button:has-text("Discard")');
  await page.waitForTimeout(400);
  const discarded = await page.evaluate(() => ({
    modeSwitch: !!document.querySelector('.mode-switch .mode-row'),
    snapshotGone: !localStorage.getItem('gambit.activeGame'),
  }));
  log('explicit discard: snapshot removed, configuration screen shown', discarded.modeSwitch && discarded.snapshotGone, JSON.stringify(discarded));

  /* ---------- Discard failure: verified removal, truthful error ---------- */
  // removal is checked: when storage refuses, the panel MUST stay with a
  // truthful error — never a silent false success
  await resetToModeSwitch(page);
  await startAndPlayOpening(page); // writes lastConfig AND a verified snapshot
  await page.reload();
  await page.waitForTimeout(600);
  await page.evaluate(faultSetItem(['gambit.activeGame']));
  await page.evaluate(faultRemoveItem(['gambit.activeGame']));
  await page.click('button:has-text("Discard")');
  await page.waitForTimeout(400);
  const discardFail = await page.evaluate(() => {
    const t = document.body.textContent;
    const buttons = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim());
    return {
      keyStillThere: !!localStorage.getItem('gambit.activeGame'),
      panelStill: t.includes('Game in progress'),
      error: t.includes('Discard FAILED'),
      // after the failed removal the app reports a persist failure, so the
      // snapshot is unverified: the offered action is the labeled recovery
      actionOffered: buttons.includes('Resume') || buttons.some((b) => b?.startsWith('Recover anyway')),
    };
  });
  log(
    'discard failure: snapshot kept, panel preserved with truthful error, no false success',
    discardFail.keyStillThere && discardFail.panelStill && discardFail.error && discardFail.actionOffered,
    JSON.stringify(discardFail),
  );
  await page.reload(); // lift faults
  await page.waitForTimeout(500);
  await page.click('button:has-text("Discard")'); // cleanup: verified discard now
  await page.waitForTimeout(300);

  /* ---------- Acknowledge must not upgrade an unverified snapshot ---------- */
  // The snapshot is written first (verified), THEN the triple fault: the
  // profile write, the snapshot removal AND the finished-marker write all
  // fail. Acknowledge dismisses the profile warning and the unsaved-game
  // tracking, but the active-game RELIABILITY EVIDENCE must survive so the
  // snapshot stays unverified across a real reload.
  await resetToModeSwitch(page);
  await startAndPlayOpening(page); // snapshot durably written first
  await page.evaluate(faultSetItem(['gambit.profile', 'gambit.activeGame']));
  await page.evaluate(faultRemoveItem(['gambit.activeGame']));
  await resignGame(page);
  await page.waitForTimeout(400);
  const ackBefore = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim());
    return {
      ack: buttons.some((b) => b?.startsWith('Acknowledge')),
      banner: !!document.querySelector('.persist-banner[role="alert"]'),
    };
  });
  log('triple fault: Acknowledge offered (dismissible warning + unsaved game exist)', ackBefore.ack && ackBefore.banner, JSON.stringify(ackBefore));
  // two Acknowledge buttons exist in this state (unsaved-section and
  // failures-section); click the failures-section one by its exact copy
  await page.click('button:has-text("Acknowledge (I understand the data may be lost)")');
  await page.waitForTimeout(300);
  const ackAfter = await page.evaluate(() => {
    let status = {};
    try {
      status = JSON.parse(localStorage.getItem('gambit.persistStatus.v1') ?? '{}');
    } catch {}
    return {
      banner: !!document.querySelector('.persist-banner[role="alert"]'),
      activeGameEntry: !!status['gambit.activeGame'],
      profileEntry: !!status['gambit.profile'],
    };
  });
  log(
    'Acknowledge: active-game reliability evidence survives, profile warning cleared',
    ackAfter.banner && ackAfter.activeGameEntry && !ackAfter.profileEntry,
    JSON.stringify(ackAfter),
  );
  // real reload: the snapshot remains unverified — no ordinary Resume.
  // Diagnostics on failure: URL, snapshot presence, body snippet.
  await page.reload();
  await page.goto(`${BASE}/#/play`);
  await page.waitForTimeout(600);
  const unverifiedAfterAck = await page.evaluate(() => {
    const t = document.body.textContent;
    const buttons = [...document.querySelectorAll('button')].map((b) => b.textContent?.trim());
    return {
      url: location.href,
      snapshotOnDisk: !!localStorage.getItem('gambit.activeGame'),
      panel: t.includes('Game in progress'),
      unverified: t.includes('could not be verified'),
      plainResume: buttons.includes('Resume'),
      recoverLabeled: buttons.some((b) => b?.startsWith('Recover anyway')),
    };
  });
  log(
    'Acknowledge + real reload: snapshot remains unverified, no ordinary Resume',
    unverifiedAfterAck.panel && unverifiedAfterAck.unverified && !unverifiedAfterAck.plainResume && unverifiedAfterAck.recoverLabeled,
    JSON.stringify(unverifiedAfterAck),
  );
  await page.click('button:has-text("Discard")'); // faults died with the reload
  await page.waitForTimeout(300);

  /* ================= section 4: beforeunload guards ================= */
  // (a) live game: reload/close is vetoed
  await resetToModeSwitch(page);
  await startAndPlayOpening(page);
  // settle: the veto handler is registered in a passive effect, which can
  // flush a frame after the DOM shows the second ply
  await page.waitForTimeout(500);
  const vetoLive = await beforeUnloadVetoed(page);
  log('beforeunload: live game arms a reload veto', vetoLive === true, `vetoed=${vetoLive}`);
  // (b) resign with WORKING storage: the finished record is durable → no veto
  const countBeforeB = await page.evaluate(() => JSON.parse(localStorage.getItem('gambit.profile')).games.length);
  await resignGame(page);
  await page.waitForTimeout(500); // passive-effect settle before the dispatch
  const vetoDurable = await beforeUnloadVetoed(page);
  const durableCount = await page.evaluate(() => JSON.parse(localStorage.getItem('gambit.profile')).games.length);
  log(
    'beforeunload: finished durable game does not veto',
    vetoDurable === false && durableCount === countBeforeB + 1,
    `vetoed=${vetoDurable} games=${durableCount}`,
  );
  // (c) finished UNPERSISTED game: veto armed while the record is absent durably
  await resetToModeSwitch(page);
  await page.evaluate(faultSetItem(['gambit.profile']));
  await startAndPlayOpening(page);
  const countBeforeC = await page.evaluate(() => JSON.parse(localStorage.getItem('gambit.profile')).games.length);
  await resignGame(page);
  await page.waitForTimeout(500); // passive-effect settle before the dispatch
  const vetoUnsaved = await beforeUnloadVetoed(page);
  log('beforeunload: finished UNPERSISTED game arms a reload veto', vetoUnsaved === true, `vetoed=${vetoUnsaved}`);
  // (d) SPA navigation: the emergency route stays reachable from any page
  await page.click('.main-nav a:has-text("Profile")');
  await page.waitForTimeout(400);
  const unsavedRoute = await page.evaluate(() => {
    const t = document.body.textContent;
    return {
      section: t.includes('could not be saved and exist only on this screen session'),
      exportButton: [...document.querySelectorAll('button')].some((b) => b.textContent?.startsWith('Emergency export (')),
    };
  });
  log('SPA navigation: unsaved-game emergency export available from Profile', unsavedRoute.section && unsavedRoute.exportButton, JSON.stringify(unsavedRoute));
  // (e) app-level guard: we are on Profile now — the game screen is unmounted,
  // but the session store is not. The veto must still be armed, a real reload
  // from Profile must fire the beforeunload dialog, and forcing through must
  // genuinely lose the unpersisted record (the warning is not cosmetic).
  const vetoFromProfile = await beforeUnloadVetoed(page);
  log('app-level guard: unsaved game still vetoes reload from Profile', vetoFromProfile === true, `vetoed=${vetoFromProfile}`);
  let dialogSeen = false;
  const dialogHandler = (d) => {
    dialogSeen = d.type() === 'beforeunload';
    d.dismiss().catch(() => {});
  };
  page.on('dialog', dialogHandler);
  let reloadThrew = false;
  try {
    await page.reload({ timeout: 4000 });
  } catch {
    reloadThrew = true;
  }
  await page.waitForTimeout(600);
  page.off('dialog', dialogHandler);
  log(
    'app-level guard: beforeunload dialog fires on a real reload from Profile',
    dialogSeen,
    `dialog=${dialogSeen} reloadThrew=${reloadThrew}`,
  );
  // force through: the dialog is accepted this time; the unpersisted record
  // must be honestly gone
  page.once('dialog', (d) => d.accept().catch(() => {}));
  await page.reload({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  const afterForce = await page.evaluate(() => JSON.parse(localStorage.getItem('gambit.profile')).games.length);
  log(
    'real reload forces through: the unpersisted records are honestly gone',
    afterForce === countBeforeC,
    `games=${afterForce} (expected ${countBeforeC})`,
  );

  await ctx.close();
  await browser.close();
  const failed = results.filter((r) => !r).length;
  if (pageErrors.length > 0) console.log(`UNCAUGHT PAGE ERRORS: ${pageErrors.length}`);
  const verdict = failed === 0 && pageErrors.length === 0;
  console.log(verdict ? 'ALL PERSIST QA PASS' : `${failed} FAILURES${pageErrors.length ? `, ${pageErrors.length} uncaught page errors` : ''}`);
  process.exit(verdict ? 0 : 1);
}

run().catch((e) => {
  console.error('QA ERROR', e);
  process.exit(2);
});
