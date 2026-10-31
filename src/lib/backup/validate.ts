/* ============================================================
   backup/validate — strict, chess-aware validation of an untrusted
   backup file. Imported content is DATA ONLY: it is parsed, checked
   and stringified back — never executed.

   Failure policy: a backup that fails any structural or chess
   validation is rejected whole with a specific error code. Optional
   sections may be absent; present sections must be valid.
   ============================================================ */

import { Chess } from 'chess.js';
import { isPersonaId } from '../engine/personas';
import { pgnHeaderTags, sanTokensFromHeaderlessPgn } from '../chessUtils';
import { buildIntegrity } from './exportBackup';
import {
  ALL_SECTIONS,
  BACKUP_APP,
  BACKUP_FORMAT_VERSION,
  BACKUP_MAX_BYTES,
  OPTIONAL_SECTIONS,
  checksumOf,
  utf8Bytes,
  type BackupEnvelope,
} from './format';

export type BackupErrorCode =
  | 'NOT_JSON'
  | 'TOO_LARGE'
  | 'BAD_ENVELOPE'
  | 'UNSUPPORTED_VERSION'
  | 'MISSING_SECTIONS'
  | 'CHECKSUM_MISMATCH'
  | 'FORBIDDEN_KEYS'
  | 'INVALID_SECTION';

export class BackupError extends Error {
  code: BackupErrorCode;
  section?: string;
  constructor(code: BackupErrorCode, message: string, section?: string) {
    super(message);
    this.code = code;
    this.section = section;
  }
}

/** keys that must never appear anywhere in imported data (prototype pollution) */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function scanForbiddenKeys(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    const hits: string[] = [];
    value.forEach((v, i) => hits.push(...scanForbiddenKeys(v, `${path}[${i}]`)));
    return hits;
  }
  if (value && typeof value === 'object') {
    const hits: string[] = [];
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k)) hits.push(`${path}.${k}`);
      hits.push(...scanForbiddenKeys(v, `${path}.${k}`));
    }
    return hits;
  }
  return [];
}

/* ------------------------------ chess helpers ------------------------------ */

