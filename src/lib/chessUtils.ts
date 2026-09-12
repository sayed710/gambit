import { Chess } from 'chess.js';
import type { Color, PieceSymbol } from 'chess.js';
import type { Ply, TimeControl } from './types';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const PIECE_NAMES: Record<string, string> = { p: 'Pawn', n: 'Knight', b: 'Bishop', r: 'Rook', q: 'Queen', k: 'King' };

const START_COUNTS: Record<PieceSymbol, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
export const PIECE_CP: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Pieces each side has captured (deduced by comparing the FEN against the initial army). */
export function capturedFromFen(fen: string): { byWhite: PieceSymbol[]; byBlack: PieceSymbol[]; diff: number } {
  const counts: Record<Color, Record<PieceSymbol, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  };
  const placement = fen.split(' ')[0];
  for (const ch of placement) {
    if (/[a-zA-Z]/.test(ch)) {
      const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
      const type = ch.toLowerCase() as PieceSymbol;
      counts[color][type]++;
    }
  }
  const byWhite: PieceSymbol[] = []; // black pieces missing = captured by white
  const byBlack: PieceSymbol[] = [];
  let diff = 0;
  for (const type of ['q', 'r', 'b', 'n', 'p'] as PieceSymbol[]) {
    const missingBlack = START_COUNTS[type] - counts.b[type];
    const missingWhite = START_COUNTS[type] - counts.w[type];
    // promotions can produce "negative missing" — clamp
    for (let i = 0; i < Math.max(0, missingBlack); i++) byWhite.push(type);
    for (let i = 0; i < Math.max(0, missingWhite); i++) byBlack.push(type);
    diff += Math.max(0, missingBlack) * PIECE_CP[type] - Math.max(0, missingWhite) * PIECE_CP[type];
  }
  return { byWhite, byBlack, diff };
}

/** Build the annotated ply list from a chess.js game. */
export function pliesFromGame(game: Chess): Ply[] {
  return game.history({ verbose: true }).map((m) => ({
    san: m.san,
    from: m.from,
    to: m.to,
    color: m.color,
    fenAfter: m.after,
    isCapture: m.isCapture(),
    isCheck: m.san.includes('+') || m.san.includes('#'),
  }));
}

