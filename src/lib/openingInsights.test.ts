import { describe, expect, it } from 'vitest';
import type { GameRecord } from './types';
import type { GameReport } from './review';
import { bestWorstOpenings, MIN_SAMPLE_FOR_EXTREMES, openingInsights } from './openingInsights';

let seq = 0;
const game = (over: Partial<GameRecord>): GameRecord => ({
  id: `g${++seq}`,
  date: seq * 1000,
  mode: 'ai',
  timeControl: { id: '10+0', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 },
  playerColor: 'w',
  opponentName: 'Engine',
  opponentRating: 1400,
  result: 'win',
  reason: 'checkmate',
  moves: ['e4', 'c5', 'Nf3'],
  pgn: '1. e4 c5 2. Nf3',
  ratingBefore: 1200,
  ratingAfter: 1216,
  ...over,
});

const sicilianReport = (): GameReport => ({
  reviews: [],
  evals: [],
  accuracy: { w: 78, b: 71 },
  counts: { w: {} as never, b: {} as never },
  avgCpl: { w: 30, b: 45 },
});

describe('openingInsights — personal data only', () => {
  it('groups by ECO+name with W/B split and score', () => {
    const games = [
      game({ result: 'win' }),
      game({ result: 'loss', playerColor: 'w' }),
      game({ result: 'draw' }),
    ];
    const ins = openingInsights(games, () => null);
    expect(ins.openings.length).toBe(1);
    const o = ins.openings[0];
    expect(o.eco).toBe('B27'); // 1.e4 c5 2.Nf3
    expect(o.games).toBe(3);
    expect(o.white).toBe(3);
    expect(o.black).toBe(0);
    expect(o.wins).toBe(1);
    expect(o.draws).toBe(1);
    expect(o.losses).toBe(1);
    expect(o.scorePct).toBe(50);
  });

  it('accuracy only when a real review report exists', () => {
    const games = [game({}), game({})];
    expect(openingInsights(games, () => null).openings[0].avgAccuracy).toBeNull();
    const withReport = openingInsights(games, sicilianReport).openings[0];
    expect(withReport.avgAccuracy).toBe(78);
    expect(withReport.avgCpl).toBe(30);
  });

  it('unidentified games land in an honest bucket', () => {
    const games = [game({ moves: ['a3'], pgn: '1. a3' })];
    const ins = openingInsights(games, () => null);
    expect(ins.openings).toEqual([]);
    expect(ins.unidentified?.games).toBe(1);
  });

  it('black games count as black', () => {
    const games = [game({ playerColor: 'b' })];
    const o = openingInsights(games, () => null).openings[0];
    expect(o.black).toBe(1);
    expect(o.white).toBe(0);
  });
});

describe('best/worst openings — minimum sample rule', () => {
  it('refuses extremes under MIN_SAMPLE_FOR_EXTREMES', () => {
    const games = [game({}), game({ result: 'loss' })]; // 2 games < 3
    const ins = openingInsights(games, () => null);
    const { best, worst } = bestWorstOpenings(ins.openings);
    expect(best).toBeNull();
    expect(worst).toBeNull();
    expect(MIN_SAMPLE_FOR_EXTREMES).toBe(3);
  });

  it('reports extremes at or above the sample rule', () => {
    const games = [
      game({}),
      game({}),
      game({}),
      game({ moves: ['d4', 'd5'], pgn: '1. d4 d5', result: 'loss' }),
      game({ moves: ['d4', 'd5'], pgn: '1. d4 d5', result: 'loss' }),
      game({ moves: ['d4', 'd5'], pgn: '1. d4 d5', result: 'loss' }),
    ];
    const ins = openingInsights(games, () => null);
    const { best, worst } = bestWorstOpenings(ins.openings);
    expect(best?.name).toMatch(/Sicilian/i); // 3/3 wins
    expect(worst?.name).toMatch(/London|Queen's Pawn|Game/i); // 0/3
  });
});
