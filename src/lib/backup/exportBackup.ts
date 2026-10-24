/* ============================================================
   backup/exportBackup — one-click export of every durable domain.

   Export reads the RAW stored JSON (parse only, never normalized or
   rewritten), so a restore writes back exactly what was exported:
   IDs, timestamps, trees, preferred maps, move timings,
   classifications and practice history all survive verbatim.
   ============================================================ */

import {
  ALL_SECTIONS,
  BACKUP_APP,
  BACKUP_FORMAT_VERSION,
  REVIEWS_PREFIX,
  SECTION_KEYS,
  SESSION_KEYS,
  utf8Bytes,
  checksumOf,
  type BackupEnvelope,
} from './format';
import { APP_VERSION } from '../appMeta';

/** Raw read of one localStorage key — null when absent. */
function readRaw(key: string): unknown {
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    // stored value is not JSON — export it verbatim as a string so
    // restore can put back exactly what was there
    return raw;
  }
}

function readReviews(): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  let found = false;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(REVIEWS_PREFIX)) continue;
    const id = key.slice(REVIEWS_PREFIX.length);
    if (!id) continue;
    found = true;
    out[id] = readRaw(key);
  }
  return found ? out : undefined;
}

export interface ExportOptions {
  /** cached Game Review reports add bulk; on by default, excludable */
  includeReviews?: boolean;
  now?: Date;
}

/** Collect the raw payload of every allowlisted section. */
export function collectSections(opts: ExportOptions = {}): BackupEnvelope['sections'] {
  const includeReviews = opts.includeReviews !== false;
  const sections: Record<string, unknown> = {};
  for (const name of ALL_SECTIONS) {
    if (name === 'reviews') {
      if (includeReviews) sections.reviews = readReviews();
      continue;
    }
    const key =
      name in SECTION_KEYS
        ? SECTION_KEYS[name as keyof typeof SECTION_KEYS]
        : SESSION_KEYS[name as keyof typeof SESSION_KEYS];
    sections[name] = readRaw(key);
  }
  return sections as BackupEnvelope['sections'];
}

/** Human-readable entry count per section (for the export summary). */
export function sectionCounts(sections: BackupEnvelope['sections']): Record<string, number> {
  const count = (v: unknown): number => (Array.isArray(v) ? v.length : typeof v === 'object' && v !== null ? Object.keys(v).length : v === undefined ? 0 : 1);
  const out: Record<string, number> = {};
  for (const name of ALL_SECTIONS) {
    const v = (sections as Record<string, unknown>)[name];
    if (name === 'profile') {
      const p = v as { games?: unknown[] } | undefined;
      out.games = p && typeof p === 'object' && Array.isArray(p.games) ? p.games.length : 0;
      out.profile = p === undefined ? 0 : 1;
      continue;
    }
    out[name] = count(v);
  }
  return out;
}

export interface BuiltBackup {
  envelope: BackupEnvelope;
  /** pretty-printed JSON text ready for download */
  text: string;
  filename: string;
}

export function buildBackup(opts: ExportOptions = {}): BuiltBackup {
  const sections = collectSections(opts);
  const text = JSON.stringify(envelopeOf(sections, opts.now ?? new Date()), null, 2);
  return {
    envelope: envelopeOf(sections, opts.now ?? new Date()),
    text,
    filename: backupFilenameOf(opts.now ?? new Date()),
  };
}

// small indirection so the envelope used for the checksum and the
// serialized one are built identically
function envelopeOf(sections: BackupEnvelope['sections'], now: Date): BackupEnvelope {
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT_VERSION,
    exportedAt: now.toISOString(),
    sourceVersion: APP_VERSION,
    sections,
    integrity: {
      sectionCounts: sectionCounts(sections),
      checksum: checksumOf(sections),
      bytes: utf8Bytes(JSON.stringify(sections)),
    },
  };
}

function backupFilenameOf(now: Date): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `gambit-backup-${y}-${m}-${d}.json`;
}
