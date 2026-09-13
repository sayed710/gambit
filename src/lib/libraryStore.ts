import { loadJSON, saveJSON } from './storage';
import type { GameRecord } from './types';

/* ============================================================
   libraryStore — additive metadata (tags, notes, favorites)
   layered over the existing game records. Games themselves keep
   living in the profile store; this schema is separate so no
   migration of stored games is ever needed.
   ============================================================ */

export const LIBRARY_KEY = 'library.v1'; // storage layer adds the gambit. prefix

export interface LibraryMeta {
  tags: Record<string, string[]>;
  notes: Record<string, string>;
  favorites: string[];
}

export function normalizeLibraryMeta(raw: unknown): LibraryMeta {
  const fallback: LibraryMeta = { tags: {}, notes: {}, favorites: [] };
  if (!raw || typeof raw !== 'object') return fallback;
  const r = raw as Partial<LibraryMeta>;
  return {
    tags: r.tags && typeof r.tags === 'object' && !Array.isArray(r.tags) ? (r.tags as LibraryMeta['tags']) : {},
    notes: r.notes && typeof r.notes === 'object' && !Array.isArray(r.notes) ? (r.notes as LibraryMeta['notes']) : {},
    favorites: Array.isArray(r.favorites) ? r.favorites.filter((x): x is string => typeof x === 'string') : [],
  };
}

export function loadLibraryMeta(): LibraryMeta {
  return normalizeLibraryMeta(loadJSON<unknown>(LIBRARY_KEY, {}));
}

export function saveLibraryMeta(meta: LibraryMeta): void {
  saveJSON(LIBRARY_KEY, meta);
}

export function toggleFavorite(meta: LibraryMeta, gameId: string): void {
  meta.favorites = meta.favorites.includes(gameId)
    ? meta.favorites.filter((x) => x !== gameId)
    : [...meta.favorites, gameId];
}

export interface LibraryFilters {
  q?: string;
  result?: 'win' | 'loss' | 'draw' | 'all';
  mode?: 'ai' | 'pass' | 'all';
  tc?: string; // time-control category, e.g. 'Blitz'
  from?: number;
  to?: number;
  tag?: string;
  tags?: Record<string, string[]>;
  favoritesOnly?: boolean;
  favorites?: string[];
}

export function filterGames(games: GameRecord[], f: LibraryFilters): GameRecord[] {
  const q = f.q?.trim().toLowerCase() ?? '';
  return games.filter((g) => {
    if (f.result && f.result !== 'all' && g.result !== f.result) return false;
    if (f.mode && f.mode !== 'all' && g.mode !== f.mode) return false;
    if (f.tc && g.timeControl.category !== f.tc) return false;
    if (f.from && g.date < f.from) return false;
    if (f.to && g.date > f.to) return false;
    if (f.favoritesOnly && !(f.favorites ?? []).includes(g.id)) return false;
    if (f.tag && !(f.tags?.[g.id] ?? []).includes(f.tag)) return false;
    if (q) {
      const hay = `${g.opponentName} ${g.moves.join(' ')} ${g.pgn} ${g.result} ${g.reason}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Bulk PGN export: one game per line-block, concatenated. */
export function exportSelectedPgn(games: GameRecord[]): string {
  return games
    .map((g) => g.pgn.trim())
    .filter(Boolean)
    .join('\n\n');
}
