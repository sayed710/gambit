import { describe, expect, it } from 'vitest';
import { buildAdaptiveSession } from './adaptiveEngine';

const NOW = Date.parse('2026-09-14T12:00:00Z');
const DAY = 86_400_000;

describe('adaptive training engine', () => {
  it('empty data produces a small default session (visualization + puzzle)', () => {
    const items = buildAdaptiveSession({ now: NOW });
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.some((i) => i.kind === 'visualization')).toBe(true);
  });

  it('the weakest puzzle theme ranks first with an explanation', () => {
    const items = buildAdaptiveSession({
      now: NOW,
      motifStats: { discovered: { seen: 5, missed: 4, lastSeen: NOW - DAY } },
      puzzleThemes: { discovered: { solved: 1, failed: 4 } },
    });
    const top = items[0];
    expect(top.kind).toBe('puzzle');
    expect(top.reason).toMatch(/discovered/i);
    expect(top.reason).toMatch(/missed|failed/i);
  });

  it('endgame lessons with low mastery rank near the top', () => {
    const items = buildAdaptiveSession({
      now: NOW,
      endgame: { 'kr-mate': { attempted: 4, solved: 0, bestAttempts: null, lastPracticed: NOW - 2 * DAY, mastery: 0 } },
    });
    expect(items.some((i) => i.kind === 'endgame' && i.ref.lessonId === 'kr-mate')).toBe(true);
    const eg = items.find((i) => i.kind === 'endgame' && i.ref.lessonId === 'kr-mate')!;
    expect(eg.reason).toMatch(/0%/);
  });

  it('due repertoire positions generate due-first items', () => {
    const items = buildAdaptiveSession({
      now: NOW,
      repScheduling: {
        'r1:l1:root': { due: NOW - DAY, interval: 3, reps: 2, ease: 2.5, lapses: 1, lastResult: 'good' },
      },
      repertoirePositions: [{ repertoireId: 'r1', lineId: 'l1', nodeKey: 'root', san: 'e4' }],
    });
    const rep = items.find((i) => i.kind === 'repertoire');
    expect(rep).toBeDefined();
    expect(rep!.reason).toMatch(/due/i);
  });

  it('reviewed blunders become mistake items, most severe first', () => {
    const items = buildAdaptiveSession({
      now: NOW,
      reviewMistakes: [
        { gameId: 'g1', ply: 34, san: 'Qe7', className: 'blunder', when: NOW - DAY, motif: 'hanging' },
        { gameId: 'g2', ply: 10, san: 'Bb4', className: 'inaccuracy', when: NOW - 5 * DAY },
      ],
    });
    const mistakes = items.filter((i) => i.kind === 'mistake');
    expect(mistakes.length).toBe(2);
    expect(mistakes[0].ref.gameId).toBe('g1'); // blunder outranks inaccuracy
    expect(mistakes[0].reason).toMatch(/blunder/i);
  });

  it('recency beats nothing: a missed motif this week outranks an old one', () => {
    const items = buildAdaptiveSession({
      now: NOW,
      reviewMistakes: [
        { gameId: 'g1', ply: 34, san: 'Qe7', className: 'blunder', when: NOW - DAY },
        { gameId: 'g2', ply: 10, san: 'Bb4', className: 'blunder', when: NOW - 20 * DAY },
      ],
    });
    const mistakes = items.filter((i) => i.kind === 'mistake');
    expect(mistakes[0].ref.gameId).toBe('g1'); // same severity, more recent first
  });

  it('session length is capped at 15', () => {
    const reviewMistakes = Array.from({ length: 30 }, (_, i) => ({
      gameId: `g${i}`,
      ply: 10,
      san: 'Qe7',
      className: 'blunder',
      when: NOW - i * DAY,
    }));
    const items = buildAdaptiveSession({ now: NOW, reviewMistakes });
    expect(items.length).toBeLessThanOrEqual(15);
  });
});
