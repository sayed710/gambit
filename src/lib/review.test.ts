import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import {
  accuracyFromCpl,
  buildReport,
  classifyMove,
  evalToUnit,
  isMaterialOffer,
  type PlyEval,
} from './review';
import type { Ply } from './types';

function ply(san: string, from: string, to: string, fenAfter: string, color: 'w' | 'b' = 'w'): Ply {
  return { san, from: from as Square, to: to as Square, color, fenAfter, isCapture: false, isCheck: false };
}

function evalOf(cp: number, bestSan: string | null = null): PlyEval {
  return { cp, mateIn: null, bestSan };
}

describe('classifyMove thresholds', () => {
  it('labels engine-best moves as best', () => {
    expect(classifyMove(0, true)).toBe('best');
    expect(classifyMove(10, true)).toBe('best');
  });
  it('falls back to excellent for tiny losses not flagged best', () => {
    expect(classifyMove(5, false)).toBe('excellent');
    expect(classifyMove(20, false)).toBe('excellent');
  });
  it('splits good / inaccuracy / mistake / blunder', () => {
    expect(classifyMove(50, false)).toBe('good');
    expect(classifyMove(100, false)).toBe('inaccuracy');
    expect(classifyMove(300, false)).toBe('mistake');
    expect(classifyMove(301, false)).toBe('blunder');
    expect(classifyMove(900, false)).toBe('blunder');
  });
});

describe('accuracyFromCpl', () => {
  it('is ~100 for perfect play', () => {
    expect(accuracyFromCpl(0)).toBeGreaterThan(99);
  });
  it('decays with average centipawn loss and stays in [0,100]', () => {
    expect(accuracyFromCpl(30)).toBeLessThan(accuracyFromCpl(10));
    expect(accuracyFromCpl(500)).toBeLessThanOrEqual(accuracyFromCpl(100));
    expect(accuracyFromCpl(100)).toBeLessThan(accuracyFromCpl(10));
    expect(accuracyFromCpl(10000)).toBeGreaterThanOrEqual(0);
    expect(accuracyFromCpl(10000)).toBeLessThanOrEqual(100);
  });
});

describe('isMaterialOffer (brilliant ingredient)', () => {
  it('detects a queen stepping onto a knight-attacked square', () => {
    // after White Qe2: black Nc3 attacks e2 (cheapest attacker 3 < queen 9)
    const g = new Chess('4k3/8/8/8/8/2n5/4Q3/4K3 b - - 0 1');
    expect(g.attackers('e2', 'b').length).toBeGreaterThan(0);
    expect(isMaterialOffer(ply('Qe2', 'e1', 'e2', g.fen()))).toBe(true);
  });
  it('is false when the destination is unattacked', () => {
    const g = new Chess('4k3/8/8/8/8/8/4Q3/4K3 b - - 0 1');
    expect(isMaterialOffer(ply('Qe2', 'e1', 'e2', g.fen()))).toBe(false);
  });
  it('ignores equal-value pawn tension (pawn attacked by pawn)', () => {
    const g = new Chess('4k3/8/8/3p4/4P3/8/8/4K3 b - - 0 1');
    expect(isMaterialOffer(ply('e4', 'e2', 'e4', g.fen()))).toBe(false);
  });
  it('flags a minor piece offered to a pawn', () => {
    // white Ne5 attacked by black d6 pawn after playing Ne5
    const g = new Chess('4k3/8/3p4/4N3/8/8/8/4K3 b - - 0 1');
    expect(isMaterialOffer(ply('Ne5', 'c4', 'e5', g.fen()))).toBe(true);
  });
});

