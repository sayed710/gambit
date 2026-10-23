import { describe, expect, it } from 'vitest';
import type { GameRecord } from './types';
import type { GameReport } from './review';
import { buildCoachLessons, type CoachInput } from './coachEngine';
import type { PlyMotifs } from './motifReview';

const record: GameRecord = {
  id: 'g1',
  date: 0,
  mode: 'ai',
  timeControl: { id: '10+0', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 },
  playerColor: 'w',
  opponentName: 'Engine',
  opponentRating: 1400,
  result: 'loss',
  reason: 'checkmate',
  moves: [],
  pgn: '',
  ratingBefore: 1200,
  ratingAfter: 1176,
};

const review = (san: string, color: 'w' | 'b', cpl: number, classification: string) => ({
  san,
  color,
  cpl,
  classification: classification as never,
});

const baseReport: GameReport = {
  reviews: [
    review('e4', 'w', 0, 'best'),
    review('e5', 'b', 0, 'book'),
    review('Qd2', 'w', 310, 'blunder'),
    review('Nf6', 'b', 0, 'best'),
  ],
  evals: [],
  accuracy: { w: 60, b: 90 },
  counts: { w: {} as never, b: {} as never },
  avgCpl: { w: 80, b: 5 },
};

const forkMiss: PlyMotifs[] = [
  { ply: 3, played: [], missed: [{ type: 'fork', confidence: 'confirmed', fenBefore: 'x', fenAfter: 'y', actorColor: 'w', sourceSquare: 'g1', targetSquares: ['e8', 'd5'], involvedPieces: ['n', 'k', 'q'], explanationKey: 'k', explanation: 'Knight fork: the knight on c7 attacks the king and the queen.' }] },
];

