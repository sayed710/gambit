import { describe, expect, it } from 'vitest';
import { loadTraining } from './trainingStore';
import {
  enumerateRepertoirePositions,
  gradeKey,
  lineupTraining,
  recordRepDrill,
  trainingStatsFor,
  type RepertoireRef,
} from './repertoireTrain2';
import { buildAdaptiveSession } from './adaptiveEngine';
import { applySan, createTree, type GameTreeData } from './gameTree';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-14T12:00:00Z');

const ref = (over: Partial<RepertoireRef>): RepertoireRef => ({
  repertoireId: 'r1',
  lineId: 'l1',
  nodeKey: 'k1',
  san: 'e4',
  ...over,
});

/** A full persisted-repertoire fixture (real Repertoire shape). */
function mkRep(
  id: string,
  side: 'w' | 'b',
  lines: { id: string; name: string; tree: GameTreeData; preferred: Record<string, string> }[],
) {
  return { id, name: `Rep ${id}`, side, createdAt: 0, updatedAt: 0, lines };
}

function line(tree: GameTreeData, preferred: Record<string, string> = {}) {
  return { id: 'l1', name: 'Main', tree, preferred };
}

// unnamed inline lines in older fixtures get a name via normalization-safe shapes

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

  it('lapse feeds due-today immediately (counted over existing positions)', () => {
    const state = loadTraining();
    recordRepDrill(state, ref({}), 'again', NOW);
    const rec = state.repScheduling[gradeKey('r1', 'l1', 'k1')];
    expect(rec.due).toBe(NOW);
    const positions = [ref({})];
    expect(trainingStatsFor(state, positions, NOW).due).toBe(1);
  });

  it('stats: mastered (interval >= 21), learning, due', () => {
    const state = loadTraining();
    let t0 = NOW;
    for (let i = 0; i < 4; i++) {
      recordRepDrill(state, ref({ nodeKey: 'a' }), 'easy', t0);
      t0 += 30 * DAY;
    }
    recordRepDrill(state, ref({ nodeKey: 'b' }), 'good', NOW);
    const stats = trainingStatsFor(
      state,
      [
        ref({ nodeKey: 'a', san: 'e4' }),
        ref({ nodeKey: 'b', san: 'd4' }),
      ],
      NOW,
    );
    expect(stats.mastered).toBe(1);
    expect(stats.learning).toBe(1);
    expect(stats.due).toBe(0);
    expect(stats.retention).toBeGreaterThan(0);
  });

  it('orphaned schedules (deleted repertoire/line/node) never affect stats', () => {
    const state = loadTraining();
    let t0 = NOW;
    for (let i = 0; i < 4; i++) {
      recordRepDrill(state, ref({ nodeKey: 'live' }), 'easy', t0);
      t0 += 30 * DAY;
    }
    // orphans: deleted repertoire, deleted line, unknown node, stale junk
    recordRepDrill(state, ref({ repertoireId: 'deleted-rep', nodeKey: 'x' }), 'again', NOW);
    recordRepDrill(state, ref({ lineId: 'deleted-line', nodeKey: 'x' }), 'again', NOW);
    recordRepDrill(state, ref({ nodeKey: 'unknown-node' }), 'good', NOW);
    state.repScheduling['r1:l1:stale'] = {
      due: NOW - DAY,
      interval: 99,
      reps: 9,
      ease: 3.2,
      lapses: 0,
      lastResult: 'good',
    };

    const stats = trainingStatsFor(state, [ref({ nodeKey: 'live' })], NOW);
    expect(stats.mastered).toBe(1); // the valid position counts
    expect(stats.due).toBe(0); // none of the orphans do
    expect(stats.learning).toBe(0);
    expect(stats.retention).toBeGreaterThan(21); // unrelated stale interval does not dilute
  });

  it('lineup: due first, then weak (lapsed), then new, then random known', () => {
    const state = loadTraining();
    recordRepDrill(state, ref({ nodeKey: 'due1', san: 'e4' }), 'again', NOW);
    recordRepDrill(state, ref({ nodeKey: 'old', san: 'd4' }), 'good', NOW - 30 * DAY);
    const positions = [ref({ nodeKey: 'due1', san: 'e4' }), ref({ nodeKey: 'old', san: 'd4' }), ref({ nodeKey: 'fresh', san: 'Nf3' })];
    const lineup = lineupTraining(state, positions, NOW, 'due');
    expect(lineup[0].nodeKey).toBe('old'); // most overdue first
    expect(lineup[1].nodeKey).toBe('due1');
    const weak = lineupTraining(state, positions, NOW, 'weak');
    expect(weak.some((p) => p.nodeKey === 'due1')).toBe(true); // lapsed = weak
    const fresh = lineupTraining(state, positions, NOW, 'new');
    expect(fresh.map((p) => p.nodeKey)).toEqual(['fresh']);
  });
});

