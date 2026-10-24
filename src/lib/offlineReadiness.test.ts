import { describe, expect, it } from 'vitest';
import { assessOfflineReadiness } from './offlineReadiness';

/* Truthful offline readiness: every required asset class must be in the
   precache, including the RUNNING version's entry script. */

const BASE = 'http://localhost:4173';
const ENTRY = `${BASE}/assets/index-ABC123.js`;

function fullCache(): string[] {
  return [
    `${BASE}/index.html?__WB_REVISION__=r1`,
    `${BASE}/assets/index-ABC123.js?__WB_REVISION__=r2`,
    `${BASE}/assets/index-DEF456.css?__WB_REVISION__=r3`,
    `${BASE}/assets/inter-latin-400-XYZ.woff2?__WB_REVISION__=r4`,
    `${BASE}/assets/move-HASH1.mp3?__WB_REVISION__=r5`,
    `${BASE}/stockfish/stockfish-18-lite-single.js?__WB_REVISION__=r6`,
    `${BASE}/stockfish/stockfish-18-lite-single.wasm?__WB_REVISION__=r7`,
  ];
}

describe('offline readiness assessment', () => {
  it('a fully cached app is ready', () => {
    const r = assessOfflineReadiness({ precacheUrls: fullCache(), runningEntryScript: ENTRY });
    expect(r.ready).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it('incomplete cache (no fonts, no sounds) is NOT ready', () => {
    const urls = fullCache().filter((u) => !u.endsWith('.woff2?__WB_REVISION__=r4') && !u.includes('.mp3'));
    const r = assessOfflineReadiness({ precacheUrls: urls, runningEntryScript: ENTRY });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('fonts');
    expect(r.missing).toContain('sounds');
  });

  it('missing Stockfish WASM is NOT ready', () => {
    const urls = fullCache().filter((u) => !u.includes('.wasm'));
    const r = assessOfflineReadiness({ precacheUrls: urls, runningEntryScript: ENTRY });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('Stockfish WASM');
  });

  it('missing app shell is NOT ready', () => {
    const urls = fullCache().filter((u) => !u.includes('index.html'));
    const r = assessOfflineReadiness({ precacheUrls: urls, runningEntryScript: ENTRY });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('app shell');
  });

  it('a stale/superseded cache (running entry script absent) is NOT ready', () => {
    // old cache from the previous deploy; the page now runs a NEW hashed build
    const r = assessOfflineReadiness({ precacheUrls: fullCache(), runningEntryScript: `${BASE}/assets/index-NEW789.js` });
    expect(r.ready).toBe(false);
    expect(r.missing).toContain('current app build');
  });
});
