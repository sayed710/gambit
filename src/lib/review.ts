import { Chess } from 'chess.js';
import type { Ply } from './types';
import { PIECE_CP } from './chessUtils';
import { identifyOpening, isBookLine } from './openings';
import type { SFEval } from './engine/stockfish';

/** chess.com-style move classifications. */
export type MoveClass =
  | 'brilliant'
  | 'great'
  | 'book'
  | 'best'
  | 'excellent'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'miss'
  | 'blunder';

export const CLASSIFICATION_META: Record<MoveClass, { label: string; color: string }> = {
  brilliant: { label: 'Brilliant', color: '#26c2a3' },
  great: { label: 'Great', color: '#5c8bb0' },
  book: { label: 'Book', color: '#a8bfd0' },
  best: { label: 'Best', color: '#81b64c' },
  excellent: { label: 'Excellent', color: '#95bb4a' },
  good: { label: 'Good', color: '#96af8b' },
  inaccuracy: { label: 'Inaccuracy', color: '#f7c631' },
  miss: { label: 'Miss', color: '#ff8a3d' },
  mistake: { label: 'Mistake', color: '#ffa459' },
  blunder: { label: 'Blunder', color: '#fa412d' },
};

/**
 * One source of truth for classification punctuation. The board verdict,
 * the move list and the graph markers all read from here.
 */
export const CLASSIFICATION_GLYPH: Record<MoveClass, string> = {
  brilliant: '!!',
  great: '!',
  best: '\u2605',
  excellent: '!',
  good: '',
  book: '\u25a4',
  inaccuracy: '?!',
  mistake: '?',
  miss: '\u2047',
  blunder: '??',
};

/** Classifications that mark a move worth revisiting. */
export const CRITICAL_CLASSES: MoveClass[] = ['inaccuracy', 'mistake', 'miss', 'blunder'];

/**
 * Standard annotation symbols (Numeral Convention Guidelines):
 * brilliant !!, great !, excellent !, inaccuracy ?!, miss ?!, mistake ?, blunder ??.
 * Best/book/excellent-by-threshold carry no symbol.
 */
export const CLASSIFICATION_SYMBOL: Partial<Record<MoveClass, string>> = {
  brilliant: '!!',
  great: '!',
  excellent: '!',
  inaccuracy: '?!',
  miss: '?!',
  mistake: '?',
  blunder: '??',
};

/**
 * Second-pass Great refinement. A "great" move is the engine's top choice
 * whose only real alternative is significantly worse — i.e. the position had
 * exactly one good move. Documented heuristic: played move is 'best' AND the
 * second MultiPV line is at least GREAT_GAP centipawns worse than the first
 * (both from the mover's perspective). This is not chess.com's proprietary
 * definition; it is an honest, checkable approximation.
 */
export const GREAT_GAP_CP = 120;

export function refineGreatMoves(
  report: GameReport,
  secondLines: Map<number, { best: number | null; second: number | null }>,
): GameReport {
  const reviews = report.reviews.map((r, i) => {
    if (r.classification !== 'best') return r;
    const lines = secondLines.get(i);
    if (!lines || lines.best == null || lines.second == null) return r;
    const gap = lines.best - lines.second;
    if (gap >= GREAT_GAP_CP) return { ...r, classification: 'great' as MoveClass };
    return r;
  });
  const counts = { w: emptyCounts(), b: emptyCounts() };
  const cplSum = { w: 0, b: 0 };
  const cplN = { w: 0, b: 0 };
  for (const r of reviews) {
    counts[r.color][r.classification]++;
    if (r.classification !== 'book') {
      cplSum[r.color] += r.cpl;
      cplN[r.color]++;
    }
  }
  return {
    ...report,
    reviews,
    counts,
    accuracy: {
      w: cplN.w > 0 ? accuracyFromCpl(cplSum.w / cplN.w) : 100,
      b: cplN.b > 0 ? accuracyFromCpl(cplSum.b / cplN.b) : 100,
    },
  };
}

