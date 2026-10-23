import { describe, expect, it } from 'vitest';
import { detectMotifsForMove } from './motifDetection';
import { applyMotifAnalysis, motifAnalysisForReport } from './motifReview';
import { emptyTrainingState } from './trainingStore';
import type { GameReport } from './review';
import { pressureCorrelation, timingStats } from './timeAnalytics';
import { practiceStartFen, practiceEvalIndex } from './practiceDrill';
import { assessPracticeMove, recordPracticeAttempt, type PracticeItem } from './practiceQueue';
import type { GameRecord, MoveTiming } from './types';
import { Chess } from 'chess.js';

/* ============================================================
   Correctness-audit regressions, phases 5–8.
   ============================================================ */

describe('motif attribution: pre-existing geometry is not claimed', () => {
  it('pre-existing absolute pin: an unrelated quiet move claims nothing', () => {
    const fen = '4k3/4n3/8/8/8/8/P7/4R1K1 w - - 0 1'; // Re1 pins Ne7 to Ke8 already
    const res = detectMotifsForMove(fen, 'a3');
    expect(res).not.toBeNull();
    expect(res!.motifs.map((m) => m.type)).not.toContain('pin-absolute');
  });

  it('a pin CREATED by the move is still detected', () => {
    const fen = '4k3/4n3/8/8/8/8/P7/R5K1 w - - 0 1'; // rook on a1, pin not yet there
    const res = detectMotifsForMove(fen, 'Re1');
    expect(res).not.toBeNull();
    expect(res!.motifs.map((m) => m.type)).toContain('pin-absolute');
  });

  it('pre-existing skewer: an unrelated quiet move claims nothing', () => {
    const fen = 'r6k/8/8/q7/8/8/7P/R5K1 w - - 0 1'; // Ra1 skewers Qa5 -> Ra8 already
    const res = detectMotifsForMove(fen, 'h3');
    expect(res).not.toBeNull();
    expect(res!.motifs.map((m) => m.type)).not.toContain('skewer');
  });

  it('a skewer CREATED by the move is still detected', () => {
    const fen = 'r6k/8/8/q7/8/8/6K1/7R w - - 0 1';
    const res = detectMotifsForMove(fen, 'Ra1');
    expect(res).not.toBeNull();
    expect(res!.motifs.map((m) => m.type)).toContain('skewer');
  });

  it('pre-existing hanging piece: an unrelated move claims nothing', () => {
    const fen = '3k4/8/8/3r4/8/8/8/3QK3 w - - 0 1'; // d5 rook already hanging to Qd1
    const res = detectMotifsForMove(fen, 'Ke2');
    expect(res).not.toBeNull();
    expect(res!.motifs.map((m) => m.type)).not.toContain('hanging');
  });

  it('a hanging piece CREATED by the move is still detected', () => {
    const fen = '3k4/8/8/3r4/8/8/8/6QK w - - 0 1';
    const res = detectMotifsForMove(fen, 'Qd1');
    expect(res).not.toBeNull();
    expect(res!.motifs.map((m) => m.type)).toContain('hanging');
  });

  it('pre-existing relative pin: an unrelated quiet move claims nothing', () => {
    const fen = '4q2k/4n3/8/8/8/8/P7/4R1K1 w - - 0 1'; // Re1 relatively pins Ne7 against Qe8
    const res = detectMotifsForMove(fen, 'a3');
    expect(res).not.toBeNull();
    expect(res!.motifs.map((m) => m.type)).not.toContain('pin-relative');
  });

  it('a relative pin CREATED by the move is still detected', () => {
    const fen = '4q2k/4n3/8/8/8/8/6K1/7R w - - 0 1';
    const res = detectMotifsForMove(fen, 'Re1');
    expect(res).not.toBeNull();
    expect(res!.motifs.map((m) => m.type)).toContain('pin-relative');
  });
});

