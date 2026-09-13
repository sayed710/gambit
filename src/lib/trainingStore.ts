import { loadJSON, saveJSON } from './storage';

/* ============================================================
   trainingStore — versioned persistence for every training
   system: endgame academy progress, repertoire spaced-repetition
   scheduling, adaptive queue, tactical-motif statistics.

   One key (gambit.training.v1), defensive normalization, additive
   schemas — never discards user data on a schema mismatch.
   ============================================================ */

export const TRAINING_KEY = 'training.v1'; // storage layer adds the gambit. prefix

export interface EndgameProgress {
  attempted: number;
  solved: number;
  /** fewest moves-to-completion ever needed (null = never solved) */
  bestAttempts: number | null;
  lastPracticed: number | null;
  /** solved / attempted, clamped 0..1 */
  mastery: number;
}

export type SrGrade = 'again' | 'hard' | 'good' | 'easy';

export interface SrRecord {
  /** epoch ms the position is next due */
  due: number;
  /** current interval in days (0 = not yet learned) */
  interval: number;
  reps: number;
  ease: number;
  lapses: number;
  lastResult: SrGrade | null;
}

export interface MotifStat {
  seen: number;
  missed: number;
  lastSeen: number | null;
}

export type AdaptiveItemKind = 'puzzle' | 'mistake' | 'repertoire' | 'endgame' | 'motif' | 'visualization';

export interface AdaptiveItem {
  id: string;
  kind: AdaptiveItemKind;
  /** why this was recommended — shown to the user verbatim */
  reason: string;
  /** deterministic priority, higher = more urgent */
  score: number;
  /** payload for the drill page (game id, lesson id, motif, ...) */
  ref: Record<string, string>;
  createdAt: number;
}

export interface TrainingState {
  version: 1;
  endgame: Record<string, EndgameProgress>;
  /** key: `${repertoireId}:${lineId}:${nodeKey}` */
  repScheduling: Record<string, SrRecord>;
  motifs: Record<string, MotifStat>;
  adaptive: { queue: AdaptiveItem[]; lastGenerated: number | null };
}

