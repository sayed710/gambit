import { beforeEach, describe, expect, it } from 'vitest';
import { applySan, createTree, treeKey } from './gameTree';
import {
  createChapter,
  createStudy,
  duplicateChapter,
  loadStudies,
  normalizeStudyList,
  saveStudies,
  type Study,
} from './studyStore';

function line(sans: string[]): ReturnType<typeof createTree> {
  const tree = createTree();
  let parent: string | null = null;
  for (const san of sans) {
    const r = applySan(tree, parent, san);
    if (!r.ok) throw new Error(`illegal ${san}`);
    parent = r.id;
  }
  return tree;
}

beforeEach(() => {
  localStorage.clear();
});

describe('study store', () => {
  it('creates a study with one untitled chapter', () => {
    const study = createStudy('Ruy Lopez ideas');
    expect(study.title).toBe('Ruy Lopez ideas');
    expect(study.chapters.length).toBe(1);
    expect(study.chapters[0].name).toBe('Chapter 1');
    expect(study.chapters[0].tree.moves.length).toBe(0);
  });

  it('saves and loads without loss', () => {
    const study = createStudy('Test');
    study.chapters[0].tree = line(['e4', 'e5']);
    saveStudies([study]);
    const loaded = loadStudies();
    expect(loaded.length).toBe(1);
    expect(treeKey(loaded[0].chapters[0].tree)).toBe(treeKey(study.chapters[0].tree));
    expect(loaded[0].title).toBe('Test');
  });

  it('skips malformed entries when loading (migration safety)', () => {
    localStorage.setItem(
      'gambit.studies.v1',
      JSON.stringify([{ junk: true }, { id: 's2', title: 'Keep', createdAt: 1, updatedAt: 1, chapters: [] }]),
    );
    const loaded = loadStudies();
    expect(loaded.length).toBe(1);
    expect(loaded[0].id).toBe('s2');
  });

  it('normalizes a study missing chapters into one empty chapter', () => {
    const fixed = normalizeStudyList([
      { id: 'x', title: 'No chapters', createdAt: 1, updatedAt: 2, chapters: null } as unknown as Study,
    ]);
    expect(fixed[0].chapters.length).toBe(1);
    expect(fixed[0].chapters[0].tree.moves).toEqual([]);
  });

  it('duplicates a chapter with a fresh id and copied tree', () => {
    const study = createStudy('D');
    study.chapters[0].tree = line(['d4', 'd5']);
    const dup = duplicateChapter(study, study.chapters[0].id);
    expect(dup).not.toBeNull();
    expect(study.chapters.length).toBe(2);
    expect(study.chapters[1].id).not.toBe(study.chapters[0].id);
    expect(study.chapters[1].name).toContain('copy');
    expect(treeKey(study.chapters[1].tree)).toBe(treeKey(study.chapters[0].tree));
  });

  it('createChapter names sequentially', () => {
    const study = createStudy('C');
    createChapter(study, 'Caro Kann structures');
    expect(study.chapters[1].name).toBe('Caro Kann structures');
    createChapter(study, 'Caro Kann structures');
    expect(study.chapters[2].name).toBe('Caro Kann structures (2)');
  });
});
