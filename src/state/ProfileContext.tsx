import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { GameRecord } from '../lib/types';
import { loadJSON, saveJSON } from '../lib/storage';

interface PuzzleStats {
  rating: number;
  solved: number;
  failed: number;
  bestStreak: number;
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
  recordPuzzle: (solved: boolean, puzzleRating: number, streak: number) => void;
  resetAll: () => void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<ProfileData>(() => ({ ...DEFAULT_PROFILE, ...loadJSON('profile', {}) }));

  useEffect(() => {
    saveJSON('profile', profile);
  }, [profile]);

  const recordGame = useCallback((record: GameRecord) => {
    setProfile((p) => {
      const rating = record.ratingAfter;
      return {
        ...p,
        rating,
        peakRating: Math.max(p.peakRating, rating),
        ratingHistory: [...p.ratingHistory.slice(-99), rating],
        games: [record, ...p.games].slice(0, 50),
      };
    });
  }, []);

  const recordPuzzle = useCallback((solved: boolean, puzzleRating: number, streak: number) => {
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
        },
      };
    });
  }, []);

  const resetAll = useCallback(() => {
    setProfile({ ...DEFAULT_PROFILE, joined: Date.now() });
  }, []);

  const value = useMemo(() => ({ profile, recordGame, recordPuzzle, resetAll }), [profile, recordGame, recordPuzzle, resetAll]);
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

export function useProfile(): ProfileContextValue {
  const v = useContext(ProfileContext);
  if (!v) throw new Error('useProfile must be used inside ProfileProvider');
  return v;
}