function legalFen(fen: unknown): boolean {
  if (typeof fen !== 'string') return false;
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

/** replay a SAN list; returns false on the first illegal/unknown move */
function replayableSans(sans: unknown, startFen?: string): boolean {
  if (!Array.isArray(sans) || sans.some((s) => typeof s !== 'string')) return false;
  let g: Chess;
  try {
    g = new Chess(startFen);
  } catch {
    return false;
  }
  for (const san of sans) {
    try {
      g.move(san as string);
    } catch {
      return false;
    }
  }
  return true;
}

/* ------------------------------ section validators ------------------------------ */

type SectionValidator = (value: unknown) => void; // throws BackupError(INVALID_SECTION)

function fail(section: string, why: string): never {
  throw new BackupError('INVALID_SECTION', `${section}: ${why}`, section);
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const isId = (v: unknown): boolean => typeof v === 'string' && v.length > 0 && v.length <= 128;

const CLASSIFICATIONS = new Set(['brilliant', 'best', 'excellent', 'great', 'good', 'inaccuracy', 'mistake', 'miss', 'blunder', 'book']);
const SR_RATINGS = new Set(['again', 'hard', 'good', 'easy']);

/**
 * Load a game PGN from its DECLARED start position. chess.js loadPgn resets
 * to the standard start before applying the PGN's own FEN header, so a
 * headerless PGN belonging to a custom-start game must have its SAN tokens
 * parsed and replayed from the declared FEN (tokens legal only there would
 * be rejected by loadPgn, and legal-but-different tokens would corrupt the
 * position). Throws on invalid FEN or malformed move text.
 */
function loadPgnFromStart(pgn: string, startFen?: string): void {
  // REAL header tags only (block-scoped parse) — a movetext comment
  // containing FEN-shaped text is never a header
  const headerFen = pgnHeaderTags(pgn).FEN;
  if (startFen !== undefined && headerFen !== undefined && headerFen !== startFen) {
    throw new Error('PGN FEN header disagrees with the declared starting position');
  }
  const g = new Chess(startFen);
  if (startFen !== undefined && headerFen === undefined) {
    for (const san of sanTokensFromHeaderlessPgn(pgn)) {
      g.move(san);
    }
  } else {
    g.loadPgn(pgn);
  }
}

export function validateGameRecord(game: unknown, i = 0): void {
  if (!isPlainObject(game)) fail('profile', `game #${i} is not an object`);
  if (!isId(game.id)) fail('profile', `game #${i} has no valid id`);
  if (typeof game.result === 'string' && !['win', 'loss', 'draw'].includes(game.result)) {
    fail('profile', `game ${game.id}: bad result`);
  }
  // Zero-move games are real: Gambit saves games terminated before the
  // first move (resignation/timeout in pass mode). They must carry an
  // explicit terminal result + reason; anything else is malformed.
  if (!Array.isArray(game.moves)) fail('profile', `game ${game.id}: no move list`);
  const zeroMoveGame = Array.isArray(game.moves) && game.moves.length === 0;
  if (zeroMoveGame) {
    if (typeof game.result !== 'string' || !['win', 'loss', 'draw'].includes(game.result)) {
      fail('profile', `game ${game.id}: zero-move game without a result`);
    }
    if (typeof game.reason !== 'string' || game.reason.trim().length === 0) {
      fail('profile', `game ${game.id}: zero-move game without a termination reason`);
    }
  }
  // Custom-start games carry their starting position; it must be a VALID
  // FEN and the move list must replay from IT, not from the standard start.
  // Legacy records without the field replay from the standard start.
  let startFen: string | undefined;
  if (game.initialFen !== undefined) {
    if (typeof game.initialFen !== 'string' || game.initialFen.trim().length === 0) {
      fail('profile', `game ${game.id}: initialFen is not a FEN string`);
    }
    try {
      new Chess(game.initialFen as string);
    } catch {
      fail('profile', `game ${game.id}: initialFen is not a valid chess position`);
    }
    startFen = game.initialFen as string;
    // consistency: a REAL embedded PGN FEN header must AGREE with the
    // declared initialFen — a mismatch means one of them is wrong; refuse
    // the record. FEN-shaped text inside movetext comments is not a header.
    if (typeof game.pgn === 'string') {
      const headerFen = pgnHeaderTags(game.pgn).FEN;
      if (headerFen !== undefined && headerFen !== startFen) {
        fail('profile', `game ${game.id}: PGN FEN header disagrees with initialFen`);
      }
    }
  }
  if (typeof game.pgn === 'string' && game.pgn.length > 0) {
    // PGN (when present) must itself be loadable from the game's declared
    // start position — never silently from the standard start
    try {
      loadPgnFromStart(game.pgn, startFen);
    } catch {
      fail('profile', `game ${game.id}: unreadable PGN`);
    }
  }
  if (!replayableSans(game.moves, startFen)) fail('profile', `game ${game.id}: move list contains an illegal SAN`);
  if (game.moveTimings !== undefined) {
    if (!Array.isArray(game.moveTimings)) fail('profile', `game ${game.id}: moveTimings is not a list`);
    game.moveTimings.forEach((t: unknown, j: number) => {
      if (!isPlainObject(t) || !isNum((t as Record<string, unknown>).ply) || !isNum((t as Record<string, unknown>).thinkMs)) {
        fail('profile', `game ${game.id}: malformed move timing #${j}`);
      }
      const c = (t as Record<string, unknown>).color;
      if (c !== 'w' && c !== 'b') fail('profile', `game ${game.id}: timing #${j} has no color`);
    });
  }
  if (game.timeControl !== undefined) {
    const tc = game.timeControl as Record<string, unknown>;
    if (!isPlainObject(tc) || !isNum(tc.minutes) || !isNum(tc.increment)) fail('profile', `game ${game.id}: bad time control`);
  }
  if (game.persona !== undefined && !isPersonaId(game.persona)) fail('profile', `game ${game.id}: unknown persona`);
  if (game.rated !== undefined && typeof game.rated !== 'boolean') fail('profile', `game ${game.id}: rated is not a boolean`);
}

const validateProfile: SectionValidator = (v) => {
  if (!isPlainObject(v)) fail('profile', 'not an object');
  if (!Array.isArray(v.games)) fail('profile', 'games list missing');
  v.games.forEach(validateGameRecord);
  if (v.puzzle !== undefined && !isPlainObject(v.puzzle)) fail('profile', 'puzzle progress is not an object');
  if (v.rating !== undefined && !isNum(v.rating)) fail('profile', 'rating is not a number');
};

const validateSettings: SectionValidator = (v) => {
  if (!isPlainObject(v)) fail('settings', 'not an object');
};

function validateTreeNode(node: unknown, section: string, label: string): void {
  if (!isPlainObject(node)) fail(section, `${label}: node is not an object`);
  if (!isId(node.id)) fail(section, `${label}: node has no id`);
  if (typeof node.san !== 'string') fail(section, `${label}: node has no san`);
  if (!legalFen(node.fenBefore) || !legalFen(node.fenAfter)) fail(section, `${label}: illegal FEN`);
  if (!replayableSans([node.san], node.fenBefore as string)) fail(section, `${label}: san ${node.san} is illegal in its position`);
  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) fail(section, `${label}: children is not a list`);
    (node.children as unknown[]).forEach((c, i) => validateTreeNode(c, section, `${label}.children[${i}]`));
  }
}

