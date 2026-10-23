import { beforeEach, describe, expect, it } from 'vitest';
import { addPracticeItem, loadPractice, recordPracticeAttempt, savePractice, type PracticeItem } from './practiceQueue';

beforeEach(() => localStorage.clear());

describe('practice queue', () => {
  const item = {
    kind: 'mistake' as const,
    sourceGameId: 'g1',
    ply: 34,
    fen: '4k3/8/8/8/8/8/8/4K3 w - - 0 1',
    side: 'w' as const,
    objective: 'Find the better move',
    expectedSan: 'Qxd4',
  };

  it('adds, persists, and reloads', () => {
    const list: PracticeItem[] = [];
    const created = addPracticeItem(list, item);
    expect(created).not.toBeNull();
    savePractice(list);
    const loaded = loadPractice();
    expect(loaded.length).toBe(1);
    expect(loaded[0].fen).toBe(item.fen);
    expect(loaded[0].attempts).toBe(0);
  });

  it('prevents duplicate saves from the same game+ply+kind', () => {
    const list: PracticeItem[] = [];
    addPracticeItem(list, item);
    const again = addPracticeItem(list, item);
    expect(again).toBeNull();
    expect(list.length).toBe(1);
    // a different ply saves fine
    expect(addPracticeItem(list, { ...item, ply: 35 })).not.toBeNull();
  });

  it('same position without a source game is a separate key', () => {
    const list: PracticeItem[] = [];
    addPracticeItem(list, item);
    const second = addPracticeItem(list, { ...item, sourceGameId: undefined });
    expect(second?.kind).toBe('mistake');
  });

  it('records attempts and solves', () => {
    const list: PracticeItem[] = [];
    const created = addPracticeItem(list, item)!;
    recordPracticeAttempt(list, created.id, false);
    recordPracticeAttempt(list, created.id, true);
    expect(created.attempts).toBe(2);
    expect(created.solved).toBe(1);
    expect(created.lastPracticed).not.toBeNull();
  });

  it('normalizes malformed persisted payloads', () => {
    localStorage.setItem('gambit.practice.v1', JSON.stringify([{ junk: 1 }, { id: 'ok', fen: 'x', attempts: 'n' }]));
    const loaded = loadPractice();
    expect(loaded.length).toBe(1);
    expect(loaded[0].attempts).toBe(0);
  });
});
