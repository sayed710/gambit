/* ============================================================
   offlineReadiness — truthful "Ready offline" assessment.

   Ready is claimed ONLY when the precache holds every REQUIRED asset
   for the CURRENTLY RUNNING version: the app shell, the engine
   (worker JS + WASM), the running document's own entry script (a real
   anti-stale check — a superseded cache fails it), styles, at least
   one font and one sound. Registration alone proves nothing, and a
   cache missing any of these must not produce "Ready offline".
   ============================================================ */

export interface ReadinessInput {
  /** every URL currently stored in the workbox precache */
  precacheUrls: string[];
  /** the src of the running document's module entry script (hashed), if any */
  runningEntryScript?: string | null;
}

export interface Readiness {
  ready: boolean;
  missing: string[];
}

function has(urls: string[], pred: (u: string) => boolean): boolean {
  return urls.some(pred);
}

/** Strip workbox revision query for suffix checks. */
function clean(u: string): string {
  return u.split('?')[0] ?? u;
}

export function assessOfflineReadiness(input: ReadinessInput): Readiness {
  const urls = input.precacheUrls;
  const cleaned = urls.map(clean);
  const missing: string[] = [];

  // 1) app shell: the precached navigation document
  if (!has(cleaned, (u) => u.endsWith('/index.html') || u === '/' || u.endsWith('/'))) {
    missing.push('app shell');
  }
  // 2) engine worker + WASM — the offline engine is non-negotiable
  if (!has(cleaned, (u) => u.includes('stockfish') && u.endsWith('.js'))) missing.push('Stockfish worker');
  if (!has(cleaned, (u) => u.includes('stockfish') && u.endsWith('.wasm'))) missing.push('Stockfish WASM');
  // 3) the RUNNING version's entry script — catches stale/superseded caches
  if (input.runningEntryScript) {
    const wanted = clean(input.runningEntryScript);
    if (!urls.some((u) => clean(u) === wanted || clean(u).endsWith(wanted.split('/').pop() ?? wanted))) {
      missing.push('current app build');
    }
  }
  // 4) styles, at least one font face and one sound sample
  if (!has(cleaned, (u) => u.endsWith('.css'))) missing.push('styles');
  if (!has(cleaned, (u) => u.endsWith('.woff2'))) missing.push('fonts');
  if (!has(cleaned, (u) => u.endsWith('.mp3'))) missing.push('sounds');

  return { ready: missing.length === 0, missing };
}
