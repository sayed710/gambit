import type { SrGrade } from './trainingStore';
import { scheduleSr, type SrRecord, type TrainingState } from './trainingStore';

/* ============================================================
   repertoireTrain2 — spaced-repetition integration for the
   repertoire trainer: stable keys, grade recording, training
   modes (due / weak / new / full / random) and dashboard stats.
   The schedule itself lives in gambit.training.v1.
   ============================================================ */

export interface RepertoireRef {
  repertoireId: string;
  lineId: string;
  /** stable position key inside the line */
  nodeKey: string;
  /** the expected move (display) */
  san: string;
}

export function gradeKey(repertoireId: string, lineId: string, nodeKey: string): string {
  return `${repertoireId}:${lineId}:${nodeKey}`;
}

/** Grade a drilled position and persist the schedule. Mutates state in place. */
export function recordRepDrill(
  state: TrainingState,
  ref: RepertoireRef,
  grade: SrGrade,
  now: number,
): SrRecord {
  const key = gradeKey(ref.repertoireId, ref.lineId, ref.nodeKey);
  const prev: SrRecord = state.repScheduling[key] ?? {
    due: 0,
    interval: 0,
    reps: 0,
    ease: 2.5,
    lapses: 0,
    lastResult: null,
  };
  const next = scheduleSr(prev, grade, now);
  state.repScheduling[key] = next;
  return next;
}

/** Positions scheduled and currently due (overdue counts). */
export function dueCount(state: TrainingState, now: number): number {
  return Object.values(state.repScheduling).filter((r) => r.due <= now).length;
}

export interface TrainingStats {
  due: number;
  mastered: number;
  learning: number;
  /** average interval days across scheduled positions (0 = none) */
  retention: number;
}

export function trainingStats(state: TrainingState, now: number): TrainingStats {
  const records = Object.values(state.repScheduling);
  let due = 0;
  let mastered = 0;
  let learning = 0;
  let intervalSum = 0;
  for (const r of records) {
    if (r.due <= now) due += 1;
    if (r.interval >= 21) mastered += 1;
    else learning += 1;
    intervalSum += r.interval;
  }
  return {
    due,
    mastered,
    learning,
    retention: records.length ? Math.round((intervalSum / records.length) * 10) / 10 : 0,
  };
}

export type TrainingMode = 'due' | 'weak' | 'full' | 'random' | 'new';

/**
 * Order a set of trainable positions for the chosen mode.
 * - due    : scheduled positions whose due date has passed, most overdue first
 * - weak   : highest lapse count, then shortest interval
 * - new    : never-drilled positions only
 * - full   : natural tree order
 * - random : shuffled (caller supplies a seeded shuffle for tests)
 */
export function lineupTraining(
  state: TrainingState,
  positions: RepertoireRef[],
  now: number,
  mode: TrainingMode,
  shuffle?: <T>(arr: T[]) => T[],
): RepertoireRef[] {
  const rec = (p: RepertoireRef): SrRecord | undefined =>
    state.repScheduling[gradeKey(p.repertoireId, p.lineId, p.nodeKey)];

  switch (mode) {
    case 'due':
      return positions
        .filter((p) => {
          const r = rec(p);
          return !!r && r.due <= now;
        })
        .sort((a, b) => (rec(a)!.due ?? 0) - (rec(b)!.due ?? 0));
    case 'weak':
      return positions
        .filter((p) => rec(p))
        .sort((a, b) => (rec(b)!.lapses - rec(a)!.lapses) || (rec(a)!.interval - rec(b)!.interval));
    case 'new':
      return positions.filter((p) => !rec(p));
    case 'random': {
      const known = positions.filter((p) => rec(p));
      return shuffle ? shuffle(known) : known;
    }
    case 'full':
    default:
      return positions;
  }
}

/* ---------- full position enumeration ---------- */

import { expectedChildAt, sideToMoveAt } from './repertoireTrain';
import type { GameTreeData } from './gameTree';

export interface TrainablePosition extends RepertoireRef {
  /** '__root__' for the line start */
  nodeKey: string;
}

/** Stable SR key for a line position. */
export function positionKey(lineId: string, nodeKey: string): string {
  return `${lineId}:${nodeKey}`;
}

/**
 * Enumerate EVERY trainable position in a line — the line start plus every
 * node after which the repertoire side is to move, with the expected SAN
 * (preferred child, else first). Reuses sideToMoveAt/expectedChildAt from
 * repertoireTrain so traversal semantics live in exactly one place.
 */
export function enumerateLinePositions(
  repertoireId: string,
  lineId: string,
  tree: GameTreeData,
  side: 'w' | 'b',
): TrainablePosition[] {
  const out: TrainablePosition[] = [];
  // preferred = {} — enumeration reflects the line's natural order; the
  // trainer's own preferred-map lives in the repertoire store and is applied
  // at drill time through the same expectedChildAt helper.
  const lineView = { id: lineId, name: '', tree, preferred: {} as Record<string, string> };
  const visit = (nodeId: string | null): void => {
    if (sideToMoveAt(lineView, nodeId) === side) {
      const expected = expectedChildAt(lineView, nodeId);
      if (expected) out.push({ repertoireId, lineId, nodeKey: nodeId ?? '__root__', san: expected.san });
    }
    const children = nodeId === null ? tree.moves : (findNodeChildren(tree, nodeId) ?? []);
    for (const child of children) visit(child.id);
  };
  visit(null);
  return out;
}

function findNodeChildren(tree: GameTreeData, id: string) {
  const stack = [...tree.moves];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n.children;
    stack.push(...n.children);
  }
  return null;
}

/** All trainable positions across a set of repertoires. */
export function enumerateRepertoirePositions(
  repertoires: { id: string; side: 'w' | 'b'; lines: { id: string; tree: GameTreeData }[] }[],
): TrainablePosition[] {
  return repertoires.flatMap((r) => r.lines.flatMap((l) => enumerateLinePositions(r.id, l.id, l.tree, r.side)));
}
