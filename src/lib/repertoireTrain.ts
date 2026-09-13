import { findNode, lineTo, type TreeNode } from './gameTree';
import type { RepLine } from './repertoireStore';

/* ============================================================
   repertoireTrain — pure walk logic for repertoire training.
   The trainer asks the repertoire side for their move; the
   opponent's reply is auto-played along the line's first child.
   ============================================================ */

export type TrainStep =
  | { status: 'correct'; nodeId: string; oppReply?: { id: string; san: string }; lineEnd: boolean }
  | { status: 'deviation'; expectedSan: string; parentNodeId: string }
  | { status: 'line-end' };

function expectedChild(line: RepLine, node: TreeNode | null): TreeNode | null {
  const siblings = node ? node.children : line.tree.moves;
  if (!siblings || siblings.length === 0) return null;
  const parentKey = node?.id ?? '__root__';
  const preferredId = line.preferred[parentKey];
  return siblings.find((c) => c.id === preferredId) ?? siblings[0];
}

/**
 * Play `san` at position `nodeId` (null = line start).
 * - 'correct': the move is the expected repertoire move; `oppReply` carries the
 *   auto-played opponent answer (when one exists and it is the opponent's turn).
 * - 'deviation': legal but not the repertoire move; `expectedSan` is revealed.
 * - 'line-end': the position has no continuation.
 */
export function trainerStep(line: RepLine, nodeId: string | null, san: string): TrainStep {
  const node = nodeId ? findNode(line.tree, nodeId) : null;
  if (nodeId && !node) return { status: 'line-end' };
  const expected = expectedChild(line, node);
  if (!expected) return { status: 'line-end' };
  if (expected.san !== san) {
    return { status: 'deviation', expectedSan: expected.san, parentNodeId: node?.id ?? '__root__' };
  }
  const oppReply = expected.children.length > 0 ? { id: expected.children[0].id, san: expected.children[0].san } : undefined;
  return { status: 'correct', nodeId: expected.id, oppReply, lineEnd: !oppReply };
}

/** Positions along the line where the repertoire side must produce a move. */
export function trainables(line: RepLine): TreeNode[] {
  const out: TreeNode[] = [];
  const firstColor = line.tree.moves[0]?.color;
  if (!firstColor) return out;
  const walkAll = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.color === firstColor) out.push(n);
      walkAll(n.children);
    }
  };
  walkAll(line.tree.moves);
  return out;
}

/** Human-readable depth of a node within its line (for progress display). */
export function depthOf(line: RepLine, nodeId: string): number {
  const node = findNode(line.tree, nodeId);
  return node ? lineTo(line.tree, node.id).length : 0;
}
