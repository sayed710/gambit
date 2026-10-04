import { describe, expect, it } from 'vitest';
import { applySan, createTree } from './gameTree';
import { matchRepertoire, type RepertoireMatchResult } from './repertoireMatch';
import type { Repertoire } from './repertoireStore';

function buildLine(sans: string[]) {
  const tree = createTree();
  let parent: string | null = null;
  for (const san of sans) {
    const r = applySan(tree, parent, san);
    if (!r.ok) throw new Error(`illegal ${san}`);
    parent = r.id;
  }
  return { id: 'l1', name: 'Main', tree, preferred: {} as Record<string, string> };
}

function rep(side: 'w' | 'b', lines: ReturnType<typeof buildLine>[]): Repertoire {
  return { id: 'r1', name: 'R', side, createdAt: 1, updatedAt: 1, lines };
}

/** 1.e4 c5 2.Nf3 d6 — a compact Sicilian repertoire line. */
const SICILIANS = buildLine(['e4', 'c5', 'Nf3', 'd6', 'd4']);

describe('repertoireMatch — games vs repertoire', () => {
  it('full follow: all plies counted, no deviation', () => {
    const r: RepertoireMatchResult | null = matchRepertoire([rep('w', [SICILIANS])], 'w', ['e4', 'c5', 'Nf3', 'd6']);
    expect(r?.followedPlies).toBe(4);
    expect(r?.deviation).toBeNull();
  });

  it('user deviation: expected repertoire move is reported with the FEN', () => {
    const r = matchRepertoire([rep('w', [SICILIANS])], 'w', ['e4', 'c5', 'Nf3', 'd6', 'Qd3']);
    expect(r?.deviation?.who).toBe('user');
    expect(r?.deviation?.ply).toBe(5);
    expect(r?.deviation?.playedSan).toBe('Qd3');
    expect(r?.deviation?.expectedSan).toBe('d4');
    expect(r?.followedPlies).toBe(4);
  });

  it('opponent deviation: the player is not blamed', () => {
    const r = matchRepertoire([rep('w', [SICILIANS])], 'w', ['e4', 'e5']);
    expect(r?.deviation?.who).toBe('opponent');
    expect(r?.deviation?.ply).toBe(2);
    expect(r?.deviation?.playedSan).toBe('e5');
    expect(r?.followedPlies).toBe(1);
  });

  it('preferred branch is respected over first-child order', () => {
    const line = buildLine(['e4', 'e5', 'Nf3']);
    applySan(line.tree, null, 'd4'); // second root branch
    const d4 = line.tree.moves[1];
    applySan(line.tree, d4.id, 'd5'); // black's answer inside the d4 branch
    line.preferred = { __root__: d4.id };
    const r = matchRepertoire([rep('w', [line])], 'w', ['d4', 'd5']);
    expect(r?.deviation).toBeNull(); // 1. d4 followed — preferred, not first child
    expect(r?.followedPlies).toBe(2);
    // and 1. e4 now counts as a user deviation
    const r2 = matchRepertoire([rep('w', [line])], 'w', ['e4', 'e5']);
    expect(r2?.deviation?.who).toBe('user');
    expect(r2?.deviation?.expectedSan).toBe('d4');
  });

  it('deepest matching line wins across repertoires', () => {
    const shallow = buildLine(['e4']);
    const r = matchRepertoire([rep('w', [shallow]), rep('w', [SICILIANS])], 'w', ['e4', 'c5', 'Nf3', 'd6']);
    expect(r?.followedPlies).toBe(4); // Sicilian line, not the 1-ply e4 line
  });

  it('no same-color repertoire returns null', () => {
    expect(matchRepertoire([rep('b', [SICILIANS])], 'w', ['e4'])).toBeNull();
  });

  it('line exhausted: followed to the end; an opponent move after it is an honest exit', () => {
    const r = matchRepertoire([rep('w', [SICILIANS])], 'w', ['e4', 'c5', 'Nf3', 'd6', 'd4', 'Nf6']);
    expect(r?.followedPlies).toBe(5);
    // the line ends after 5 plies — black's Nf6 is outside the book (spec §19)
    expect(r?.deviation?.who).toBe('opponent');
    expect(r?.deviation?.ply).toBe(6);
    expect(r?.deviation?.expectedSan).toBeNull();
  });
});
