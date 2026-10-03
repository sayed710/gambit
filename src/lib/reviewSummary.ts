import type { GameRecord } from './types';
import type { GameReport, MoveClass } from './review';
import { CRITICAL_CLASSES } from './review';

/* ============================================================
   reviewSummary — real review classifications, extracted from the
   persisted per-game Review cache (review.<id> = GameReport).

   Nothing here synthesizes mistakes from results. A game without a
   cached report contributes nothing. Used by Today's Training so the
   adaptive engine only ever sees classifications the engine actually
   produced.
   ============================================================ */

export interface ReviewMistakeItem {
  gameId: string;
  ply: number;
  san: string;
  className: MoveClass;
  when: number;
}

type ReportReader = (gameId: string) => GameReport | null;

/**
 * Extract the player's critical moves (blunder/mistake/miss) from real
 * cached review reports. `readReport` is injected so callers decide where
 * the cache lives (localStorage today); tests inject fixtures directly.
 */
export function reviewMistakesFromReports(
  games: Pick<GameRecord, 'id' | 'date' | 'playerColor'>[],
  readReport: ReportReader,
  maxGames = 20,
): ReviewMistakeItem[] {
  const out: ReviewMistakeItem[] = [];
  for (const game of games.slice(0, maxGames)) {
    const report = readReport(game.id);
    if (!report || !Array.isArray(report.reviews)) continue;
    report.reviews.forEach((r, i) => {
      if (r.color !== game.playerColor) return;
      if (!CRITICAL_CLASSES.includes(r.classification)) return;
      out.push({
        gameId: game.id,
        ply: i + 1,
        san: r.san,
        className: r.classification,
        when: game.date,
      });
    });
  }
  return out;
}
