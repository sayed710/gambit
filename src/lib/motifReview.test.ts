import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { GameReport } from './review';
import { motifAnalysisForReport, recordMotifAnalysis } from './motifReview';
import { emptyTrainingState } from './trainingStore';

const evalOf = (cp: number, bestSan: string | null = null) => ({ cp, mateIn: null, bestSan });

/** Family-fork fixture: 1. e4 e5 2. Qh5?? no — use 1.e4 e5 2.Nf3? no.
    Simplest real fork fixture: white to play Nc7+ forking king+rook. */
const FEN_BEFORE = 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1';
const FEN_AFTER_PLAYED = '4k3/2N5/8/8/8/8/8/4K3 b - - 0 1'; // 1... something played instead? no —
// played move = Ke7?? (a blunder that walks into nothing); best = Nc7+ (fork)
const fens = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  FEN_BEFORE,
];
void FEN_AFTER_PLAYED;

function reportWith(playedSan: string, playedClass: 'blunder' | 'best', bestSan: string | null): GameReport {
  return {
    reviews: [
      { san: 'e4', color: 'w', cpl: 0, classification: 'best' },
      { san: playedSan, color: 'w', cpl: playedClass === 'blunder' ? 400 : 0, classification: playedClass },
    ],
    evals: [evalOf(10, 'e4'), evalOf(playedClass === 'blunder' ? -300 : 10, bestSan)],
    accuracy: { w: 50, b: 90 },
    counts: { w: {} as never, b: {} as never },
    avgCpl: { w: 100, b: 0 },
  };
}

describe('motifReview — real classifications only', () => {
  it('finds the missed fork in the engine best move at a blunder', () => {
    // ply 2 played Ke7 (blunder), best was... we need fens[1] = position before ply 2
    const fens2 = [fens[0], FEN_BEFORE];
    const report = reportWith('Ke7', 'blunder', 'Nc7+');
    void fens2;
    const analysis = motifAnalysisForReport([fens[0], FEN_BEFORE], report, 'w');
    // ply 2 = Ke7 blunder; best Nc7+ creates the fork
    const missed = analysis.flatMap((a) => a.missed.map((m) => m.type));
    expect(missed).toContain('fork');
  });

  it('a move without confirmed motifs contributes nothing', () => {
    const analysis = motifAnalysisForReport(
      ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1'],
      reportWith('e4', 'best', 'e4'),
      'w',
    );
    expect(analysis).toEqual([]);
  });

  it('records missed and found into the training store additively', () => {
    const state = emptyTrainingState();
    const analysis = motifAnalysisForReport([fens[0], FEN_BEFORE], reportWith('Ke7', 'blunder', 'Nc7+'), 'w');
    recordMotifAnalysis(state, analysis, 'g1', 1234);
    expect(state.motifs.fork.missed).toBeGreaterThan(0);
    expect(state.motifs.fork.recentMisses).toEqual([{ gameId: 'g1', ply: 2 }]);
  });

  it('returns readable explanations for the Review UI', () => {
    const game = new Chess();
    void game;
    const res = motifAnalysisForReport([fens[0], FEN_BEFORE], reportWith('Ke7', 'blunder', 'Nc7+'), 'w');
    const forkMiss = res[0]?.missed.find((m) => m.type === 'fork');
    expect(forkMiss?.explanation).toMatch(/fork/i);
  });
});
