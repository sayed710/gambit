import { checkedSetJSON } from './persist';
import { reportPersistFailure, clearPersistStatus } from './persistStatus';
import { loadJSON } from './storage';
import { Chess } from 'chess.js';
import { CRITICAL_CLASSES, verifyReportAgainstGame, type GameReport, type MoveClass } from './review';
import type { GameRecord } from './types';
import { normalizeSrRecord, scheduleSr, type SrGrade, type SrRecord } from './trainingStore';

/* ============================================================
   mistakeLab — Personal Mistake Lab (Gambit 2.0, milestone 1).

   Turns VERIFIED mistakes from the user's actual games into
   resumable, spaced-repetition practice. Everything here derives
   from data that already exists: the Review cache (`gambit.review.
   <gameId>` — a real engine GameReport) plus the game record. The
   lab NEVER runs its own evaluation and NEVER invents a best
   move — an exercise exists only where a review already judged
   the position with a critical classification AND recorded the
   engine's best move.

   Persistence: gambit.mistakeLab.v1 through checkedSetJSON with
   persistStatus reporting (durable, user-mourned data — the PR-A
   convention). A lost lab write must surface in the banner.
   ============================================================ */

export const MISTAKE_LAB_KEY = 'mistakeLab.v1'; // storage layer adds the gambit. prefix

/** interval (days) at which an exercise is honestly "mastered" */
export const MASTERED_INTERVAL_DAYS = 21;

/** per game, keep only the worst N mistakes (highest cpl) */
export const MAX_PER_GAME = 6;

export interface LabExercise {
  /** `${gameId}:${ply}` — content-stable identity */
  id: string;
  gameId: string;
  opponent: string;
  playedAt: number;
  /** ply index within the game (0-based, matches report.reviews) */
  ply: number;
  /** exact position BEFORE the decision */
  fenBefore: string;
  side: 'w' | 'b';
  /** what the player actually played */
  playedSan: string;
  /** the engine's best move at that position (from the review cache) */
  bestSan: string;
  classification: Extract<MoveClass, 'inaccuracy' | 'mistake' | 'miss' | 'blunder'>;
  cpl: number;
  createdAt: number;
  attempts: number;
  solved: number;
  lastPracticed: number | null;
  sr: SrRecord;
}

export interface LabSession {
  /** exercise ids in this session's queue */
  queue: string[];
  index: number;
  startedAt: number;
  /** ids resolved so far in THIS session, with their outcomes */
  results: { id: string; outcome: 'clean' | 'after-wrong' | 'assisted' }[];
  /** in-progress attempt flags per unresolved exercise — persisted so a
      reload mid-exercise cannot turn a bungled start into a clean solve */
  flags: Record<string, { assisted: boolean; firstTry: boolean }>;
}

export interface MistakeLabState {
  version: 1;
  exercises: LabExercise[];
  /** interrupted session — resumable */
  session: LabSession | null;
  /** when a harvest last ran (for "last synced" copy) */
  lastHarvestAt: number | null;
}

export function emptyLabState(): MistakeLabState {
  return { version: 1, exercises: [], session: null, lastHarvestAt: null };
}

/** A brand-new exercise schedule: immediately due, no history. */
function freshSrRecord(now: number): SrRecord {
  return { due: now, interval: 0, reps: 0, ease: 2.5, lapses: 0, lastResult: null };
}

