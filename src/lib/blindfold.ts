import { Chess } from 'chess.js';
import type { Color, PieceSymbol, Square } from 'chess.js';

/* ============================================================
   blindfold — visualization training exercises.

   Everything is deterministic: generators are seeded, graders are
   pure, and every pool position is replayed through chess.js (tests
   verify legality). Real opening lines only — no invented data.
   ============================================================ */

export type BlindfoldLevel = 1 | 2 | 3 | 4;

export interface BfSanToSquare {
  kind: 'san-to-square';
  id: string;
  fen: string; // position BEFORE the move
  san: string;
}
export interface BfSanOrigin {
  kind: 'san-origin';
  id: string;
  fen: string;
  san: string;
}
export interface BfTrackPieces {
  kind: 'track-pieces';
  id: string;
  sans: string[]; // played from the start position
  askColor: Color;
  askPiece: PieceSymbol;
}
export interface BfBlindMate {
  kind: 'blind-mate';
  id: string;
  fen: string; // a mate-in-1 exists (verified by the grader tests)
}
export type BlindfoldExercise = BfSanToSquare | BfSanOrigin | BfTrackPieces | BfBlindMate;

/** deterministic PRNG (mulberry32) — same seed, same exercise */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------ pools ------------------------------ */

/** Famous short games, as real SAN lines. Exercises derive from these. */
const GAME_LINES: { name: string; sans: string[] }[] = [
  {
    name: 'Opera Game',
    sans: ['e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5', 'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5', 'Nxb5', 'cxb5', 'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8', 'Rxd7', 'Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7', 'Qb8+', 'Nxb8', 'Rd8#'],
  },
  {
    name: 'Scholar-like miniature',
    sans: ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'],
  },
  {
    name: 'Légal',
    sans: ['e4', 'e5', 'Nf3', 'd6', 'Bc4', 'Bg4', 'Nc3', 'g6', 'Nxe5', 'Bxd1', 'Bxf7+', 'Ke7', 'Nd5#'],
  },
  {
    name: 'Fool’s mate',
    sans: ['f3', 'e5', 'g4', 'Qh4#'],
  },
  {
    name: 'Italian mainline',
    sans: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'c3', 'Nf6', 'd4', 'exd4', 'cxd4', 'Bb4+', 'Bd2', 'Bxd2+', 'Nbxd2'],
  },
  {
    name: 'Scandinavian',
    sans: ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'c6', 'Bc4', 'Bf5', 'Bd2', 'e6'],
  },
];

/** Verified mate-in-1 positions (each test-proves a mating move exists). */
// All fixtures machine-verified: the side TO MOVE has a mating move.
const MATE_IN_1: { fen: string; name: string }[] = [
  { fen: '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1', name: 'back-rank-rook' },
  { fen: '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', name: 'traded-back-rank' },
  { fen: '1r4k1/5ppp/8/8/8/8/5PPP/1Q4K1 w - - 0 1', name: 'queen-back-rank' },
  { fen: '7k/5K2/6Q1/8/8/8/8/8 w - - 0 1', name: 'queen-ladder-four-ways' },
];

interface MoveStep {
  fenBefore: string;
  san: string;
  to: string;
  from: string;
  color: Color;
}

/** Replay a SAN line into (fen, move) steps. Throws on any illegal san. */
function replaySteps(sans: string[]): MoveStep[] {
  const g = new Chess();
  const out: MoveStep[] = [];
  for (const san of sans) {
    const fenBefore = g.fen();
    const m = g.move(san); // throws when illegal — tests catch pool rot
    out.push({ fenBefore, san: m.san, to: m.to, from: m.from, color: m.color });
  }
  return out;
}

/* ---------------------------- generators ---------------------------- */

export interface BlindfoldGenOptions {
  /** the user's own repertoire mainline (SAN list) — used for level 3 when present */
  repertoireLine?: string[] | null;
}

/** Non-overload form for generic callers (tests, sweeps). */
export function generateExerciseAny(level: BlindfoldLevel, seed: number, opts: BlindfoldGenOptions = {}): BlindfoldExercise {
  return generateExerciseImpl(level, seed, opts);
}

export function generateExercise(level: 1, seed: number, opts?: BlindfoldGenOptions): BfSanToSquare;
export function generateExercise(level: 2, seed: number, opts?: BlindfoldGenOptions): BfSanOrigin;
export function generateExercise(level: 3, seed: number, opts?: BlindfoldGenOptions): BfTrackPieces;
export function generateExercise(level: 4, seed: number, opts?: BlindfoldGenOptions): BfBlindMate;
export function generateExercise(level: BlindfoldLevel, seed: number, opts: BlindfoldGenOptions = {}): BlindfoldExercise {
  return generateExerciseImpl(level, seed, opts);
}

