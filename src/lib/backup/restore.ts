/* ============================================================
   backup/restore — REPLACE and MERGE modes with checked writes,
   snapshot/rollback and post-restore verification.

   The generic saveJSON swallows storage failures, so restores never
   use it: every write goes through checkedWrite (setItem + read-back
   equality) and any failure rolls the whole allowlisted dataset back
   to the pre-restore snapshot. No atomicity is claimed beyond that —
   localStorage itself offers none.
   ============================================================ */

import {
  ALL_SECTIONS,
  REVIEWS_PREFIX,
  SECTION_KEYS,
  SESSION_KEYS,
  type BackupEnvelope,
  type SectionName,
} from './format';
import type { ParsedBackup } from './validate';

type StorageMap = Record<string, string | null>;

const keyFor = (name: SectionName): string | null =>
  name === 'reviews' ? null : name in SECTION_KEYS ? SECTION_KEYS[name as keyof typeof SECTION_KEYS] : SESSION_KEYS[name as keyof typeof SESSION_KEYS];

/** Raw snapshot of every allowlisted key (reviews included). */
export function snapshotAll(): StorageMap {
  const snap: StorageMap = {};
  const keys = new Set<string>([...Object.values(SECTION_KEYS), ...Object.values(SESSION_KEYS)]);
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(REVIEWS_PREFIX)) keys.add(key);
  }
  for (const key of keys) snap[key] = localStorage.getItem(key);
  return snap;
}

export type WriteFailureKind = 'quota' | 'mismatch';

export class RestoreError extends Error {
  kind: WriteFailureKind | 'rollback';
  constructor(kind: WriteFailureKind | 'rollback', message: string) {
    super(message);
    this.kind = kind;
  }
}

/** setItem + immediate read-back; throws RestoreError on failure. */
export function checkedWrite(key: string, text: string): void {
  try {
    localStorage.setItem(key, text);
  } catch {
    throw new RestoreError('quota', `storage rejected the write for ${key} (quota or unavailable)`);
  }
  if (localStorage.getItem(key) !== text) {
    throw new RestoreError('mismatch', `read-back verification failed for ${key}`);
  }
}

/** Restore the snapshot verbatim (rollback path). Best-effort by necessity. */
export function rollbackTo(snap: StorageMap): void {
  for (const [key, value] of Object.entries(snap)) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch {
      /* best effort — surfaced by verify below */
    }
  }
}

function writeJsonChecked(key: string, value: unknown): void {
  checkedWrite(key, JSON.stringify(value));
}

/** All allowlisted keys that exist right now. */
function existingReviewIds(): string[] {
  const out: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key && key.startsWith(REVIEWS_PREFIX) && key.length > REVIEWS_PREFIX.length) out.push(key.slice(REVIEWS_PREFIX.length));
  }
  return out;
}

export interface RestoreResult {
  mode: 'replace' | 'merge';
  applied: string[]; // section names actually written
  removed: string[]; // keys removed (replace mode prune)
  gamesAfter: number;
  reviewsAfter: number;
}

/**
 * REPLACE: the backup becomes the complete dataset. Sections absent from
 * the backup are removed (reviews not in the backup are pruned), then
 * everything is verified by read-back.
 */
export function restoreReplace(parsed: ParsedBackup): RestoreResult {
  const snap = snapshotAll();
  try {
    const applied: string[] = [];
    const removed: string[] = [];
    for (const name of ALL_SECTIONS) {
      const value = (parsed.envelope.sections as Record<string, unknown>)[name];
      if (name === 'reviews') {
        const wanted = new Set<string>(Object.keys((value as Record<string, unknown>) ?? {}));
        for (const id of existingReviewIds()) {
          if (!wanted.has(id)) {
            localStorage.removeItem(REVIEWS_PREFIX + id);
            removed.push(`review.${id}`);
          }
        }
        if (value !== undefined) {
          for (const [id, rep] of Object.entries(value as Record<string, unknown>)) {
            writeJsonChecked(REVIEWS_PREFIX + id, rep);
          }
          if (wanted.size > 0) applied.push('reviews');
        }
        continue;
      }
      const key = keyFor(name)!;
      if (value === undefined) {
        if (localStorage.getItem(key) !== null) {
          localStorage.removeItem(key);
          removed.push(name);
        }
        continue;
      }
      writeJsonChecked(key, value);
      applied.push(name);
    }
    verifyAgainst(parsed.envelope);
    return summarize('replace', applied, removed);
  } catch (e) {
    rollbackTo(snap);
    if (e instanceof RestoreError) throw e;
    throw new RestoreError('rollback', `restore failed and was rolled back: ${(e as Error).message}`);
  }
}

/** post-restore verification: every section read back deep-equal. */
function verifyAgainst(envelope: BackupEnvelope): void {
  for (const name of ALL_SECTIONS) {
    const value = (envelope.sections as Record<string, unknown>)[name];
    if (value === undefined) continue;
    if (name === 'reviews') {
      for (const [id, rep] of Object.entries((value as Record<string, unknown>) ?? {})) {
        const back = localStorage.getItem(REVIEWS_PREFIX + id);
        if (back === null || JSON.stringify(JSON.parse(back)) !== JSON.stringify(rep)) {
          throw new RestoreError('mismatch', `verification failed for review ${id}`);
        }
      }
      continue;
    }
    const back = localStorage.getItem(keyFor(name)!);
    if (back === null || JSON.stringify(JSON.parse(back)) !== JSON.stringify(value)) {
      throw new RestoreError('mismatch', `verification failed for section ${name}`);
    }
  }
}

