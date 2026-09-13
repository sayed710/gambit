import { findNode, lineTo, type TreeNode } from './gameTree';
import type { RepLine } from './repertoireStore';

/* ============================================================
   repertoireTrain — pure walk logic for repertoire training.

   The trainer ALWAYS auto-advances until the repertoire side is
   actually to move before prompting:
   - White repertoire: prompts at the root, opponent replies auto-played.
   - Black repertoire: the opponent's White move is auto-played first
     (preferred continuation if marked, otherwise the first child),
     then Black is asked, and so on.
   ============================================================ */

export type TrainStep =
  | { status: 'correct'; nodeId: string; oppReply?: { id: string; san: string }; lineEnd: boolean }
  | { status: 'deviation'; expectedSan: string; parentNodeId: string }
  | { status: 'line-end' };

function childrenAt(line: RepLine, nodeId: string | null): TreeNode[] {
  if (nodeId === null) return line.tree.moves;
  const node = findNode(line.tree, nodeId);
  return node ? node.children : [];
}

/** The move the trainer expects at this position (preferred child, else first). */
export function expectedChildAt(line: RepLine, nodeId: string | null): TreeNode | null {
  const siblings = childrenAt(line, nodeId);
  if (!siblings.length) return null;
  const key = nodeId ?? '__root__';
  const preferredId = line.preferred[key];
  return siblings.find((c) => c.id === preferredId) ?? siblings[0];
}

export function expectedSanAt(line: RepLine, nodeId: string | null): string | null {
  return expectedChildAt(line, nodeId)?.san ?? null;
}

/** Side to move at a position (null = line start). */
export function sideToMoveAt(line: RepLine, nodeId: string | null): 'w' | 'b' {
  if (nodeId === null) {
    const first = line.tree.moves[0];
    return first ? first.color : 'w';
  }
  const node = findNode(line.tree, nodeId);
  if (!node) return 'w';
  return node.color === 'w' ? 'b' : 'w';
}

export interface AdvanceResult {
  /** position where the repertoire side is to move (or the last reached) */
  nodeId: string | null;
  /** opponent moves auto-played to get there, in order */
  replies: { id: string; san: string }[];
  /** true when the line ended before the repertoire side could move again */
  ended: boolean;
}

/** Auto-play opponent moves (preferred continuation, else first child) until the repertoire side is to move. */
export function advanceToRepertoireSide(line: RepLine, nodeId: string | null, side: 'w' | 'b'): AdvanceResult {
  const replies: AdvanceResult['replies'] = [];
  let current = nodeId;
  for (let guard = 0; guard < 512; guard++) {
    if (sideToMoveAt(line, current) === side) {
      return { nodeId: current, replies, ended: false };
    }
    const next = expectedChildAt(line, current);
    if (!next) {
      return { nodeId: current, replies, ended: true };
    }
    replies.push({ id: next.id, san: next.san });
    current = next.id;
  }
  return { nodeId: current, replies, ended: true };
}

/**
 * Grade a played move at a position where the repertoire side is to move.
 * - 'correct': matches the expected repertoire move; `oppReply` carries the
 *   auto-played opponent answer when one exists.
 * - 'deviation': legal but not the repertoire move; `expectedSan` is revealed.
 * - 'line-end': no continuation exists (or the position is unreachable).
 */
export function trainerStep(line: RepLine, nodeId: string | null, san: string, side: 'w' | 'b'): TrainStep {
  if (nodeId !== null && !findNode(line.tree, nodeId)) return { status: 'line-end' };
  if (sideToMoveAt(line, nodeId) !== side) return { status: 'line-end' };
  const expected = expectedChildAt(line, nodeId);
  if (!expected) return { status: 'line-end' };
  if (expected.san !== san) {
    return { status: 'deviation', expectedSan: expected.san, parentNodeId: nodeId ?? '__root__' };
  }
  const oppReply = expected.children.length > 0 ? { id: expected.children[0].id, san: expected.children[0].san } : undefined;
  return { status: 'correct', nodeId: expected.id, oppReply, lineEnd: !oppReply };
}

/** Human-readable depth of a node within its line (for progress display). */
export function depthOf(line: RepLine, nodeId: string): number {
  const node = findNode(line.tree, nodeId);
  return node ? lineTo(line.tree, node.id).length : 0;
}