function validateTree(tree: unknown, section: string, label: string): void {
  if (!isPlainObject(tree)) fail(section, `${label}: tree is not an object`);
  if (!legalFen(tree.startFen)) fail(section, `${label}: illegal start FEN`);
  if (!Array.isArray(tree.moves)) fail(section, `${label}: moves is not a list`);
  (tree.moves as unknown[]).forEach((n, i) => validateTreeNode(n, section, `${label}.moves[${i}]`));
}

const validateStudies: SectionValidator = (v) => {
  if (!Array.isArray(v)) fail('studies', 'not a list');
  v.forEach((study, i) => {
    if (!isPlainObject(study)) fail('studies', `study #${i} is not an object`);
    if (!isId(study.id)) fail('studies', `study #${i} has no id`);
    if (typeof study.title !== 'string') fail('studies', `study ${study.id}: no title`);
    if (!Array.isArray(study.chapters)) fail('studies', `study ${study.id}: chapters missing`);
    (study.chapters as unknown[]).forEach((ch, j) => {
      if (!isPlainObject(ch) || !isId(ch.id)) fail('studies', `study ${study.id}: chapter #${j} invalid`);
      validateTree((ch as Record<string, unknown>).tree, 'studies', `study ${study.id} chapter ${ch.id}`);
    });
  });
};

const validateRepertoires: SectionValidator = (v) => {
  if (!Array.isArray(v)) fail('repertoires', 'not a list');
  v.forEach((rep, i) => {
    if (!isPlainObject(rep)) fail('repertoires', `repertoire #${i} is not an object`);
    if (!isId(rep.id)) fail('repertoires', `repertoire #${i} has no id`);
    if (rep.side !== 'w' && rep.side !== 'b') fail('repertoires', `repertoire ${rep.id}: bad side`);
    if (!Array.isArray(rep.lines)) fail('repertoires', `repertoire ${rep.id}: lines missing`);
    (rep.lines as unknown[]).forEach((line, j) => {
      if (!isPlainObject(line) || !isId(line.id)) fail('repertoires', `repertoire ${rep.id}: line #${j} invalid`);
      validateTree((line as Record<string, unknown>).tree, 'repertoires', `repertoire ${rep.id} line ${line.id}`);
      const pref = (line as Record<string, unknown>).preferred;
      if (pref !== undefined && !isPlainObject(pref)) fail('repertoires', `repertoire ${rep.id}: preferred is not a map`);
    });
  });
};

const validateTraining: SectionValidator = (v) => {
  if (!isPlainObject(v)) fail('training', 'not an object');
  if (v.version !== 1) fail('training', `unsupported training schema version ${String(v.version)}`);
  if (v.endgame !== undefined && !isPlainObject(v.endgame)) fail('training', 'endgame is not a map');
  if (v.repScheduling !== undefined) {
    if (!isPlainObject(v.repScheduling)) fail('training', 'repScheduling is not a map');
    for (const rec of Object.values(v.repScheduling as Record<string, unknown>)) {
      if (!isPlainObject(rec) || !SR_RATINGS.has(String((rec as Record<string, unknown>).lastRating))) {
        // legacy records without a rating still merge; only a malformed
        // rating value rejects the file
        const r = (rec as Record<string, unknown>)?.lastRating;
        if (r !== undefined) fail('training', 'malformed SR record rating');
      }
    }
  }
  if (v.motifs !== undefined) {
    if (!isPlainObject(v.motifs)) fail('training', 'motifs is not a map');
    for (const stat of Object.values(v.motifs as Record<string, unknown>)) {
      if (!isPlainObject(stat) || !isNum((stat as Record<string, unknown>).opportunities)) {
        fail('training', 'malformed motif stat');
      }
    }
  }
  if (v.motifGames !== undefined && !isPlainObject(v.motifGames)) fail('training', 'motifGames is not a map');
  if (v.blindfold !== undefined) {
    if (!isPlainObject(v.blindfold)) fail('training', 'blindfold is not an object');
    const bf = v.blindfold as { levels?: unknown; scheduling?: unknown };
    if (bf.levels !== undefined && !isPlainObject(bf.levels)) fail('training', 'blindfold.levels is not a map');
    if (bf.scheduling !== undefined && !isPlainObject(bf.scheduling)) fail('training', 'blindfold.scheduling is not a map');
    if (isPlainObject(bf.scheduling)) {
      for (const rec of Object.values(bf.scheduling)) {
        if (!isPlainObject(rec) || !isNum((rec as Record<string, unknown>).due)) fail('training', 'malformed blindfold SR record');
      }
    }
  }
  if (v.adaptive !== undefined && !isPlainObject(v.adaptive)) fail('training', 'adaptive is not an object');
};

