import type { GameRecord, MoveTiming } from './types';
import type { GameReport } from './review';

/* ============================================================
   timeAnalytics — time management analysis from REAL clock data.

   Time-pressure definition (documented, not universal theory):
   a move is "under time pressure" when the mover's remaining
   clock before the move is at or below max(15% of the initial
   clock, 20 s absolute floor). Initial clock = timeControl
   minutes × 60 s. Untimed games never produce pressure stats.
   ============================================================ */

export const PRESSURE_PCT = 0.15;
export const PRESSURE_FLOOR_MS = 20_000;

export function pressureThresholdMs(initialMinutes: number): number {
  return Math.max(PRESSURE_PCT * initialMinutes * 60_000, PRESSURE_FLOOR_MS);
}

export interface TimingStats {
  /** player's own timings only */
  playerTimings: MoveTiming[];
  avgThinkMs: number;
  slowest: MoveTiming | null;
  /** fastest move with at least 1 s of think time (filtering premove-like taps) */
  fastestMeaningful: MoveTiming | null;
  underPressure: number;
  pressureThresholdMs: number;
  avgThinkOpeningMs: number | null;
  avgThinkMiddlegameMs: number | null;
}

export function timingStats(record: GameRecord): TimingStats | null {
  const timings = record.moveTimings;
  if (!timings || timings.length === 0) return null;
  const playerTimings = timings.filter((t) => t.color === record.playerColor);
  if (playerTimings.length === 0) return null;

  const thinkTimes = playerTimings.map((t) => t.thinkMs);
  const avgThinkMs = Math.round(thinkTimes.reduce((a, b) => a + b, 0) / thinkTimes.length);
  const slowest = playerTimings.reduce((a, b) => (b.thinkMs > a.thinkMs ? b : a), playerTimings[0]);
  const meaningful = playerTimings.filter((t) => t.thinkMs >= 1000);
  const fastestMeaningful = meaningful.length
    ? meaningful.reduce((a, b) => (b.thinkMs < a.thinkMs ? b : a), meaningful[0])
    : null;

  const threshold = record.timeControl.minutes > 0 ? pressureThresholdMs(record.timeControl.minutes) : 0;
  const underPressure =
    record.timeControl.minutes > 0
      ? playerTimings.filter((t) => t.clockBeforeMs !== null && t.clockBeforeMs <= threshold).length
      : 0;

  // opening = first 10 moves of the player's own moves; middlegame after
  const openingTimings = playerTimings.slice(0, 10);
  const openingAvg = openingTimings.length
    ? Math.round(openingTimings.reduce((a, b) => a + b.thinkMs, 0) / openingTimings.length)
    : null;
  const rest = playerTimings.slice(10);
  const middleAvg = rest.length ? Math.round(rest.reduce((a, b) => a + b.thinkMs, 0) / rest.length) : null;

  return {
    playerTimings,
    avgThinkMs,
    slowest,
    fastestMeaningful,
    underPressure,
    pressureThresholdMs: threshold,
    avgThinkOpeningMs: openingAvg,
    avgThinkMiddlegameMs: middleAvg,
  };
}

export interface PressureCorrelation {
  criticalTotal: number;
  criticalUnderPressure: number;
  /** only claimed when at least 4 critical moves exist (sample rule) */
  sampleAdequate: boolean;
}

/** Correlate the player's critical mistakes with real clock state. */
export function pressureCorrelation(record: GameRecord, report: GameReport): PressureCorrelation {
  const timings = record.moveTimings;
  if (!timings || record.timeControl.minutes === 0) {
    return { criticalTotal: 0, criticalUnderPressure: 0, sampleAdequate: false };
  }
  const threshold = pressureThresholdMs(record.timeControl.minutes);
  // join by the stored game ply (review i == ply i+1). Timings skip engine
  // plies, so array position would misalign for every AI game.
  const byPly = new Map(timings.map((t) => [t.ply, t]));
  let criticalTotal = 0;
  let criticalUnderPressure = 0;
  report.reviews.forEach((r, i) => {
    if (r.color !== record.playerColor) return;
    if (!['blunder', 'mistake', 'miss'].includes(r.classification)) return;
    const t = byPly.get(i + 1);
    if (!t || t.color !== record.playerColor) return;
    criticalTotal += 1;
    if (t.clockBeforeMs !== null && t.clockBeforeMs <= threshold) criticalUnderPressure += 1;
  });
  return {
    criticalTotal,
    criticalUnderPressure,
    sampleAdequate: criticalTotal >= 4,
  };
}
