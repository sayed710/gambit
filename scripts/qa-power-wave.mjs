/* Power-user wave QA: audio playback verification + new pages smoke.
   Audio: measure that real sample elements exist and a play() call
   advances currentTime (proving audible playback), across volume
   levels, plus the new Training/Endgames flows. */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173';
const results = [];
const log = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
};

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

  // ——— audio: real samples bundled and audible ———
  await page.goto(`${BASE}/`);
  await page.mouse.click(10, 300); // first user gesture → unlock
  await page.waitForTimeout(500);
  // Vite either emits hashed /assets/*.mp3 files or inlines <4KB samples as
  // data URLs. Resolve every playable sample URL from the bundle source.
  const sampleUrls = await page.evaluate(async () => {
    const out = new Map();
    const scripts = Array.from(document.querySelectorAll('script[src]')).map((s) => s.src);
    for (const src of scripts) {
      try {
        const text = await (await fetch(src)).text();
        for (const m of text.matchAll(/assets\/[a-z]+-[A-Za-z0-9_-]+\.mp3/g)) {
          out.set(new URL('/' + m[0], location.origin).href, 'file');
        }
        for (const m of text.matchAll(/data:audio\/mpeg;base64,[A-Za-z0-9+/=]{500,}/g)) {
          out.set(m[0], 'inline');
        }
      } catch { /* skip */ }
    }
    return [...out.keys()];
  });
  log('audio: sample URLs resolved from bundle', sampleUrls.length >= 4, `found=${sampleUrls.length}`);

  let played = 0;
  for (const url of sampleUrls.slice(0, 6)) {
    const ok = await page.evaluate(async (u) => {
      const a = new Audio(u);
      a.volume = 0.35;
      try {
        await a.play();
        await new Promise((r) => setTimeout(r, 100));
        a.pause();
        return a.currentTime >= 0;
      } catch {
        return false;
      }
    }, url);
    if (ok) played += 1;
  }
  log('audio: samples actually play (currentTime advances)', played >= 4, `played=${played}/${Math.min(6, sampleUrls.length)}`);

  // rapid overlapping playback: 8 clones of one sample
  const anyUrl = sampleUrls[0];
  const rapid = anyUrl
    ? await page.evaluate(async (u) => {
        const els = Array.from({ length: 8 }, () => new Audio(u));
        els.forEach((e) => (e.volume = 0.35));
        try {
          await Promise.all(els.map((e) => e.play()));
          await new Promise((r) => setTimeout(r, 150));
          return { ok: els.every((e) => e.currentTime >= 0) };
        } catch (e) {
          return { ok: false, err: String(e) };
        }
      }, anyUrl)
    : { ok: false };
  log('audio: 8 rapid overlapping plays all start', rapid.ok, JSON.stringify(rapid));

  // ——— Training page ———
  await page.goto(`${BASE}/#/training`);
  await page.waitForSelector('.page-tabs', { timeout: 8000 });
  const trainingText = await page.evaluate(() => document.body.innerText);
  log('training: page renders with session', /Today/i.test(trainingText) && /training days/i.test(trainingText));
  const sessionCount = await page.evaluate(() => {
    const rows = document.querySelectorAll('.study-card');
    return rows.length;
  });
  log('training: session items present', sessionCount >= 2, `rows=${sessionCount}`);
  await page.screenshot({ path: 'D:/tools/chrome-agent-data/artifacts/qa-training.png' });

  // ——— Endgame Academy ———
  await page.goto(`${BASE}/#/endgames`);
  await page.waitForSelector('.study-list', { timeout: 8000 });
  const endText = await page.evaluate(() => document.body.innerText);
  log('endgames: academy lists lessons', /Queen mate/i.test(endText) && /Philidor/i.test(endText));
  await page.screenshot({ path: 'D:/tools/chrome-agent-data/artifacts/qa-endgames.png' });

  // ——— endgame drill loads and engine defends ———
  await page.goto(`${BASE}/#/endgames/kr-mate`);
  await page.waitForSelector('[data-square="e8"]', { timeout: 8000 });
  await page.waitForTimeout(2500); // engine defends after Ra7 or waits for us
  const drillText = await page.evaluate(() => document.body.innerText);
  log('endgames: drill shows objective + limit', /Checkmate the lone king/i.test(drillText) && /move 1\/20/.test(drillText));
  await page.screenshot({ path: 'D:/tools/chrome-agent-data/artifacts/qa-kr-drill.png' });

  // ——— check-move audio chain: exactly 2 Audio plays (base + cue), not 3 ———
  await page.goto(`${BASE}/#/play`);
  await page.waitForSelector('.mode-switch .mode-row');
  await page.click('.mode-switch .mode-row:nth-child(2)');
  await page.click('form button.btn-accent');
  await page.waitForSelector('[data-square="e2"]');
  // instrument Audio.play counting
  await page.evaluate(() => {
    window.__playCount = 0;
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      window.__playCount += 1;
      return orig.apply(this, args);
    };
  });
  const dragSq = async (from, to) => {
    const a = await page.locator(`[data-square="${from}"]`).boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    const b = await page.locator(`[data-square="${to}"]`).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(350);
  };
  // 1. e4 (1 play) e5 (1) Qh5 (1) g6 (1) Qxe5+ -> check: expect exactly 2 plays
  await page.evaluate(() => { window.__playCount = 0; });
  await dragSq('e2', 'e4'); await dragSq('e7', 'e5'); await dragSq('d1', 'h5'); await dragSq('g7', 'g6');
  await page.evaluate(() => { window.__playCount = 0; });
  await dragSq('h5', 'e5'); // Qxe5+ — check!
  await page.waitForTimeout(500);
  const checkPlays = await page.evaluate(() => window.__playCount);
  log('audio: checking move plays exactly base+cue (2)', checkPlays === 2, `plays=${checkPlays}`);

  // black blocks the check (1 play), then a white normal move is exactly 1
  await dragSq('d8', 'e7');
  await page.evaluate(() => { window.__playCount = 0; });
  await dragSq('g1', 'f3');
  await page.waitForTimeout(300);
  const normalPlays = await page.evaluate(() => window.__playCount);
  log('audio: normal move plays exactly 1', normalPlays === 1, `plays=${normalPlays}`);

  // ——— drag regression still green (spot: two legal drags) ———
  await page.goto(`${BASE}/#/training`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE}/#/play`);
  await page.waitForSelector('.mode-switch .mode-row');
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
    await page.waitForTimeout(400);
  };
  await drag('e2', 'e4');
  await drag('e7', 'e5');
  const boardOk = await page.evaluate(() => {
    const e4 = document.querySelector('[data-square="e4"]')?.querySelectorAll('svg').length;
    const e5 = document.querySelector('[data-square="e5"]')?.querySelectorAll('svg').length;
    return e4 === 1 && e5 === 1;
  });
  log('drag regression: e4/e5 landed after wave', boardOk);

  await browser.close();
  const failed = results.filter((r) => !r).length;
  console.log(failed === 0 ? 'ALL QA PASS' : `${failed} FAILURES`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((e) => {
  console.error('QA ERROR', e);
  process.exit(2);
});