function summarize(mode: 'replace' | 'merge', applied: string[], removed: string[]): RestoreResult {
  const profile = localStorage.getItem(SECTION_KEYS.profile);
  const games = profile ? (JSON.parse(profile).games ?? []).length : 0;
  return {
    mode,
    applied,
    removed,
    gamesAfter: games,
    reviewsAfter: existingReviewIds().length,
  };
}

/* ---------------------------------- merge ---------------------------------- */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function readSection(name: SectionName): unknown {
  const key = keyFor(name);
  if (key === null) return undefined;
  const raw = localStorage.getItem(key);
  return raw === null ? undefined : JSON.parse(raw);
}

function trainingIsInitial(t: unknown): boolean {
  if (!isObj(t)) return true;
  const empty = (v: unknown) => !v || (typeof v === 'object' && Object.keys(v as object).length === 0);
  return (
    empty(t.endgame) &&
    empty(t.repScheduling) &&
    empty(t.motifs) &&
    empty(t.motifGames) &&
    (!isObj(t.adaptive) || !Array.isArray((t.adaptive as { queue?: unknown[] }).queue) || (t.adaptive as { queue: unknown[] }).queue.length === 0)
  );
}

/**
 * MERGE — union by stable id, existing-wins on conflict, per domain:
 * - profile: keep current profile fields; add only NEW games (by id).
 *   Historical aggregates (rating, puzzle stats) are never summed or
 *   overwritten — imported games are the only addition.
 * - studies / repertoires / practice: union by id, existing wins, so
 *   importing the same backup twice never duplicates anything.
 * - library: per-game tags/notes existing-wins; favorites union.
 * - training: replace-only domain — kept unless the current state is
 *   still initial (fresh install), in which case the backup seeds it.
 *   SR schedules and motif contributions are never summed (double count).
 * - reviews: fill only game ids with no cached report yet.
 * - settings / activeGame / lastConfig: existing kept.
 */
export function restoreMerge(parsed: ParsedBackup): RestoreResult {
  const snap = snapshotAll();
  try {
    const applied: string[] = [];
    const incoming = parsed.envelope.sections as Record<string, unknown>;
    const currentProfile = readSection('profile');
    const incomingProfile = incoming.profile;

    if (isObj(incomingProfile)) {
      if (!isObj(currentProfile)) {
        writeJsonChecked(SECTION_KEYS.profile, incomingProfile);
        applied.push('profile');
      } else {
        const currentIds = new Set<string>((Array.isArray(currentProfile.games) ? currentProfile.games : []).map((g) => (isObj(g) ? String(g.id) : '')).filter(Boolean));
        const newGames = (Array.isArray(incomingProfile.games) ? incomingProfile.games : []).filter((g) => isObj(g) && !currentIds.has(String(g.id)));
        if (newGames.length > 0) {
          const merged = { ...currentProfile, games: [...(newGames as unknown[]), ...(Array.isArray(currentProfile.games) ? currentProfile.games : [])] };
          writeJsonChecked(SECTION_KEYS.profile, merged);
          applied.push('profile');
        }
      }
    }

    for (const name of ['studies', 'repertoires', 'practice'] as const) {
      const inc = incoming[name];
      if (!Array.isArray(inc)) continue;
      const current = readSection(name);
      const currentIds = new Set<string>((Array.isArray(current) ? current : []).map((x) => (isObj(x) ? String(x.id) : '')).filter(Boolean));
      const additions = inc.filter((x) => isObj(x) && !currentIds.has(String(x.id)));
      if (current === undefined) {
        if (inc.length > 0) {
          writeJsonChecked(keyFor(name)!, inc);
          applied.push(name);
        }
        continue;
      }
      if (additions.length > 0) {
        writeJsonChecked(keyFor(name)!, [...additions, ...(current as unknown[])]);
        applied.push(name);
      }
    }

    const incLib = incoming.library;
    if (isObj(incLib) && isObj(readSection('library'))) {
      const cur = readSection('library') as Record<string, unknown>;
      const tags = { ...(incLib.tags as Record<string, string[]> | undefined), ...(cur.tags as Record<string, string[]> | undefined) };
      const notes = { ...(incLib.notes as Record<string, string> | undefined), ...(cur.notes as Record<string, string> | undefined) };
      const favorites = Array.from(new Set([...((cur.favorites as string[]) ?? []), ...((incLib.favorites as string[]) ?? [])]));
      writeJsonChecked(SECTION_KEYS.library, { tags, notes, favorites });
      applied.push('library');
    } else if (isObj(incLib) && readSection('library') === undefined) {
      writeJsonChecked(SECTION_KEYS.library, incLib);
      applied.push('library');
    }

    const incTraining = incoming.training;
    if (isObj(incTraining) && trainingIsInitial(readSection('training'))) {
      writeJsonChecked(SECTION_KEYS.training, incTraining);
      applied.push('training');
    }

    const incReviews = incoming.reviews;
    if (isObj(incReviews)) {
      const existing = new Set(existingReviewIds());
      let wrote = false;
      for (const [id, rep] of Object.entries(incReviews)) {
        if (existing.has(id)) continue;
        writeJsonChecked(REVIEWS_PREFIX + id, rep);
        wrote = true;
      }
      if (wrote) applied.push('reviews');
    }

    return summarize('merge', applied, []);
  } catch (e) {
    rollbackTo(snap);
    if (e instanceof RestoreError) throw e;
    throw new RestoreError('rollback', `merge failed and was rolled back: ${(e as Error).message}`);
  }
}