function normalizeState(raw: unknown): MistakeLabState {
  if (!raw || typeof raw !== 'object') return emptyLabState();
  const state = raw as Partial<MistakeLabState>;
  if (!Array.isArray(state.exercises)) return emptyLabState();
  const exercises = state.exercises
    .filter((x): x is LabExercise => !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.fenBefore === 'string')
    .map((x) => ({
      ...x,
      attempts: typeof x.attempts === 'number' ? x.attempts : 0,
      solved: typeof x.solved === 'number' ? x.solved : 0,
      lastPracticed: typeof x.lastPracticed === 'number' ? x.lastPracticed : null,
      // an unreadable schedule means "unknown, treat as due now" — honest
      sr: normalizeSrRecord(x.sr) ?? freshSrRecord(0),
    }));
  const session =
    state.session && Array.isArray(state.session.queue) && typeof state.session.index === 'number'
      ? {
          ...state.session,
          results: Array.isArray(state.session.results) ? state.session.results : [],
          flags: state.session.flags && typeof state.session.flags === 'object' ? state.session.flags : {},
        }
      : null;
  // a persisted session may reference exercises that failed normalization
  // (corrupt/partial write) — without sanitizing, the page would deadlock:
  // an active session whose current exercise can never render
  const saneSession = sanitizeSession(session, exercises);
  return {
    version: 1,
    exercises,
    session: saneSession,
    lastHarvestAt: typeof state.lastHarvestAt === 'number' ? state.lastHarvestAt : null,
  };
}

export function loadLab(): MistakeLabState {
  return normalizeState(loadJSON<unknown>(MISTAKE_LAB_KEY, emptyLabState()));
}

/** Verified write + banner reporting (PR-A convention). Returns the
    state that is now durable-truth (caller refreshes from it). */
export function saveLab(state: MistakeLabState): { ok: boolean; state: MistakeLabState } {
  const res = checkedSetJSON(MISTAKE_LAB_KEY, state);
  if (res.ok) {
    clearPersistStatus(`gambit.${MISTAKE_LAB_KEY}`);
    return { ok: true, state };
  }
  reportPersistFailure(res.kind, `gambit.${MISTAKE_LAB_KEY}`, 'mistake lab', res.detail);
  return { ok: false, state };
}

/* ---------------- harvest ---------------- */

export interface HarvestResult {
  state: MistakeLabState;
  /** exercises ADDED by this harvest */
  added: number;
  /** games scanned (those with a review cache) */
  gamesScanned: number;
  /** games whose cached review could not be verified against the record */
  gamesRejected: number;
}

function exerciseId(gameId: string, ply: number): string {
  return `${gameId}:${ply}`;
}

function isCritical(c: MoveClass): c is LabExercise['classification'] {
  return (CRITICAL_CLASSES as string[]).includes(c);
}

/**
 * Extract lab exercises from ONE completed game + its cached review.
 * Only plies whose classification is critical AND whose cached eval
 * carries a real engine best move (different from the played move)
 * become exercises. The game's SAN list is replayed to produce the
 * exact before-positions; a replay that diverges from the cached
 * report aborts the game's harvest (never fabricate alignment).
 */
export type GameHarvestStatus = 'ok' | 'rejected';

export interface GameHarvest {
  /** 'rejected' = the cached review could not be verified against the game
      record (length/evals mismatch, illegal replay, or SAN/color drift) —
      distinguishable from a clean game with no eligible mistakes */
  status: GameHarvestStatus;
  exercises: LabExercise[];
}

