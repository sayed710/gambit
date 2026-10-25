import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { checkedSetJSON, serialize, checkedRemove } from './persist';
import { clearPersistStatus, getFailures, reportPersistFailure, resetPersistStatusForTests } from './persistStatus';
import { ProfileProvider, useProfile } from '../state/ProfileContext';
import type { GameRecord } from './types';
import { buildEmergencyGameFile } from './persist';
import { parseEmergencyGame } from './backup/validate';

/* ============================================================
   PR-A — data-loss protection regressions.
   ============================================================ */

beforeEach(() => {
  localStorage.clear();
  resetPersistStatusForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
  localStorage.clear();
  resetPersistStatusForTests();
});

/* ---------- checkedSetJSON failure classes ---------- */
describe('checkedSetJSON failure classes', () => {
  it('a successful write is verified by read-back', () => {
    expect(checkedSetJSON('probe', { a: 1 })).toEqual({ ok: true });
    expect(JSON.parse(localStorage.getItem('gambit.probe')!)).toEqual({ a: 1 });
  });

  it('a quota rejection is reported as quota — never as success', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'gambit.probe') throw new DOMException('quota', 'QuotaExceededError');
      return real.call(this, key, value);
    };
    try {
      const res = checkedSetJSON('probe', { a: 1 });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.kind).toBe('quota');
      expect(localStorage.getItem('gambit.probe')).toBeNull();
    } finally {
      Storage.prototype.setItem = real;
    }
  });

  it('a silent write/read-back mismatch is detected', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      return real.call(this, key, value.slice(0, 4)); // silently corrupts
    };
    try {
      const res = checkedSetJSON('probe', { a: 1, b: 2 });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.kind).toBe('mismatch');
    } finally {
      Storage.prototype.setItem = real;
    }
  });

  it('unavailable storage (localStorage throws) is its own class', () => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function () {
      throw new DOMException('denied', 'SecurityError');
    };
    try {
      const res = checkedSetJSON('probe', { a: 1 });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.kind).toBe('unavailable');
    } finally {
      Storage.prototype.setItem = real;
    }
  });

  it('serialization failure is its own class', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const res = checkedSetJSON('probe', circular);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.kind).toBe('serialize');
  });

  it('checkedRemove verifies removal', () => {
    localStorage.setItem('gambit.probe', 'x');
    expect(checkedRemove('probe').ok).toBe(true);
    expect(localStorage.getItem('gambit.probe')).toBeNull();
  });

  it('serialize helper reports broken payloads without throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect('error' in serialize(circular)).toBe(true);
    expect('text' in serialize({ a: 1 })).toBe(true);
  });
});

/* ---------- game history: no truncation, honest persistence ---------- */
const TC = { id: '10+0', label: '10 min', category: 'Rapid' as const, minutes: 10, increment: 0 };

