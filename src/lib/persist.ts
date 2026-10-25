/* ============================================================
   persist — verified, honest persistence for critical data.

   The legacy saveJSON swallows failures (including quota). Critical
   writes go through checkedSetJSON: serialize → write → read-back
   verify, with each failure class reported separately so the UI can
   say exactly what is and is not saved.

   localStorage offers no transactions. "Verified" here means the
   exact serialized payload read back immediately after the write —
   the strongest guarantee the storage backend provides.
   ============================================================ */

export type PersistFailureKind = 'quota' | 'unavailable' | 'mismatch' | 'serialize';

export interface PersistOk {
  ok: true;
}
export interface PersistFailure {
  ok: false;
  kind: PersistFailureKind;
  /** storage key involved */
  key: string;
  /** human-readable, actionable detail */
  detail: string;
}

export type PersistResult = PersistOk | PersistFailure;

const PREFIX = 'gambit.';

export function fullKey(key: string): string {
  return PREFIX + key;
}

function failure(kind: PersistFailureKind, key: string, detail: string): PersistFailure {
  return { ok: false, kind, key: fullKey(key), detail };
}

/** Serialize independently so a broken payload is reported, not silently dropped. */
export function serialize(value: unknown): { text: string } | { error: unknown } {
  try {
    return { text: JSON.stringify(value) };
  } catch (error) {
    return { error };
  }
}

/**
 * Write `value` under `key` and verify by read-back. Never throws —
 * every failure mode is returned as structured data.
 */
export function checkedSetJSON(key: string, value: unknown): PersistResult {
  let text: string;
  const serialized = serialize(value);
  if ('error' in serialized) {
    return failure('serialize', key, `Data could not be serialized: ${(serialized.error as Error)?.message ?? 'unknown error'}`);
  }
  text = serialized.text;

  const target = fullKey(key);
  let storage: Storage;
  try {
    storage = window.localStorage;
    if (!storage) return failure('unavailable', key, 'Browser storage is unavailable (private browsing or disabled).');
  } catch {
    return failure('unavailable', key, 'Browser storage is unavailable (private browsing or disabled).');
  }

  try {
    storage.setItem(target, text);
  } catch (error) {
    const e = error as { name?: string; code?: number };
    const isQuota =
      e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e?.code === 22 || e?.code === 1014;
    return failure(
      isQuota ? 'quota' : 'unavailable',
      key,
      isQuota
        ? 'Browser storage is full — free space (export a backup, then remove old data) and try again.'
        : `Browser storage rejected the write: ${e?.name ?? 'unknown error'}.`,
    );
  }

  // read-back proof: the exact payload must come back
  let readBack: string | null = null;
  try {
    readBack = storage.getItem(target);
  } catch {
    return failure('mismatch', key, 'Could not read the saved data back for verification.');
  }
  if (readBack !== text) {
    return failure('mismatch', key, 'The saved data did not read back correctly — the write silently failed.');
  }
  return { ok: true };
}

/** Remove a key with the same honesty contract. */
export function checkedRemove(key: string): PersistResult {
  const target = fullKey(key);
  try {
    window.localStorage.removeItem(target);
    if (window.localStorage.getItem(target) !== null) {
      return failure('mismatch', key, 'Key could not be removed.');
    }
    return { ok: true };
  } catch {
    return failure('unavailable', key, 'Browser storage is unavailable.');
  }
}

/* ============================================================
   Emergency export — recovery route for data that exists in memory
   but could NOT be persisted. THIS IS NOT A COMPLETE BACKUP: the
   full backup exporter reads saved storage; this file carries only
   the flagged record(s). kind:'emergency-game' keeps it distinct.
   ============================================================ */

export interface EmergencyGameFile {
  app: 'gambit';
  kind: 'emergency-game';
  format: 1;
  exportedAt: string;
  reason: string;
  game: unknown; // GameRecord (validated on import)
}

export function buildEmergencyGameFile(game: unknown, reason: string, now = new Date()): EmergencyGameFile {
  return {
    app: 'gambit',
    kind: 'emergency-game',
    format: 1,
    exportedAt: now.toISOString(),
    reason,
    game,
  };
}

export function emergencyFilename(now = new Date()): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  const h = `${now.getHours()}`.padStart(2, '0');
  const mi = `${now.getMinutes()}`.padStart(2, '0');
  return `gambit-emergency-game-${y}-${m}-${d}-${h}${mi}.json`;
}
