import { describe, expect, it } from 'vitest';
import {
  emptyTrainingState,
  normalizeTrainingState,
  recordEndgameAttempt,
  scheduleSr,
  type EndgameProgress,

  type SrRecord,
} from './trainingStore';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-14T12:00:00Z');

describe('training store — normalization', () => {
  it('returns a fully-shaped empty state for fresh installs', () => {
    const s = emptyTrainingState();
    expect(s.version).toBe(1);
    expect(s.endgame).toEqual({});
    expect(s.repScheduling).toEqual({});
    expect(s.motifs).toEqual({});
    expect(s.adaptive.queue).toEqual([]);
  });

  it('normalizes corrupt/partial payloads without throwing', () => {
    const fixed = normalizeTrainingState({
      version: 1,
      endgame: { lucena: { attempted: 'three', solved: 1 } },
      repScheduling: { bad: 7, good: { due: 5, interval: 'x', reps: -2, ease: 9, lapses: 0, lastResult: 'zzz' } },
      motifs: { fork: { seen: 'x' } },
      adaptive: { queue: 'nope' },
    });
    expect(fixed.endgame.lucena.attempted).toBe(0);
    expect(fixed.repScheduling.good.interval).toBe(0);
    expect(fixed.repScheduling.good.ease).toBe(3.2); // clamped to the documented cap
    expect(fixed.repScheduling.bad).toBeUndefined();
    expect(fixed.motifs.fork.seen).toBe(0);
    expect(fixed.adaptive.queue).toEqual([]);
  });

  it('keeps valid records intact through normalization', () => {
    const prog: EndgameProgress = { attempted: 3, solved: 2, bestAttempts: 2, lastPracticed: NOW, mastery: 0.66 };
    const fixed = normalizeTrainingState({ version: 1, endgame: { kr: prog } });
    expect(fixed.endgame.kr).toEqual(prog);
  });
});

describe('endgame progress', () => {
  it('records attempts, best attempts and mastery', () => {
    let p: EndgameProgress | undefined;
    p = recordEndgameAttempt(p, true, 3, NOW);
    expect(p).toEqual({ attempted: 1, solved: 1, bestAttempts: 3, lastPracticed: NOW, mastery: 1 });

    p = recordEndgameAttempt(p, false, 5, NOW + DAY);
    expect(p!.attempted).toBe(2);
    expect(p!.solved).toBe(1);
    expect(p!.bestAttempts).toBe(3); // failed attempt does not improve best
    expect(p!.mastery).toBeCloseTo(0.5, 5);

    // a faster solve improves bestAttempts and pushes mastery up
    p = recordEndgameAttempt(p, true, 2, NOW + 2 * DAY);
    expect(p!.bestAttempts).toBe(2);
    expect(p!.mastery).toBeGreaterThan(0.5);
  });
});

describe('SM-2-lite scheduling (deterministic)', () => {
  const fresh: SrRecord = { due: 0, interval: 0, reps: 0, ease: 2.5, lapses: 0, lastResult: null };

  it('first Good schedules 1 day out', () => {
    const r = scheduleSr(fresh, 'good', NOW);
    expect(r.reps).toBe(1);
    expect(r.interval).toBe(1);
    expect(r.due).toBe(NOW + DAY);
    expect(r.lastResult).toBe('good');
  });

  it('repeated Good multiplies by ease', () => {
    let r = scheduleSr(fresh, 'good', NOW);
    r = scheduleSr(r, 'good', NOW);
    expect(r.interval).toBe(3);
    r = scheduleSr(r, 'good', NOW);
    expect(r.interval).toBeCloseTo(3 * r.ease, 5);
  });

  it('Hard shortens growth and lowers ease (floor 1.3)', () => {
    let r = scheduleSr(fresh, 'good', NOW);
    r = scheduleSr(r, 'hard', NOW);
    expect(r.interval).toBeCloseTo(1.2, 5); // 1 day * 1.2 - fractional days are fine
    expect(r.ease).toBeCloseTo(2.45, 5);
  });

  it('Easy grows faster and raises ease (cap 3.2)', () => {
    const r = scheduleSr(fresh, 'easy', NOW);
    expect(r.interval).toBeGreaterThan(1);
    expect(r.ease).toBeCloseTo(2.65, 5);
  });

  it('Again lapses: reps reset, ease drops with floor, due immediately', () => {
    let r = scheduleSr(fresh, 'good', NOW);
    r = scheduleSr(r, 'good', NOW);
    const eased = r.ease;
    r = scheduleSr(r, 'again', NOW);
    expect(r.reps).toBe(0);
    expect(r.interval).toBe(0);
    expect(r.lapses).toBe(1);
    expect(r.ease).toBe(Math.max(1.3, eased - 0.2));
    expect(r.due).toBe(NOW); // due right away
  });

  it('serialization round trips', () => {
    const r = scheduleSr(fresh, 'good', NOW);
    const back: SrRecord = JSON.parse(JSON.stringify(r));
    expect(back).toEqual(r);
  });
});