describe('buildReport', () => {
  it('keeps one review per played move (final move never lost)', () => {
    const g = new Chess();
    const plies: Ply[] = [];
    for (const san of ['e4', 'e5', 'Nf3', 'Nc6']) {
      const m = g.move(san);
      plies.push(ply(m.san, m.from, m.to, m.after, m.color));
    }
    const evals: (PlyEval | null)[] = plies.map((_, i) => evalOf(20 + i));
    evals.push(evalOf(20 + plies.length));
    const report = buildReport(plies, evals);
    expect(report.reviews.length).toBe(plies.length);
    expect(report.reviews.map((r) => r.san)).toEqual(plies.map((p) => p.san));
    expect(report.reviews[3].san).toBe('Nc6');
  });

  it('promotes a best-move material offer that stays winning to brilliant', () => {
    // after 1.Qe2 (a knight-offer), the engine still calls it best and White stays +150
    const g = new Chess('4k3/8/8/8/8/2n5/4Q3/4K3 b - - 0 1');
    const plies = [ply('Qe2', 'e1', 'e2', g.fen())];
    const evals: (PlyEval | null)[] = [evalOf(150, 'Qe2'), evalOf(150)];
    const report = buildReport(plies, evals);
    expect(report.reviews[0].classification).toBe('brilliant');
    expect(report.counts.w.brilliant).toBe(1);
  });

  it('does not award brilliant when the position dips below -50 for the mover', () => {
    const g = new Chess('4k3/8/8/8/8/2n5/4Q3/4K3 b - - 0 1');
    const plies = [ply('Qe2', 'e1', 'e2', g.fen())];
    // still the engine's top choice (cpl 5 → 'best'), but White ends up -80
    const evals: (PlyEval | null)[] = [evalOf(-75, 'Qe2'), evalOf(-80)];
    const report = buildReport(plies, evals);
    expect(report.reviews[0].classification).toBe('best');
    expect(report.reviews[0].classification).not.toBe('brilliant');
  });

  it('never awards brilliant to an ordinary quiet move', () => {
    const g = new Chess();
    const m = g.move('g4'); // not in the opening book table
    const plies = [ply(m.san, m.from, m.to, m.after)];
    const evals: (PlyEval | null)[] = [evalOf(30, 'g4'), evalOf(30)];
    const report = buildReport(plies, evals);
    expect(report.reviews[0].classification).toBe('best');
    expect(report.counts.w.brilliant).toBe(0);
  });

  it('classifies known opening moves as book and excludes them from accuracy', () => {
    const g = new Chess();
    const plies: Ply[] = [];
    for (const san of ['e4', 'e5', 'Nf3']) {
      const m = g.move(san);
      plies.push(ply(m.san, m.from, m.to, m.after, m.color));
    }
    const evals: (PlyEval | null)[] = plies.map((_, i) => evalOf(40 + i));
    evals.push(evalOf(43));
    const report = buildReport(plies, evals);
    expect(report.reviews.map((r) => r.classification)).toEqual(['book', 'book', 'book']);
    expect(report.counts.w.book).toBe(2);
    expect(report.counts.b.book).toBe(1);
    // book carries no accuracy signal: nothing was billed
    expect(report.avgCpl.w).toBe(0);
    expect(report.avgCpl.b).toBe(0);
  });

  it('labels a failure to punish an opponent blunder as a Miss', () => {
    const g = new Chess();
    const plies: Ply[] = [];
    for (const san of ['g4', 'h5']) {
      const m = g.move(san);
      plies.push(ply(m.san, m.from, m.to, m.after, m.color));
    }
    // White played g4 (+40), Black replied h5 leaving White +160… then White
    // "fails to punish": after White's next move the eval collapses to +20.
    // (three plies so the Miss lands on White's second move)
    const m3 = g.move('h4');
    plies.push(ply(m3.san, m3.from, m3.to, m3.after));
    const evals: (PlyEval | null)[] = [evalOf(20), evalOf(160, 'Nc3'), evalOf(160), evalOf(20)];
    const report = buildReport(plies, evals);
    expect(report.reviews[2].classification).toBe('miss');
  });

  it('computes accuracy per side from centipawn loss', () => {
    const g = new Chess();
    const plies: Ply[] = [];
    for (const san of ['g4', 'h5']) {
      const m = g.move(san);
      plies.push(ply(m.san, m.from, m.to, m.after, m.color));
    }
    // white perfect; black's h5 lets the eval swing from +30 to +60 (30cp loss)
    const evals: (PlyEval | null)[] = [evalOf(0), evalOf(30, 'g4'), evalOf(60)];
    const report = buildReport(plies, evals);
    expect(report.accuracy.w).toBeGreaterThan(95);
    expect(report.accuracy.b).toBeLessThan(accuracyFromCpl(30) + 1);
  });
});

describe('evalToUnit', () => {
  it('maps equal to mid, winning toward 1, losing toward 0', () => {
    expect(evalToUnit(0)).toBeCloseTo(0.5, 5);
    expect(evalToUnit(1000)).toBeGreaterThan(0.9);
    expect(evalToUnit(-1000)).toBeLessThan(0.1);
  });
});
