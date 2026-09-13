import { describe, expect, it, vi } from 'vitest';
import {
  applySan,
  createTree,
  deleteMove,
  fromPgn,
  lineTo,
  mainline,
  promote,
  setComment,
  toggleNag,
  toPgn,
  treeKey,
  type GameTreeData,
} from './gameTree';

/** Build a tree from a SAN sequence, returning the tree and last id. */
function line(sans: string[], startFen?: string): { tree: GameTreeData; ids: string[] } {
  const tree = createTree(startFen);
  const ids: string[] = [];
  let parent: string | null = null;
  for (const san of sans) {
    const r = applySan(tree, parent, san);
    if (!r.ok) throw new Error(`illegal ${san}`);
    ids.push(r.id);
    parent = r.id;
  }
  return { tree, ids };
}

describe('variation tree — moves', () => {
  it('builds a mainline with correct fens and move numbers', () => {
    const { tree, ids } = line(['e4', 'e5', 'Nf3']);
    const ml = mainline(tree);
    expect(ml.map((n) => n.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(ml[0].moveNumber).toBe(1);
    expect(ml[0].color).toBe('w');
    expect(ml[1].moveNumber).toBe(1);
    expect(ml[1].color).toBe('b');
    expect(ml[2].moveNumber).toBe(2);
    // fen after e4 is the known position
    expect(lineTo(tree, ids[0]).length).toBe(1);
    expect(ml[0].fenAfter.split(' ')[0]).toBe(
      'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR',
    );
    expect(ml[2].fenAfter.split(' ')[1]).toBe('b');
  });

  it('rejects illegal moves without mutating the tree', () => {
    const tree = createTree();
    expect(applySan(tree, null, 'Ke2').ok).toBe(false);
    expect(tree.moves.length).toBe(0);
  });

  it('dedupes a repeated move among siblings', () => {
    const { tree, ids } = line(['e4']);
    const again = applySan(tree, ids[0], 'e5');
    const dupe = applySan(tree, ids[0], 'e5');
    expect(again.ok).toBe(true);
    expect(dupe.ok).toBe(true);
    if (again.ok && dupe.ok) expect(again.id).toBe(dupe.id);
    const kids = tree.moves[0].children;
    expect(kids.filter((k) => k.san === 'e5').length).toBe(1);
  });
});

describe('variation tree — structure ops', () => {
  it('adds a side variation as a second child, mainline first', () => {
    const { tree, ids } = line(['e4', 'e5', 'Nf3']);
    const alt = applySan(tree, ids[0], 'c5'); // alternative to 1... e5
    expect(alt.ok).toBe(true);
    expect(tree.moves[0].children.map((c) => c.san)).toEqual(['e5', 'c5']);
    expect(mainline(tree).map((n) => n.san)).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('nests variations below a variation move', () => {
    const { tree, ids } = line(['e4', 'e5']);
    const sicilian = applySan(tree, ids[0], 'c5');
    expect(sicilian.ok).toBe(true);
    if (!sicilian.ok) return;
    const deep = applySan(tree, sicilian.id, 'Nf3');
    expect(deep.ok).toBe(true);
    const varNode = tree.moves[0].children[1];
    expect(varNode.children.map((c) => c.san)).toEqual(['Nf3']);
    // mainline untouched
    expect(mainline(tree).map((n) => n.san)).toEqual(['e4', 'e5']);
  });

  it('promotes a variation to the mainline', () => {
    const { tree, ids } = line(['d4', 'd5', 'c4']);
    const alt = applySan(tree, ids[0], 'Nf6'); // alternative to 1... d5
    expect(alt.ok).toBe(true);
    expect(tree.moves[0].children.map((c) => c.san)).toEqual(['d5', 'Nf6']);
    // promote Nf6 above d5
    expect(promote(tree, alt.ok ? alt.id : '')).toBe(true);
    expect(tree.moves[0].children.map((c) => c.san)).toEqual(['Nf6', 'd5']);
    expect(mainline(tree).map((n) => n.san)).toEqual(['d4', 'Nf6']);
    // promoting the first child is a no-op
    expect(promote(tree, tree.moves[0].children[0].id)).toBe(false);
  });

  it('deletes a variation subtree without touching the rest', () => {
    const { tree, ids } = line(['e4', 'e5', 'Nf3']);
    const alt = applySan(tree, ids[0], 'c5');
    if (!alt.ok) throw new Error('alt failed');
    applySan(tree, alt.id, 'Nf3');
    deleteMove(tree, alt.id);
    expect(tree.moves[0].children.map((c) => c.san)).toEqual(['e5']);
    expect(mainline(tree).map((n) => n.san)).toEqual(['e4', 'e5', 'Nf3']);
    expect(lineTo(tree, alt.id)).toEqual([]);
  });
});

describe('variation tree — annotations', () => {
  it('sets comments and toggles NAGs', () => {
    const { tree, ids } = line(['e4']);
    setComment(tree, ids[0], 'Best by test');
    toggleNag(tree, ids[0], '!');
    toggleNag(tree, ids[0], '!');
    expect(tree.moves[0].comment).toBe('Best by test');
    expect(tree.moves[0].nags).toEqual([]);
    toggleNag(tree, ids[0], '!?');
    expect(tree.moves[0].nags).toEqual(['!?']);
  });
});

describe('PGN with variations — import/export round trip', () => {
  const PGN = [
    '[Event "Spec"]',
    '[White "A"]',
    '[Black "B"]',
    '[Result "*"]',
    '',
    '1. e4 e5 (1... c5 2. Nf3 {Sicilian} 2... d6 (2... Nc6 3. d4)) (1... e6 2. d4) 2. Nf3 Nc6 $4 {Open game.} *',
  ].join('\n');

  it('parses mainline, side variations, nested variations, comments and NAGs', () => {
    const { tree, headers } = fromPgn(PGN);
    expect(headers.White).toBe('A');
    expect(mainline(tree).map((n) => n.san)).toEqual(['e4', 'e5', 'Nf3', 'Nc6']);
    const e5Kids = tree.moves[0].children;
    expect(e5Kids.map((c) => c.san)).toEqual(['e5', 'c5', 'e6']);
    const sicilian = e5Kids[1];
    const nf3 = sicilian.children[0];
    expect(nf3.san).toBe('Nf3');
    expect(nf3.comment).toBe('Sicilian');
    // (2... d6 (2... Nc6 3. d4)): the paren block is an alternative to d6
    expect(nf3.children.map((c) => c.san)).toEqual(['d6', 'Nc6']);
    expect(nf3.children[1].children.map((c) => c.san)).toEqual(['d4']);
    // NAG on Nc6 (mainline)
    expect(mainline(tree)[3].nags).toEqual(['??']);
    expect(mainline(tree)[3].comment).toBe('Open game.');
  });

  it('exports variations, comments and NAGs that re-import to the same tree', () => {
    const { tree } = fromPgn(PGN);
    const pgn = toPgn(tree, { Event: 'Spec', White: 'A', Black: 'B', Result: '*' });
    const again = fromPgn(pgn);
    expect(treeKey(again.tree)).toBe(treeKey(tree));
  });

  it('round trips a plain game without annotations', () => {
    const { tree, ids } = line(['e4', 'c5', 'Nf3', 'd6']);
    setComment(tree, ids[3], 'Old Sicilian');
    const pgn = toPgn(tree, { Event: 'X' });
    const again = fromPgn(pgn);
    expect(treeKey(again.tree)).toBe(treeKey(tree));
    expect(mainline(again.tree).map((n) => n.san)).toEqual(['e4', 'c5', 'Nf3', 'd6']);
  });

  it('round trips a game from a custom start position', () => {
    // K+Q vs K: white to mate in one
    const fen = 'k7/8/2K5/8/8/8/8/1Q6 w - - 0 1';
    const { tree } = line(['Qb7#'], fen);
    const pgn = toPgn(tree, { Event: 'Custom' });
    expect(pgn).toContain('[FEN "k7/8/2K5/8/8/8/8/1Q6 w - - 0 1"]');
    expect(pgn).toContain('[SetUp "1"]');
    const again = fromPgn(pgn);
    expect(again.tree.startFen).toBe(fen);
    expect(treeKey(again.tree)).toBe(treeKey(tree));
  });
});

describe('tree ids — persistence safety', () => {
  it('new ids never collide with ids stored before a reload', async () => {
    // 1. create a tree with the current module instance and "store" it
    await import('./gameTree');
    const stored = JSON.stringify(line(['e4', 'e5', 'Nf3']).tree);

    // 2. simulate a browser reload: reset module state, re-import, reload the tree
    vi.resetModules();
    const second = await import('./gameTree');
    const revived = JSON.parse(stored) as GameTreeData;

    // 3. add more moves and a side variation with the fresh module
    let parent: string | null = revived.moves[0].children[0].id;
    const r1 = second.applySan(revived, parent, 'Nf3');
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = second.applySan(revived, r1.id, 'Nc6');
    expect(r2.ok).toBe(true);
    const mainlineEnd = second.mainline(revived);
    parent = mainlineEnd[mainlineEnd.length - 1].id;
    const r3 = second.applySan(revived, parent, 'Bb5');
    expect(r3.ok).toBe(true);

    // 4. every node id in the whole tree is unique
    const ids: string[] = [];
    const stack = [...revived.moves];
    while (stack.length) {
      const n = stack.pop()!;
      ids.push(n.id);
      stack.push(...n.children);
    }
    expect(new Set(ids).size).toBe(ids.length);

    // 5. add a real side variation at the root, then annotate it
    const sideVar = second.applySan(revived, null, 'd4'); // legal root alternative to 1. e4
    expect(sideVar.ok).toBe(true);
    const altTarget = revived.moves[1]; // root-level sibling of 1. e4
    expect(altTarget?.san).toBe('d4');
    second.setComment(revived, altTarget.id, 'side variation');
    expect(altTarget.comment).toBe('side variation');
    expect(second.lineTo(revived, altTarget.id).map((n) => n.san)).toEqual(['d4']);
  });
});

describe('underpromotion', () => {
  function startWithPromotionLine(): { tree: GameTreeData; ids: string[] } {
    const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1'; // a7 pawn one step from promoting
    const tree = createTree(fen);
    const ids: string[] = [];
    let parent: string | null = null;
    for (const san of ['a8=N', 'Kg8']) {
      const r = applySan(tree, parent, san);
      if (!r.ok) throw new Error(`illegal ${san}`);
      parent = r.id;
      ids.push(r.id);
    }
    return { tree, ids };
  }

  it('records knight promotion with correct SAN and FEN', () => {
    const { tree } = startWithPromotionLine();
    const node = tree.moves[0];
    expect(node.san).toBe('a8=N');
    expect(node.promotion).toBe('n');
    expect(node.fenAfter.split(' ')[0]).toContain('N7'); // knight sits on a8
  });

  it('supports rook and bishop promotions', () => {
    const fen = '8/P6k/8/8/8/8/8/K7 w - - 0 1';
    for (const san of ['a8=R', 'a8=B']) {
      const tree = createTree(fen);
      const r = applySan(tree, null, san);
      expect(r.ok).toBe(true);
      expect(tree.moves[0].san).toBe(san);
    }
  });

  it('handles capture promotions', () => {
    const fen = '1n5k/P7/8/8/8/8/8/K7 w - - 0 1';
    const tree = createTree(fen);
    const r = applySan(tree, null, 'axb8=Q+');
    expect(r.ok).toBe(true);
    expect(tree.moves[0].san).toBe('axb8=Q+');
  });

  it('keeps underpromotion through a PGN round trip', () => {
    const { tree } = startWithPromotionLine();
    const pgn = toPgn(tree, { Event: 'Promo' });
    expect(pgn).toContain('a8=N');
    const again = fromPgn(pgn);
    expect(treeKey(again.tree)).toBe(treeKey(tree));
    expect(again.tree.moves[0].promotion).toBe('n');
  });
});
