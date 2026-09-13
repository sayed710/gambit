import { Chess } from 'chess.js';
import type { GameReport, PlyEval } from './review';

/* ============================================================
   reviewInsights — derived analysis for the Review page.

   Heuristics are documented and deliberately simple:
   - Opening  = fullmove ≤ 10
   - Endgame  = non-king material ≤ 14 points (both sides) or fullmove > 40
   - Middlegame = everything else
   ============================================================ */

export type PhaseName = 'opening' | 'middlegame' | 'endgame';

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Total material (both sides, kings excluded) in a position. */
export function materialAfterPly(fen: string): number {
  let total = 0;
  try {
    for (const row of new Chess(fen).board()) {
      for (const sq of row) {
        if (!sq) continue;
        total += PIECE_VALUE[sq.type] ?? 0;
      }
    }
  } catch {
    /* malformed FEN — treated as zero */
  }
  return total;
}

export function materialSeries(fens: string[]): number[] {
  return fens.map((fen) => {
    let white = 0;
    let black = 0;
    try {
      for (const row of new Chess(fen).board()) {
        for (const sq of row) {
          if (!sq) continue;
          const v = PIECE_VALUE[sq.type] ?? 0;
          if (sq.color === 'w') white += v;
          else black += v;
        }
      }
    } catch {
      /* ignore */
    }
    return white - black;
  });
}

/** plyNumber is 1-based; material is the total after the ply. */
export function phaseOfPly(plyNumber: number, material: number): PhaseName {
  const moveNumber = Math.ceil(plyNumber / 2);
  if (moveNumber <= 10) return 'opening';
  if (material <= 14 || moveNumber > 40) return 'endgame';
  return 'middlegame';
}

const MATE_CP = 10_000;

function cpOf(e: PlyEval | null): number | null {
  if (!e) return null;
  return e.mateIn !== null ? (e.mateIn > 0 ? MATE_CP : -MATE_CP) : e.cp;
}

export interface Swing {
  ply: number; // 1-based ply index where the swing happened
  delta: number; // absolute centipawn change, white perspective
}

/** The k plies with the largest absolute evaluation change. */
export function biggestSwings(report: GameReport, k = 3): Swing[] {
  const out: Swing[] = [];
  for (let i = 1; i < report.evals.length; i++) {
    const before = cpOf(report.evals[i - 1]);
    const after = cpOf(report.evals[i]);
    if (before === null || after === null) continue;
    out.push({ ply: i, delta: Math.abs(after - before) });
  }
  return out.sort((a, b) => b.delta - a.delta).slice(0, k);
}

/** Average accuracy-style score per phase from per-ply centipawn loss. */
export function phaseAccuracies(report: GameReport, fens: string[]): Record<PhaseName, number | null> {
  const buckets: Record<PhaseName, { sum: number; n: number }> = {
    opening: { sum: 0, n: 0 },
    middlegame: { sum: 0, n: 0 },
    endgame: { sum: 0, n: 0 },
  };
  report.reviews.forEach((r, i) => {
    const material = fens[i + 1] ? materialAfterPly(fens[i + 1]) : 39;
    const phase = phaseOfPly(i + 1, material);
    buckets[phase].sum += r.cpl;
    buckets[phase].n += 1;
  });
  // same mapping the review page uses: 0 loss ≈ 100, 100+ loss ≈ 0
  const score = (avg: number) => Math.max(0, Math.min(100, Math.round(100 - avg / 1.2)));
  const out = {} as Record<PhaseName, number | null>;
  (Object.keys(buckets) as PhaseName[]).forEach((p) => {
    out[p] = buckets[p].n > 0 ? score(buckets[p].sum / buckets[p].n) : null;
  });
  return out;
}
