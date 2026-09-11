import type { Ply } from './types';
import type { SFEval } from './engine/stockfish';

/** chess.com-style move classifications. */
export type MoveClass = 'brilliant' | 'best' | 'excellent' | 'good' | 'inaccuracy' | 'mistake' | 'blunder';

export const CLASSIFICATION_META: Record<MoveClass, { label: string; color: string }> = {
  brilliant: { label: 'Brilliant', color: '#26c2a3' },
  best: { label: 'Best', color: '#81b64c' },
  excellent: { label: 'Excellent', color: '#95bb4a' },
  good: { label: 'Good', color: '#96af8b' },
  inaccuracy: { label: 'Inaccuracy', color: '#f7c631' },
  mistake: { label: 'Mistake', color: '#ffa459' },
  blunder: { label: 'Blunder', color: '#fa412d' },
};

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

  plies.forEach((ply, i) => {
    const cpl = cplFor(evals, i);
    const before = evals[i];
    const played = ply.san;
    const isBest = (before?.bestSan != null && before.bestSan === played) || cpl <= 10;
    const classification = classifyMove(cpl, isBest);
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
  return { brilliant: 0, best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
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

/** Graph helper: normalize a white-perspective eval to [0,1] for the chart. */
export function evalToUnit(cp: number): number {
  const v = Math.max(-MATE_CP, Math.min(MATE_CP, cp));
  // logistic-ish curve so small advantages stay readable
  return 1 / (1 + Math.exp(-v / 380));
}