export function harvestFromGame(record: GameRecord, report: GameReport, now: number): GameHarvest {
  // ONE shared, chess-backed verification (review.ts): lengths agree,
  // every stored move replays legally (noncanonical spellings allowed),
  // and each cached review names the same canonical move + mover color.
  // No chess validation is duplicated here.
  const verification = verifyReportAgainstGame(report, record.moves, record.initialFen);
  if (!verification.ok || !verification.fensBefore) return { status: 'rejected', exercises: [] };
  const fensBefore = verification.fensBefore;
  // the full replay verified — candidates are filtered from trusted data:
  const candidates: LabExercise[] = [];
  for (let ply = 0; ply < record.moves.length; ply++) {
    const review = report.reviews[ply];
    const evalBefore = report.evals[ply];
    if (!evalBefore?.bestSan) continue; // no verified best move -> no exercise
    // a personal-mistake lab trains THE PLAYER's decisions only
    if (review.color !== record.playerColor) continue;
    if (!isCritical(review.classification)) continue;
    if (evalBefore.bestSan === review.san) continue; // played the best move — not a mistake to retry
    // the verified answer must be PLAYABLE in the presented position AND
    // canonically identical to what the board will submit: a legal move
    // whose canonical SAN differs from the cached text (a dropped check/
    // mate suffix) would make the exercise unsolvable — skip it (no
    // substitute is invented)
    try {
      const best = new Chess(fensBefore[ply]).move(evalBefore.bestSan);
      if (!best || best.san !== evalBefore.bestSan) continue;
    } catch {
      continue;
    }
    candidates.push({
      id: exerciseId(record.id, ply),
      gameId: record.id,
      opponent: record.opponentName,
      playedAt: record.date,
      ply,
      fenBefore: fensBefore[ply],
      side: review.color,
      playedSan: review.san,
      bestSan: evalBefore.bestSan,
      classification: review.classification,
      cpl: review.cpl,
      createdAt: now,
      attempts: 0,
      solved: 0,
      lastPracticed: null,
      sr: freshSrRecord(now),
    });
  }
  // worst first, then cap: the lab trains the sharpest mistakes
  return { status: 'ok', exercises: candidates.sort((a, b) => b.cpl - a.cpl).slice(0, MAX_PER_GAME) };
}

/**
 * Harvest every completed game that HAS a review cache. Existing
 * exercises keep their identity (id) and their SR progress; only
 * genuinely new (game, ply) pairs are added.
 */
export function harvestAll(profile: { games: GameRecord[] }, state: MistakeLabState, now: number): HarvestResult {
  const byId = new Map(state.exercises.map((x) => [x.id, x]));
  let added = 0;
  let gamesScanned = 0;
  let gamesRejected = 0;
  for (const record of profile.games) {
    const report = loadJSON<unknown>(`review.${record.id}`, null) as GameReport | null;
    if (!report) continue; // no cache — nothing to scan for this game
    // a PRESENT cache counts as scanned even when malformed: the sync note
    // must be able to name it as unusable instead of "no reviewed games"
    gamesScanned += 1;
    if (!Array.isArray(report.reviews) || !Array.isArray(report.evals)) {
      gamesRejected += 1; // malformed cache — skipped below by the type guard
      continue;
    }
    let harvest: GameHarvest;
    try {
      harvest = harvestFromGame(record, report, now);
    } catch {
      gamesRejected += 1;
      continue; // a damaged cache never blocks the remaining games
    }
    if (harvest.status === 'rejected') {
      gamesRejected += 1;
      continue;
    }
    for (const ex of harvest.exercises) {
      if (!byId.has(ex.id)) {
        byId.set(ex.id, ex);
        added += 1;
      }
    }
  }
  // reconcile: exercises whose source game no longer exists (deleted game,
  // profile reset) leave the lab — with their session references
  const liveIds = new Set(profile.games.map((g) => g.id));
  const exercises = [...byId.values()].filter((x) => liveIds.has(x.gameId));
  const session = sanitizeSession(state.session, exercises);
  return {
    state: { version: 1, exercises, session, lastHarvestAt: now },
    added,
    gamesScanned,
    gamesRejected,
  };
}

/** Drop session queue/results entries whose exercises no longer exist.
    The cursor shifts back by the entries removed BEFORE it (so it still
    points at the same exercise), and a COMPLETED session (cursor === old
    length) stays completed — never reopened by sanitation. */