describe('motif stats: idempotent per-game contribution', () => {
  const report: GameReport = {
    reviews: [{ san: 'a3', color: 'w', cpl: 300, classification: 'blunder' }],
    evals: [
      { cp: 20, mateIn: null, bestSan: 'Nf3' },
      { cp: -280, mateIn: null, bestSan: null },
      { cp: 0, mateIn: null, bestSan: null },
    ],
    accuracy: { w: 50, b: 90 },
    counts: {
      w: { best: 0, brilliant: 0, excellent: 0, great: 0, good: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 1, book: 0 },
      b: { best: 0, brilliant: 0, excellent: 0, great: 0, good: 0, inaccuracy: 0, mistake: 0, miss: 0, blunder: 0, book: 0 },
    },
    avgCpl: { w: 300, b: 0 },
  };

  function fensFor(sans: string[]): string[] {
    const g = new Chess();
    const out = [g.fen()];
    for (const san of sans) {
      g.move(san);
      out.push(g.fen());
    }
    return out;
  }

  it('first contribution records, second is refused (no double count)', () => {
    const fens = fensFor(['a3', 'e5']);
    const analysis = motifAnalysisForReport(fens, report, 'w');
    const state = emptyTrainingState();
    expect(applyMotifAnalysis(state, analysis, 'game-1', 1000)).toBe(true);
    const afterFirst = JSON.stringify(state.motifs);
    expect(applyMotifAnalysis(state, analysis, 'game-1', 2000)).toBe(false);
    expect(applyMotifAnalysis(state, analysis, 'game-1', 3000)).toBe(false);
    expect(JSON.stringify(state.motifs)).toBe(afterFirst); // unchanged
    // a DIFFERENT game still contributes
    expect(applyMotifAnalysis(state, analysis, 'game-2', 4000)).toBe(true);
  });

  it('a different game with no motifs records its marker but no stats', () => {
    const state = emptyTrainingState();
    expect(applyMotifAnalysis(state, [], 'game-x', 1)).toBe(true);
    expect(state.motifGames['game-x']).toBe(1);
    expect(Object.keys(state.motifs)).toHaveLength(0);
    expect(applyMotifAnalysis(state, [], 'game-x', 2)).toBe(false);
  });

  it('pre-existing pin is not reported as a missed motif for a quiet best move', () => {
    // white blundered with a3; engine best Kf1 is also quiet; the board's
    // pre-existing pin must not appear as a missed tactic for either side
    const fen = '4k3/4n3/8/8/8/8/P7/4R1K1 w - - 0 1';
    const g = new Chess(fen);
    g.move('a3');
    const g2 = new Chess(fen);
    g2.move('Kf1');
    const rep: GameReport = {
      ...report,
      evals: [
        { cp: 20, mateIn: null, bestSan: 'Kf1' },
        { cp: 10, mateIn: null, bestSan: null },
        { cp: 10, mateIn: null, bestSan: null },
      ],
    };
    const fens = [fen, g.fen(), g.fen()]; // index alignment: before a3 / after
    fens[1] = g.fen();
    fens[2] = g2.fen();
    const analysis = motifAnalysisForReport(fens, rep, 'w');
    const types = analysis.flatMap((p) => [...p.played, ...p.missed].map((m) => m.type));
    expect(types).not.toContain('pin-absolute');
    expect(types).not.toContain('pin-relative');
  });
});