/** Evaluation of one position, white perspective, from the analysis run. */
export interface PlyEval {
  cp: number; // white perspective; mates map to ±10000
  mateIn: number | null; // signed plies: positive = white delivers mate
  bestSan: string | null;
}

export interface PlyReview {
  san: string;
  color: 'w' | 'b';
  /** centipawn loss for the mover (0 = matched the engine) */
  cpl: number;
  classification: MoveClass;
}

export interface GameReport {
  reviews: PlyReview[];
  evals: (PlyEval | null)[]; // eval BEFORE each ply, length = plies.length + 1
  accuracy: { w: number; b: number };
  counts: { w: Record<MoveClass, number>; b: Record<MoveClass, number> };
  avgCpl: { w: number; b: number };
}

const MATE_CP = 10_000;

function evalToCp(e: PlyEval): number {
  return e.mateIn !== null ? (e.mateIn > 0 ? MATE_CP : -MATE_CP) : e.cp;
}

function moverCp(e: PlyEval, moverIsWhite: boolean): number {
  return moverIsWhite ? evalToCp(e) : -evalToCp(e);
}

/** centipawn loss for the mover of plies[i], given evals before and after. */
function cplFor(evals: (PlyEval | null)[], i: number): number {
  const before = evals[i];
  const after = evals[i + 1];
  if (!before || !after) return 0;
  const moverIsWhite = pliesColor(i) === 'w';
  const beforeMover = moverIsWhite ? evalToCp(before) : -evalToCp(before);
  const afterMover = moverIsWhite ? evalToCp(after) : -evalToCp(after);
  return Math.max(0, Math.min(1000, beforeMover - afterMover));
}

function pliesColor(i: number): 'w' | 'b' {
  return i % 2 === 0 ? 'w' : 'b';
}

export function classifyMove(cpl: number, isEngineBest: boolean): MoveClass {
  if (isEngineBest && cpl <= 10) return 'best';
  if (cpl <= 20) return 'excellent';
  if (cpl <= 50) return 'good';
  if (cpl <= 100) return 'inaccuracy';
  if (cpl <= 300) return 'mistake';
  return 'blunder';
}

/**
 * Material-offer test for the Brilliant heuristic: after the move, an enemy
 * piece attacks the destination square and the cheapest attacker is strictly
 * weaker than the moved piece — i.e. the opponent can win material by
 * capturing it. Equal-value trades (pawn takes pawn) are NOT offers.
 *
 * This is a static, intentionally conservative approximation of
 * chess.com's proprietary Brilliant rule: we do not run a full SEE, so quiet
 * sacrifices that only pay off after later moves are missed. Combined with
 * "the engine's top choice" and "still at least equal afterwards" it stays
 * rare and honest rather than flattering.
 */
export function isMaterialOffer(ply: Ply): boolean {
  try {
    const g = new Chess(ply.fenAfter);
    const moved = g.get(ply.to);
    if (!moved || PIECE_CP[moved.type] < 3) return false; // minor piece or more
    const enemy: 'w' | 'b' = moved.color === 'w' ? 'b' : 'w';
    const attackers = g.attackers(ply.to, enemy);
    if (attackers.length === 0) return false;
    let cheapest = Infinity;
    for (const a of attackers) {
      const p = g.get(a);
      if (p) cheapest = Math.min(cheapest, PIECE_CP[p.type]);
    }
    return cheapest < PIECE_CP[moved.type];
  } catch {
    return false;
  }
}

/** Lichess-style accuracy model: 103.17·e^(−0.04354·avgCPL) − 3.17, clamped to [0,100]. */
export function accuracyFromCpl(avgCpl: number): number {
  const acc = 103.1668 * Math.exp(-0.04354 * avgCpl) - 3.1669;
  return Math.max(0, Math.min(100, Math.round(acc * 10) / 10));
}

