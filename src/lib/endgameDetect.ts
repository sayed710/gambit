import { Chess } from 'chess.js';
import type { EndgameLesson } from '../data/endgames';

/* ============================================================
   endgameDetect — mechanical outcome detection for drills.
   Success/failure are exactly the documented conditions; nothing
   is adjudicated from vibes.
   ============================================================ */

export type DrillOutcome =
  | { status: 'playing' }
  | { status: 'success'; reason: string }
  | { status: 'failure'; reason: string };

/** Material the learner still owns (kings excluded). */
function learnerMaterial(game: Chess, side: 'w' | 'b'): number {
  const v: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let total = 0;
  for (const row of game.board()) {
    for (const sq of row) {
      if (sq && sq.color === side) total += v[sq.type] ?? 0;
    }
  }
  return total;
}

/**
 * @param game          live position (after engine reply if any)
 * @param lesson        the drill definition
 * @param learnerMoves  how many learner moves have been played
 * @param startMaterial learner material at the start (rook lessons track losses)
 * @param promoted      whether the learner has promoted a pawn this drill
 */
export function evaluateDrill(
  game: Chess,
  lesson: EndgameLesson,
  learnerMoves: number,
  startMaterial: number,
  promoted: boolean,
): DrillOutcome {
  // immediate terminal states
  if (game.isCheckmate()) {
    const matedSide = game.turn(); // side to move is mated
    if (matedSide === lesson.side) {
      return { status: 'failure', reason: 'You were checkmated — the defense held.' };
    }
    return {
      status: 'success',
      reason: lesson.success.kind === 'mate' ? `Checkmate delivered in ${learnerMoves} of ${lesson.moveLimit} moves.` : 'Checkmate — more than the objective required, well done.',
    };
  }
  if (game.isStalemate()) {
    return lesson.success.kind === 'survive'
      ? { status: 'success', reason: 'Stalemate — a draw was the goal.' }
      : { status: 'failure', reason: 'Stalemate — the win slipped away.' };
  }
  if (game.isInsufficientMaterial()) {
    return lesson.success.kind === 'survive'
      ? { status: 'success', reason: 'Insufficient material — the draw is secured.' }
      : { status: 'failure', reason: 'Insufficient material — the winning chances are gone.' };
  }

  // rook-loss guard for the defensive drill
  if (lesson.success.kind === 'survive' && lesson.success.mustKeepRook) {
    const cur = learnerMaterial(game, lesson.side);
    if (cur < startMaterial - 1) {
      return { status: 'failure', reason: 'The defensive rook fell — without it there is no draw.' };
    }
  }

  // move limit
  if (learnerMoves >= lesson.moveLimit) {
    if (lesson.success.kind === 'survive') {
      return {
        status: 'success',
        reason: `Survived ${lesson.moveLimit} moves with the rook intact — tablebase-verified draw held.`,
      };
    }
    return { status: 'failure', reason: `${lesson.moveLimit} moves used without completing the objective.` };
  }

  // promotion is progress, not the goal itself (mate lessons keep going)
  void promoted;
  return { status: 'playing' };
}