function generateExerciseImpl(level: BlindfoldLevel, seed: number, opts: BlindfoldGenOptions): BlindfoldExercise {
  const r = rng(seed);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(r() * arr.length)];

  if (level === 1 || level === 2) {
    const line = pick(GAME_LINES);
    const steps = replaySteps(line.name === 'Fool’s mate' ? line.sans : line.sans);
    // early/mid moves only (first 16 plies): recognizable, not endgame scrambles
    const step = steps[Math.floor(r() * Math.min(steps.length, 16))];
    const id = `l${level}:${line.name}:${step.san}`;
    return level === 1
      ? { kind: 'san-to-square', id, fen: step.fenBefore, san: step.san }
      : { kind: 'san-origin', id, fen: step.fenBefore, san: step.san };
  }

  if (level === 3) {
    // prefer the user's own repertoire mainline: training their real opening
    let sans: string[];
    let sourceId: string;
    if (opts.repertoireLine && opts.repertoireLine.length >= 6) {
      sans = opts.repertoireLine.slice(0, Math.min(12, opts.repertoireLine.length));
      sourceId = 'repertoire';
    } else {
      const line = pick(GAME_LINES.filter((l) => l.sans.length >= 8));
      sans = line.sans.slice(0, Math.min(12, line.sans.length));
      sourceId = line.name;
    }
    const g = new Chess();
    for (const san of sans) g.move(san);
    // ask for a piece type that exists in the final position
    const byType = new Map<`${Color}${PieceSymbol}`, Square[]>();
    for (const row of g.board()) {
      for (const cell of row) {
        if (!cell) continue;
        const k = `${cell.color}${cell.type}` as const;
        byType.set(k, [...(byType.get(k) ?? []), cell.square]);
      }
    }
    const candidates = [...byType.entries()].filter(([k, sqs]) => k[0] === 'w' && sqs.length <= 4 && (k[1] === 'p' || k[1] === 'n' || k[1] === 'b' || k[1] === 'r'));
    const [key] = pick(candidates.length > 0 ? candidates : [...byType.entries()]);
    return {
      kind: 'track-pieces',
      id: `l3:${sourceId}:${sans.length}:${key}`,
      sans,
      askColor: key[0] as Color,
      askPiece: key.slice(1) as PieceSymbol,
    };
  }

  // level 4
  const m = pick(MATE_IN_1);
  return { kind: 'blind-mate', id: `l4:${m.name}`, fen: m.fen };
}

/** All squares holding a color+piece after replaying sans (level-3 answer). */
export function squaresOfPieces(sans: string[], color: Color, piece: PieceSymbol): Square[] {
  const g = new Chess();
  for (const san of sans) g.move(san);
  const out: Square[] = [];
  for (const row of g.board()) for (const cell of row) if (cell && cell.color === color && cell.type === piece) out.push(cell.square);
  return out.sort();
}

/* ------------------------------ graders ------------------------------ */

export interface GradeResult {
  correct: boolean;
  /** the true answer, revealed after grading for honest feedback */
  expected: string;
}

export function gradeSanToSquare(ex: BfSanToSquare, answer: Square): GradeResult {
  const g = new Chess(ex.fen);
  const m = g.move(ex.san);
  return { correct: answer === m.to, expected: m.to };
}

export function gradeSanOrigin(ex: BfSanOrigin, answer: Square): GradeResult {
  const g = new Chess(ex.fen);
  const m = g.move(ex.san);
  return { correct: answer === m.from, expected: m.from };
}

export function gradeTrackPieces(ex: BfTrackPieces, answer: Square[]): GradeResult {
  const expected = squaresOfPieces(ex.sans, ex.askColor, ex.askPiece);
  const given = [...new Set(answer)].sort();
  return { correct: given.length === expected.length && given.every((s, i) => s === expected[i]), expected: expected.join(', ') };
}

/** any LEGAL move that delivers checkmate counts — multiple mates accepted */
export function gradeBlindMate(ex: BfBlindMate, from: Square, to: Square): GradeResult {
  const g = new Chess(ex.fen);
  let m;
  try {
    m = g.move({ from, to, promotion: 'q' });
  } catch {
    return { correct: false, expected: 'a mating move' };
  }
  if (!g.isCheckmate()) {
    // reveal ONE true mating move for honest feedback
    const mate = g.moves({ verbose: true }).length; // position unchanged — g reverted? no: failed candidate consumed a move
    void mate;
    const probe = new Chess(ex.fen);
    const answer = probe.moves({ verbose: true }).find((mv) => {
      probe.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? 'q' });
      const isMate = probe.isCheckmate();
      probe.undo();
      return isMate;
    });
    return { correct: false, expected: answer ? answer.san : 'a mating move' };
  }
  return { correct: true, expected: m.san };
}

/** True when the exercise's own data is still legal (pool rot guard). */
export function exerciseIsSound(ex: BlindfoldExercise): boolean {
  try {
    if (ex.kind === 'san-to-square' || ex.kind === 'san-origin') {
      new Chess(ex.fen).move(ex.san);
      return true;
    }
    if (ex.kind === 'track-pieces') {
      squaresOfPieces(ex.sans, ex.askColor, ex.askPiece);
      return true;
    }
    const probe = new Chess(ex.fen);
    return probe.moves({ verbose: true }).some((mv) => {
      probe.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? 'q' });
      const mate = probe.isCheckmate();
      probe.undo();
      return mate;
    });
  } catch {
    return false;
  }
}

/** SR scheduling key for a single exercise (per-exercise spaced repetition). */
export function blindfoldSrKey(ex: BlindfoldExercise): string {
  return `bf:${ex.id}`;
}

/** Aggregate progress key per level in training.blindfold. */
export function blindfoldLevelKey(level: BlindfoldLevel): string {
  return `l${level}`;
}