export function sanitizeSession(
  session: MistakeLabState['session'],
  exercises: LabExercise[],
): MistakeLabState['session'] {
  if (!session) return null;
  const ids = new Set(exercises.map((x) => x.id));
  // every collection is defensively filtered: a malformed persisted entry
  // (null, wrong shape) is discarded, never dereferenced
  const queue = (Array.isArray(session.queue) ? session.queue : []).filter(
    (id): id is string => typeof id === 'string' && ids.has(id),
  );
  const results = (Array.isArray(session.results) ? session.results : []).filter(
    (r): r is MistakeLabState['session'] extends null ? never : NonNullable<MistakeLabState['session']>['results'][number] =>
      !!r && typeof r === 'object' && typeof r.id === 'string' && ids.has(r.id),
  );
  if (queue.length === 0) return null;
  const rawIndex = typeof session.index === 'number' ? session.index : 0;
  const removedBefore = session.queue.slice(0, rawIndex).filter((id) => !ids.has(id)).length;
  let index = rawIndex - removedBefore;
  if (rawIndex >= session.queue.length) index = queue.length; // completed stays completed
  index = Math.max(0, Math.min(index, queue.length));
  const flags: NonNullable<MistakeLabState['session']>['flags'] = {};
  for (const id of queue) {
    const f = session.flags?.[id];
    if (f && typeof f === 'object' && typeof f.assisted === 'boolean' && typeof f.firstTry === 'boolean') {
      flags[id] = { assisted: f.assisted, firstTry: f.firstTry };
    }
  }
  return { ...session, queue, results, index, flags };
}

/** Remove one game's exercises (Profile delete) — also drops its session
    references. Pure; callers persist through saveLab. */
export function purgeGame(state: MistakeLabState, gameId: string): MistakeLabState {
  const exercises = state.exercises.filter((x) => x.gameId !== gameId);
  if (exercises.length === state.exercises.length) return state;
  return { ...state, exercises, session: sanitizeSession(state.session, exercises) };
}

/** Merge ONE game's harvested exercises into the lab WITHOUT orphan
    reconciliation — used by Review's single-game send, which must never
    touch exercises belonging to other games. Pure. */
export function sendGameToLab(
  state: MistakeLabState,
  harvested: LabExercise[],
  now: number,
): { state: MistakeLabState; added: number } {
  const byId = new Map(state.exercises.map((x) => [x.id, x]));
  let added = 0;
  for (const ex of harvested) {
    if (!byId.has(ex.id)) {
      byId.set(ex.id, ex);
      added += 1;
    }
  }
  return { state: { ...state, exercises: [...byId.values()], lastHarvestAt: now }, added };
}

/** Clear the whole lab (profile reset). */
export function emptyLabAfterReset(): MistakeLabState {
  return emptyLabState();
}

/* ---------------- practice semantics ---------------- */

/** Exact-SAN v1 grading, identical in spirit to practiceQueue: the only
    correct answer is the engine's verified best move. */
export function gradeLabMove(exercise: LabExercise, san: string): 'correct' | 'wrong' {
  return san === exercise.bestSan ? 'correct' : 'wrong';
}

export type LabOutcome = 'clean' | 'after-wrong' | 'assisted';

/** The promotion piece the VERIFIED answer demands ('q' for a plain best
    move or a queen promotion). The runner enters promotions with this
    piece, so a verified underpromotion is playable instead of impossible
    under auto-queen. */
export function promotionPieceFor(bestSan: string): 'q' | 'r' | 'b' | 'n' {
  const m = /=\s*([NBRQ])/.exec(bestSan);
  if (!m) return 'q';
  return ({ N: 'n', B: 'b', R: 'r', Q: 'q' } as Record<string, 'q' | 'r' | 'b' | 'n'>)[m[1]] ?? 'q';
}

/** outcome -> SR grade (honest: assistance and retries are never a full success) */
export function outcomeToGrade(outcome: LabOutcome): SrGrade {
  return outcome === 'clean' ? 'good' : 'hard';
}

export function isMastered(exercise: LabExercise): boolean {
  return exercise.sr.interval >= MASTERED_INTERVAL_DAYS;
}

export function isDue(exercise: LabExercise, now: number): boolean {
  return exercise.sr.due <= now;
}

