/* Pure server-side adjudication rules — imported by the Edge Functions
   (Deno, relative path) AND unit-tested in vitest, so the policy lives
   in exactly one place. */

/** Minimal structural view of a chess.js instance — keeps this module
    importable by BOTH Deno (edge functions) and vitest. */
export interface ChessSquareView {
  square: string;
  type: string;
  color: string;
}
export interface ChessLike {
  board(): (ChessSquareView | null)[][];
}

/**
 * The single expiry boundary: a side whose elapsed time has reached its
 * remaining time has LOST on time. `elapsed === remaining` is already
 * expired (FIDE 6.9 — the flag falls the moment the time is exhausted).
 */
export function isExpired(elapsedMs: number, remainingMs: number): boolean {
  return elapsedMs >= remainingMs;
}

/**
 * FIDE 6.9: a player out of time wins — UNLESS the opponent cannot
 * checkmate by ANY series of legal moves, in which case the game is
 * drawn. With the flagged player's pieces still on the board a help-mate
 * is always possible, so the material of BOTH sides matters: no pawns,
 * no rooks, no queens, and every bishop on the same square color ⇒ no
 * mate exists against anything ⇒ draw.
 */
export function insufficientMaterialForAnyMate(c: ChessLike, winnerColor: 'w' | 'b'): boolean {
  // per-side material scan
  let winnerPawnsRooksQueens = 0;
  let winnerKnights = 0;
  const winnerBishopColors: ('light' | 'dark')[] = [];
  let winnerMinors = 0;
  let defenderPieces = 0;
  const board = c.board();
  for (const row of board) {
    for (const sq of row) {
      if (!sq || sq.type === 'k') continue;
      const mine = sq.color === winnerColor;
      if (sq.type === 'p' || sq.type === 'r' || sq.type === 'q') {
        if (mine) winnerPawnsRooksQueens += 1;
        else defenderPieces += 1;
        continue;
      }
      if (mine) {
        if (sq.type === 'n') {
          winnerKnights += 1;
          winnerMinors += 1;
        }
        if (sq.type === 'b') {
          const dark = (sq.square.charCodeAt(0) + sq.square.charCodeAt(1)) % 2 === 0;
          winnerBishopColors.push(dark ? 'dark' : 'light');
          winnerMinors += 1;
        }
      } else {
        defenderPieces += 1; // any defender piece can self-block escape squares
      }
    }
  }
  // heavy material for the winner: mate is reachable
  if (winnerPawnsRooksQueens > 0) return false;
  // two knights have help-mates against any defense
  if (winnerKnights >= 2) return false;
  // opposite-colored winner bishops cover every escape color
  if (winnerBishopColors.length > 0 && winnerBishopColors.some((b) => b !== winnerBishopColors[0])) return false;
  // bishop + knight (any count, any colors — the knight covers the
  // bishop's missing color; KBN help-mates vs a bare king exist):
  // always sufficient
  if (winnerBishopColors.length >= 1 && winnerKnights >= 1) return false;
  // a single minor can mate only when the defender still owns a piece
  // that can self-block; vs a bare king no mate exists
  if (winnerMinors >= 1) return defenderPieces === 0;
  return true; // bare winner can never deliver mate
}

/**
 * The result when `flaggedSide` runs out of clock, per the rule above.
 */
export function timeoutResult(
  c: ChessLike,
  flaggedSide: 'w' | 'b',
): { result: 'white' | 'black' | 'draw'; reason: 'timeout' } {
  // the claimer is the NON-flagged side — if their material cannot mate
  // any position, the timeout is a draw (FIDE 6.9)
  const claimer = flaggedSide === 'w' ? 'b' : 'w';
  const draw = insufficientMaterialForAnyMate(c, claimer);
  return {
    result: draw ? 'draw' : flaggedSide === 'w' ? 'black' : 'white',
    reason: 'timeout',
  };
}

/** Reconcile-on-expiry outcome for command handlers. */
export interface ExpiryOutcome {
  expired: boolean;
  result: 'white' | 'black' | 'draw';
  reason: 'timeout';
  /** the seat whose clock ran out */
  flagged: 'w' | 'b';
}

export function expiryOutcome(
  c: ChessLike,
  clock: {
    turn: 'w' | 'b';
    turn_started_at: string | null;
    white_ms_remaining: number;
    black_ms_remaining: number;
  },
  now: number,
): ExpiryOutcome | null {
  if (!clock.turn_started_at) return null;
  const elapsed = Math.max(0, now - new Date(clock.turn_started_at).getTime());
  const remaining = clock.turn === 'w' ? clock.white_ms_remaining : clock.black_ms_remaining;
  if (!isExpired(elapsed, remaining)) return null;
  return {
    expired: true,
    flagged: clock.turn,
    ...timeoutResult(c, clock.turn),
  };
}