const PRACTICE_KINDS = new Set(['mistake', 'missed-tactic', 'repertoire', 'position']);

const validatePractice: SectionValidator = (v) => {
  if (!Array.isArray(v)) fail('practice', 'not a list');
  v.forEach((item, i) => {
    if (!isPlainObject(item)) fail('practice', `item #${i} is not an object`);
    if (!isId(item.id)) fail('practice', `item #${i} has no id`);
    if (!PRACTICE_KINDS.has(String(item.kind))) fail('practice', `item ${item.id}: unknown kind`);
    if (!legalFen(item.fen)) fail('practice', `item ${item.id}: illegal FEN`);
    if (item.side !== 'w' && item.side !== 'b') fail('practice', `item ${item.id}: bad side`);
    if (item.expectedSan !== undefined && typeof item.expectedSan !== 'string') fail('practice', `item ${item.id}: bad expectedSan`);
  });
};

const validateLibrary: SectionValidator = (v) => {
  if (!isPlainObject(v)) fail('library', 'not an object');
  if (v.tags !== undefined && !isPlainObject(v.tags)) fail('library', 'tags is not a map');
  if (v.notes !== undefined && !isPlainObject(v.notes)) fail('library', 'notes is not a map');
  if (v.favorites !== undefined && !Array.isArray(v.favorites)) fail('library', 'favorites is not a list');
};

const validateReviews: SectionValidator = (v) => {
  if (!isPlainObject(v)) fail('reviews', 'not an object');
  for (const [id, rep] of Object.entries(v)) {
    if (!id) fail('reviews', 'empty review id');
    if (!isPlainObject(rep)) fail('reviews', `review ${id}: not an object`);
    if (!Array.isArray(rep.reviews)) fail('reviews', `review ${id}: no reviews list`);
    rep.reviews.forEach((row: unknown, i: number) => {
      if (!isPlainObject(row)) fail('reviews', `review ${id}: row #${i} invalid`);
      const cls = (row as Record<string, unknown>).classification;
      if (typeof cls !== 'string' || !CLASSIFICATIONS.has(cls)) fail('reviews', `review ${id}: row #${i} bad classification`);
      const color = (row as Record<string, unknown>).color;
      if (color !== 'w' && color !== 'b') fail('reviews', `review ${id}: row #${i} bad color`);
    });
    if (!Array.isArray(rep.evals)) fail('reviews', `review ${id}: no evals list`);
  }
};

const validateActiveGame: SectionValidator = (v) => {
  if (!isPlainObject(v)) fail('activeGame', 'not an object');
  if (typeof v.pgn !== 'string') fail('activeGame', 'no pgn');
  // Same resume contract as useGame: the snapshot's config may declare a
  // custom starting position, and a HEADERLESS PGN must be validated from
  // that position (chess.js loadPgn resets to the standard start first).
  let cfgFen: string | undefined;
  if (v.config !== undefined) {
    if (!isPlainObject(v.config)) fail('activeGame', 'config is not an object');
    if (v.config.initialFen !== undefined) {
      if (typeof v.config.initialFen !== 'string' || (v.config.initialFen as string).trim().length === 0) {
        fail('activeGame', 'initialFen is not a FEN string');
      }
      try {
        new Chess(v.config.initialFen as string);
      } catch {
        fail('activeGame', 'initialFen is not a valid chess position');
      }
      cfgFen = v.config.initialFen as string;
      const headerFen = pgnHeaderTags(v.pgn).FEN;
      if (headerFen !== undefined && headerFen !== cfgFen) {
        fail('activeGame', 'PGN FEN header disagrees with config.initialFen');
      }
    }
    if (v.config.persona !== undefined && !isPersonaId(v.config.persona)) {
      fail('activeGame', 'unknown persona in config');
    }
  }
  try {
    loadPgnFromStart(v.pgn, cfgFen);
  } catch {
    fail('activeGame', 'unreadable PGN');
  }
};