export function buildReport(plies: Ply[], evals: (PlyEval | null)[]): GameReport {
  const reviews: PlyReview[] = [];
  const counts = {
    w: emptyCounts(),
    b: emptyCounts(),
  };
  const cplSum = { w: 0, b: 0 };
  const cplN = { w: 0, b: 0 };
  const sanList = plies.map((p) => p.san);

  plies.forEach((ply, i) => {
    const cpl = cplFor(evals, i);
    const before = evals[i];
    const after = evals[i + 1];
    const played = ply.san;
    const moverIsWhite = ply.color === 'w';

    // Book: the move is still covered by known opening theory — i.e. the line
    // played so far is a prefix of (or exactly) a table line. This terminates
    // when the game steps off theory; it used to use identifyOpening, which
    // kept matching forever once an entry had been extended, silently marking
    // the rest of the game as book with zero accuracy signal.
    if (isBookLine(sanList.slice(0, i + 1))) {
      reviews.push({ san: played, color: ply.color, cpl: 0, classification: 'book' });
      counts[ply.color].book++;
      return; // book moves carry no accuracy signal
    }

    const isBest = (before?.bestSan != null && before.bestSan === played) || cpl <= 10;
    let classification = classifyMove(cpl, isBest);

    // Brilliant: engine's top choice AND a real material offer AND the position
    // afterwards is still at least equal for the mover.
    if (classification === 'best' && after && isMaterialOffer(ply)) {
      const afterMover = moverCp(after, moverIsWhite);
      if (afterMover >= -50) classification = 'brilliant';
    }

    // Miss: the opponent had just blundered into a winning position for the
    // mover, and this move failed to capitalize (still not clearly winning).
    if (
      (classification === 'inaccuracy' || classification === 'mistake') &&
      before &&
      after &&
      moverCp(before, moverIsWhite) >= 150 &&
      moverCp(after, moverIsWhite) <= 50
    ) {
      classification = 'miss';
    }

    reviews.push({ san: played, color: ply.color, cpl, classification });
    counts[ply.color][classification]++;
    cplSum[ply.color] += cpl;
    cplN[ply.color]++;
  });

  return {
    reviews,
    evals,
    accuracy: {
      w: cplN.w > 0 ? accuracyFromCpl(cplSum.w / cplN.w) : 100,
      b: cplN.b > 0 ? accuracyFromCpl(cplSum.b / cplN.b) : 100,
    },
    counts,
    avgCpl: {
      w: cplN.w > 0 ? Math.round(cplSum.w / cplN.w) : 0,
      b: cplN.b > 0 ? Math.round(cplSum.b / cplN.b) : 0,
    },
  };
}

function emptyCounts(): Record<MoveClass, number> {
  return { brilliant: 0, great: 0, book: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, miss: 0, mistake: 0, blunder: 0 };
}

/** Convert an SF eval to the report's white-perspective PlyEval. */
export function toPlyEval(sf: SFEval): PlyEval {
  let cp = sf.cpWhite;
  let mateIn: number | null = null;
  if (Math.abs(cp) >= 9999) {
    mateIn = sf.matePlies ?? (cp > 0 ? 1 : -1);
    cp = mateIn > 0 ? MATE_CP : -MATE_CP;
  }
  return { cp, mateIn, bestSan: sf.bestSan };
}

/** The plies with the biggest evaluation losses, most critical first. */
export function criticalMoments(report: GameReport, count = 3): number[] {
  return report.reviews
    .map((r, i) => ({ i, cpl: r.cpl, critical: CRITICAL_CLASSES.includes(r.classification) }))
    .filter((r) => r.critical || r.cpl >= 100)
    .sort((a, b) => b.cpl - a.cpl)
    .slice(0, count)
    .map((r) => r.i);
}

/** Graph helper: normalize a white-perspective eval to [0,1] for the chart. */
export function evalToUnit(cp: number): number {
  const v = Math.max(-MATE_CP, Math.min(MATE_CP, cp));
  // logistic-ish curve so small advantages stay readable
  return 1 / (1 + Math.exp(-v / 380));
}
