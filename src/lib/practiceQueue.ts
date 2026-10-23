import { loadJSON, saveJSON } from './storage';
import { uid } from './trainingStore';

/* ============================================================
   practiceQueue — persistent local practice items, versioned
   (gambit.practice.v1). Fed from Review mistakes, confirmed
   tactical misses, repertoire deviations, or manual saves.
   Duplicate saves from the same game+ply+type are refused.
   ============================================================ */

export const PRACTICE_KEY = 'practice.v1'; // storage layer adds the gambit. prefix

export type PracticeKind = 'mistake' | 'missed-tactic' | 'repertoire' | 'position';

export interface PracticeItem {
  id: string;
  kind: PracticeKind;
  sourceGameId?: string;
  ply?: number;
  /** exact position BEFORE the move to find */
  fen: string;
  side: 'w' | 'b';
  objective: string;
  /** the move the practice should find (engine best) */
  expectedSan?: string;
  createdAt: number;
  attempts: number;
  solved: number;
  lastPracticed: number | null;
}

export function normalizePracticeList(raw: unknown): PracticeItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is PracticeItem => !!x && typeof x === 'object' && typeof (x as PracticeItem).id === 'string' && typeof (x as PracticeItem).fen === 'string')
    .map((x) => ({
      ...x,
      attempts: typeof x.attempts === 'number' ? x.attempts : 0,
      solved: typeof x.solved === 'number' ? x.solved : 0,
      lastPracticed: typeof x.lastPracticed === 'number' ? x.lastPracticed : null,
    }));
}

export function loadPractice(): PracticeItem[] {
  return normalizePracticeList(loadJSON<unknown>(PRACTICE_KEY, []));
}

export function savePractice(list: PracticeItem[]): void {
  saveJSON(PRACTICE_KEY, list);
}

/**
 * Add a practice item. Returns null when an item with the same
 * sourceGameId+ply+kind already exists (duplicate prevented).
 */
export function addPracticeItem(
  list: PracticeItem[],
  item: Omit<PracticeItem, 'id' | 'createdAt' | 'attempts' | 'solved' | 'lastPracticed'>,
): PracticeItem | null {
  const duplicate = list.find(
    (x) =>
      x.kind === item.kind &&
      x.sourceGameId === item.sourceGameId &&
      x.ply === item.ply,
  );
  if (duplicate) return null;
  const created: PracticeItem = {
    ...item,
    id: uid('p'),
    createdAt: Date.now(),
    attempts: 0,
    solved: 0,
    lastPracticed: null,
  };
  list.push(created);
  return created;
}

export type PracticeAssessment = 'correct' | 'wrong' | 'ungraded';

/**
 * Grade a played SAN against the item's verified expected move.
 * v1 policy (documented): grading is exact-SAN against the engine's best
 * move. Items without a verified expected move are UNGRADED — any legal
 * move resolves them for play purposes but never counts as solved.
 * Near-equivalent moves count as wrong until an engine-verified
 * equivalence check exists.
 */
export function assessPracticeMove(item: PracticeItem, san: string): PracticeAssessment {
  if (!item.expectedSan) return 'ungraded';
  return san === item.expectedSan ? 'correct' : 'wrong';
}

export function recordPracticeAttempt(list: PracticeItem[], id: string, solved: boolean): void {
  const item = list.find((x) => x.id === id);
  if (!item) return;
  item.attempts += 1;
  if (solved) item.solved += 1;
  item.lastPracticed = Date.now();
}