describe('enumerateRepertoirePositions — preferred semantics are the single source of truth', () => {
  it('A. white root with two branches: marking the second preferred enumerates it', () => {
    const { tree } = buildLine(['e4', 'e5', 'Nf3']);
    applySan(tree, null, 'd4'); // second root branch
    const d4 = tree.moves[1];
    const rep = mkRep('r1', 'w', [line(tree, { __root__: d4.id })]);
    const out = enumerateRepertoirePositions([rep]);
    expect(out[0].san).toBe('d4');
    expect(out[0].nodeKey).toBe('__root__');
  });

  it('B. later white position: second candidate marked preferred is enumerated', () => {
    const { tree, ids } = buildLine(['e4', 'e5', 'Nf3']);
    const alt = applySan(tree, ids[1], 'Nc3'); // second candidate after 1... e5 (Nf3 first)
    if (!alt.ok) throw new Error('alt failed');
    const rep = mkRep('r1', 'w', [line(tree, { [ids[1]]: alt.id })]);
    const out = enumerateRepertoirePositions([rep]);
    const atE5 = out.find((p) => p.nodeKey === ids[1]);
    expect(atE5?.san).toBe('Nc3');
  });

  it('C. black repertoire: opponent branching with a non-first preferred path', () => {
    const { tree, ids } = buildLine(['e4', 'c5', 'Nf3', 'd6']);
    const d4 = applySan(tree, null, 'd4'); // second white root branch
    if (!d4.ok) throw new Error('d4 failed');
    const d5reply = applySan(tree, d4.id, 'd5'); // black's answer in that branch
    if (!d5reply.ok) throw new Error('d5 failed');
    // the OPPONENT's preferred root continuation is d4 (not the first child e4):
    // black's trainables follow the preferred path wherever it branches
    const rep = mkRep('r1', 'b', [line(tree, { __root__: d4.id })]);
    const out = enumerateRepertoirePositions([rep]);
    // DFS order: after e4 (c5), after Nf3 (d6), then the preferred d4 branch (d5)
    expect(out.map((p) => p.san)).toEqual(['c5', 'd6', 'd5']);
    const atD4 = out.find((p) => p.nodeKey === d4.id);
    expect(atD4?.san).toBe('d5');
    void ids;
  });

  it('D. changing the preferred selection changes the expected SAN, not the position key', () => {
    const { tree, ids } = buildLine(['e4', 'e5', 'Nf3']);
    applySan(tree, null, 'd4');
    const d4 = tree.moves[1];
    const asFirst = enumerateRepertoirePositions([mkRep('r1', 'w', [line(tree)])]);
    const asPreferred = enumerateRepertoirePositions([mkRep('r1', 'w', [line(tree, { __root__: d4.id })])]);
    expect(asFirst[0].san).toBe('e4');
    expect(asPreferred[0].san).toBe('d4');
    expect(asFirst[0].nodeKey).toBe(asPreferred[0].nodeKey); // '__root__' — same key
    void ids;
  });

  it('E. no preferred setting still falls back to the first child', () => {
    const { tree } = buildLine(['e4', 'e5']);
    const out = enumerateRepertoirePositions([mkRep('r1', 'w', [line(tree)])]);
    expect(out[0].san).toBe('e4');
  });

  it('root position is enumerated (white repertoire)', () => {
    const { tree } = buildLine(['e4', 'e5']);
    const positions = enumerateRepertoirePositions([mkRep('r1', 'w', [line(tree)])]);
    expect(positions).toEqual([{ repertoireId: 'r1', lineId: 'l1', nodeKey: '__root__', san: 'e4' }]);
  });

  it('later nodes are enumerated after an opponent reply (black repertoire)', () => {
    const { tree, ids } = buildLine(['e4', 'c5', 'Nf3', 'd6']);
    const positions = enumerateRepertoirePositions([mkRep('r1', 'b', [line(tree)])]);
    expect(positions.map((p) => p.nodeKey)).toEqual([ids[0], ids[2]]);
    expect(positions.map((p) => p.san)).toEqual(['c5', 'd6']);
  });

  it('multiple due positions in one line are all enumerable and gradeable', () => {
    const { tree, ids } = buildLine(['e4', 'c5', 'Nf3', 'd6']);
    const state = loadTraining();
    recordRepDrill(state, { repertoireId: 'r1', lineId: 'l1', nodeKey: ids[0], san: 'c5' }, 'again', NOW);
    recordRepDrill(state, { repertoireId: 'r1', lineId: 'l1', nodeKey: ids[2], san: 'd6' }, 'good', NOW - 40 * DAY);
    const positions = enumerateRepertoirePositions([mkRep('r1', 'b', [line(tree)])]);
    const due = lineupTraining(state, positions, NOW, 'due');
    expect(due.length).toBe(2);
    expect(due[0].nodeKey).toBe(ids[2]); // most overdue first
  });

  it('a weak/lapsed later node reaches the adaptive session, unrelated nodes do not', () => {
    const { tree, ids } = buildLine(['e4', 'c5', 'Nf3', 'd6']);
    const state = loadTraining();
    recordRepDrill(state, { repertoireId: 'r1', lineId: 'l1', nodeKey: ids[2], san: 'd6' }, 'again', NOW);
    recordRepDrill(state, { repertoireId: 'other', lineId: 'lx', nodeKey: 'zz', san: 'e4' }, 'again', NOW);

    const positions = enumerateRepertoirePositions([mkRep('r1', 'b', [line(tree)])]);
    expect(positions.some((p) => p.nodeKey === ids[2])).toBe(true);
    expect(positions.some((p) => p.nodeKey === 'zz')).toBe(false);

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