describe('coachEngine — evidence-based lessons', () => {
  it('no review report -> no lessons (never invent)', () => {
    const input: CoachInput = {
      record,
      report: { reviews: [], evals: [], accuracy: { w: 0, b: 0 }, counts: { w: {} as never, b: {} as never }, avgCpl: { w: 0, b: 0 } },
      motifs: [],
      repertoireMatch: null,
      pressure: { criticalTotal: 0, criticalUnderPressure: 0, sampleAdequate: false },
    };
    expect(buildCoachLessons(input)).toEqual([]);
  });

  it('a blunder produces a lesson with pawn evidence', () => {
    const input: CoachInput = {
      record,
      report: baseReport,
      motifs: [],
      repertoireMatch: null,
      pressure: { criticalTotal: 1, criticalUnderPressure: 0, sampleAdequate: false },
    };
    const lessons = buildCoachLessons(input);
    expect(lessons.length).toBe(1);
    expect(lessons[0].type).toBe('major-blunder');
    expect(lessons[0].evidence).toMatch(/Qd2/);
    expect(lessons[0].evidence).toMatch(/3\.1 pawns/);
  });

  it('a missed fork outranks the blunder and merges when on the same ply', () => {
    const withFork: CoachInput = {
      record,
      report: baseReport,
      motifs: forkMiss,
      repertoireMatch: null,
      pressure: { criticalTotal: 0, criticalUnderPressure: 0, sampleAdequate: false },
    };
    const lessons = buildCoachLessons(withFork);
    expect(lessons[0].type).toBe('missed-tactic');
    expect(lessons[0].ply).toBe(3);
    // blunder lesson suppressed: same ply already covered by the tactic lesson
    expect(lessons.filter((l) => l.type === 'major-blunder')).toHaveLength(0);
  });

  it('time-pressure lesson appears only with adequate sample', () => {
    const inadequate: CoachInput = {
      record,
      report: baseReport,
      motifs: [],
      repertoireMatch: null,
      pressure: { criticalTotal: 1, criticalUnderPressure: 1, sampleAdequate: false },
    };
    expect(buildCoachLessons(inadequate).some((l) => l.type === 'time-pressure')).toBe(false);

    const adequate: CoachInput = {
      record,
      report: baseReport,
      motifs: [],
      repertoireMatch: null,
      pressure: { criticalTotal: 5, criticalUnderPressure: 3, sampleAdequate: true },
    };
    const lessons = buildCoachLessons(adequate);
    const tp = lessons.find((l) => l.type === 'time-pressure')!;
    expect(tp.evidence).toMatch(/3 of 5/);
  });

  it('user repertoire deviation becomes a lesson; opponent exit becomes informational', () => {
    const userDev: CoachInput = {
      record,
      report: baseReport,
      motifs: [],
      repertoireMatch: { repertoireId: 'r1', followedPlies: 4, deviation: { ply: 5, who: 'user', playedSan: 'Qd3', expectedSan: 'd4', fen: 'x', nodeKey: 'k' } },
      pressure: { criticalTotal: 0, criticalUnderPressure: 0, sampleAdequate: false },
    };
    const lessons = buildCoachLessons(userDev);
    const dev = lessons.find((l) => l.type === 'repertoire-deviation')!;
    expect(dev.evidence).toMatch(/prefers d4/);
    expect(dev.action?.kind).toBe('repertoire');

    const oppExit: CoachInput = { ...userDev, repertoireMatch: { repertoireId: 'r1', followedPlies: 5, deviation: { ply: 6, who: 'opponent', playedSan: 'Nf6', expectedSan: null, fen: 'x', nodeKey: 'k' } } };
    const lessons2 = buildCoachLessons(oppExit);
    expect(lessons2.some((l) => l.type === 'opponent-left-book')).toBe(true);
  });

  it('a strong confirmed find becomes a positive lesson (not on blunders)', () => {
    const found: PlyMotifs[] = [{ ply: 1, played: [{ type: 'fork', confidence: 'confirmed', fenBefore: 'x', fenAfter: 'y', actorColor: 'w', sourceSquare: 'g1', targetSquares: ['e8', 'd5'], involvedPieces: ['n'], explanationKey: 'k', explanation: 'Knight fork.' }], missed: [] }];
    const lessons = buildCoachLessons({ record, report: baseReport, motifs: found, repertoireMatch: null, pressure: { criticalTotal: 0, criticalUnderPressure: 0, sampleAdequate: false } });
    expect(lessons.some((l) => l.type === 'strong-find')).toBe(true);

    // same find on a blunder ply is not celebrated
    const foundOnBlunder: PlyMotifs[] = [{ ply: 3, played: found[0].played, missed: [] }];
    expect(buildCoachLessons({ record, report: baseReport, motifs: foundOnBlunder, repertoireMatch: null, pressure: { criticalTotal: 0, criticalUnderPressure: 0, sampleAdequate: false } }).some((l) => l.type === 'strong-find')).toBe(false);
  });

  it('caps at 5 lessons', () => {
    const manyMotifs: PlyMotifs[] = Array.from({ length: 10 }, (_, i) => ({
      ply: i + 1,
      played: [],
      missed: [{ type: 'fork' as const, confidence: 'confirmed' as const, fenBefore: 'x', fenAfter: 'y', actorColor: 'w', sourceSquare: 'g1', targetSquares: ['e8'], involvedPieces: ['n'], explanationKey: `k${i}`, explanation: 'fork' }],
    }));
    // build a report where every ply is a distinct critical class
    const report: GameReport = {
      reviews: manyMotifs.map((_m, i) => review(`M${i}`, 'w', 300 + i, 'blunder')),
      evals: [],
      accuracy: { w: 10, b: 90 },
      counts: { w: {} as never, b: {} as never },
      avgCpl: { w: 300, b: 5 },
    };
    const lessons = buildCoachLessons({ record, report, motifs: manyMotifs, repertoireMatch: null, pressure: { criticalTotal: 0, criticalUnderPressure: 0, sampleAdequate: false } });
    expect(lessons.length).toBeLessThanOrEqual(5);
  });
});
