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

import { enumerateRepertoirePositions } from './repertoireTrain2';
import { buildAdaptiveSession } from './adaptiveEngine';
import { applySan, createTree } from './gameTree';

function buildLine(sans: string[]) {
  const tree = createTree();
  let parent: string | null = null;
  const ids: string[] = [];
  for (const san of sans) {
    const r = applySan(tree, parent, san);
    if (!r.ok) throw new Error(`illegal ${san}`);
    parent = r.id;
    ids.push(r.id);
  }
  return { tree, ids };
}

describe('enumerateRepertoirePositions — full trainable model', () => {
  it('root position is enumerated with the expected SAN (white repertoire)', () => {
    const { tree } = buildLine(['e4', 'e5']);
    const positions = enumerateRepertoirePositions([
      { id: 'r1', side: 'w', lines: [{ id: 'l1', tree }] },
    ]);
    expect(positions).toEqual([{ repertoireId: 'r1', lineId: 'l1', nodeKey: '__root__', san: 'e4' }]);
  });

  it('later nodes are enumerated after an opponent reply (black repertoire)', () => {
    const { tree, ids } = buildLine(['e4', 'c5', 'Nf3', 'd6']);
    const positions = enumerateRepertoirePositions([
      { id: 'r1', side: 'b', lines: [{ id: 'l1', tree }] },
    ]);
    // black answers after e4 (c5) and after Nf3 (d6) — not at the root
    expect(positions.map((p) => p.nodeKey)).toEqual([ids[0], ids[2]]);
    expect(positions.map((p) => p.san)).toEqual(['c5', 'd6']);
  });

  it('multiple due positions in one line are all enumerable and gradeable', () => {
    const { tree, ids } = buildLine(['e4', 'c5', 'Nf3', 'd6']);
    const state = loadTraining();
    recordRepDrill(state, { repertoireId: 'r1', lineId: 'l1', nodeKey: ids[0], san: 'c5' }, 'again', NOW);
    recordRepDrill(state, { repertoireId: 'r1', lineId: 'l1', nodeKey: ids[2], san: 'd6' }, 'good', NOW - 40 * DAY);
    const positions = enumerateRepertoirePositions([
      { id: 'r1', side: 'b', lines: [{ id: 'l1', tree }] },
    ]);
    const due = lineupTraining(state, positions, NOW, 'due');
    expect(due.length).toBe(2);
    expect(due[0].nodeKey).toBe(ids[2]); // most overdue first (40 days vs now)
  });

  it('a weak/lapsed later node reaches the adaptive session, unrelated nodes do not', () => {
    const { tree, ids } = buildLine(['e4', 'c5', 'Nf3', 'd6']);
    const state = loadTraining();
    recordRepDrill(state, { repertoireId: 'r1', lineId: 'l1', nodeKey: ids[2], san: 'd6' }, 'again', NOW);
    recordRepDrill(state, { repertoireId: 'other', lineId: 'lx', nodeKey: 'zz', san: 'e4' }, 'again', NOW);

    const positions = enumerateRepertoirePositions([
      { id: 'r1', side: 'b', lines: [{ id: 'l1', tree }] },
    ]);
    expect(positions.some((p) => p.nodeKey === ids[2])).toBe(true);
    expect(positions.some((p) => p.nodeKey === 'zz')).toBe(false);

    // adaptive: the lapsed r1 position is recommended; the unrelated one is not
    const items = buildAdaptiveSession({
      now: NOW,
      repScheduling: state.repScheduling,
      repertoirePositions: positions,
    });
    const repItems = items.filter((i) => i.kind === 'repertoire');
    expect(repItems.length).toBe(1);
    expect(repItems[0].ref.repertoireId).toBe('r1');
    expect(repItems[0].reason).toMatch(/lapsed/i);
  });
});
