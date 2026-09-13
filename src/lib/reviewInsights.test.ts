import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { biggestSwings, materialAfterPly, materialSeries, phaseAccuracies, phaseOfPly, type PhaseName } from './reviewInsights';
import type { GameReport, PlyEval } from './review';

const evalCp = (cp: number): PlyEval => ({ cp, mateIn: null, bestSan: null });

describe('review insights — phases', () => {
  it('uses documented boundaries: opening ≤ move 10, endgame by material or move 40', () => {
    expect(phaseOfPly(1, 39)).toBe('opening');
    expect(phaseOfPly(20, 39)).toBe('opening'); // move 10
    expect(phaseOfPly(21, 39)).toBe('middlegame'); // move 11
    expect(phaseOfPly(30, 39)).toBe('middlegame');
    expect(phaseOfPly(30, 12)).toBe('endgame'); // heavy pieces gone
    expect(phaseOfPly(81, 39)).toBe('endgame'); // move 41
  });

  it('counts material from a FEN, excluding kings', () => {
    const g = new Chess();
    expect(materialAfterPly(g.fen())).toBe(78); // 39 per side
  });

  it('produces a material series with one entry per position', () => {
    const g = new Chess();
    const fens = [g.fen()];
    g.move('e4');
    fens.push(g.fen());
    const series = materialSeries(fens);
    expect(series.length).toBe(2);
    expect(series[0]).toBe(series[1]);
  });
});

describe('review insights — swings and phase accuracy', () => {
  const report: GameReport = {
    reviews: Array.from({ length: 5 }, () => ({ san: 'e4', color: 'w' as const, cpl: 10, classification: 'good' as never })),
    evals: [evalCp(0), evalCp(0), evalCp(150), evalCp(20), evalCp(500), evalCp(480)],
    accuracy: { w: 90, b: 85 },
    counts: { w: {} as never, b: {} as never },
    avgCpl: { w: 10, b: 15 },
  };

  it('finds the largest evaluation swings in white perspective', () => {
    const swings = biggestSwings(report, 2);
    expect(swings[0]).toEqual({ ply: 4, delta: 480 });
    expect(swings[1]).toEqual({ ply: 2, delta: 150 });
  });

  it('buckets accuracy per phase', () => {
    const fens: string[] = [];
    const g = new Chess();
    fens.push(g.fen());
    for (let i = 0; i < 5; i++) {
      g.move(g.moves()[0]);
      fens.push(g.fen());
    }
    const acc = phaseAccuracies(report, fens);
    expect(Object.keys(acc).sort()).toEqual(['endgame', 'middlegame', 'opening'].sort() as unknown as string[]);
    expect((acc as Record<PhaseName, number | null>).opening).not.toBeNull();
  });
});