const validateLastConfig: SectionValidator = (v) => {
  if (!isPlainObject(v)) fail('lastConfig', 'not an object');
  if (v.persona !== undefined && !isPersonaId(v.persona)) fail('lastConfig', 'unknown persona');
};

const SECTION_VALIDATORS: Partial<Record<string, SectionValidator>> = {
  profile: validateProfile,
  settings: validateSettings,
  studies: validateStudies,
  repertoires: validateRepertoires,
  training: validateTraining,
  practice: validatePractice,
  library: validateLibrary,
  reviews: validateReviews,
  activeGame: validateActiveGame,
  lastConfig: validateLastConfig,
};


export interface ParsedEmergency {
  game: unknown;
  reason: string;
  exportedAt: string;
}

/** Validate an emergency-game file (persist.ts kind:'emergency-game'). */
export function parseEmergencyGame(text: string): ParsedEmergency {
  if (utf8Bytes(text) > BACKUP_MAX_BYTES) throw new BackupError('TOO_LARGE', 'file exceeds the size limit');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('NOT_JSON', 'not valid JSON');
  }
  if (!isPlainObject(raw) || raw.app !== 'gambit' || raw.kind !== 'emergency-game') {
    throw new BackupError('BAD_ENVELOPE', 'this is not a Gambit emergency-game file');
  }
  if (raw.format !== 1) {
    throw new BackupError('UNSUPPORTED_VERSION', `Unsupported emergency file format ${String(raw.format)} (expected 1)`);
  }
  if (typeof raw.reason !== 'string' || typeof raw.exportedAt !== 'string' || !('game' in raw)) {
    throw new BackupError('BAD_ENVELOPE', 'emergency file is incomplete');
  }
  validateGameRecord(raw.game, 0);
  return { game: raw.game, reason: raw.reason, exportedAt: raw.exportedAt };
}

/* ------------------------------ entry point ------------------------------ */

export interface ParsedBackup {
  envelope: BackupEnvelope;
  /** section sizes in bytes, for the preview UI */
  bytes: number;
}