describe('time analytics: pressure correlation joins by ply', () => {
  const tc = { id: '10+0', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 };

  function recordWith(timings: MoveTiming[], playerColor: 'w' | 'b'): GameRecord {
    return {
      id: 'g',
      date: Date.now(),
      mode: 'ai',
      timeControl: tc,
      playerColor,
      opponentName: 'Engine',
      opponentRating: 1200,
      result: 'loss',
      reason: 'x',
      moves: [],
      pgn: '',
      ratingBefore: 1200,
      ratingAfter: 1200,
      moveTimings: timings,
    } as unknown as GameRecord;
  }

  function reviewRow(i: number, color: 'w' | 'b', classification: 'blunder' | 'best') {
    return { san: `san${i}`, color, cpl: classification === 'blunder' ? 300 : 0, classification };
  }

  it('human-Black game: criticals at plies 2,4,6 match timings at those plies (array position would misalign)', () => {
    const reviews = [
      reviewRow(0, 'w', 'best'), // engine ply 1
      reviewRow(1, 'b', 'blunder'), // human ply 2 — UNDER pressure
      reviewRow(2, 'w', 'best'),
      reviewRow(3, 'b', 'blunder'), // human ply 4 — not under
      reviewRow(4, 'w', 'best'),
      reviewRow(5, 'b', 'blunder'), // human ply 6 — not under
    ];
    const timings: MoveTiming[] = [
      { ply: 2, color: 'b', thinkMs: 3000, clockBeforeMs: 500_000, clockAfterMs: 497_000 },
      { ply: 4, color: 'b', thinkMs: 3000, clockBeforeMs: 400_000, clockAfterMs: 397_000 },
      { ply: 6, color: 'b', thinkMs: 3000, clockBeforeMs: 300_000, clockAfterMs: 297_000 },
    ];
    // make one genuinely pressured: ply 2 with tiny clock
    const report = {
      reviews,
      evals: [],
      accuracy: { w: 50, b: 50 },
      counts: { w: {} as never, b: {} as never },
      avgCpl: { w: 0, b: 0 },
    };
    const corr = pressureCorrelation(recordWith(timings, 'b'), report);
    expect(corr.criticalTotal).toBe(3); // plies 2,4,6 all found via ply join
    expect(corr.sampleAdequate).toBe(false); // 3 < 4
    expect(corr.criticalUnderPressure).toBe(0);

    // now push one critical under the 90s threshold at its TRUE ply
    const pressured: MoveTiming[] = [
      { ply: 2, color: 'b', thinkMs: 3000, clockBeforeMs: 80_000, clockAfterMs: 77_000 }, // <= 90s threshold
      { ply: 4, color: 'b', thinkMs: 3000, clockBeforeMs: 85_000, clockAfterMs: 82_000 },
      { ply: 6, color: 'b', thinkMs: 3000, clockBeforeMs: 60_000, clockAfterMs: 57_000 },
    ];
    const corr2 = pressureCorrelation(recordWith(pressured, 'b'), report);
    expect(corr2.criticalUnderPressure).toBe(3); // array-position join would have found 0
  });

  it('timingStats still filters to player color and computes honestly', () => {
    const timings: MoveTiming[] = [
      { ply: 1, color: 'w', thinkMs: 1500, clockBeforeMs: 600_000, clockAfterMs: 598_500 },
      { ply: 2, color: 'b', thinkMs: 900, clockBeforeMs: 600_000, clockAfterMs: 599_100 }, // engine: excluded
      { ply: 3, color: 'w', thinkMs: 2500, clockBeforeMs: 598_500, clockAfterMs: 596_000 },
    ];
    const stats = timingStats(recordWith(timings, 'w'));
    expect(stats).not.toBeNull();
    expect(stats!.playerTimings.map((t) => t.ply)).toEqual([1, 3]);
    expect(stats!.avgThinkMs).toBe(2000);
  });
});

describe('practice drill indexing', () => {
  const fens = ['start-fen', 'after-ply-1', 'after-ply-2', 'after-ply-3'];

  it('practice starts at the position BEFORE the critical ply', () => {
    expect(practiceStartFen(fens, 1)).toBe('start-fen'); // before ply 1 = initial position
    expect(practiceStartFen(fens, 3)).toBe('after-ply-2'); // before ply 3
    expect(practiceStartFen(fens, 0)).toBeNull();
    expect(practiceStartFen(fens, 5)).toBeNull(); // beyond the game
  });

  it('eval index: start ply minus one, plus moves played', () => {
    expect(practiceEvalIndex(3, 0)).toBe(2); // position before ply 3 == evals[2]
    expect(practiceEvalIndex(3, 1)).toBe(3); // after one practice move
    expect(practiceEvalIndex(1, 0)).toBe(0);
  });
});

describe('practice runner grading policy (v1: exact SAN)', () => {
  const base = {
    id: 'p1',
    kind: 'mistake' as const,
    fen: 'x',
    side: 'w' as const,
    objective: 'o',
    createdAt: 1,
    attempts: 0,
    solved: 0,
    lastPracticed: null,
  };

  it('exact expected move is correct; anything else is wrong; no expected move is ungraded', () => {
    const graded: PracticeItem = { ...base, expectedSan: 'Nf3' };
    expect(assessPracticeMove(graded, 'Nf3')).toBe('correct');
    expect(assessPracticeMove(graded, 'Nc3')).toBe('wrong'); // near-equivalents are wrong in v1
    const ungraded: PracticeItem = { ...base };
    expect(assessPracticeMove(ungraded, 'Nf3')).toBe('ungraded');
    expect(assessPracticeMove(ungraded, 'anything')).toBe('ungraded');
  });

  it('ungraded items never count as solved', () => {
    const list: PracticeItem[] = [{ ...base, id: 'p2' }];
    // simulate the runner policy: ungraded -> recordPracticeAttempt(solved=false)
    list[0].attempts = 0;
    list[0].solved = 0;
      recordPracticeAttempt(list, 'p2', false);
    expect(list[0]).toMatchObject({ attempts: 1, solved: 0 });
  });
});
