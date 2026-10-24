/* ============================================================
   backup/format — the portable Gambit backup envelope.

   Format v1: a strict allowlist of data sections, raw (unnormalized)
   payloads, and integrity metadata (per-section counts + a
   deterministic FNV-1a checksum over the canonical serialization).
   The checksum detects accidental corruption, not tampering.
   ============================================================ */

export const BACKUP_APP = 'gambit';
export const BACKUP_FORMAT_VERSION = 1;
/** hard ceiling on parsed backup size — protects the UI thread */
export const BACKUP_MAX_BYTES = 96 * 1024 * 1024;

/** Every durable Gambit storage domain. Nothing outside this list is
 *  ever exported or restored — unrelated origin keys stay untouched. */
export const SECTION_KEYS = {
  profile: 'gambit.profile',
  settings: 'gambit.settings',
  studies: 'gambit.studies.v1',
  repertoires: 'gambit.repertoire.v1',
  training: 'gambit.training.v1',
  practice: 'gambit.practice.v1',
  library: 'gambit.library.v1',
} as const;

export type SingletonSection = keyof typeof SECTION_KEYS;

/** multi-key domain: one localStorage entry per reviewed game */
export const REVIEWS_PREFIX = 'gambit.review.';

/** session sections — real user state, exported for completeness */
export const SESSION_KEYS = {
  activeGame: 'gambit.activeGame',
  lastConfig: 'gambit.lastConfig',
} as const;

export type SessionSection = keyof typeof SESSION_KEYS;

export type SectionName = SingletonSection | SessionSection | 'reviews';

export const ALL_SECTIONS: SectionName[] = [
  'profile',
  'settings',
  'studies',
  'repertoires',
  'training',
  'practice',
  'library',
  'reviews',
  'activeGame',
  'lastConfig',
];

/** sections whose absence in a v1 backup is tolerated (legacy/optional) */
export const OPTIONAL_SECTIONS: SectionName[] = ['activeGame', 'lastConfig', 'library', 'reviews'];

export interface BackupIntegrity {
  /** entry count per section (games, studies, repertoire lines, ...) */
  sectionCounts: Record<string, number>;
  /** FNV-1a 32-bit checksum of the canonical sections JSON */
  checksum: string;
  /** serialized byte size of the sections object (UTF-8) */
  bytes: number;
}

export interface BackupEnvelope {
  app: typeof BACKUP_APP;
  format: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string; // ISO timestamp
  sourceVersion: string; // app version that produced the file
  sections: {
    profile?: unknown;
    settings?: unknown;
    studies?: unknown;
    repertoires?: unknown;
    training?: unknown;
    practice?: unknown;
    library?: unknown;
    /** gameId -> GameReport (raw) */
    reviews?: Record<string, unknown>;
    activeGame?: unknown;
    lastConfig?: unknown;
  };
  integrity: BackupIntegrity;
}

/** Deterministic JSON: object keys sorted at every level. */
export function canonicalJson(value: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      out.push(JSON.stringify(v));
      return;
    }
    if (Array.isArray(v)) {
      out.push('[');
      v.forEach((item, i) => {
        if (i > 0) out.push(',');
        walk(item);
      });
      out.push(']');
      return;
    }
    if (typeof v === 'object') {
      out.push('{');
      const keys = Object.keys(v as Record<string, unknown>).sort();
      keys.forEach((k, i) => {
        if (i > 0) out.push(',');
        out.push(JSON.stringify(k), ':');
        walk((v as Record<string, unknown>)[k]);
      });
      out.push('}');
      return;
    }
    // undefined / functions / symbols never occur in persisted JSON
    out.push('null');
  };
  walk(value);
  return out.join('');
}

/** FNV-1a 32-bit, hex — synchronous, dependency-free corruption check. */
export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    // 32-bit FNV prime multiplication via shifts (JS number safety)
    h = (h + ((h << 1) >>> 0) + ((h << 4) >>> 0) + ((h << 7) >>> 0) + ((h << 8) >>> 0) + ((h << 24) >>> 0)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function checksumOf(sections: BackupEnvelope['sections']): string {
  return fnv1a(canonicalJson(sections));
}

export function utf8Bytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** `gambit-backup-2026-10-24.json` */
export function backupFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `gambit-backup-${y}-${m}-${d}.json`;
}
