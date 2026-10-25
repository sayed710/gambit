import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  exerciseIsSound,
  generateExercise,
  generateExerciseAny,
  gradeBlindMate,
  gradeSanOrigin,
  gradeSanToSquare,
  gradeTrackPieces,
  rng,
  squaresOfPieces,
} from './blindfold';
import type { Square } from 'chess.js';

/* ============================================================
   Blindfold training — generators are deterministic, pools are
   legal, graders are exact.
   ============================================================ */

describe('blindfold generators', () => {
  it('same seed -> same exercise; different seed -> (almost surely) different', () => {
    const a1 = generateExercise(1, 42);
    const a2 = generateExercise(1, 42);
    expect(a1).toEqual(a2);
    const b = generateExercise(1, 43);
    expect([a1.san, a1.fen]).not.toEqual([b.san, b.fen]);
  });

  it('every generated exercise of every level is sound (legal pools, real mates)', { timeout: 20_000 }, () => {
    // sweep a wide seed range — any pool rot fails here
    for (let seed = 1; seed <= 120; seed += 1) {
      for (const level of [1, 2, 3, 4] as const) {
        const ex = generateExerciseAny(level, seed);
        expect(exerciseIsSound(ex), `${level}@${seed} ${ex.id}`).toBe(true);
      }
    }
  });

  it('level 3 prefers the user repertoire line when provided', () => {
    const ex = generateExercise(3, 7, { repertoireLine: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6'] });
    expect(ex.id.startsWith('l3:repertoire:')).toBe(true);
    // and falls back to a curated line without one
    const fb = generateExercise(3, 7);
    expect(fb.id.startsWith('l3:')).toBe(true);
    expect(fb.id.startsWith('l3:repertoire:')).toBe(false);
  });

  it('level 3 asks for a white piece type with at most 4 instances', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const ex = generateExercise(3, seed);
      expect(ex.askColor).toBe('w');
      expect(['p', 'n', 'b', 'r']).toContain(ex.askPiece);
      expect(squaresOfPieces(ex.sans, ex.askColor, ex.askPiece).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('blindfold graders', () => {
  it('L1: destination square graded exactly', () => {
    const ex = generateExercise(1, 42);
    const g = new Chess(ex.fen);
    const move = g.move(ex.san);
    expect(gradeSanToSquare(ex, move.to as Square).correct).toBe(true);
    expect(gradeSanToSquare(ex, (move.to === 'e4' ? 'd4' : 'e4') as Square).correct).toBe(false);
  });

  it('L2: origin square graded exactly', () => {
    const ex = generateExercise(2, 42);
    const g = new Chess(ex.fen);
    const move = g.move(ex.san);
    expect(gradeSanOrigin(ex, move.from as Square).correct).toBe(true);
    expect(gradeSanOrigin(ex, (move.from === 'e2' ? 'd2' : 'e2') as Square).correct).toBe(false);
  });

  it('L3: exact square-set equality (missing, extra, wrong all fail)', () => {
    const sans = ['e4', 'e5', 'Nf3', 'Nc6'];
    const expected = squaresOfPieces(sans, 'w', 'p'); // e4, d2, a2..f2,h2 minus e-pawn moved
    const exact = gradeTrackPieces({ kind: 'track-pieces', id: 'x', sans, askColor: 'w', askPiece: 'p' }, expected);
    expect(exact.correct).toBe(true);
    const missingOne = gradeTrackPieces({ kind: 'track-pieces', id: 'x', sans, askColor: 'w', askPiece: 'p' }, expected.slice(1));
    expect(missingOne.correct).toBe(false);
    const extraOne = gradeTrackPieces({ kind: 'track-pieces', id: 'x', sans, askColor: 'w', askPiece: 'p' }, [...expected, 'h5' as Square]);
    expect(extraOne.correct).toBe(false);
    // duplicates in the answer do not game the comparison
    const dupes = gradeTrackPieces({ kind: 'track-pieces', id: 'x', sans, askColor: 'w', askPiece: 'p' }, [...expected, ...expected]);
    expect(dupes.correct).toBe(true);
  });

  it('L4: any true mating move passes; non-mating and illegal fail with the true answer revealed', () => {
    // back-rank: Ra8# from a1; also a rook waiting on a1... only one mate here
    const ex = { kind: 'blind-mate', id: 't', fen: '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1' } as const;
    expect(gradeBlindMate(ex, 'a1', 'a8').correct).toBe(true);
    const wrong = gradeBlindMate(ex, 'a1', 'a7');
    expect(wrong.correct).toBe(false);
    expect(wrong.expected).toBe('Ra8#');
    expect(gradeBlindMate(ex, 'h2', 'h3').correct).toBe(false); // king move, no mate
    // multiple-mate position: ANY mating move must pass (verified: 4 mates)
    const multi = { kind: 'blind-mate', id: 'm', fen: '7k/5K2/6Q1/8/8/8/8/8 w - - 0 1' } as const;
    const g = new Chess(multi.fen);
    const mates = g.moves({ verbose: true }).filter((mv) => {
      g.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? 'q' });
      const mate = g.isCheckmate();
      g.undo();
      return mate;
    });
    expect(mates.length).toBeGreaterThan(1);
    for (const m of mates) expect(gradeBlindMate(multi, m.from as Square, m.to as Square).correct).toBe(true);
  });
});

describe('blindfold rng', () => {
  it('mulberry32 is deterministic and in-range', () => {
    const a = rng(99);
    const b = rng(99);
    for (let i = 0; i < 100; i += 1) {
      const x = a();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(x).toBe(b());
    }
  });
});
