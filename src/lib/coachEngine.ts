import type { GameRecord } from './types';
import type { GameReport, MoveClass } from './review';
import { CRITICAL_CLASSES } from './review';
import type { PlyMotifs } from './motifReview';
import type { RepertoireMatchResult } from './repertoireMatch';
import type { PressureCorrelation } from './timeAnalytics';

/* ============================================================
   coachEngine — deterministic, evidence-based post-game lessons.
   Max 5, deduplicated by concept, every lesson carries its
   evidence and an action. No prose without data behind it.
   ============================================================ */

export type CoachType =
  | 'missed-tactic'
  | 'major-blunder'
  | 'time-pressure'
  | 'repertoire-deviation'
  | 'strong-find'
  | 'opponent-left-book'
  | 'endgame-conversion';

export interface CoachLesson {
  type: CoachType;
  /** 1 = most important */
  severity: number;
  title: string;
  evidence: string;
  gameId: string;
  ply?: number;
  fen?: string;
  action?: { kind: 'jump' | 'practice' | 'repertoire' | 'training'; label: string };
}

export interface CoachInput {
  record: GameRecord;
  report: GameReport;
  /** per-ply motif analysis from motifReview */
  motifs: PlyMotifs[];
  /** repertoire match (may be null when none matches) */
  repertoireMatch: RepertoireMatchResult | null;
  /** time-pressure correlation */
  pressure: PressureCorrelation;
}

/** Largest player blunder/mistake by cpl. */
function worstCritical(report: GameReport, playerColor: 'w' | 'b'): { ply: number; san: string; cpl: number; classification: MoveClass } | null {
  let worst: { ply: number; san: string; cpl: number; classification: MoveClass } | null = null;
  report.reviews.forEach((r, i) => {
    if (r.color !== playerColor) return;
    if (!CRITICAL_CLASSES.includes(r.classification)) return;
    if (!worst || r.cpl > worst.cpl) {
      worst = { ply: i + 1, san: r.san, cpl: r.cpl, classification: r.classification };
    }
  });
  return worst;
}

export function buildCoachLessons(input: CoachInput): CoachLesson[] {
  const { record, report, motifs, repertoireMatch, pressure } = input;
  const lessons: CoachLesson[] = [];

  // ——— missed confirmed tactic at a critical move (highest priority)
  const missedTactic = motifs.find((m) => m.missed.length > 0);
  if (missedTactic) {
    const first = missedTactic.missed[0];
    const review = report.reviews[missedTactic.ply - 1];
    lessons.push({
      type: 'missed-tactic',
      severity: 1,
      title: `Missed ${first.type.replace('-', ' ')}`,
      evidence: review
        ? `You played ${review.san}; the engine's ${first.explanation.replace(/^(Discovered|Knight|Double|Bishop|Rook|Queen|Pawn|Skewer|Absolute|Relative) /i, '')} was available.`
        : first.explanation,
      gameId: record.id,
      ply: missedTactic.ply,
      fen: first.fenBefore,
      action: { kind: 'practice', label: 'Practice this position' },
    });
  }

  // ——— worst single blunder (merged with missed-tactic when same ply)
  const worst = worstCritical(report, record.playerColor);
  if (worst && !(missedTactic && missedTactic.ply === worst.ply)) {
    lessons.push({
      type: 'major-blunder',
      severity: 2,
      title: `${worst.classification[0].toUpperCase()}${worst.classification.slice(1)} on move ${Math.ceil(worst.ply / 2)}`,
      evidence: `${worst.san} cost ${(worst.cpl / 100).toFixed(1)} pawns of engine value.`,
      gameId: record.id,
      ply: worst.ply,
      action: { kind: 'jump', label: 'Jump to position' },
    });
  }

  // ——— time-pressure critical errors (aggregated; only with real clock data)
  if (pressure.criticalTotal > 0 && pressure.sampleAdequate && pressure.criticalUnderPressure > 0) {
    lessons.push({
      type: 'time-pressure',
      severity: 3,
      title: 'Time trouble behind your critical mistakes',
      evidence: `${pressure.criticalUnderPressure} of ${pressure.criticalTotal} critical mistakes were played below the pressure threshold.`,
      gameId: record.id,
      action: { kind: 'jump', label: 'Review the game' },
    });
  }

  // ——— repertoire deviation by the user
  if (repertoireMatch?.deviation?.who === 'user') {
    const d = repertoireMatch.deviation;
    lessons.push({
      type: 'repertoire-deviation',
      severity: 4,
      title: `Left your repertoire on move ${Math.ceil(d.ply / 2)}`,
      evidence: d.expectedSan
        ? `You played ${d.playedSan}; your repertoire prefers ${d.expectedSan}.`
        : `You played ${d.playedSan}, outside your repertoire's line.`,
      gameId: record.id,
      ply: d.ply,
      fen: d.fen,
      action: { kind: 'repertoire', label: 'Open repertoire' },
    });
  } else if (repertoireMatch?.deviation?.who === 'opponent' && repertoireMatch.followedPlies >= 4) {
    lessons.push({
      type: 'opponent-left-book',
      severity: 5,
      title: `Opponent left your book on move ${Math.ceil(repertoireMatch.deviation.ply / 2)}`,
      evidence: `You followed your repertoire for ${repertoireMatch.followedPlies} plies before ${repertoireMatch.deviation.playedSan}.`,
      gameId: record.id,
      ply: repertoireMatch.deviation.ply,
      action: { kind: 'jump', label: 'Jump to position' },
    });
  }

  // ——— strong tactical find (positive, lower priority)
  const foundTactic = motifs.find((m) => m.played.length > 0);
  if (foundTactic) {
    const first = foundTactic.played[0];
    const review = report.reviews[foundTactic.ply - 1];
    if (review && !['blunder', 'mistake'].includes(review.classification)) {
      lessons.push({
        type: 'strong-find',
        severity: 6,
        title: `Strong find: ${first.type.replace('-', ' ')}`,
        evidence: `Your ${review.san} created a confirmed tactic — ${first.explanation}.`,
        gameId: record.id,
        ply: foundTactic.ply,
        action: { kind: 'jump', label: 'Jump to position' },
      });
    }
  }

  // sort by severity, cap at 5
  return lessons.sort((a, b) => a.severity - b.severity).slice(0, 5);
}
