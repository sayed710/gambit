import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  exerciseIsSound,
  idHash,
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
    const ex = generateExercise(3, 7, {
      repertoireLine: { sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6'], startFen: new Chess().fen(), key: 'r1:l1' },
    });
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
    const mk3 = { kind: 'track-pieces', id: 'x', sans, startFen: new Chess().fen(), askColor: 'w', askPiece: 'p' } as const;
    const exact = gradeTrackPieces(mk3, expected);
    expect(exact.correct).toBe(true);
    const missingOne = gradeTrackPieces(mk3, expected.slice(1));
    expect(missingOne.correct).toBe(false);
    const extraOne = gradeTrackPieces(mk3, [...expected, 'h5' as Square]);
    expect(extraOne.correct).toBe(false);
    // duplicates in the answer do not game the comparison
    const dupes = gradeTrackPieces(mk3, [...expected, ...expected]);
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

describe('exercise identity collisions (PR #3 review)', () => {
  it('the Opera Game two dxe5 moves get DIFFERENT ids (different positions)', () => {
    // generate from every step of the Opera line directly (exhaustive, no RNG)
    // the FULL Opera line — the generator can reach any of its first 16 plies
    const opera = ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5'];
    const g = new Chess();
    const ids: string[] = [];
    for (const san of opera) {
      const fenBefore = g.fen();
      g.move(san);
      // reconstruct the exact identity rule used by the generator
      ids.push(`l1:Opera Game:${san}:${idHash(fenBefore + '|' + san)}`);
    }
    const dxe5Ids = ids.filter((id) => id.includes('dxe5'));
    expect(dxe5Ids).toHaveLength(2);
    expect(dxe5Ids[0]).not.toBe(dxe5Ids[1]); // different positions -> different ids
    // and the RNG-driven generator can only ever emit ids from the same
    // content set — same content, same id (repeats are correct: SR skips due)
    const bySeed = new Map<string, number>();
    for (let seed = 1; seed <= 400; seed += 1) {
      const ex = generateExerciseAny(1, seed);
      bySeed.set(ex.id, (bySeed.get(ex.id) ?? 0) + 1);
    }
    // every generated id derives from the same identity rule (fen+san hash):
    // reconstruct and confirm membership in the exhaustive identity set
    const identitySet = new Set(ids);
    for (let seed = 1; seed <= 400; seed += 1) {
      const ex = generateExerciseAny(1, seed);
      if (ex.id.includes('Opera Game')) expect(identitySet.has(ex.id)).toBe(true); // Opera ids come from its identity set
    }
  }, 20_000); // 800 exhaustive generations — 5s default budget flakes under load (pre-existing, PR-C carries the fix)

  it('L2 ids also separate identical SANs from different positions', () => {
    const ids = new Set<string>();
    for (let seed = 1; seed <= 300; seed += 1) ids.add(generateExerciseAny(2, seed).id);
    expect(ids.size).toBeGreaterThanOrEqual(15); // many distinct exercises
  });

  it('distinct repertoire lines with identical length and piece target get distinct L3 ids', () => {
    const std = new Chess().fen();
    const lineA = { sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+'], startFen: std, key: 'repA:l1' };
    const lineB = { sans: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'c6', 'Bc4', 'Bf5'], startFen: std, key: 'repB:l1' };
    const a = generateExercise(3, 11, { repertoireLine: lineA });
    const b = generateExercise(3, 11, { repertoireLine: lineB });
    expect(a.id).not.toBe(b.id);
    expect(a.sans.length).toBe(b.sans.length); // same shape, different identity
  });

  it('changing the repertoire line content changes the id (no mastery reuse)', () => {
    const std = new Chess().fen();
    const before = generateExercise(3, 11, { repertoireLine: { sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6'], startFen: std, key: 'r:l' } });
    const after = generateExercise(3, 11, { repertoireLine: { sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'f5'], startFen: std, key: 'r:l' } });
    expect(before.id).not.toBe(after.id);
  });

  it('ids are stable across seeds only through content: same content, same id', () => {
    const line = { sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], startFen: new Chess().fen(), key: 'r:l' };
    const a = generateExercise(3, 5, { repertoireLine: line });
    const b = generateExercise(3, 999, { repertoireLine: line });
    expect(a.id).toBe(b.id); // identity from content, not the RNG
  });
});

describe('real move-history context (PR #3 final review)', () => {
  it('L2 carries the genuine prior SANs — midgame exercises included', () => {
    // sweep: many L2 exercises; whenever prior is non-empty it must be a
    // legal prefix of the source line, and the exercise FEN must equal the
    // replay of prior (no FEN-derived invention)
    let midgameSeen = 0;
    for (let seed = 1; seed <= 120; seed += 1) {
      const ex = generateExercise(2, seed);
      const g = new Chess();
      for (const san of ex.prior) g.move(san); // prefix must be legal
      expect(g.fen()).toBe(ex.fen); // context replays EXACTLY to the position
      if (ex.prior.length >= 4) midgameSeen += 1;
    }
    expect(midgameSeen).toBeGreaterThan(10); // midgame positions really occur
  });

  it('L2 prior supports black-to-move and capture SANs with a real prefix', () => {
    let blackCapture = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      const ex = generateExercise(2, seed);
      const g = new Chess(ex.fen);
      if (g.turn() === 'b' && ex.san.includes('x')) {
        blackCapture += 1;
        expect(ex.prior.length).toBeGreaterThan(0); // genuine prefix carried
        // disambiguation context: the prior must contain enough moves that
        // the side-to-move computation is exact (odd prior = black to move)
        expect(ex.prior.length % 2).toBe(1);
      }
    }
    expect(blackCapture).toBeGreaterThan(0); // black-to-move captures really occur
  });
});

describe('custom-FEN repertoires (PR #3 final review, option A)', () => {
  const CUSTOM_START = '4k3/8/8/8/8/8/8/4K2R w - - 0 1'; // K+R vs K, rook start position
  const customLine = { sans: ['Rh2', 'Kd8', 'Rg2', 'Ke8', 'Rg7', 'Kd8', 'Rd7+', 'Ke8'], startFen: CUSTOM_START, key: 'custom:technique' };

  it('generates and grades an L3 exercise from a nonstandard start', () => {
    const ex = generateExercise(3, 21, { repertoireLine: customLine });
    expect(ex.startFen).toBe(CUSTOM_START);
    // these moves are NOT legal from the standard start (e.g. Rh2 needs the h1 rook)
    const std = new Chess();
    const stdLegal = new Set(std.moves());
    expect(stdLegal.has(customLine.sans[0])).toBe(false);
    // the replay from the real start is sound
    expect(exerciseIsSound(ex)).toBe(true);
    // grading works: ask for a white piece and answer with its true squares
    const expected = squaresOfPieces(ex.sans, ex.askColor, ex.askPiece, ex.startFen);
    const res = gradeTrackPieces(ex, expected);
    expect(res.correct).toBe(true);
  });

  it('custom-FEN identities never overlap standard-start exercises with similar shape', () => {
    const stdLine = { sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6'], startFen: new Chess().fen(), key: 'std:main' };
    const a = generateExercise(3, 21, { repertoireLine: customLine });
    const b = generateExercise(3, 21, { repertoireLine: stdLine });
    expect(a.id).not.toBe(b.id);
    // and the same custom line across seeds keeps ONE stable identity
    expect(generateExercise(3, 999, { repertoireLine: customLine }).id).toBe(generateExercise(3, 21, { repertoireLine: customLine }).id);
  });

  it('a malformed repertoire source falls back to curated fixtures safely', () => {
    const bad = { sans: ['e4'], startFen: 'not-a-fen', key: 'broken:line' }; // too short + invalid FEN
    const ex = generateExercise(3, 5, { repertoireLine: bad });
    expect(ex.id.startsWith('l3:')).toBe(true);
    expect(ex.id.startsWith('l3:repertoire:')).toBe(false); // fell back to curated
    expect(exerciseIsSound(ex)).toBe(true);
  });
});

describe('repertoireMainline validation (final targeted fix)', () => {
  // the page-level validator is exercised through the generator contract:
  // only VALIDATED lines reach repertoire:<key> ids; anything inconsistent
  // either falls back to curated or, inside the generator, replays safely.

  it('an INVALID start FEN never produces a repertoire exercise (skipped)', () => {
    // mirror of the page validator: chess.js must reject the FEN outright
    expect(() => new Chess('not-a-fen')).toThrow();
    // generator safety net: a broken source falls back to curated, still sound
    const ex = generateExercise(3, 9, { repertoireLine: { sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'], startFen: 'broken-fen', key: 'broken:l' } });
    expect(ex.id.startsWith('l3:')).toBe(true);
    expect(exerciseIsSound(ex)).toBe(true);
  });

  it('an ILLEGAL SAN inside a six-plus-move line is rejected by the replay contract', () => {
    // a corrupted stored path: white moves twice in a row (wrong-side move) —
    // exactly the inconsistency the walk-and-replay validator rejects
    const g = new Chess();
    g.move('e4');
    g.move('e5');
    g.move('Nf3');
    expect(() => g.move('Bb5')).toThrow(); // white piece while black to move
    // generator safety net for such a corrupted line:
    const ex = generateExercise(3, 9, {
      repertoireLine: { sans: ['e4', 'e5', 'Nf3', 'Bb5', 'Nc3', 'Nf6'], startFen: new Chess().fen(), key: 'corrupt:l' },
    });
    expect(ex.id.startsWith('l3:')).toBe(true);
    expect(ex.id.startsWith('l3:repertoire:')).toBe(false); // fell back to curated
    expect(exerciseIsSound(ex)).toBe(true);
  });

  it('a VALID nonstandard-FEN repertoire still generates, sounds, and grades', () => {
    const custom = { sans: ['Rh2', 'Kd8', 'Rg2', 'Ke8', 'Rg7', 'Kd8'], startFen: '4k3/8/8/8/8/8/8/4K2R w - - 0 1', key: 'custom:l' };
    const ex = generateExercise(3, 21, { repertoireLine: custom });
    expect(ex.id).toContain('l3:repertoire:custom:l');
    expect(ex.startFen).toBe(custom.startFen);
    expect(exerciseIsSound(ex)).toBe(true);
    const expected = squaresOfPieces(ex.sans, ex.askColor, ex.askPiece, ex.startFen);
    expect(gradeTrackPieces(ex, expected).correct).toBe(true);
  });
});
