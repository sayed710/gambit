import { describe, expect, it } from 'vitest';
import type { GameRecord, MoveTiming } from './types';
import type { GameReport } from './review';
import { pressureCorrelation, pressureThresholdMs, timingStats } from './timeAnalytics';

const timed = (over: Partial<GameRecord>): GameRecord => ({
  id: 'g1',
  date: 0,
  mode: 'ai',
  timeControl: { id: '10+0', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 },
  playerColor: 'w',
  opponentName: 'Engine',
  opponentRating: 1400,
  result: 'win',
  reason: 'checkmate',
  moves: [],
  pgn: '',
  ratingBefore: 1200,
  ratingAfter: 1200,
  ...over,
});

const t = (ply: number, color: 'w' | 'b', thinkMs: number, clockBeforeMs: number | null): MoveTiming => ({
  ply,
  color,
  thinkMs,
  clockBeforeMs,
  clockAfterMs: clockBeforeMs === null ? null : Math.max(0, clockBeforeMs - thinkMs),
});

describe('time pressure definition', () => {
  it('15% of initial clock, floored at 20 s', () => {
    expect(pressureThresholdMs(10)).toBe(90_000); // max(90s, 20s)
    expect(pressureThresholdMs(1)).toBe(20_000); // max(9s, 20s) -> floor
    expect(pressureThresholdMs(30)).toBe(270_000);
  });
});

describe('timingStats', () => {
  it('returns null for old games without timings', () => {
    expect(timingStats(timed({}))).toBeNull();
    expect(timingStats(timed({ moveTimings: [] }))).toBeNull();
  });

  it('averages, slowest, fastest meaningful (>=1s)', () => {
    const stats = timingStats(
      timed({
        moveTimings: [
          t(1, 'w', 400, 600_000), // fast tap — excluded from fastest meaningful
          t(2, 'b', 5_000, 590_000),
          t(3, 'w', 20_000, 570_000),
          t(4, 'b', 1_500, 568_000),
          t(5, 'w', 1_500, 565_000),
        ],
      }),
    )!;
    expect(stats.playerTimings.length).toBe(3); // black plies are engine moves
    expect(stats.avgThinkMs).toBe(Math.round((400 + 20000 + 1500) / 3));
    expect(stats.slowest?.thinkMs).toBe(20_000);
    expect(stats.fastestMeaningful?.thinkMs).toBe(1_500); // white ply 5
  });

  it('engine moves are excluded from player stats', () => {
    // white player: only white plies counted
    const stats = timingStats(
      timed({
        moveTimings: [t(1, 'w', 2_000, 600_000), t(2, 'b', 60_000, 590_000), t(3, 'w', 3_000, 598_000)],
      }),
    )!;
    expect(stats.playerTimings.every((x) => x.color === 'w')).toBe(true);
    expect(stats.avgThinkMs).toBe(2_500);
  });

  it('untimed games: no pressure count, null clocks fine', () => {
    const stats = timingStats(
      timed({
        timeControl: { id: 'unlimited', label: 'No clock', category: 'Unlimited', minutes: 0, increment: 0 },
        moveTimings: [t(1, 'w', 9_000, null), t(2, 'b', 4_000, null)],
      }),
    )!;
    expect(stats.underPressure).toBe(0);
    expect(stats.pressureThresholdMs).toBe(0);
  });

  it('counts moves under real pressure', () => {
    const stats = timingStats(
      timed({
        moveTimings: [
          t(1, 'w', 5_000, 600_000),
          t(2, 'b', 5_000, 600_000),
          t(3, 'w', 5_000, 80_000), // below 90s threshold
          t(4, 'b', 5_000, 80_000),
        ],
      }),
    )!;
    expect(stats.underPressure).toBe(1); // only white's ply-3 clock
  });
});

describe('pressureCorrelation', () => {
  const reportWith = (classes: { color: 'w' | 'b'; classification: string }[]): GameReport => ({
    reviews: classes.map((c) => ({
      san: 'Qd2',
      color: c.color,
      cpl: 300,
      classification: c.classification as never,
    })),
    evals: [],
    accuracy: { w: 50, b: 50 },
    counts: { w: {} as never, b: {} as never },
    avgCpl: { w: 100, b: 100 },
  });

  it('ties critical mistakes to real clock state', () => {
    const record = timed({
      moveTimings: [
        t(1, 'w', 1_000, 600_000),
        t(2, 'b', 1_000, 600_000),
        t(3, 'w', 1_000, 600_000),
        t(4, 'b', 1_000, 600_000),
        t(5, 'w', 1_000, 60_000), // under pressure
        t(6, 'b', 1_000, 600_000),
      ],
    });
    const report = reportWith([
      { color: 'w', classification: 'blunder' }, // ply 1: normal time
      { color: 'b', classification: 'blunder' }, // ply 2: opponent — excluded
      { color: 'w', classification: 'mistake' }, // ply 3: normal
      { color: 'b', classification: 'mistake' }, // ply 4: excluded
      { color: 'w', classification: 'mistake' }, // ply 5: under pressure
      { color: 'b', classification: 'blunder' }, // ply 6: excluded
    ]);
    const c = pressureCorrelation(record, report);
    expect(c.criticalTotal).toBe(3);
    expect(c.criticalUnderPressure).toBe(1);
    expect(c.sampleAdequate).toBe(false); // < 4 criticals
  });

  it('untimed games produce no correlation', () => {
    const record = timed({
      timeControl: { id: 'unlimited', label: 'No clock', category: 'Unlimited', minutes: 0, increment: 0 },
      moveTimings: [t(1, 'w', 1_000, null)],
    });
    const c = pressureCorrelation(record, reportWith([{ color: 'w', classification: 'blunder' }]));
    expect(c.criticalTotal).toBe(0);
  });
});
