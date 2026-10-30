const PREFIX = 'gambit.';

export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Legacy convenience write. AUDIT NOTE (PR-A): this does not verify the
 * write — non-critical writers may keep using it, but anything a user
 * would mourn losing must call checkedSetJSON (src/lib/persist.ts) and
 * report failures via persistStatus instead of relying on this function.
 * Returns the persistence result so callers CAN check it.
 */
export function saveJSON(key: string, value: unknown): { ok: boolean } {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}
