import { beforeEach, describe, expect, it } from 'vitest';
import { applySan, createTree } from './gameTree';
import {
  createRepertoire,
  loadRepertoires,
  markPreferred,
  normalizeRepertoireList,
  saveRepertoires,
  setPreferredChild,
} from './repertoireStore';
import { advanceToRepertoireSide, expectedSanAt, trainerStep } from './repertoireTrain';

function line(sans: string[]) {
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

beforeEach(() => localStorage.clear());

describe('repertoire store', () => {
  it('creates a white or black repertoire with one empty line', () => {
    const rep = createRepertoire('My 1.e4', 'w');
    expect(rep.side).toBe('w');
    expect(rep.lines.length).toBe(1);
  });

  it('saves and loads without loss, skipping malformed entries', () => {
    const rep = createRepertoire('Keep', 'b');
    saveRepertoires([rep]);
    localStorage.setItem('gambit.repertoire.v1', JSON.stringify([{ junk: 1 }, rep]));
    const loaded = loadRepertoires();
    expect(loaded.length).toBe(1);
    expect(loaded[0].name).toBe('Keep');
  });

  it('normalizes a repertoire with no lines into one empty line', () => {
    const fixed = normalizeRepertoireList([
      { id: 'x', name: 'N', side: 'w', createdAt: 1, updatedAt: 2, lines: null } as never,
    ]);
    expect(fixed[0].lines.length).toBe(1);
  });
});

describe('preferred moves', () => {
  it('marks and unmarks a preferred child', () => {
    const { tree, ids } = line(['e4', 'e5']);
    const rep = createRepertoire('R', 'w');
    const lin = rep.lines[0];
    lin.tree = tree;
    markPreferred(lin, ids[0], true);
    expect(lin.preferred[ids[0]]).toBeTruthy();
    markPreferred(lin, ids[0], false);
    expect(lin.preferred[ids[0]]).toBeUndefined();
  });
});

describe('trainer walk — side aware', () => {
  it('white repertoire: prompts at the root, auto-plays the reply', () => {
    const { tree, ids } = line(['e4', 'e5', 'Nf3']);
    const rep = createRepertoire('R', 'w');
    rep.lines[0].tree = tree;

    // at the root it is White's turn — the trainer expects e4
    const step1 = trainerStep(rep.lines[0], null, 'e4', 'w');
    expect(step1.status).toBe('correct');
    if (step1.status !== 'correct') return;
    expect(step1.oppReply?.san).toBe('e5');

    const dev = trainerStep(rep.lines[0], null, 'd4', 'w');
    expect(dev.status).toBe('deviation');
    if (dev.status === 'deviation') expect(dev.expectedSan).toBe('e4');

    // after 1.e4 e5 White is asked again for Nf3
    const step2 = trainerStep(rep.lines[0], ids[1], 'Nf3', 'w');
    expect(step2.status).toBe('correct');
    if (step2.status !== 'correct') return;
    const step3 = trainerStep(rep.lines[0], step2.nodeId ?? ids[2], 'anything', 'w');
    expect(step3.status).toBe('line-end');
  });

  it('black repertoire: the opponent white move is played first, then Black is asked', () => {
    const { tree, ids } = line(['e4', 'c5', 'Nf3', 'd6']);
    const rep = createRepertoire('R', 'b');
    rep.lines[0].tree = tree;

    // from the root it is White's turn: the trainer auto-advances past e4
    const advanced = advanceToRepertoireSide(rep.lines[0], null, 'b');
    expect(advanced.ended).toBe(false);
    expect(advanced.replies.map((r) => r.san)).toEqual(['e4']);
    expect(advanced.nodeId).toBe(ids[0]);

    // now Black is asked for the Sicilian
    const step = trainerStep(rep.lines[0], advanced.nodeId, 'c5', 'b');
    expect(step.status).toBe('correct');
    if (step.status !== 'correct') return;
    expect(step.oppReply?.san).toBe('Nf3');

    // and after Nf3, Black is asked for d6
    const step2 = trainerStep(rep.lines[0], step.oppReply!.id, 'd6', 'b');
    expect(step2.status).toBe('correct');
  });

  it('longer black repertoire keeps asking only on Black turns', () => {
    const { tree, ids } = line(['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6']);
    const rep = createRepertoire('R', 'b');
    rep.lines[0].tree = tree;
    let nodeId: string | null = null;
    let asked = 0;
    for (;;) {
      const adv = advanceToRepertoireSide(rep.lines[0], nodeId, 'b');
      nodeId = adv.nodeId;
      if (adv.ended) break;
      asked += 1;
      const expected = expectedSanAt(rep.lines[0], nodeId);
      if (!expected) break;
      const step = trainerStep(rep.lines[0], nodeId, expected, 'b');
      if (step.status !== 'correct') break;
      nodeId = step.oppReply ? step.oppReply.id : step.nodeId;
      if (!step.oppReply) break;
    }
    // Black answers: c5, d6, cxd4, Nf6
    expect(asked).toBe(4);
    expect(nodeId).toBe(ids[7]);
  });

  it('opponent continuation respects a preferred child', () => {
    const { tree, ids } = line(['e4', 'c5']);
    const scandinavian = applySan(tree, null, 'd4'); // root-level alternative to 1. e4
    if (!scandinavian.ok) throw new Error('d4 failed');
    const rep = createRepertoire('R', 'b');
    rep.lines[0].tree = tree;
    setPreferredChild(rep.lines[0], null, scandinavian.id);
    const advanced = advanceToRepertoireSide(rep.lines[0], null, 'b');
    expect(advanced.replies.map((r) => r.san)).toEqual(['d4']);
    expect(advanced.nodeId).toBe(scandinavian.id);
    void ids;
  });

  it('deviations reveal the expected move at a black turn', () => {
    const { tree, ids } = line(['e4', 'c5', 'Nf3']);
    const rep = createRepertoire('R', 'b');
    rep.lines[0].tree = tree;
    const step = trainerStep(rep.lines[0], ids[0], 'e6', 'b');
    expect(step.status).toBe('deviation');
    if (step.status === 'deviation') expect(step.expectedSan).toBe('c5');
  });

  it('empty line and malformed node end the drill', () => {
    const rep = createRepertoire('Empty', 'b');
    expect(advanceToRepertoireSide(rep.lines[0], null, 'b').ended).toBe(true);
    expect(trainerStep(rep.lines[0], null, 'e4', 'b').status).toBe('line-end');
    expect(trainerStep(rep.lines[0], 'missing-node', 'e4', 'b').status).toBe('line-end');
  });
});
