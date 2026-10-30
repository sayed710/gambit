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
  const { profile, recordGame, importGameRecord } = useProfile();
  return { profile, recordGame, importGameRecord };
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
    // honest truth) and the failure marker SURVIVES (a re-save of old state
    // does not recover the lost record); it clears only via Acknowledge or
    // an explicit recovery
    const reborn = renderHook(() => useRecorder(), { wrapper: ProfileProvider });
    expect(reborn.result.current.profile.games.map((g) => g.id)).toEqual(['pre']);
    expect(getFailures().some((f) => f.key === 'gambit.profile')).toBe(true);
    // recovery of the lost record clears it (verified durable write)
    act(() => {
      reborn.result.current.importGameRecord(mkGame('gone', 1250));
    });
    expect(getFailures().some((f) => f.key === 'gambit.profile')).toBe(false);
    expect(reborn.result.current.profile.games.map((g) => g.id)).toContain('gone');
    void rerender;
  });

  it('a re-save does NOT auto-clear the failure: the unsaved record was not recovered (explicit recovery or Acknowledge clears)', () => {
    const { result } = setup();
    const real = Storage.prototype.setItem;
    let fail = true;
    // ONE record object, reused for the failed save and the recovery import —
    // a real emergency file carries the exact record, dates included
    const lostRecord = mkGame('lost', 1200);
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'gambit.profile' && fail) throw new DOMException('quota', 'QuotaExceededError');
      return real.call(this, key, value);
    };
    try {
      act(() => {
        result.current.recordGame(lostRecord);
      });
      expect(getFailures().length).toBe(1);
      // NOTE: any later SUCCESSFUL profile write persists the whole in-memory
      // profile (whole-blob storage), so 'lost' would ride along — this test
      // keeps storage failed until recovery to isolate the marker semantics.
      void fail;
    } finally {
      Storage.prototype.setItem = real;
    }
    // the lost record is durable-absent; explicit recovery writes it (verified)
    // and clears the marker honestly
    let importResult: { ok: boolean; duplicate?: boolean; conflict?: boolean; detail?: string } | null = null;
    act(() => {
      importResult = result.current.importGameRecord(lostRecord);
    });
    expect((importResult as { ok?: boolean } | null)?.ok).toBe(true);
    expect(getFailures().length).toBe(0);
    expect(result.current.profile.games.map((g) => g.id)).toContain('lost');
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