/** Record one finished attempt against an exercise (pure). */
export function applyOutcome(state: MistakeLabState, id: string, outcome: LabOutcome, now: number): MistakeLabState {
  return {
    ...state,
    exercises: state.exercises.map((x) => {
      if (x.id !== id) return x;
      const solved = outcome === 'clean';
      return {
        ...x,
        attempts: x.attempts + 1,
        solved: x.solved + (solved ? 1 : 0),
        lastPracticed: now,
        sr: scheduleSr(x.sr, outcomeToGrade(outcome), now),
      };
    }),
  };
}

/* ---------------- sessions (resumable) ---------------- */

export const SESSION_SIZE = 10;

export function dueExercises(state: MistakeLabState, now: number): LabExercise[] {
  return state.exercises.filter((x) => isDue(x, now)).sort((a, b) => a.sr.due - b.sr.due);
}

export function startSession(state: MistakeLabState, now: number): MistakeLabState {
  const queue = dueExercises(state, now)
    .slice(0, SESSION_SIZE)
    .map((x) => x.id);
  if (queue.length === 0) return state;
  return { ...state, session: { queue, index: 0, startedAt: now, results: [], flags: {} } };
}

/** Persist a mid-exercise event (wrong guess, hint, reveal) so a reload
    cannot reset the attempt's honesty flags. Pure. */
export function markFlags(
  state: MistakeLabState,
  id: string,
  patch: { assisted?: boolean; firstTry?: boolean },
): MistakeLabState {
  const session = state.session;
  if (!session) return state;
  const current = session.flags[id] ?? { assisted: false, firstTry: true };
  return {
    ...state,
    session: {
      ...session,
      flags: { ...session.flags, [id]: { assisted: patch.assisted ?? current.assisted, firstTry: patch.firstTry ?? current.firstTry } },
    },
  };
}

/** The exercise the session is currently asking about (null = done/none). */
export function currentExercise(state: MistakeLabState): LabExercise | null {
  const session = state.session;
  if (!session || session.index >= session.queue.length) return null;
  const id = session.queue[session.index];
  return state.exercises.find((x) => x.id === id) ?? null;
}

/** Advance the session after recording an outcome. Pure. The resolved
    exercise's in-progress flags are dropped with it. */
export function completeCurrent(state: MistakeLabState, outcome: LabOutcome, now: number): MistakeLabState {
  const session = state.session;
  if (!session) return state;
  const id = session.queue[session.index];
  if (!id) return state;
  const flags = { ...session.flags };
  delete flags[id];
  const withOutcome: LabSession = {
    ...session,
    index: session.index + 1,
    results: [...session.results, { id, outcome }],
    flags,
  };
  return applyOutcome({ ...state, session: withOutcome }, id, outcome, now);
}

/** A lapsed exercise: attempted, not solved, SR scheduled as 'again'. */
function lapse(state: MistakeLabState, id: string, now: number): MistakeLabState {
  return {
    ...state,
    exercises: state.exercises.map((x) => {
      if (x.id !== id) return x;
      return {
        ...x,
        attempts: x.attempts + 1,
        lastPracticed: now,
        sr: scheduleSr(x.sr, 'again', now),
      };
    }),
  };
}

export function abandonSession(state: MistakeLabState, now: number): MistakeLabState {
  // an abandoned session lapses every UNRESOLVED exercise in its queue —
  // honest: they were due and were not answered
  const session = state.session;
  if (!session) return state;
  let next = state;
  for (let i = session.index; i < session.queue.length; i++) {
    next = lapse(next, session.queue[i], now);
  }
  return { ...next, session: null };
}

export interface LabStats {
  total: number;
  due: number;
  mastered: number;
  sources: number;
}

export function labStats(state: MistakeLabState, now: number): LabStats {
  return {
    total: state.exercises.length,
    due: dueExercises(state, now).length,
    mastered: state.exercises.filter(isMastered).length,
    sources: new Set(state.exercises.map((x) => x.gameId)).size,
  };
}
