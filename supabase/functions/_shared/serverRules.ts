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
  if (winnerBishopColors.length >= 1) {
    // the winner owns ONLY bishops, all on ONE square color: checkmate
    // is possible only if the defender can self-block or occupy the
    // opposite color — i.e. the defender owns ANY piece that is not a
    // bishop of that same color (FIDE 6.9: KB vs KB on the same color
    // can never produce mate; a defender pawn/rook/knight/queen or an
    // opposite-colored bishop restores the help-mate)
    const winnerColor0 = winnerBishopColors[0];
    let defenderUsable = 0;
    const board2 = c.board();
    for (const row of board2) {
      for (const sq of row) {
        if (!sq || sq.type === 'k' || sq.color === winnerColor) continue;
        if (sq.type === 'b') {
          const dark = (sq.square.charCodeAt(0) + sq.square.charCodeAt(1)) % 2 === 0;
          if ((dark ? 'dark' : 'light') === winnerColor0) continue; // stuck — cannot help mate
          defenderUsable += 1;
        } else {
          defenderUsable += 1;
        }
      }
    }
    return defenderUsable === 0; // no mate exists -> draw
  }
  // a BARE claimer (no minors, no heavy pieces) can never deliver a
  // check at all — no mate exists regardless of what the flagged side
  // still owns (its pieces could only self-block a check that cannot
  // be given)
  if (winnerMinors === 0) return true;
  // a single knight checks both colors: mate exists when the defender
  // still owns a piece that can self-block; vs a bare king none does
  return defenderPieces === 0;
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

/**
 * The honest action for a room that has been inactive past its expiry:
 * waiting/ready rooms are simply ABANDONED; an ACTIVE room is adjudicated
 * ONLY when the side to move has truly flagged — elapsed (one numeric
 * server reading minus turn_started_at) compared against that player's
 * REMAINING balance (a long game with increments can legally bank more
 * than the expiry window; banked-but-unexpired time is never a fake win).
 * completed/abandoned rooms need no action.
 */
export function staleRoomAction(
  room: {
    status: string;
    turn: 'w' | 'b';
    turn_started_at: string | null;
    white_ms_remaining: number;
    black_ms_remaining: number;
  },
  nowMs: number,
): 'timeout' | 'abandon' | 'none' {
  if (room.status === 'waiting' || room.status === 'ready') return 'abandon';
  if (room.status !== 'active') return 'none';
  const elapsed = room.turn_started_at
    ? Math.max(0, nowMs - new Date(room.turn_started_at).getTime())
    : 0;
  const remaining = room.turn === 'w' ? room.white_ms_remaining : room.black_ms_remaining;
  return elapsed >= remaining ? 'timeout' : 'abandon';
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
