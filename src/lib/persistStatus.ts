import { useSyncExternalStore } from 'react';
import type { PersistFailureKind } from './persist';

/* ============================================================
   persistStatus — app-wide, observable record of persistence
   failures. Any writer (profile, training, repertoires, …) reports
   here; one persistent banner reflects the truth for the user.
   Failures survive reload (persisted) until a successful write to
   the same key clears them.
   ============================================================ */

export interface PersistStatusEntry {
  kind: PersistFailureKind;
  key: string;
  domain: string; // e.g. 'profile', 'training', 'repertoire'
  detail: string;
  at: number;
}

const STATUS_KEY = 'persistStatus.v1';

function readAll(): Record<string, PersistStatusEntry> {
  try {
    const raw = localStorage.getItem('gambit.' + STATUS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PersistStatusEntry>) : {};
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, PersistStatusEntry>): void {
  try {
    localStorage.setItem('gambit.' + STATUS_KEY, JSON.stringify(all));
  } catch {
    // the status store itself cannot be persisted — keep memory-only
  }
}

let cache: Record<string, PersistStatusEntry> | null = null;
const listeners = new Set<() => void>();
// useSyncExternalStore requires a CACHED snapshot: getSnapshot must return a
// stable value between store changes or React loops forever (error #185)
let snapshotCache: PersistStatusEntry[] = [];
let snapshotVersion = -1;
let storeVersion = 0;

function current(): Record<string, PersistStatusEntry> {
  if (!cache) cache = readAll();
  return cache;
}

function emit(): void {
  storeVersion += 1;
  writeAll(current());
  for (const fn of listeners) fn();
}

function snapshot(): PersistStatusEntry[] {
  if (snapshotVersion !== storeVersion) {
    snapshotVersion = storeVersion;
    snapshotCache = Object.values(current());
  }
  return snapshotCache;
}

/** Report a failed write. `domain` groups failures for the banner copy. */
export function reportPersistFailure(kind: PersistFailureKind, key: string, domain: string, detail: string): void {
  const all = current();
  all[key] = { kind, key, domain, detail, at: Date.now() };
  emit();
}

/** A successful verified write to `key` clears its failure entry. */
export function clearPersistStatus(key: string): void {
  const all = current();
  if (all[key]) {
    delete all[key];
    emit();
  }
}

export function getFailures(): PersistStatusEntry[] {
  return snapshot();
}

export function hasFailures(): boolean {
  return snapshot().length > 0;
}

/** React binding — re-renders on any status change. */
export function usePersistFailures(): PersistStatusEntry[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    snapshot,
    () => [] as PersistStatusEntry[],
  );
}

/** Test helper: reset in-memory cache (localStorage is cleared by tests). */
export function resetPersistStatusForTests(): void {
  cache = null;
}



/* ============================================================
   Unsaved finished games — a session store for completed games that
   failed to persist. It survives SPA navigation (module scope), so
   the emergency-export route is available from ANY page, not only
   the game screen. Entries are removed when a verified profile write
   demonstrably contains them, or after a verified emergency import.
   ============================================================ */

let unsavedCache: GameRecordLite[] = [];
const unsavedListeners = new Set<() => void>();
let unsavedVersion = 0;
let unsavedSnapshot: GameRecordLite[] = [];

export interface GameRecordLite {
  id: string;
  pgn: string;
  moves: string[];
  opponentName: string;
  result: string;
  reason: string;
  date: number;
  raw: unknown;
}

export function addUnsavedGame(record: GameRecordLite): void {
  if (unsavedCache.some((g) => g.id === record.id)) return;
  unsavedCache = [record, ...unsavedCache];
  unsavedVersion += 1;
  for (const fn of unsavedListeners) fn();
}

/** Remove entries whose id now exists in the durable profile (verified save). */
export function pruneUnsavedGames(durableIds: string[]): void {
  const ids = new Set(durableIds);
  const kept = unsavedCache.filter((g) => !ids.has(g.id));
  if (kept.length !== unsavedCache.length) {
    unsavedCache = kept;
    unsavedVersion += 1;
    for (const fn of unsavedListeners) fn();
  }
}

export function removeUnsavedGame(id: string): void {
  unsavedCache = unsavedCache.filter((g) => g.id !== id);
  unsavedVersion += 1;
  for (const fn of unsavedListeners) fn();
}

export function useUnsavedGames(): GameRecordLite[] {
  return useSyncExternalStore(
    (onChange) => {
      unsavedListeners.add(onChange);
      return () => unsavedListeners.delete(onChange);
    },
    () => {
      if (unsavedSnapshotVersion !== unsavedVersion) {
        unsavedSnapshotVersion = unsavedVersion;
        unsavedSnapshot = [...unsavedCache];
      }
      return unsavedSnapshot;
    },
    () => [] as GameRecordLite[],
  );
}

let unsavedSnapshotVersion = -1;