function mkGame(id: string, after: number, rated = true): GameRecord {
  return {
    id,
    date: Date.now(),
    mode: 'ai',
    timeControl: TC,
    playerColor: 'w',
    opponentName: 'Engine · Club',
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

describe('game history durability (PR-A)', () => {
  function setup() {
    return renderHook(() => useRecorder(), { wrapper: ProfileProvider });
  }

  it('recording the 51st game preserves the previous 50', () => {
    const { result } = setup();
    act(() => {
      for (let i = 1; i <= 50; i += 1) result.current.recordGame(mkGame(`g${i}`, 1200));
    });
    expect(result.current.profile.games).toHaveLength(50);
    act(() => {
      result.current.recordGame(mkGame('g51', 1200));
    });
    expect(result.current.profile.games).toHaveLength(51);
    const ids = result.current.profile.games.map((g) => g.id);
    expect(ids).toContain('g1'); // oldest kept
    expect(ids).toContain('g51');
  });

  it('recording the 501st game never invokes an automatic deletion rule', () => {
    const { result } = setup();
    act(() => {
      for (let i = 1; i <= 500; i += 1) result.current.recordGame(mkGame(`g${i}`, 1200));
    });
    expect(result.current.profile.games).toHaveLength(500);
    act(() => {
      result.current.recordGame(mkGame('g501', 1200));
    });
    expect(result.current.profile.games).toHaveLength(501);
    const ids = result.current.profile.games.map((g) => g.id);
    expect(ids).toContain('g1'); // the very first game still exists
    expect(ids).toContain('g501');
  });

  it('a quota failure does not falsely acknowledge persistence', () => {
    const { result } = setup();
    // first game persists fine
    act(() => {
      result.current.recordGame(mkGame('kept', 1200));
    });
    expect(JSON.parse(localStorage.getItem('gambit.profile')!).games.map((g: { id: string }) => g.id)).toEqual(['kept']);
    // now storage refuses the profile key
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'gambit.profile') throw new DOMException('quota', 'QuotaExceededError');
      return real.call(this, key, value);
    };
    try {
      act(() => {
        result.current.recordGame(mkGame('lost', 1250));
      });
    } finally {
      Storage.prototype.setItem = real;
    }
    // the failure is observable
    const failures = getFailures();
    expect(failures.some((f) => f.key === 'gambit.profile' && f.kind === 'quota')).toBe(true);
    // saved storage still holds ONLY the verified state (old game preserved)
    const stored = JSON.parse(localStorage.getItem('gambit.profile')!);
    expect(stored.games.map((g: { id: string }) => g.id)).toEqual(['kept']);
    // in memory the new game is NOT lost and NOT claimed as saved
    expect(result.current.profile.games.map((g) => g.id)).toContain('lost');
  });

  it('reload behavior after a failed write: the failed game is absent from storage (honestly surfaced)', () => {
    const { result, rerender } = setup();
    act(() => {
      result.current.recordGame(mkGame('pre', 1200));
    });
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'gambit.profile') throw new DOMException('quota', 'QuotaExceededError');
      return real.call(this, key, value);
    };
    try {
      act(() => {
        result.current.recordGame(mkGame('gone', 1250));
      });
    } finally {
      Storage.prototype.setItem = real;
    }
    // failure state persists across a reload (persisted status store)
    cleanup();
    resetPersistStatusForTests();
    expect(getFailures().some((f) => f.key === 'gambit.profile')).toBe(true);
    // reload: fresh provider reads storage — the failed game is absent (the
    // honest truth) and the provider's verified re-save of the OLD state is
    // consistent, so its success clears the stale failure marker
    const reborn = renderHook(() => useRecorder(), { wrapper: ProfileProvider });
    expect(reborn.result.current.profile.games.map((g) => g.id)).toEqual(['pre']);
    expect(getFailures().some((f) => f.key === 'gambit.profile')).toBe(false);
    void rerender;
  });

  it('a successful write after a failure clears the failure state', () => {
    const { result } = setup();
    const real = Storage.prototype.setItem;
    let fail = true;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'gambit.profile' && fail) throw new DOMException('quota', 'QuotaExceededError');
      return real.call(this, key, value);
    };
    try {
      act(() => {
        result.current.recordGame(mkGame('a', 1200));
      });
      expect(getFailures().length).toBe(1);
      fail = false;
      act(() => {
        result.current.recordGame(mkGame('b', 1210));
      });
      expect(getFailures().length).toBe(0);
      expect(clearPersistStatus).toBeDefined();
    } finally {
      Storage.prototype.setItem = real;
    }
  });
});

/* ---------- persistStatus store ---------- */
describe('persistStatus store', () => {
  it('reports, dedupes per key, and clears on success', () => {
    reportPersistFailure('quota', 'k1', 'profile', 'd1');
    reportPersistFailure('quota', 'k1', 'profile', 'd2'); // same key: replaced
    reportPersistFailure('mismatch', 'k2', 'training', 'd3');
    expect(getFailures()).toHaveLength(2);
    clearPersistStatus('k1');
    expect(getFailures().map((f) => f.key)).toEqual(['k2']);
    clearPersistStatus('k2');
    expect(getFailures()).toHaveLength(0);
  });
});

/* ---------- emergency export/import ---------- */
describe('emergency export/import (PR-A)', () => {
  it('the emergency file contains exactly the game it claims and validates', () => {
    const game = mkGame('emergency-1', 1250);
    const file = buildEmergencyGameFile(game, 'Storage write failed after game completion');
    expect(file).toMatchObject({ app: 'gambit', kind: 'emergency-game', format: 1 });
    const parsed = parseEmergencyGame(JSON.stringify(file));
    expect(parsed.game).toEqual(game);
    expect(parsed.reason).toBe('Storage write failed after game completion');
  });

  it('a tampered emergency file is rejected', () => {
    const file = buildEmergencyGameFile(mkGame('e', 1250), 'r');
    const bad = JSON.parse(JSON.stringify(file));
    bad.game.moves = 'not-a-list';
    expect(() => parseEmergencyGame(JSON.stringify(bad))).toThrow();
  });
});
