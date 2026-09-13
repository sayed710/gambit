import { beforeEach, describe, expect, it } from 'vitest';
import { filterGames, loadLibraryMeta, normalizeLibraryMeta, saveLibraryMeta, toggleFavorite, type LibraryMeta } from './libraryStore';
import type { GameRecord } from './types';

function game(partial: Partial<GameRecord>): GameRecord {
  return {
    id: 'g1',
    date: Date.now(),
    mode: 'ai',
    timeControl: { id: '10+0', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 },
    playerColor: 'w',
    opponentName: 'Engine · Casual',
    opponentRating: 1400,
    result: 'win',
    reason: 'checkmate',
    moves: ['e4', 'e5'],
    pgn: '1. e4 e5',
    ratingBefore: 1200,
    ratingAfter: 1216,
    ...partial,
  };
}

beforeEach(() => localStorage.clear());

describe('library metadata store', () => {
  it('normalizes malformed payloads into an empty meta', () => {
    localStorage.setItem('gambit.library.v1', JSON.stringify({ tags: 'nope', favorites: 3, notes: [] }));
    const meta = loadLibraryMeta();
    expect(meta.tags).toEqual({});
    expect(meta.favorites).toEqual([]);
    expect(meta.notes).toEqual({});
  });

  it('round trips tags, notes and favorites', () => {
    const meta: LibraryMeta = { tags: { g1: ['sicilian', 'good game'] }, notes: { g1: 'watch the h4 idea' }, favorites: ['g1'] };
    saveLibraryMeta(meta);
    expect(loadLibraryMeta()).toEqual(meta);
  });

  it('toggleFavorite adds and removes', () => {
    const meta = normalizeLibraryMeta(undefined);
    toggleFavorite(meta, 'g1');
    expect(meta.favorites).toEqual(['g1']);
    toggleFavorite(meta, 'g1');
    expect(meta.favorites).toEqual([]);
  });
});

describe('library filters', () => {
  const games: GameRecord[] = [
    game({ id: 'a', result: 'win', mode: 'ai', opponentName: 'Engine · Gentle', date: Date.parse('2026-01-05') }),
    game({
      id: 'b',
      result: 'loss',
      mode: 'pass',
      opponentName: 'Anna',
      date: Date.parse('2026-03-10'),
      timeControl: { id: '3+0', label: '3 min', category: 'Blitz', minutes: 3, increment: 0 },
    }),
    game({ id: 'c', result: 'win', mode: 'ai', opponentName: 'Engine · Sharp', date: Date.parse('2026-06-01') }),
  ];

  it('searches across opponent names and move text', () => {
    expect(filterGames(games, { q: 'anna' }).map((g) => g.id)).toEqual(['b']);
    expect(filterGames(games, { q: 'Nf3' }).map((g) => g.id)).toEqual([]);
    expect(filterGames(games, { q: 'E5' }).map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters by result, mode and favorites', () => {
    const meta: LibraryMeta = { tags: {}, notes: {}, favorites: ['c'] };
    expect(filterGames(games, { result: 'win' }).map((g) => g.id)).toEqual(['a', 'c']);
    expect(filterGames(games, { mode: 'pass' }).map((g) => g.id)).toEqual(['b']);
    expect(filterGames(games, { favoritesOnly: true, favorites: meta.favorites }).map((g) => g.id)).toEqual(['c']);
  });

  it('filters by time-control category and date range', () => {
    expect(filterGames(games, { tc: 'Rapid' }).length).toBe(2);
    expect(filterGames(games, { from: Date.parse('2026-02-01') }).map((g) => g.id)).toEqual(['b', 'c']);
    expect(filterGames(games, { to: Date.parse('2026-02-01') }).map((g) => g.id)).toEqual(['a']);
  });

  it('filters by tag', () => {
    const meta: LibraryMeta = { tags: { b: ['sofa'] }, notes: {}, favorites: [] };
    expect(filterGames(games, { tag: 'sofa', tags: meta.tags }).map((g) => g.id)).toEqual(['b']);
  });
});
