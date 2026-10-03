import { describe, expect, it } from 'vitest';
import { reviewMistakesFromReports } from './reviewSummary';
import type { GameReport } from './review';

const game = (id: string) => ({ id, date: Date.parse('2026-09-14T10:00:00Z'), playerColor: 'w' as const });

describe('reviewSummary — real classifications only', () => {
  it('a game WITHOUT a cached review contributes nothing (no synthesized mistakes)', () => {
    const items = reviewMistakesFromReports([game('g1')], () => null);
    expect(items).toEqual([]);
  });

  it('a plain loss without a review produces no fake blunder items', () => {
    // the old heuristic turned losses into blunders — this proves that path is gone
    const games = [{ id: 'lost-game', date: Date.now(), playerColor: 'w' as const }];
    const items = reviewMistakesFromReports(games, () => null);
    expect(items).toEqual([]);
  });

  it('extracts only the player critical moves from a real report', () => {
    const report: GameReport = {
      reviews: [
        { san: 'e4', color: 'w', cpl: 0, classification: 'best' },
        { san: 'e5', color: 'b', cpl: 0, classification: 'book' },
        { san: 'Qh5', color: 'w', cpl: 320, classification: 'blunder' },
        { san: 'Nc6', color: 'b', cpl: 40, classification: 'good' },
        { san: 'Qxf7', color: 'w', cpl: 500, classification: 'blunder' },
      ],
      evals: [],
      accuracy: { w: 40, b: 95 },
      counts: { w: {} as never, b: {} as never },
      avgCpl: { w: 200, b: 10 },
    };
    const items = reviewMistakesFromReports([game('g1')], () => report);
    expect(items).toEqual([
      { gameId: 'g1', ply: 3, san: 'Qh5', className: 'blunder', when: Date.parse('2026-09-14T10:00:00Z') },
      { gameId: 'g1', ply: 5, san: 'Qxf7', className: 'blunder', when: Date.parse('2026-09-14T10:00:00Z') },
    ]);
  });

  it('opponent mistakes are not attributed to the player', () => {
    const report: GameReport = {
      reviews: [{ san: 'd6', color: 'b', cpl: 400, classification: 'blunder' }],
      evals: [],
      accuracy: { w: 90, b: 30 },
      counts: { w: {} as never, b: {} as never },
      avgCpl: { w: 10, b: 200 },
    };
    const items = reviewMistakesFromReports([game('g1')], () => report);
    expect(items).toEqual([]);
  });
});
