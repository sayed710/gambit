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