export function parseBackupText(text: string): ParsedBackup {
  if (utf8Bytes(text) > BACKUP_MAX_BYTES) {
    throw new BackupError('TOO_LARGE', `backup exceeds the ${Math.round(BACKUP_MAX_BYTES / 1024 / 1024)} MB limit`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('NOT_JSON', 'the file is not valid JSON');
  }
  return validateBackup(raw);
}

export function validateBackup(raw: unknown): ParsedBackup {
  if (!isPlainObject(raw)) throw new BackupError('BAD_ENVELOPE', 'backup root is not an object');
  if (raw.app !== BACKUP_APP) throw new BackupError('BAD_ENVELOPE', 'this file was not produced by Gambit');
  if (raw.format !== BACKUP_FORMAT_VERSION) {
    throw new BackupError('UNSUPPORTED_VERSION', `Unsupported backup format ${String(raw.format)} (expected ${BACKUP_FORMAT_VERSION})`);
  }
  if (!isPlainObject(raw.sections)) throw new BackupError('MISSING_SECTIONS', 'no sections object in the backup');
  if (!isPlainObject(raw.integrity) || !isPlainObject(raw.integrity.sectionCounts)) {
    throw new BackupError('BAD_ENVELOPE', 'integrity metadata missing');
  }
  // FNV-1a integrity is REQUIRED for format-v1 backups: presence, format,
  // correctness, section counts and payload size must all line up.
  // (The checksum detects accidental corruption, not malicious tampering —
  // an attacker can recompute it; chess validation is the deeper guard.)
  if (typeof raw.integrity.checksum !== 'string' || !/^[0-9a-f]{8}$/.test(raw.integrity.checksum)) {
    throw new BackupError('CHECKSUM_MISMATCH', 'integrity checksum missing or malformed');
  }
  if (typeof raw.integrity.bytes !== 'number' || !Number.isFinite(raw.integrity.bytes) || raw.integrity.bytes < 0) {
    throw new BackupError('BAD_ENVELOPE', 'integrity payload size missing');
  }

  const forbidden = scanForbiddenKeys(raw);
  if (forbidden.length > 0) {
    throw new BackupError('FORBIDDEN_KEYS', `backup contains forbidden keys: ${forbidden.slice(0, 3).join(', ')}`);
  }

  for (const name of ALL_SECTIONS) {
    const value = (raw.sections as Record<string, unknown>)[name];
    if (value === undefined) {
      if (!OPTIONAL_SECTIONS.includes(name)) {
        throw new BackupError('MISSING_SECTIONS', `required section "${name}" is absent`, name);
      }
      continue;
    }
    SECTION_VALIDATORS[name]?.(value);
  }

  // corruption checks last: only well-formed backups get checksummed.
  // Checksum proves content integrity; sectionCounts and bytes prove the
  // inventory matches the payload actually carried in the file.
  const sections = raw.sections as BackupEnvelope['sections'];
  const actual = checksumOf(sections);
  if (actual !== raw.integrity.checksum) {
    throw new BackupError('CHECKSUM_MISMATCH', 'backup content does not match its checksum — the file is corrupted');
  }
  const actualBytes = utf8Bytes(JSON.stringify(sections));
  if (raw.integrity.bytes !== actualBytes) {
    throw new BackupError('CHECKSUM_MISMATCH', `integrity payload size ${raw.integrity.bytes} does not match the actual ${actualBytes} bytes`);
  }
  // section counts are PROOF, not advice: values must be valid numbers and
  // must equal a fresh recalculation with the exact implementation the
  // exporter uses. Empty and partial backups recalculate consistently.
  const claimedCounts = raw.integrity.sectionCounts as Record<string, unknown>;
  for (const [name, value] of Object.entries(claimedCounts)) {
    if (!ALL_SECTIONS.includes(name as never) && name !== 'games') {
      throw new BackupError('BAD_ENVELOPE', `integrity counts mention unknown section "${name}"`);
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new BackupError('BAD_ENVELOPE', `integrity count for "${name}" is not a valid number`);
    }
  }
  const expectedCounts = buildIntegrity(sections).sectionCounts;
  const actualCountsJson = JSON.stringify(expectedCounts);
  const claimedCountsJson = JSON.stringify(claimedCounts);
  if (claimedCountsJson !== actualCountsJson) {
    throw new BackupError('CHECKSUM_MISMATCH', 'integrity section counts do not match the actual backup contents');
  }

  return { envelope: raw as unknown as BackupEnvelope, bytes: utf8Bytes(JSON.stringify(raw.sections)) };
}

/** Human-readable restore preview (never executes anything). */
export interface BackupPreview {
  games: number;
  reviewedGames: number;
  studies: number;
  repertoireLines: number;
  practiceItems: number;
  trainingSections: string[];
  hasSettings: boolean;
  hasActiveGame: boolean;
  exportedAt: string;
  sourceVersion: string;
  bytes: number;
}

export function previewBackup(parsed: ParsedBackup): BackupPreview {
  const s = parsed.envelope.sections;
  let repLines = 0;
  if (Array.isArray(s.repertoires)) {
    for (const r of s.repertoires as unknown[]) {
      if (Array.isArray((r as { lines?: unknown[] }).lines)) repLines += (r as { lines: unknown[] }).lines.length;
    }
  }
  const trainingSections: string[] = [];
  if (s.training && typeof s.training === 'object') {
    const t = s.training as Record<string, unknown>;
    for (const k of ['endgame', 'repScheduling', 'motifs', 'adaptive']) {
      if (t[k] && typeof t[k] === 'object' && Object.keys(t[k] as object).length > 0) trainingSections.push(k);
    }
  }
  return {
    games: Array.isArray((s.profile as { games?: unknown[] } | undefined)?.games) ? (s.profile as { games: unknown[] }).games.length : 0,
    reviewedGames: s.reviews ? Object.keys(s.reviews).length : 0,
    studies: Array.isArray(s.studies) ? s.studies.length : 0,
    repertoireLines: repLines,
    practiceItems: Array.isArray(s.practice) ? s.practice.length : 0,
    trainingSections,
    hasSettings: s.settings !== undefined,
    hasActiveGame: s.activeGame !== undefined,
    exportedAt: parsed.envelope.exportedAt,
    sourceVersion: parsed.envelope.sourceVersion,
    bytes: parsed.bytes,
  };
}
