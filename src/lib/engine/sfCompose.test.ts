import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { composeSearchResult } from './stockfish';
import type { SelectionResult } from './personas';

type InfoLine = { multipv: number; cp: number | null; mate: number | null; depth: number; pv: string[]; bounded: boolean };

/* ============================================================
   Integration contract: SelectionResult -> SFSearchResult.
   (Pure mapping extracted from sfSearch's onLine handler.)
   ============================================================ */

const START = new Chess().fen();

function info(multipv: number, uci: string, cp: number | null, depth = 8, mate: number | null = null, bounded = false): InfoLine {
  const g = new Chess(START);
  const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
  void m;
  return { multipv, cp, mate, depth, pv: [uci, 'a7a6', 'a2a3'], bounded };
}

describe('SelectionResult -> SFSearchResult mapping', () => {
  it('a chosen candidate attaches ONLY its own score/depth/PV', () => {
    const infos = [info(1, 'e2e4', 100), info(2, 'g1f3', 40)];
    const choice: SelectionResult = {
      uci: 'g1f3',
      candidate: { multipv: 2, uci: 'g1f3', san: 'Nf3', cp: 40, mate: null, depth: 8, pvSan: ['Nf3'] },
      via: 'persona',
    };
    const res = composeSearchResult(START, infos, 'e2e4', choice, { useMulti: true, fullStrength: false, level: 4 });
    expect(res!.bestmove).toBe('g1f3');
    expect(res!.san).toBe('Nf3');
    expect(res!.cp).toBe(40); // candidate's own score, never line #1's 100
    expect(res!.depth).toBe(8);
    expect(res!.pvSan).toEqual(['Nf3', 'a6', 'a3']);
  });

  it('an UNLISTED legal bestmove: move + SAN kept, score metadata null/unknown — MultiPV #1 never leaks', () => {
    const infos = [info(1, 'e2e4', 100), info(2, 'g1f3', 40)];
    const choice: SelectionResult = { uci: 'b1c3', candidate: null, via: 'engine-best', reason: 'bestmove-unlisted' };
    const res = composeSearchResult(START, infos, 'b1c3', choice, { useMulti: true, fullStrength: false, level: 4 });
    expect(res!.bestmove).toBe('b1c3');
    expect(res!.san).toBe('Nc3'); // computed independently
    expect(res!.cp).toBeNull(); // no borrowed 100
    expect(res!.mate).toBeNull();
    expect(res!.depth).toBe(0);
    expect(res!.pvSan).toEqual([]); // no borrowed PV
    // the lines array still reports what the engine actually said
    expect(res!.lines).toHaveLength(2);
  });

  it('an unlisted bestmove with a MATE score on MultiPV #1: the mate number does not leak', () => {
    const infos = [{ ...info(1, 'e2e4', null, 8, 3) }, info(2, 'g1f3', 40)];
    const choice: SelectionResult = { uci: 'b1c3', candidate: null, via: 'engine-best', reason: 'bestmove-unlisted' };
    const res = composeSearchResult(START, infos, 'b1c3', choice, { useMulti: true, fullStrength: false, level: 4 });
    expect(res!.bestmove).toBe('b1c3');
    expect(res!.cp).toBeNull();
    expect(res!.mate).toBeNull();
    expect(res!.pvSan).toEqual([]);
  });

  it('no legal selected UCI and no legal bestmove -> safe null (engine fallback)', () => {
    const infos = [info(1, 'e2e4', 100)];
    const choice: SelectionResult = { uci: null, candidate: null, via: 'fallback', reason: 'bestmove-unlisted' };
    // bestmoveUci is malformed ('zz9x') — uciToSan yields null
    const res = composeSearchResult(START, infos, 'zz9x', choice, { useMulti: true, fullStrength: false, level: 4 });
    expect(res).toBeNull();
  });

  it('classic weighted path (no choice) still samples and attaches the picked line metadata', () => {
    const infos = [info(1, 'e2e4', 100), info(2, 'g1f3', 40), info(3, 'd2d4', 10)];
    const res = composeSearchResult(START, infos, 'e2e4', null, { useMulti: true, fullStrength: false, level: 1 });
    expect(['e2e4', 'g1f3', 'd2d4']).toContain(res!.bestmove);
    const picked = infos.find((i) => i.pv[0] === res!.bestmove)!;
    expect(res!.cp).toBe(picked.cp); // consistent metadata
    expect(res!.depth).toBe(picked.depth);
  });

  it('mapping is internally consistent: SAN matches the chosen UCI, lines describe the engine output', () => {
    const infos = [info(1, 'e2e4', 100), info(2, 'g1f3', 40)];
    const choice: SelectionResult = {
      uci: 'e2e4',
      candidate: { multipv: 1, uci: 'e2e4', san: 'e4', cp: 100, mate: null, depth: 8, pvSan: ['e4'] },
      via: 'engine-best',
    };
    const res = composeSearchResult(START, infos, 'e2e4', choice, { useMulti: true, fullStrength: false, level: 4 });
    expect(res!.bestmove).toBe('e2e4');
    expect(res!.san).toBe('e4');
    expect(res!.cp).toBe(100);
    expect(res!.lines.every((l) => l.uci !== null && l.san !== null)).toBe(true);
  });
});
