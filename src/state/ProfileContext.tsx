import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameRecord } from '../lib/types';
import { loadJSON } from '../lib/storage';
import { checkedSetJSON } from '../lib/persist';
import { clearPersistStatus, reportPersistFailure } from '../lib/persistStatus';

interface PuzzleStats {
  rating: number;
  solved: number;
  failed: number;
  bestStreak: number;
  byTheme?: Record<string, { solved: number; failed: number }>;
}

interface ProfileData {
  joined: number;
  rating: number; // play rating (vs engine & friends)
  peakRating: number;
  ratingHistory: number[]; // after each rated game
  games: GameRecord[];
  puzzle: PuzzleStats;
}

const DEFAULT_PROFILE: ProfileData = {
  joined: Date.now(),
  rating: 1200,
  peakRating: 1200,
  ratingHistory: [1200],
  games: [],
  puzzle: { rating: 1200, solved: 0, failed: 0, bestStreak: 0 },
};

interface ProfileContextValue {
  profile: ProfileData;
  recordGame: (record: GameRecord) => void;
  importGameRecord: (record: GameRecord) => { ok: boolean; duplicate?: boolean; conflict?: boolean; detail?: string };
  recordPuzzle: (solved: boolean, puzzleRating: number, streak: number, theme?: string) => void;
  deleteGame: (id: string) => void;
  togglePin: (id: string) => void;
  resetAll: () => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<ProfileData>(() => ({ ...DEFAULT_PROFILE, ...loadJSON('profile', {}) }));
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useEffect(() => {
    // CRITICAL write: verified (write + read-back). A browser rejection is
    // never reported as saved — it is surfaced via persistStatus (banner).
    // NOTE: a successful RE-SAVE deliberately does NOT clear previous
    // failure markers — rewriting old state does not recover the record
    // that was lost. Markers clear only via explicit recovery
    // (importGameRecord) or the banner's Acknowledge button.
    const res = checkedSetJSON('profile', profile);
    if (!res.ok) reportPersistFailure(res.kind, 'gambit.profile', 'profile', res.detail);
  }, [profile]);

  const recordGame = useCallback((record: GameRecord) => {
    setProfile((p) => {
      // rating integrity: unrated games (personas, pass & play) persist with
      // full data but never touch rating/peakRating/ratingHistory. Legacy
      // records without the field are treated as rated (backward compatible).
      const isRated = record.rated !== false;
      const rating = isRated ? record.ratingAfter : p.rating;
      return {
        ...p,
        rating,
        peakRating: Math.max(p.peakRating, rating),
        ratingHistory: isRated ? [...p.ratingHistory.slice(-99), rating] : p.ratingHistory,
        // NEVER truncate: the oldest game is user history, not garbage.
        // Capacity problems surface through verified persistence failures
        // (persistStatus) instead of silent deletion.
        games: [record, ...p.games],
      };
    });
  }, []);

  /**
   * PR-A: verified, IDEMPOTENT, rating-safe import of a recovered
   * historical game (emergency files). Durable write happens FIRST,
   * outside any state updater; React state updates only after the
   * durable write is verified. Rating policy (documented): recovered
   * games are records-only — current rating, peak and ratingHistory are
   * NEVER recalculated, regardless of the record's rated flag.
   */
  const importGameRecord = useCallback(
    (record: GameRecord): { ok: boolean; duplicate?: boolean; conflict?: boolean; detail?: string } => {
      // IDEMPOTENCE + conflict checks run against DURABLE storage (the source
      // of truth), not memory: an in-memory-only record still needs the
      // durable write even if it "already exists" in React state.
      const durable = loadJSON<{ games?: GameRecord[] }>('profile', {});
      const durableGames = durable.games ?? [];
      const durableExisting = durableGames.find((g) => g.id === record.id);
      if (durableExisting) {
        const same = JSON.stringify(durableExisting) === JSON.stringify(record);
        if (same) return { ok: true, duplicate: true }; // genuinely already durable — nothing to do
        return {
          ok: false,
          conflict: true,
          detail: `A DIFFERENT game with id ${record.id} already exists in storage — the imported record was rejected to protect your history.`,
        };
      }
      // rating policy: recovered games are records-only — the next state
      // keeps the CURRENT rating/peak/ratingHistory verbatim
      const baseGames = durableGames.length > 0 ? durableGames : profileRef.current.games;
      const next: ProfileData = {
        ...profileRef.current,
        games: [record, ...baseGames.filter((g) => g.id !== record.id)],
      };
      // durable-first: verified write OUTSIDE any state updater
      const res = checkedSetJSON('profile', next);
      if (!res.ok) {
        reportPersistFailure(res.kind, 'gambit.profile', 'profile', res.detail);
        return { ok: false, detail: res.detail };
      }
      clearPersistStatus('gambit.profile'); // the missing record WAS recovered (verified)
      setProfile(next);
      return { ok: true };
    },
    [],
  );

  const recordPuzzle = useCallback((solved: boolean, puzzleRating: number, streak: number, theme?: string) => {
    setProfile((p) => {
      // Elo-style update vs the puzzle's rating
      const expected = 1 / (1 + 10 ** ((puzzleRating - p.puzzle.rating) / 400));
      const delta = Math.round(32 * ((solved ? 1 : 0) - expected));
      return {
        ...p,
        puzzle: {
          ...p.puzzle,
          rating: Math.max(600, p.puzzle.rating + delta),
          solved: p.puzzle.solved + (solved ? 1 : 0),
          failed: p.puzzle.failed + (solved ? 0 : 1),
          bestStreak: Math.max(p.puzzle.bestStreak, streak),
          byTheme: theme
            ? {
                ...p.puzzle.byTheme,
                [theme]: {
                  solved: (p.puzzle.byTheme?.[theme]?.solved ?? 0) + (solved ? 1 : 0),
                  failed: (p.puzzle.byTheme?.[theme]?.failed ?? 0) + (solved ? 0 : 1),
                },
              }
            : p.puzzle.byTheme,
        },
      };
    });
  }, []);

  const deleteGame = useCallback((id: string) => {
    setProfile((p) => ({ ...p, games: p.games.filter((g) => g.id !== id) }));
  }, []);

  const togglePin = useCallback((id: string) => {
    setProfile((p) => ({
      ...p,
      games: p.games.map((g) => (g.id === id ? { ...g, pinned: !g.pinned } : g)),
    }));
  }, []);

  const resetAll = useCallback(() => {
    setProfile({ ...DEFAULT_PROFILE, joined: Date.now() });
  }, []);

  const value = useMemo(() => ({ profile, recordGame, importGameRecord, recordPuzzle, deleteGame, togglePin, resetAll }), [profile, recordGame, importGameRecord, recordPuzzle, deleteGame, togglePin, resetAll]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const v = useContext(ProfileContext);
  if (!v) throw new Error('useProfile must be used inside ProfileProvider');
  return v;
}