export function uid(prefix = 't'): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function emptyTrainingState(): TrainingState {
  return {
    version: 1,
    endgame: {},
    repScheduling: {},
    motifs: {},
    adaptive: { queue: [], lastGenerated: null },
  };
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const int = (v: unknown, fallback = 0): number => Math.max(0, Math.round(num(v, fallback)));

export function normalizeTrainingState(raw: unknown): TrainingState {
  const base = emptyTrainingState();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<TrainingState>;

  const endgame: TrainingState['endgame'] = {};
  if (r.endgame && typeof r.endgame === 'object') {
    for (const [id, p] of Object.entries(r.endgame)) {
      if (!p || typeof p !== 'object') continue;
      const attempted = int((p as EndgameProgress).attempted);
      const solved = int((p as EndgameProgress).solved);
      endgame[id] = {
        attempted,
        solved: Math.min(solved, attempted || solved),
        bestAttempts: typeof (p as EndgameProgress).bestAttempts === 'number' ? (p as EndgameProgress).bestAttempts : null,
        lastPracticed: typeof (p as EndgameProgress).lastPracticed === 'number' ? (p as EndgameProgress).lastPracticed : null,
        mastery: Math.max(0, Math.min(1, num((p as EndgameProgress).mastery))),
      };
    }
  }

  const repScheduling: TrainingState['repScheduling'] = {};
  if (r.repScheduling && typeof r.repScheduling === 'object') {
    for (const [key, v] of Object.entries(r.repScheduling)) {
      if (!v || typeof v !== 'object' || typeof (v as SrRecord).due !== 'number') continue;
      const rec = v as SrRecord;
      repScheduling[key] = {
        due: rec.due,
        interval: Math.max(0, num(rec.interval)),
        reps: Math.max(0, int(rec.reps)),
        ease: Math.max(1.3, Math.min(3.2, num(rec.ease, 2.5))),
        lapses: Math.max(0, int(rec.lapses)),
        lastResult: (['again', 'hard', 'good', 'easy'] as const).includes(rec.lastResult as SrGrade)
          ? (rec.lastResult as SrGrade)
          : null,
      };
    }
  }

  const motifs: TrainingState['motifs'] = {};
  if (r.motifs && typeof r.motifs === 'object') {
    for (const [id, m] of Object.entries(r.motifs)) {
      if (!m || typeof m !== 'object') continue;
      motifs[id] = {
        seen: int((m as MotifStat).seen),
        missed: int((m as MotifStat).missed),
        lastSeen: typeof (m as MotifStat).lastSeen === 'number' ? (m as MotifStat).lastSeen : null,
      };
    }
  }

  const queue = Array.isArray(r.adaptive?.queue)
    ? (r.adaptive!.queue as AdaptiveItem[]).filter(
        (q): q is AdaptiveItem => !!q && typeof q === 'object' && typeof q.id === 'string' && typeof q.kind === 'string',
      )
    : [];

  return {
    version: 1,
    endgame,
    repScheduling,
    motifs,
    adaptive: { queue, lastGenerated: typeof r.adaptive?.lastGenerated === 'number' ? r.adaptive!.lastGenerated : null },
  };
}

export function loadTraining(): TrainingState {
  return normalizeTrainingState(loadJSON<unknown>(TRAINING_KEY, {}));
}

export function saveTraining(state: TrainingState): void {
  saveJSON(TRAINING_KEY, state);
}

/* ---------- endgame progress ---------- */

export function recordEndgameAttempt(
  prev: EndgameProgress | undefined,
  solved: boolean,
  attempts: number,
  now: number,
): EndgameProgress {
  const attempted = (prev?.attempted ?? 0) + 1;
  const solvedCount = (prev?.solved ?? 0) + (solved ? 1 : 0);
  const prevBest = prev?.bestAttempts ?? null;
  const bestAttempts = solved ? (prevBest === null ? attempts : Math.min(prevBest, attempts)) : prevBest;
  return {
    attempted,
    solved: solvedCount,
    bestAttempts,
    lastPracticed: now,
    mastery: attempted > 0 ? Math.round((solvedCount / attempted) * 1000) / 1000 : 0,
  };
}

/* ---------- SM-2-lite spaced repetition ---------- */

/**
 * Documented deterministic model (Anki-flavoured SM-2, deliberately simple):
 * - again : lapse — reps 0, interval 0 (due immediately), ease -0.20 (floor 1.30)
 * - hard  : interval * 1.2 (min 1 day), ease -0.05
 * - good  : first rep 1 day, second 3 days, then interval * ease
 * - easy  : interval * ease * 1.3 (min 1 day), ease +0.15 (cap 3.20)
 */
export function scheduleSr(prev: SrRecord, grade: SrGrade, now: number): SrRecord {
  const DAY = 86_400_000;
  let { reps, interval, ease, lapses } = prev;

  if (grade === 'again') {
    reps = 0;
    interval = 0;
    lapses += 1;
    ease = Math.max(1.3, ease - 0.2);
    return { due: now, interval, reps, ease, lapses, lastResult: 'again' };
  }

  if (grade === 'hard') {
    ease = Math.max(1.3, ease - 0.05);
    interval = Math.max(1, interval * 1.2);
    reps += 1;
  } else if (grade === 'easy') {
    ease = Math.min(3.2, ease + 0.15);
    interval = Math.max(1, (interval === 0 ? 1 : interval) * ease * 1.3);
    reps += 1;
  } else {
    ease = Math.min(3.2, ease);
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 3;
    else interval = Math.max(1, interval * ease);
  }

  return {
    due: now + Math.round(interval * DAY),
    interval,
    reps,
    ease,
    lapses,
    lastResult: grade,
  };
}
