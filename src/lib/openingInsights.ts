import type { GameRecord } from './types';
import type { GameReport } from './review';
import { identifyOpening } from './openings';

/* ============================================================
   openingInsights — PERSONAL opening explorer, built ONLY from
   the user's saved games (labelled as such in the UI). Accuracy
   appears only for games with a real cached Review report; games
   without one contribute results but never accuracy.
   ============================================================ */

export interface OpeningStat {
  eco: string;
  name: string;
  games: number;
  white: number;
  black: number;
  wins: number;
  draws: number;
  losses: number;
  /** 0..100, score = (wins + 0.5*draws)/games */
  scorePct: number;
  /** real Review accuracy average — null unless at least one cached report */
  avgAccuracy: number | null;
  /** real average centipawn loss — null unless cached reports exist */
  avgCpl: number | null;
  lastPlayed: number;
  gameIds: string[];
}

export interface OpeningAggregates {
  openings: OpeningStat[];
  unidentified: { games: number; gameIds: string[] } | null;
}

export function openingInsights(
  games: GameRecord[],
  readReport: (gameId: string) => GameReport | null,
): OpeningAggregates {
  const byKey = new Map<
    string,
    { eco: string; name: string; games: number; white: number; black: number; wins: number; draws: number; losses: number; accSum: number; accN: number; cplSum: number; cplN: number; lastPlayed: number; gameIds: string[] }
  >();
  let unidentified: { games: number; gameIds: string[] } | null = null;

  for (const g of games) {
    // custom-start games are not opening lines — counted as unidentified
    const opening = g.initialFen ? null : identifyOpening(g.moves);
    if (!opening) {
      unidentified = unidentified ?? { games: 0, gameIds: [] };
      unidentified.games += 1;
      unidentified.gameIds.push(g.id);
      continue;
    }
    const key = `${opening.eco}|${opening.name}`;
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { eco: opening.eco, name: opening.name, games: 0, white: 0, black: 0, wins: 0, draws: 0, losses: 0, accSum: 0, accN: 0, cplSum: 0, cplN: 0, lastPlayed: 0, gameIds: [] };
      byKey.set(key, bucket);
    }
    bucket.games += 1;
    if (g.playerColor === 'w') bucket.white += 1;
    else bucket.black += 1;
    if (g.result === 'win') bucket.wins += 1;
    else if (g.result === 'draw') bucket.draws += 1;
    else bucket.losses += 1;
    bucket.lastPlayed = Math.max(bucket.lastPlayed, g.date);
    bucket.gameIds.push(g.id);

    const report = readReport(g.id);
    if (report) {
      const acc = g.playerColor === 'w' ? report.accuracy.w : report.accuracy.b;
      const cpl = g.playerColor === 'w' ? report.avgCpl.w : report.avgCpl.b;
      bucket.accSum += acc;
      bucket.accN += 1;
      bucket.cplSum += cpl;
      bucket.cplN += 1;
    }
  }

  const openings: OpeningStat[] = [...byKey.values()].map((b) => ({
    eco: b.eco,
    name: b.name,
    games: b.games,
    white: b.white,
    black: b.black,
    wins: b.wins,
    draws: b.draws,
    losses: b.losses,
    scorePct: b.games > 0 ? Math.round(((b.wins + 0.5 * b.draws) / b.games) * 100) : 0,
    avgAccuracy: b.accN > 0 ? Math.round((b.accSum / b.accN) * 10) / 10 : null,
    avgCpl: b.cplN > 0 ? Math.round(b.cplSum / b.cplN) : null,
    lastPlayed: b.lastPlayed,
    gameIds: b.gameIds,
  }));

  openings.sort((a, b) => b.games - a.games || b.lastPlayed - a.lastPlayed);
  return { openings, unidentified };
}

/** Minimum sample before calling an opening best/worst (documented rule). */
export const MIN_SAMPLE_FOR_EXTREMES = 3;

export function bestWorstOpenings(openings: OpeningStat[]): { best: OpeningStat | null; worst: OpeningStat | null } {
  const eligible = openings.filter((o) => o.games >= MIN_SAMPLE_FOR_EXTREMES);
  if (eligible.length === 0) return { best: null, worst: null };
  const sorted = [...eligible].sort((a, b) => b.scorePct - a.scorePct);
  return { best: sorted[0], worst: sorted[sorted.length - 1] };
}
