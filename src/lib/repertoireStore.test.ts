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
import { trainerStep, trainables } from './repertoireTrain';

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

describe('trainer walk', () => {
  it('asks the repertoire side, auto-plays the opponent, ends the line', () => {
    const { tree, ids } = line(['e4', 'e5', 'Nf3']);
    const rep = createRepertoire('R', 'w');
    rep.lines[0].tree = tree;

    // at root: white to move — the trainer expects e4
    const step1 = trainerStep(rep.lines[0], null, 'e4');
    expect(step1.status).toBe('correct');
    if (step1.status !== 'correct') return;
    // after e4, black's e5 is auto-played
    expect(step1.oppReply?.san).toBe('e5');

    // deviation: at root, d4 is legal but not the repertoire move
    const dev = trainerStep(rep.lines[0], null, 'd4');
    expect(dev.status).toBe('deviation');
    if (dev.status === 'deviation') expect(dev.expectedSan).toBe('e4');

    // continue the line: after e4 e5 the trainer asks for Nf3
    const step2 = trainerStep(rep.lines[0], ids[1], 'Nf3');
    expect(step2.status).toBe('correct');
    if (step2.status !== 'correct') return;
    // line ends: Nf3 has no continuation
    const step3 = trainerStep(rep.lines[0], step2.nodeId ?? ids[2], 'anything');
    expect(step3.status).toBe('line-end');
  });

  it('uses the preferred child over the mainline when marked', () => {
    const { tree } = line(['e4', 'e5']);
    const queensPawn = applySan(tree, null, 'd4'); // root-level alternative to 1. e4
    if (!queensPawn.ok) throw new Error('d4 failed');
    const rep = createRepertoire('R', 'w');
    rep.lines[0].tree = tree;
    setPreferredChild(rep.lines[0], null, queensPawn.id); // prefer 1. d4 over 1. e4
    const keep = trainerStep(rep.lines[0], null, 'd4');
    expect(keep.status).toBe('correct');
    const dev = trainerStep(rep.lines[0], null, 'e4');
    expect(dev.status).toBe('deviation');
    if (dev.status === 'deviation') expect(dev.expectedSan).toBe('d4');
  });

  it('reports trainable positions for the repertoire side', () => {
    const { tree } = line(['e4', 'e5', 'Nf3', 'Nc6']);
    const rep = createRepertoire('R', 'w');
    rep.lines[0].tree = tree;
    // white to move at root and after 1... e5 → two trainable positions
    expect(trainables(rep.lines[0]).length).toBe(2);
  });
});
