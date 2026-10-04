import { Chess } from 'chess.js';
import type { Color, Square } from 'chess.js';
import { START_FEN } from './chessUtils';
import { findNode, type GameTreeData } from './gameTree';
import type { Repertoire } from './repertoireStore';
import { expectedChildAt } from './repertoireTrain';

/* ============================================================
   repertoireMatch — deterministic comparison between a saved game
   and the user's repertoire for their color. Matches by actual
   move sequence (position walk), never by opening name. Respects
   the REAL preferred map via expectedChildAt.

   Tie-break when multiple repertoires match: deepest followed run
   wins; ties broken by creation order (id ascending) — documented.
   ============================================================ */

export interface RepertoireMatchResult {
  repertoireId: string;
  /** how many plies the player followed the repertoire */
  followedPlies: number;
  deviation:
    | null
    | {
        ply: number; // 1-based ply of the deviating move
        who: 'user' | 'opponent';
        playedSan: string;
        expectedSan: string | null;
        fen: string; // position BEFORE the deviating move
        nodeKey: string; // position key for SR scheduling
      };
}

interface WalkState {
  nodeId: string | null;
  followed: number;
  fen: string;
}

function expectedAt(line: { tree: GameTreeData; preferred: Record<string, string>; id: string; name?: string }, nodeId: string | null) {
  return expectedChildAt({ ...line, name: line.name ?? 'Match' }, nodeId);
}

function sideToMoveFen(fen: string): Color {
  return fen.split(' ')[1] === 'b' ? 'b' : 'w';
}

function walkLine(
  line: { id: string; tree: GameTreeData; preferred: Record<string, string> },
  sanMoves: string[],
  playerColor: Color,
  startFen: string,
): RepertoireMatchResult {
  const result: RepertoireMatchResult = { repertoireId: 'x', followedPlies: 0, deviation: null };
  let state: WalkState = { nodeId: null, followed: 0, fen: startFen };
  // the line's start position must match the game's start position (start-position repertoires only in v1)
  if (line.tree.startFen !== START_FEN) return result;

  for (let i = 0; i < sanMoves.length; i++) {
    const san = sanMoves[i];
    const mover = sideToMoveFen(state.fen);
    const expected = expectedAt(line, state.nodeId);

    if (mover === playerColor) {
      // the player must play the repertoire move (preferred else first)
      if (!expected) break; // line exhausted — followed to the end
      if (san !== expected.san) {
        result.deviation = {
          ply: i + 1,
          who: 'user',
          playedSan: san,
          expectedSan: expected.san,
          fen: state.fen,
          nodeKey: state.nodeId ?? '__root__',
        };
        break;
      }
      state = { nodeId: expected.id, followed: state.followed + 1, fen: expected.fenAfter };
    } else {
      // the opponent may play anything — advance only if it stays in the line
      const node = state.nodeId
        ? findNode(line.tree, state.nodeId)
        : null;
      const children = state.nodeId ? (node?.children ?? []) : line.tree.moves;
      const next = children.find((c) => c.san === san);
      if (!next) {
        result.deviation = {
          ply: i + 1,
          who: 'opponent',
          playedSan: san,
          expectedSan: expected?.san ?? null,
          fen: state.fen,
          nodeKey: state.nodeId ?? '__root__',
        };
        break;
      }
      state = { nodeId: next.id, followed: state.followed + 1, fen: next.fenAfter };
    }
  }

  result.followedPlies = state.followed;
  result.repertoireId = line.id;
  return result;
}

/** Match a saved game against every same-color repertoire; deepest run wins. */
export function matchRepertoire(
  repertoires: Repertoire[],
  playerColor: Color,
  sanMoves: string[],
): RepertoireMatchResult | null {
  const sameColor = repertoires.filter((r) => r.side === playerColor);
  if (sameColor.length === 0) return null;

  let best: RepertoireMatchResult | null = null;
  for (const rep of sameColor) {
    for (const line of rep.lines) {
      const walk = walkLine(line, sanMoves, playerColor, START_FEN);
      walk.repertoireId = rep.id;
      const better =
        best === null ||
        walk.followedPlies > best.followedPlies ||
        (walk.followedPlies === best.followedPlies &&
          walk.repertoireId < best.repertoireId); // deterministic id tie-break
      if (better) best = walk;
    }
  }
  return best;
}

/** Squares a piece attacks — used by callers to display the deviation board. */
export function deviationFen(fen: string, from: Square, to: Square): string | null {
  const game = new Chess(fen);
  try {
    game.move({ from, to, promotion: 'q' });
    return game.fen();
  } catch {
    return null;
  }
}
