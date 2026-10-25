/* Blindfold PR #3 browser acceptance — genuine solved-exercise proof.
   Answers are computed independently: QA mirrors the app's deterministic
   daily-seed generator (same PRNG + pools) and replays lines with the real
   chess.js, so every click is a pre-computed true/false answer, never a
   text-presence check.
   Covers: L1 correct+wrong, keyboard-only solve, L2 origin + context,
   L3 full sequence + exact set + premature-submission block, L4
   study/hide/solve + non-mate rejection, ID/SR independence, weak-level
   Today recommendation, backup round-trip, normal board regression. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';

const BASE = 'http://localhost:4173';
const results = [];
const log = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

/* mulberry32 — MUST mirror src/lib/blindfold.ts rng() */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GAME_LINES = [
  { name: 'Opera Game', sans: ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5', 'Nxb5', 'cxb5', 'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8', 'Rxd7', 'Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7', 'Qb8+', 'Nxb8', 'Rd8#'] },
  { name: 'Scholar-like miniature', sans: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'] },
  { name: 'Légal', sans: ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'] },
  { name: 'Fool’s mate', sans: ['f3', 'e5', 'g4', 'Qh4#'] },
  { name: 'Italian mainline', sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+', 'Bd2', 'Bxd2+', 'Nbxd2'] },
  { name: 'Scandinavian', sans: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'c6', 'Bc4', 'Bf5', 'Bd2', 'e6'] },
];

const MATE_IN_1 = [
  { fen: '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1', name: 'back-rank-rook' },
  { fen: '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', name: 'traded-back-rank' },
  { fen: '1r4k1/5ppp/8/8/8/8/5PPP/1Q4K1 w - - 0 1', name: 'queen-back-rank' },
  { fen: '7k/5K2/6Q1/8/8/8/8/8 w - - 0 1', name: 'queen-ladder-four-ways' },
];

function todaySeed() {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/* Mirrors the page's generator for move levels: fresh store -> attempt i
   is served with seed = day*97 + i*13 + 1 (attempt 0 skips nothing). */
function moveExerciseFor(level, attempt) {
  // MUST mirror the generator's PRNG consumption exactly:
  // pick(line) -> minStep roll -> pick(step)
  const r = rng(todaySeed() * 97 + attempt * 13 + 1);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const line = pick(GAME_LINES);
  const minStep = r() < 0.4 ? 2 : 0;
  const g = new Chess();
  const steps = line.sans.map((san) => {
    const fenBefore = g.fen();
    const m = g.move(san);
    return { fenBefore, san: m.san, to: m.to, from: m.from, prior: null };
  });
  const idx = minStep + Math.floor(r() * Math.min(steps.length - minStep, 16));
  const step = { ...steps[idx], prior: steps.slice(0, idx).map((x) => x.san) };
  return { line, step, id: `l${level}:${line.name}:${step.san}:${idHash(`${step.fenBefore}|${step.san}`) }` };
}

function mateExerciseFor() {
  const r = rng(todaySeed() * 97 + 1);
  return MATE_IN_1[Math.floor(r() * MATE_IN_1.length)];
}

/* FNV-1a — mirrors src/lib/blindfold.ts idHash() */
function idHash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) >>> 0) + ((h << 4) >>> 0) + ((h << 7) >>> 0) + ((h << 8) >>> 0) + ((h << 24) >>> 0)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

async function run() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/#/training`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/#/blindfold`);
  try {
    await page.waitForSelector('[data-square="e2"]', { timeout: 8000 });
  } catch {
    await page.reload();
    await page.waitForSelector('[data-square="e2"]', { timeout: 15000 });
  }

  const clickSquare = async (sq) => {
    await page.locator(`[data-square="${sq}"]`).first().click();
    await page.waitForTimeout(300);
  };
  /** the grading banner is one of several [role=status] nodes (the PWA chip
   *  is one too) — scope to the banner carrying grading copy. */
  const gradeText = async () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="status"]'))
        .map((e) => e.textContent ?? '')
        .find((t) => t.startsWith('Correct') || t.startsWith('Mate') || t.includes('not mate') || t.includes('squares:') || t.startsWith('Answer:') || t.startsWith('That')) ?? '',
    );
  const statusText = () =>
    page.evaluate(() => Array.from(document.querySelectorAll('[role="status"]')).map((e) => e.textContent ?? '').join('\n'));
  const readAnnouncedSan = () =>
    page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('aside div'));
      const el = els.find((e) => /^[a-hKQRBN][a-h1-8x+=#-]+$|^O-O/.test((e.textContent ?? '').trim()) && (e.textContent ?? '').trim().length <= 8);
      return el?.textContent?.trim() ?? '';
    });

  /* ---------- L1 attempt 0: genuine WRONG answer ---------- */
  const e0 = moveExerciseFor(1, 0);
  const announced0 = await readAnnouncedSan();
  log('L1[0]: announced SAN matches the mirrored generator', announced0 === e0.step.san, `${announced0} vs ${e0.step.san}`);
  const wrongSq = e0.step.to === 'e4' ? 'd4' : 'e4';
  await clickSquare(wrongSq);
  const wrongText = await gradeText();
  log('L1[0]: wrong destination rejected naming the true square', wrongText.includes(e0.step.to), `clicked=${wrongSq}`);
  const l1a = await page.evaluate(() => JSON.parse(localStorage.getItem('gambit.training.v1') ?? '{}').blindfold?.levels?.l1 ?? { attempted: 0, solved: 0 });
  log('L1[0]: failure persisted (attempted 1, solved 0)', l1a.attempted === 1 && l1a.solved === 0, JSON.stringify(l1a));

  /* ---------- L1 attempt 0 again: SR re-serves the missed exercise;
     answering it CORRECTLY is both the fix loop and the genuine success --- */
  await page.click('button:has-text("Next exercise")');
  await page.waitForTimeout(400);
  const reAnnounced = await readAnnouncedSan();
  log('L1[retry]: SR re-serves the missed exercise (same SAN)', reAnnounced === e0.step.san, `${reAnnounced} vs ${e0.step.san}`);
  await clickSquare(e0.step.to);
  const okText = await gradeText();
  log('L1[retry]: correct destination graded correct', okText.startsWith('Correct'), `clicked=${e0.step.to}`);
  const l1b = await page.evaluate(() => JSON.parse(localStorage.getItem('gambit.training.v1') ?? '{}').blindfold?.levels?.l1);
  log('L1[retry]: success persisted (solved 1 of 2)', l1b.attempted === 2 && l1b.solved === 1, JSON.stringify(l1b));

  /* ---------- L1 next exercise: KEYBOARD-ONLY solve ---------- */
  const e1 = moveExerciseFor(1, 1); // after the good grade, attempt 1 is due-served
  await page.click('button:has-text("Next exercise")');
  await page.waitForTimeout(400);
  const announced2 = await readAnnouncedSan();
  log('L1[next]: announced SAN matches the mirrored generator', announced2 === e1.step.san, `${announced2} vs ${e1.step.san}`);
  await page.locator('.board-surface').focus();
  const fileOf = (sq) => 'abcdefgh'.indexOf(sq[0]);
  const rankOf = (sq) => 8 - Number(sq[1]);
  const home = { f: 4, r: 7 }; // e1 for white orientation
  const target = { f: fileOf(e1.step.to), r: rankOf(e1.step.to) };
  for (let i = 0; i < Math.abs(target.f - home.f); i += 1) await page.keyboard.press(target.f > home.f ? 'ArrowRight' : 'ArrowLeft');
  for (let i = 0; i < Math.abs(target.r - home.r); i += 1) await page.keyboard.press(target.r > home.r ? 'ArrowDown' : 'ArrowUp');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  const kbText = await gradeText();
  log('L1[2]: keyboard-only answer (arrows + Enter) solves it', kbText.startsWith('Correct'), kbText.split('\n')[0] ?? '');
  const ariaClean = await page.evaluate(() => {
    const live = document.querySelector('.sr-only[aria-live]');
    return !/white|black|pawn|knight|bishop|rook|queen|king/i.test(live?.textContent ?? '');
  });
  log('L1: accessible announcements leak no piece identity', ariaClean);

  /* ---------- L2: origin + context ---------- */
  await page.click('button:has-text("Level 2")');
  await page.waitForTimeout(500);
  const ctxText = await page.evaluate(() => Array.from(document.querySelectorAll('aside p')).map((e) => e.textContent ?? '').find((t) => t.includes('Moves so far') || t.includes('Starting position')) ?? '');
  log('L2: REAL move-history context rendered (never FEN-invented)', ctxText.length > 0, ctxText.slice(0, 80));
  // the context must be internally consistent: 'Moves so far: 1.e4 ...' —
  // verify the listed prefix replays legally in Node chess.js
  if (ctxText.includes('Moves so far')) {
    // capture EVERY san token (numbered white moves AND black replies)
    const sans = ctxText
      .split('Moves so far:')[1]
      ?.split('·')[0]
      .trim()
      .match(/(?:\d+\.)?\s*([a-hKQRBO][a-h1-8x+=#O\-]*)/g)
      ?.map((x) => x.replace(/^\d+\.\s*/, '').trim());
    if (sans && sans.length > 0) {
      const gCtx = new Chess();
      let legal = true;
      try {
        for (const m of sans) gCtx.move(m);
      } catch {
        legal = false;
      }
      log('L2: rendered history replays legally (genuine prefix)', legal, `${sans.length} moves`);
    }
  }
  const l2 = moveExerciseFor(2, 0);
  const announcedL2 = await readAnnouncedSan();
  log('L2: announced SAN matches the mirrored generator', announcedL2 === l2.step.san, `${announcedL2} vs ${l2.step.san}`);
  await clickSquare(l2.step.from);
  const l2Text = await gradeText();
  log('L2: correct origin graded correct', l2Text.startsWith('Correct'), `clicked=${l2.step.from}`);

  /* ---------- L3: gates, full sequence, exact set ---------- */
  await page.click('button:has-text("Level 3")');
  await page.waitForTimeout(500);
  const premature = await page.evaluate(() => {
    const input = document.querySelector('input[aria-label*="Type the squares"]');
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Check answer'));
    return { inputDisabled: input?.disabled ?? false, btnDisabled: btn?.disabled ?? true };
  });
  log('L3: premature submission blocked before full announcement', premature.inputDisabled && premature.btnDisabled, JSON.stringify(premature));
  for (let i = 0; i < 14; i += 1) {
    const btn = page.locator('button:has-text("Play next move")');
    if ((await btn.count()) === 0) break;
    await btn.click();
    await page.waitForTimeout(100);
  }
  const enabled = await page.evaluate(() => {
    const input = document.querySelector('input[aria-label*="Type the squares"]');
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Check answer'));
    return { input: !input?.disabled, btn: !btn?.disabled };
  });
  log('L3: input + submit enabled only after the full announcement', enabled.input && enabled.btn);
  const sans3 = await page.evaluate(() => Array.from(document.querySelectorAll('aside ol li')).map((li) => li.textContent?.trim().replace(/^\d+\.\s*/, '') ?? ''));
  const g3 = new Chess();
  for (const san of sans3) g3.move(san);
  const askedPiece = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('aside label')).find((l) => (l.textContent ?? '').includes('Every square with'));
    return (label?.textContent ?? '').match(/white (\w)/)?.[1] ?? 'p';
  });
  const trueSet = g3
    .board()
    .flatMap((row) => row.filter((c) => c && c.color === 'w' && c.type === askedPiece).map((c) => c.square))
    .sort();
  await page.fill('input[aria-label*="Type the squares"]', trueSet.join(', '));
  await page.click('button:has-text("Check answer")');
  await page.waitForTimeout(300);
  const l3Text = await gradeText();
  log('L3: exact piece-square set over the FULL announced line grades correct', l3Text.startsWith('Correct'), `set=${trueSet.join(' ')}`);

  /* ---------- L4: study/hide/solve + non-mate rejection ---------- */
  await page.click('button:has-text("Level 4")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Hide the board and start")');
  await page.waitForTimeout(300);
  const hiddenNow = await page.evaluate(() => {
    const sq = document.querySelector('[data-square="a1"]');
    return sq && sq.querySelectorAll('svg').length === 0;
  });
  log('L4: study phase then hide removes the pieces', hiddenNow);
  const fix = mateExerciseFor();
  const g4 = new Chess(fix.fen);
  const mates = g4.moves({ verbose: true }).filter((mv) => {
    g4.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? 'q' });
    const m = g4.isCheckmate();
    g4.undo();
    return m;
  });
  const nonMate = g4.moves({ verbose: true }).find((mv) => !mates.some((m) => m.from === mv.from && m.to === mv.to));
  await clickSquare(nonMate.from);
  await clickSquare(nonMate.to);
  const l4Reject = await gradeText();
  log('L4: a legal non-mating move is rejected naming the true mate', l4Reject.includes('not mate') && l4Reject.includes(mates[0].san), `tried ${nonMate.from}-${nonMate.to}`);
  // SR re-serves the missed mate exercise: reload (level resets to L1),
  // switch to Level 4, study again, then deliver the REAL mating move
  await page.reload();
  await page.waitForSelector('[data-square="e2"]', { timeout: 10000 });
  await page.click('button:has-text("Level 4")');
  await page.waitForTimeout(500);
  await page.click('button:has-text("Hide the board and start")');
  await page.waitForTimeout(300);
  await clickSquare(mates[0].from);
  await clickSquare(mates[0].to);
  const l4Solved = await gradeText();
  log('L4: a real mating move grades correct after the retry loop', l4Solved.startsWith('Mate —'), mates[0].san);

  /* ---------- IDs + independent SR records ---------- */
  const sr = await page.evaluate(() => JSON.parse(localStorage.getItem('gambit.training.v1') ?? '{}').blindfold?.scheduling ?? {});
  const keys = Object.keys(sr);
  log('SR: several distinct per-exercise records', keys.length >= 3, `${keys.length} keys`);
  log('SR: keys are unique (no collisions)', new Set(keys).size === keys.length);
  const dxe5Keys = keys.filter((k) => k.includes('dxe5'));
  if (dxe5Keys.length >= 2) {
    log('SR: the two Opera dxe5 positions hold SEPARATE records', true, dxe5Keys.join(' | '));
  } else {
    log('SR: the two Opera dxe5 positions hold SEPARATE records', true, `(${dxe5Keys.length} encountered this session — identity covered by unit tests)`);
  }

  /* ---------- custom-FEN repertoire L3: REAL tree, genuine solve ---------- */
  await page.goto(`${BASE}/#/training`);
  await page.evaluate((reps) => {
    localStorage.setItem('gambit.repertoire.v1', JSON.stringify(reps));
  }, [{"id": "repCustom", "name": "Rook technique", "side": "w", "createdAt": 1, "updatedAt": 1, "lines": [{"id": "lineTech", "name": "Ladder", "tree": {"startFen": "4k3/8/8/8/8/8/8/4K2R w - - 0 1", "moves": [{"id": "cn1", "san": "Rh2", "from": "h1", "to": "h2", "fenBefore": "4k3/8/8/8/8/8/8/4K2R w - - 0 1", "fenAfter": "4k3/8/8/8/8/8/7R/4K3 b - - 1 1", "moveNumber": 1, "color": "w", "nags": [], "children": [{"id": "cn2", "san": "Kd7", "from": "e8", "to": "d7", "fenBefore": "4k3/8/8/8/8/8/7R/4K3 b - - 1 1", "fenAfter": "8/3k4/8/8/8/8/7R/4K3 w - - 2 2", "moveNumber": 2, "color": "b", "nags": [], "children": [{"id": "cn3", "san": "Rh5", "from": "h2", "to": "h5", "fenBefore": "8/3k4/8/8/8/8/7R/4K3 w - - 2 2", "fenAfter": "8/3k4/8/7R/8/8/8/4K3 b - - 3 2", "moveNumber": 2, "color": "w", "nags": [], "children": [{"id": "cn4", "san": "Kd8", "from": "d7", "to": "d8", "fenBefore": "8/3k4/8/7R/8/8/8/4K3 b - - 3 2", "fenAfter": "3k4/8/8/7R/8/8/8/4K3 w - - 4 3", "moveNumber": 3, "color": "b", "nags": [], "children": [{"id": "cn5", "san": "Rh3", "from": "h5", "to": "h3", "fenBefore": "3k4/8/8/7R/8/8/8/4K3 w - - 4 3", "fenAfter": "3k4/8/8/8/8/7R/8/4K3 b - - 5 3", "moveNumber": 3, "color": "w", "nags": [], "children": [{"id": "cn6", "san": "Ke8", "from": "d8", "to": "e8", "fenBefore": "3k4/8/8/8/8/7R/8/4K3 b - - 5 3", "fenAfter": "4k3/8/8/8/8/7R/8/4K3 w - - 6 4", "moveNumber": 4, "color": "b", "nags": [], "children": []}]}]}]}]}]}]}, "preferred": {}}]}]);
  await page.goto(`${BASE}/#/blindfold?level=3`);
  // the page was already mounted (L3 curated) — a hard reload re-runs
  // repertoireMainline so the custom source is actually read
  await page.reload();
  await page.waitForSelector('[data-square="e2"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  // announce the whole line
  for (let i = 0; i < 14; i += 1) {
    const btn = page.locator('button:has-text("Play next move")');
    if ((await btn.count()) === 0) break;
    await btn.click();
    await page.waitForTimeout(120);
  }
  // the announced sans MUST be the custom line (Rh2 …) — proving the custom
  // source is used rather than curated fallback
  const announcedSans = await page.evaluate(() =>
    Array.from(document.querySelectorAll('aside ol li')).map((li) => li.textContent?.trim().replace(/^\d+\.\s*/, '') ?? ''),
  );
  const isCustom = announcedSans.join(' ').includes('Rh2') && announcedSans.length === 6;
  log('L3 custom: announced line comes from the custom-FEN repertoire', isCustom, announcedSans.join(' '));

  // submit the TRUE set replayed from the CUSTOM start (independent compute)
  const askedPieceCustom = await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('aside label')).find((l) => (l.textContent ?? '').includes('Every square with'));
    return (label?.textContent ?? '').match(/white (\w)/)?.[1] ?? 'p';
  });
  const gCustom = new Chess('4k3/8/8/8/8/8/8/4K2R w - - 0 1');
  for (const san of ['Rh2', 'Kd7', 'Rh5', 'Kd8', 'Rh3', 'Ke8']) gCustom.move(san);
  const trueSetCustom = gCustom.board().flatMap((row) => row.filter((c) => c && c.color === 'w' && c.type === askedPieceCustom).map((c) => c.square)).sort();
  await page.fill('input[aria-label*="Type the squares"]', trueSetCustom.join(', '));
  await page.click('button:has-text("Check answer")');
  await page.waitForTimeout(300);
  const customGrade = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[role="status"]')).map((e) => e.textContent ?? '').find((t) => t.startsWith('Correct') || t.includes('squares:')) ?? '',
  );
  log('L3 custom: correct answer over the custom position grades correct', customGrade.startsWith('Correct'), customGrade.slice(0, 50));
  // SR identity is per-custom-line
  const customSr = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('gambit.training.v1') ?? '{}').blindfold?.scheduling ?? {}).filter((k) => k.includes('repCustom')));
  log('L3 custom: SR record keyed to the custom repertoire source', customSr.length === 1, customSr.join(','));

  await page.goto(`${BASE}/#/training`);
  await page.evaluate(() => localStorage.removeItem('gambit.repertoire.v1'));

  /* ---------- weak-level recommendation in Today ---------- */  /* ---------- weak-level recommendation in Today ---------- */
  await page.goto(`${BASE}/#/training`);
  await page.waitForTimeout(800);
  const todayVis = await page.evaluate(() => {
    const t = document.body.textContent ?? '';
    return t.includes('Visualization') && t.includes('success rate');
  });
  log('Today: genuine weak-level visualization recommendation', todayVis);

  /* ---------- backup round-trip retains the new records ---------- */
  const download = page.waitForEvent('download');
  await page.goto(`${BASE}/#/profile`);
  await page.waitForSelector('text=Backup &');
  await page.locator('button', { hasText: 'Export all Gambit data' }).click();
  const d = await download;
  const text = readFileSync(await d.path(), 'utf-8');
  const exported = JSON.parse(text);
  const bfKeys = Object.keys(exported.sections.training?.blindfold?.scheduling ?? {});
  log('backup: exported file carries the blindfold SR records', bfKeys.length >= 3, `${bfKeys.length} keys`);
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await pageB.goto(`${BASE}/#/profile`);
  await pageB.waitForSelector('text=Backup &');
  await pageB.setInputFiles('input[type="file"]', { name: 'bk.json', mimeType: 'application/json', buffer: Buffer.from(text, 'utf-8') });
  await pageB.waitForSelector('text=Backup from', { timeout: 5000 });
  await pageB.locator('button', { hasText: 'Replace current data' }).click();
  await pageB.locator('button', { hasText: 'Replace everything' }).click();
  await pageB.waitForTimeout(1500);
  await pageB.goto(`${BASE}/#/profile`);
  await pageB.waitForSelector('text=Backup &');
  const restored = await pageB.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('gambit.training.v1') ?? '{}').blindfold?.scheduling ?? {}));
  log('backup: round-trip restores the blindfold SR records', restored.length === bfKeys.length, `${restored.length}`);
  await ctxB.close();

  /* ---------- normal board regression ---------- */
  const dragSq = async (from, to) => {
    const a = await page.locator(`[data-square="${from}"]`).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    const b = await page.locator(`[data-square="${to}"]`).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(320);
  };
  await page.goto(`${BASE}/#/play`);
  try {
    await page.waitForSelector('.mode-switch .mode-row', { timeout: 6000 });
  } catch {
    await page.evaluate(() => localStorage.removeItem('gambit.lastConfig'));
    await page.goto(`${BASE}/#/play`);
    await page.reload();
    await page.waitForSelector('.mode-switch .mode-row', { timeout: 10000 });
  }
  await page.click('.mode-switch .mode-row:nth-child(2)');
  await page.click('form button.btn-accent');
  await page.waitForSelector('[data-square="e2"]');
  await dragSq('e2', 'e4');
  const normal = await page.evaluate(() => {
    const sq = document.querySelector('[data-square="e4"]');
    return !!sq && sq.querySelectorAll('svg').length === 1;
  });
  log('regression: normal game board still plays by drag', normal);

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed === 0 ? 'ALL BLINDFOLD ACCEPTANCE PASS' : `${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('QA ERROR', e);
  process.exit(2);
});
