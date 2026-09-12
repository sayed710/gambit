import type { Ply } from './types';
import type { PlyEval, GameReport } from './review';
import { buildReport } from './review';

/** Result shape of the app's engine evaluator (white-perspective cp). */
export interface EngineEvalResult {
  cp: number;
  mateIn: number | null;
  bestSan: string | null;
}

export interface AnalysisHooks {
  /** true when a newer run owns the UI state (or the component unmounted) */
  isStale: () => boolean;
  onProgress: (done: number, total: number) => void;
  onComplete: (report: GameReport) => void;
  /** called when this run aborted because it went stale — the state belongs to the newer run */
  onAbort: () => void;
}

/** Convert an engine evaluation to the report's white-perspective position eval. */
export function plyEvalFromEngineResult(res: EngineEvalResult): PlyEval {
  let cp = res.cp;
  let mateIn: number | null = null;
  if (Math.abs(res.cp) >= 9000) {
    // mate scores: cp is ±99000-ish from the engine wrapper; sign = who mates
    mateIn = res.mateIn !== null ? res.mateIn * 2 : res.cp > 0 ? 2 : -2; // plies, signed white-positive
    cp = res.cp > 0 ? 10_000 : -10_000;
  }
  return { cp, mateIn, bestSan: res.bestSan };
}

/**
 * Analyze every position of a game (position i sits immediately before ply i).
 *
 * Staleness contract: EVERY state write (`onProgress`, `onComplete`) and the
 * cache-affecting completion are guarded by `hooks.isStale()`, checked both
 * before and after each await. A stale run therefore cannot mutate any UI
 * state that belongs to a newer run — guaranteed structurally, in one place.
 */
export async function runGameAnalysis(
  plies: Ply[],
  fens: string[],
  evaluate: (fen: string, depth: number) => Promise<EngineEvalResult | null>,
  toPlyEval: (res: EngineEvalResult) => PlyEval,
  hooks: AnalysisHooks,
): Promise<void> {
  const total = plies.length + 1;
  if (hooks.isStale()) {
    hooks.onAbort();
    return;
  }
  hooks.onProgress(0, total);

  const evals: (PlyEval | null)[] = [];
  for (let i = 0; i < total; i++) {
    let evaluation: PlyEval | null = null;
    try {
      const res = await evaluate(fens[i], 12);
      evaluation = res ? toPlyEval(res) : null;
    } catch {
      evaluation = null;
    }
    if (hooks.isStale()) {
      hooks.onAbort();
      return;
    }
    evals.push(evaluation);
    hooks.onProgress(i + 1, total);
  }

  if (hooks.isStale()) {
    hooks.onAbort();
    return;
  }
  hooks.onComplete(buildReport(plies, evals));
}
