import { checkedSetJSON } from './persist';
import { reportPersistFailure, clearPersistStatus } from './persistStatus';
import { loadJSON } from './storage';
import { CRITICAL_CLASSES, type GameReport, type MoveClass } from './review';
import type { GameRecord } from './types';
import { normalizeSrRecord, scheduleSr, type SrGrade, type SrRecord } from './trainingStore';
import { Chess } from 'chess.js';
import type { Move } from 'chess.js';

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
      ? { ...state.session, results: Array.isArray(state.session.results) ? state.session.results : [] }
      : null;
  return {
    version: 1,
    exercises,
    session,
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
export function harvestFromGame(record: GameRecord, report: GameReport, now: number): LabExercise[] {
  if (record.moves.length !== report.reviews.length) return []; // cache/game mismatch — refuse, never guess
  let game: Chess;
  try {
    game = new Chess(record.initialFen ?? undefined);
  } catch {
    return [];
  }
  const found: LabExercise[] = [];
  for (let ply = 0; ply < record.moves.length; ply++) {
    // the REPLAY advances for EVERY ply — exercise filtering must never
    // skip moves, or the position drifts out of alignment with the report
    const fenBefore = game.fen();
    let played: Move;
    try {
      played = game.move(record.moves[ply]);
    } catch {
      return found; // replay diverged — keep only what was verified so far
    }
    if (!played || played.san !== record.moves[ply]) return found;
    const review = report.reviews[ply];
    const evalBefore = report.evals[ply];
    if (!review || !evalBefore?.bestSan) continue; // no verified best move -> no exercise
    if (!isCritical(review.classification)) continue;
    if (evalBefore.bestSan === played.san) continue; // played the best move — not a mistake to retry
    found.push({
      id: exerciseId(record.id, ply),
      gameId: record.id,
      opponent: record.opponentName,
      playedAt: record.date,
      ply,
      fenBefore,
      side: review.color,
      playedSan: played.san,
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
  // worst first, then cap — the lab trains the sharpest mistakes
  return found.sort((a, b) => b.cpl - a.cpl).slice(0, MAX_PER_GAME);
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
  for (const record of profile.games) {
    const report = loadJSON<unknown>(`review.${record.id}`, null) as GameReport | null;
    if (!report || !Array.isArray(report.reviews)) continue;
    gamesScanned += 1;
    for (const ex of harvestFromGame(record, report, now)) {
      if (!byId.has(ex.id)) {
        byId.set(ex.id, ex);
        added += 1;
      }
    }
  }
  return {
    state: { ...state, exercises: [...byId.values()], lastHarvestAt: now },
    added,
    gamesScanned,
  };
}

/* ---------------- practice semantics ---------------- */

/** Exact-SAN v1 grading, identical in spirit to practiceQueue: the only
    correct answer is the engine's verified best move. */
export function gradeLabMove(exercise: LabExercise, san: string): 'correct' | 'wrong' {
  return san === exercise.bestSan ? 'correct' : 'wrong';
}

export type LabOutcome = 'clean' | 'after-wrong' | 'assisted';

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
  return { ...state, session: { queue, index: 0, startedAt: now, results: [] } };
}

/** The exercise the session is currently asking about (null = done/none). */
export function currentExercise(state: MistakeLabState): LabExercise | null {
  const session = state.session;
  if (!session || session.index >= session.queue.length) return null;
  const id = session.queue[session.index];
  return state.exercises.find((x) => x.id === id) ?? null;
}

/** Advance the session after recording an outcome. Pure. */
export function completeCurrent(state: MistakeLabState, outcome: LabOutcome, now: number): MistakeLabState {
  const session = state.session;
  if (!session) return state;
  const id = session.queue[session.index];
  if (!id) return state;
  const withOutcome: LabSession = {
    ...session,
    index: session.index + 1,
    results: [...session.results, { id, outcome }],
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
