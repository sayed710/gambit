import { describe, expect, it, vi } from 'vitest';
import type { Ply } from './types';
import { runGameAnalysis, plyEvalFromEngineResult } from './reviewRunner';
import type { EngineEvalResult } from './reviewRunner';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const AFTER_E4 = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1';

function ply(san: string, fenAfter: string, color: 'w' | 'b'): Ply {
  return { san, from: 'e2' as never, to: 'e4' as never, color, fenAfter, isCapture: false, isCheck: false };
}

const fens = [START, AFTER_E4, START.replace('w KQkq', 'b KQkq')];
const plies = [ply('e4', AFTER_E4, 'w'), ply('e5', fens[2], 'b')];
const evalResult: EngineEvalResult = { cp: 30, mateIn: null, bestSan: 'e5' };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('runGameAnalysis stale-run isolation', () => {
  it('a run that goes stale mid-flight cannot touch progress, completion, or report state', async () => {
    let token = 1;
    const isStale = () => token !== 1;
    const deferreds = [deferred<EngineEvalResult | null>(), deferred<EngineEvalResult | null>(), deferred<EngineEvalResult | null>()];
    let call = 0;
    const evaluate = vi.fn(() => deferreds[call++].promise);

    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const onAbort = vi.fn();

    const run = runGameAnalysis(plies, fens, evaluate, plyEvalFromEngineResult, {
      isStale,
      onProgress,
      onComplete,
      onAbort,
    });

    // initial progress was emitted while the run was current
    expect(onProgress).toHaveBeenCalledWith(0, 3);

    // a newer run takes over → this run is stale while its first evaluate is pending
    token = 2;
    deferreds[0].resolve(evalResult);
    await run;

    expect(onAbort).toHaveBeenCalledTimes(1);
    // the stale run emitted nothing after losing ownership
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onComplete).not.toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledTimes(1); // it stopped at the first position
  });

  it('the current run completes and writes its report; a finished stale run cannot overwrite it', async () => {
    let token = 2;
    const isStale = () => token !== 2;
    const deferreds = [deferred<EngineEvalResult | null>(), deferred<EngineEvalResult | null>(), deferred<EngineEvalResult | null>()];
    let call = 0;
    const evaluate = vi.fn(() => deferreds[call++].promise);
    const onComplete = vi.fn();

    const run = runGameAnalysis(plies, fens, evaluate, plyEvalFromEngineResult, {
      isStale,
      onProgress: () => {},
      onComplete,
      onAbort: () => {},
    });

    // complete the current run fully
    deferreds[0].resolve(evalResult);
    deferreds[1].resolve(evalResult);
    deferreds[2].resolve(evalResult);
    await run;

    expect(onComplete).toHaveBeenCalledTimes(1);
    const report = onComplete.mock.calls[0][0];
    expect(report.reviews).toHaveLength(2);
    expect(report.evals).toHaveLength(3);

    // now mark the run stale — a late extra resolution must not re-enter
    token = 3;
    deferreds[2].resolve(evalResult);
    await Promise.resolve();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('plyEvalFromEngineResult maps mate scores to signed white-perspective plies', () => {
    const whiteMating = plyEvalFromEngineResult({ cp: 99_000, mateIn: 2, bestSan: 'Qh7' });
    expect(whiteMating.cp).toBe(10_000);
    expect(whiteMating.mateIn).toBe(4); // 2 moves → 4 plies, white-positive

    const blackMating = plyEvalFromEngineResult({ cp: -99_000, mateIn: -1, bestSan: 'Qh2' });
    expect(blackMating.cp).toBe(-10_000);
    expect(blackMating.mateIn).toBe(-2);

    const quiet = plyEvalFromEngineResult({ cp: 45, mateIn: null, bestSan: 'Nf3' });
    expect(quiet).toEqual({ cp: 45, mateIn: null, bestSan: 'Nf3' });
  });
});