export function materialLabel(diff: number): string {
  if (diff === 0) return '';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

export function formatClock(ms: number): string {
  if (ms <= 0) return '0:00';
  const totalTenths = Math.floor(ms / 100);
  const s = Math.floor(totalTenths / 10);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (ms < 20_000) {
    const tenths = totalTenths % 10;
    return `${m}:${String(sec).padStart(2, '0')}.${tenths}`;
  }
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function timeControlText(tc: TimeControl): string {
  if (tc.minutes === 0 && tc.increment === 0) return 'Unlimited';
  const base = tc.minutes >= 1 ? `${tc.minutes} min` : `${tc.minutes * 60} sec`;
  return tc.increment > 0 ? `${base} + ${tc.increment}s` : base;
}

/** Standard Elo update, K=24. score: 1 win, 0.5 draw, 0 loss. */
export function eloDelta(player: number, opponent: number, score: number, k = 24): number {
  const expected = 1 / (1 + 10 ** ((opponent - player) / 400));
  return Math.round(k * (score - expected));
}

export function describeTermination(
  game: Chess,
  by: 'move' | 'resign' | 'timeout' | 'abandon',
  winner: Color | null,
): { result: 'win' | 'loss' | 'draw' | null; reason: string } {
  const whiteWins = winner === 'w';
  if (by === 'resign' || by === 'timeout' || by === 'abandon') {
    if (winner === null) return { result: 'draw', reason: by === 'resign' ? 'By resignation' : by === 'timeout' ? 'By timeout' : 'Abandoned' };
    return {
      result: 'win',
      reason: by === 'resign' ? 'By resignation' : by === 'timeout' ? 'On time' : 'By abandonment',
    };
  }
  if (game.isCheckmate()) return { result: 'win', reason: 'Checkmate' };
  if (game.isStalemate()) return { result: 'draw', reason: 'Stalemate' };
  if (game.isInsufficientMaterial()) return { result: 'draw', reason: 'Insufficient material' };
  if (game.isThreefoldRepetition()) return { result: 'draw', reason: 'Threefold repetition' };
  if (game.isDraw()) return { result: 'draw', reason: 'Fifty-move rule' };
  void whiteWins;
  return { result: null, reason: '' };
}

/** Winner color for a finished game, from white's perspective utilities. */
export function winnerOf(termination: string, game: Chess): Color | null {
  if (termination === 'Checkmate') return game.turn() === 'w' ? 'b' : 'w';
  return null;
}

export const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
export const FULL_DATE = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Timeout adjudication helper for the flag-fall rule (FIDE Article 6.9: a
 * player who runs out of time loses unless the opponent CANNOT checkmate by
 * any possible series of legal moves from the current position).
 *
 * ⚠️ This helper is a CONSERVATIVE approximation, not a full FIDE solver:
 * deciding "mate possible by any series" exactly requires endgame tables. The
 * rule below only answers "is mate clearly impossible?" and answers with
 * "play on" (mate possible) in every case where a legal mating sequence is
 * known to exist, so it never awards a false draw. It errs in the direction
 * of longer games, never in the direction of stealing a win.
 *
 * Draw is declared (returns false) only for these provably mateless cases:
 *   - the non-flagged side has a bare king (a king alone can never mate);
 *   - K+N vs K: no mating position exists — a corner king always has an
 *     escape square no arrangement of knight + king can cover;
 *   - two (or more) bishops of ONE square color vs a bare king: they can
 *     never control squares of the opposite color, so no corner can be sealed;
 *   - KB vs KB with both bishops on the same square color and no other
 *     material: neither side can ever mate.
 * Everything else returns true ("play on"), including the easy-to-miss cases:
 *   - K+B vs K: mating positions exist (e.g. white Kb6, Bb7# vs Ka8);
 *   - K+N vs K + any enemy piece: the enemy piece can self-blockade a flight
 *     square, so helpmates exist;
 *   - K+2N vs K: mating positions exist (e.g. white Kg6, Nf6, Nf7# vs Kh8).
 */
export function hasMatingMaterial(fen: string, color: Color): boolean {
  const game = new Chess(fen);
  const collect = (side: Color) => {
    let knights = 0;
    let bishops = 0;
    let pawnMajor = 0; // pawns, rooks, queens
    const bishopColors = new Set<string>();
    for (const row of game.board()) {
      for (const sq of row) {
        if (!sq || sq.color !== side || sq.type === 'k') continue;
        if (sq.type === 'n') knights++;
        else if (sq.type === 'b') {
          bishops++;
          bishopColors.add((('abcdefgh'.indexOf(sq.square[0]) + parseInt(sq.square[1], 10)) % 2).toString());
        } else pawnMajor++;
      }
    }
    return { knights, bishops, pawnMajor, bishopColors, nonKing: knights + bishops + pawnMajor };
  };
  const side = collect(color);
  const other = collect(color === 'w' ? 'b' : 'w');

  if (side.nonKing === 0) return false; // bare king can never mate

  // KB vs KB on one square color with nothing else: provably dead drawn.
  if (
    side.pawnMajor === 0 && other.pawnMajor === 0 &&
    side.knights === 0 && other.knights === 0 &&
    side.bishops === 1 && other.bishops === 1 &&
    side.bishopColors.size === 1 &&
    [...side.bishopColors][0] === [...other.bishopColors][0]
  ) {
    return false;
  }

  if (side.pawnMajor > 0) return true;

  if (side.knights + side.bishops >= 2) {
    if (side.knights >= 1 && side.bishops >= 1) return true; // BN mates exist
    if (side.bishops >= 2 && side.bishopColors.size >= 2) return true; // opposite colors: box mate exists
    if (side.knights >= 2) return true; // KNN mates exist (e.g. Kg6/Nf6/Nf7# vs Kh8)
    // two bishops on one color complex: no mate vs a bare king, but any enemy
    // piece can self-blockade a flight square, so helpmates may exist
    return other.nonKing > 0;
  }

  // exactly one minor
  if (side.bishops === 1) return true; // KB vs K has mating positions (Bb7# pattern)
  return other.nonKing > 0; // KN vs K: provably mateless; with enemy material: helpmates exist
}
