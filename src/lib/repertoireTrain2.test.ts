import { describe, expect, it } from 'vitest';
import { loadTraining } from './trainingStore';
import {
  dueCount,
  gradeKey,
  lineupTraining,
  recordRepDrill,
  trainingStats,
  type RepertoireRef,
} from './repertoireTrain2';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-14T12:00:00Z');

const ref = (over: Partial<RepertoireRef>): RepertoireRef => ({
  repertoireId: 'r1',
  lineId: 'l1',
  nodeKey: 'k1',
  san: 'e4',
  ...over,
});

describe('repertoire spaced repetition integration', () => {
  it('grades into the training store under a stable key', () => {
    const state = loadTraining();
    recordRepDrill(state, ref({}), 'good', NOW);
    const rec = state.repScheduling[gradeKey('r1', 'l1', 'k1')];
    expect(rec).toBeDefined();
    expect(rec.reps).toBe(1);
    expect(rec.lastResult).toBe('good');
    expect(rec.due).toBe(NOW + DAY);
  });

  it('lapse feeds due-today immediately', () => {
    const state = loadTraining();
    recordRepDrill(state, ref({}), 'again', NOW);
    const rec = state.repScheduling[gradeKey('r1', 'l1', 'k1')];
    expect(rec.due).toBe(NOW);
    expect(dueCount(state, NOW)).toBe(1);
  });

  it('stats: mastered (interval >= 21), learning, due', () => {
    const state = loadTraining();
    // chain easy grades until the interval exceeds the 21-day mastery bar
    let t0 = NOW;
    for (let i = 0; i < 4; i++) {
      recordRepDrill(state, ref({ nodeKey: 'a' }), 'easy', t0);
      t0 += 30 * DAY;
    }
    recordRepDrill(state, ref({ nodeKey: 'b' }), 'good', NOW);
    const stats = trainingStats(state, NOW);
    expect(stats.mastered).toBe(1);
    expect(stats.learning).toBe(1);
    expect(stats.due).toBe(0);
    expect(stats.retention).toBeGreaterThan(0);
  });

  it('lineup: due first, then weak (lapsed), then new, then random known', () => {
    const state = loadTraining();
    recordRepDrill(state, ref({ nodeKey: 'due1', san: 'e4' }), 'again', NOW);
    recordRepDrill(state, ref({ nodeKey: 'old', san: 'd4' }), 'good', NOW - 30 * DAY);
    const positions = [
      ref({ nodeKey: 'due1', san: 'e4' }),
      ref({ nodeKey: 'old', san: 'd4' }),
      ref({ nodeKey: 'fresh', san: 'Nf3' }),
    ];
    const lineup = lineupTraining(state, positions, NOW, 'due');
    expect(lineup[0].nodeKey).toBe('old'); // most overdue first
    expect(lineup[1].nodeKey).toBe('due1');
    const weak = lineupTraining(state, positions, NOW, 'weak');
    expect(weak.some((p) => p.nodeKey === 'due1')).toBe(true); // lapsed = weak
    const fresh = lineupTraining(state, positions, NOW, 'new');
    expect(fresh.map((p) => p.nodeKey)).toEqual(['fresh']);
  });
});
