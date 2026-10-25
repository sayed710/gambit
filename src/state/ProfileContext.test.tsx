import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { ProfileProvider, useProfile } from '../state/ProfileContext';
import type { GameRecord } from '../lib/types';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function mkGame(id: string, rated: boolean | undefined, after: number): GameRecord {
  return {
    id,
    date: Date.now(),
    mode: 'ai',
    timeControl: { id: '10+0', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 },
    playerColor: 'w',
    opponentName: 'x',
    opponentRating: 1900,
    result: 'win',
    reason: 'checkmate',
    moves: ['e4'],
    pgn: '1. e4',
    ratingBefore: 1200,
    ratingAfter: after,
    rated,
  };
}

function useRecorder() {
  const { profile, recordGame } = useProfile();
  return { profile, recordGame };
}

describe('ratingHistory integrity (PR #4 review)', () => {
  it('consecutive unrated games leave rating/peak/history untouched; one rated game records', () => {
    const { result } = renderHook(() => useRecorder(), { wrapper: ProfileProvider });
    const before = result.current.profile.ratingHistory.slice();
    // two unrated persona games
    act(() => {
      result.current.recordGame(mkGame('u1', false, 1500));
      result.current.recordGame(mkGame('u2', false, 1800));
    });
    expect(result.current.profile.rating).toBe(1200);
    expect(result.current.profile.peakRating).toBe(1200);
    expect(result.current.profile.ratingHistory).toEqual(before);
    // one rated classic game
    act(() => {
      result.current.recordGame(mkGame('r1', true, 1230));
    });
    expect(result.current.profile.rating).toBe(1230);
    expect(result.current.profile.ratingHistory).toEqual([...before, 1230]);
  });

  it('pass-and-play records are explicitly unrated and skip the graph', () => {
    const { result } = renderHook(() => useRecorder(), { wrapper: ProfileProvider });
    const pass: GameRecord = { ...mkGame('p1', false, 1600), mode: 'pass', opponentName: 'Pass & play' };
    act(() => {
      result.current.recordGame(pass);
    });
    expect(result.current.profile.rating).toBe(1200);
    expect(result.current.profile.ratingHistory.at(-1)).toBe(1200);
    expect(result.current.profile.games[0].rated).toBe(false);
  });

  it('legacy records without the rated field are treated as rated', () => {
    const { result } = renderHook(() => useRecorder(), { wrapper: ProfileProvider });
    act(() => {
      result.current.recordGame(mkGame('legacy', undefined, 1260));
    });
    expect(result.current.profile.rating).toBe(1260);
    expect(result.current.profile.ratingHistory.at(-1)).toBe(1260);
  });
});