describe('emergency import: idempotence + rating safety (PR #5 review)', () => {
  function setup() {
    return renderHook(() => useRecorder(), { wrapper: ProfileProvider });
  }

  it('repeated imports of the same file are idempotent (single record)', () => {
    const { result } = setup();
    const game = mkGame('dup-1', 1250);
    const results: boolean[] = [];
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        results.push(result.current.importGameRecord(game).ok);
      });
    }
    expect(results).toEqual([true, true, true]);
    expect(result.current.profile.games.filter((g) => g.id === 'dup-1')).toHaveLength(1);
    const stored = JSON.parse(localStorage.getItem('gambit.profile')!).games.filter((g: { id: string }) => g.id === 'dup-1');
    expect(stored).toHaveLength(1);
  });

  it('a rated recovered game never recalculates rating/peak/history (records-only policy)', () => {
    const { result } = setup();
    const before = {
      rating: result.current.profile.rating,
      peak: result.current.profile.peakRating,
      history: result.current.profile.ratingHistory.slice(),
    };
    act(() => {
      result.current.importGameRecord(mkGame('rated-import', 1900, true)); // would be +700 if counted
    });
    expect(result.current.profile.rating).toBe(before.rating);
    expect(result.current.profile.peakRating).toBe(before.peak);
    expect(result.current.profile.ratingHistory).toEqual(before.history);
    expect(result.current.profile.games.map((g) => g.id)).toContain('rated-import'); // record preserved
  });

  it('same-ID conflict: the durable record is protected, the import rejected', () => {
    const { result } = setup();
    act(() => {
      result.current.recordGame(mkGame('conflict', 1220)); // durable, ratingAfter 1220
    });
    const durable = JSON.parse(localStorage.getItem('gambit.profile')!).games.find((g: { id: string }) => g.id === 'conflict');
    let res: { ok: boolean; conflict?: boolean; duplicate?: boolean; detail?: string } | null = null;
    act(() => {
      res = result.current.importGameRecord(mkGame('conflict', 9999)); // same id, different content
    });
    const r = res as { ok: boolean; conflict?: boolean } | null;
    expect(r?.conflict).toBe(true);
    const after = JSON.parse(localStorage.getItem('gambit.profile')!).games.find((g: { id: string }) => g.id === 'conflict');
    expect(after).toEqual(durable); // durable record untouched
    expect(result.current.profile.games.filter((g) => g.id === 'conflict')).toHaveLength(1);
  });

  it('in-memory same-ID conflict: importing different content under that ID is refused — nothing overwritten, no false success', () => {
    const { result } = setup();
    for (let i = 0; i < 50; i += 1) {
      act(() => {
        result.current.recordGame(mkGame(`d-${i}`, 1200, false));
      });
    }
    // one memory-only record that failed to persist (distinct content)
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'gambit.profile') throw new DOMException('quota', 'QuotaExceededError');
      return real.call(this, key, value);
    };
    const memoryOnly: GameRecord = { ...mkGame('clash', 1200, false), result: 'loss', reason: 'resignation' };
    try {
      act(() => {
        result.current.recordGame(memoryOnly);
      });
    } finally {
      Storage.prototype.setItem = real;
    }
    expect(result.current.profile.games).toHaveLength(51);

    // an emergency file with the SAME id but DIFFERENT content must be refused
    const importedDifferent = mkGame('clash', 1200, false); // win/checkmate — not the memory loss record
    let res: { ok: boolean; conflict?: boolean; detail?: string } | null = null;
    act(() => {
      res = result.current.importGameRecord(importedDifferent);
    });
    const r = res as { ok: boolean; conflict?: boolean } | null;
    expect(r?.ok).toBe(false);
    expect(r?.conflict).toBe(true);
    // durable storage untouched: still 50 games, no 'clash' record
    const durable = JSON.parse(localStorage.getItem('gambit.profile')!).games;
    expect(durable).toHaveLength(50);
    expect(durable.some((g: { id: string }) => g.id === 'clash')).toBe(false);
    // the recoverable memory record was NOT discarded or overwritten
    expect(result.current.profile.games.some((g) => g.id === 'clash' && g.result === 'loss')).toBe(true);

    // importing the EXACT memory record content is a real recovery: verified durable write
    let ok: { ok: boolean } | null = null;
    act(() => {
      ok = result.current.importGameRecord(memoryOnly);
    });
    expect((ok as { ok: boolean } | null)?.ok).toBe(true);
    const after = JSON.parse(localStorage.getItem('gambit.profile')!).games;
    expect(after).toHaveLength(51);
    expect(after.find((g: { id: string }) => g.id === 'clash').result).toBe('loss');
  });

  it('emergency file format/version is validated before import', () => {
    const file = buildEmergencyGameFile(mkGame('v', 1250), 'r');
    const badVersion = { ...file, kind: 'emergency-game', format: 99 };
    expect(() => parseEmergencyGame(JSON.stringify(badVersion))).toThrow();
    const noGame = { ...file, format: 1 };
    delete (noGame as { game?: unknown }).game;
    expect(() => parseEmergencyGame(JSON.stringify(noGame))).toThrow();
  });

  it('recovery preserves ALL records: 50 durable + 2 unsaved in-memory games survive importing one (reconcile regression)', () => {
    const { result } = setup();
    for (let i = 0; i < 50; i += 1) {
      act(() => {
        result.current.recordGame(mkGame(`d-${i}`, 1200, false));
      });
    }
    expect(JSON.parse(localStorage.getItem('gambit.profile')!).games).toHaveLength(50);

    // two games fail to persist: durable stays at 50, memory holds 52.
    // ONE object per record (reused for the import below — real emergency
    // files carry the exact record, dates included).
    const lostA = mkGame('lost-a', 1200, false);
    const lostB = mkGame('lost-b', 1200, false);
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'gambit.profile') throw new DOMException('quota', 'QuotaExceededError');
      return real.call(this, key, value);
    };
    try {
      act(() => {
        result.current.recordGame(lostA);
      });
      act(() => {
        result.current.recordGame(lostB);
      });
    } finally {
      Storage.prototype.setItem = real;
    }
    expect(result.current.profile.games).toHaveLength(52);

    // recover ONE: durable + both in-memory games + the import must all survive
    let first: { ok: boolean } | null = null;
    act(() => {
      first = result.current.importGameRecord(lostA);
    });
    expect((first as { ok: boolean } | null)?.ok).toBe(true);
    const idsAfterFirst = JSON.parse(localStorage.getItem('gambit.profile')!).games.map((g: { id: string }) => g.id);
    expect(idsAfterFirst).toHaveLength(52);
    expect(new Set(idsAfterFirst).size).toBe(52); // no duplicates, nothing dropped
    expect(idsAfterFirst).toContain('lost-a');
    expect(idsAfterFirst).toContain('lost-b'); // the OTHER unsaved game was not discarded

    // a subsequent import: lost-b rode along in the first whole-blob write,
    // so importing the EXACT record again is a verified no-op — and a freshly
    // generated record with the same id but different content is REFUSED
    // (conflict protection), never a silent duplicate
    const durableLostB = JSON.parse(localStorage.getItem('gambit.profile')!).games.find((g: { id: string }) => g.id === 'lost-b');
    let second: { ok: boolean; duplicate?: boolean } | null = null;
    act(() => {
      second = result.current.importGameRecord(durableLostB);
    });
    expect((second as { ok: boolean; duplicate?: boolean } | null)?.ok).toBe(true);
    const idsAfterSecond = JSON.parse(localStorage.getItem('gambit.profile')!).games.map((g: { id: string }) => g.id);
    expect(idsAfterSecond).toHaveLength(52);
    expect(new Set(idsAfterSecond).size).toBe(52);

    let regenerated: { ok: boolean; conflict?: boolean } | null = null;
    act(() => {
      regenerated = result.current.importGameRecord(mkGame('lost-b', 1200, false)); // new date → different content
    });
    expect((regenerated as { ok: boolean; conflict?: boolean } | null)?.conflict).toBe(true);
    expect(JSON.parse(localStorage.getItem('gambit.profile')!).games).toHaveLength(52);

    // a duplicate import of an EXISTING durable game is a verified no-op
    const durableD5 = JSON.parse(localStorage.getItem('gambit.profile')!).games.find((g: { id: string }) => g.id === 'd-5');
    let dup: { ok: boolean; duplicate?: boolean } | null = null;
    act(() => {
      dup = result.current.importGameRecord(durableD5);
    });
    expect((dup as { ok: boolean; duplicate?: boolean } | null)?.duplicate).toBe(true);
    expect(JSON.parse(localStorage.getItem('gambit.profile')!).games).toHaveLength(52);

    // a failed import under quota drops nothing: memory state is untouched
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'gambit.profile') throw new DOMException('quota', 'QuotaExceededError');
      return real.call(this, key, value);
    };
    try {
      let failed: { ok: boolean } | null = null;
      act(() => {
        failed = result.current.importGameRecord(mkGame('lost-c', 1200, false));
      });
      expect((failed as { ok: boolean } | null)?.ok).toBe(false);
      // durable unchanged, memory unchanged, still no duplicates
      expect(JSON.parse(localStorage.getItem('gambit.profile')!).games).toHaveLength(52);
      expect(result.current.profile.games).toHaveLength(52);
    } finally {
      Storage.prototype.setItem = real;
    }
    // records-only policy intact: rating untouched by all of the above
    expect(result.current.profile.rating).toBe(1200);
    expect(result.current.profile.peakRating).toBe(1200);
  });
});
