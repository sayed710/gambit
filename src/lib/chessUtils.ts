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
 * FIDE-style timeout check: a player on time loses only if the opponent could
 * still checkmate by SOME series of legal moves (Article 6.9). We approximate
 * "some series" with standard material criteria:
 *  - any pawn, rook or queen: mate is possible
 *  - bishop AND knight, or two knights: helpmates exist
 *  - two or more bishops on opposite square colors: mate possible
 *  - a single minor piece, or bishops all on one color: no mate possible
 *  - additionally, if BOTH sides lack mating material, the game is a draw
 * Known approximation: KNN vs bare king is treated as mating material even
 * though only helpmates (not forced mates) exist in most positions.
 */
export function hasMatingMaterial(fen: string, color: Color): boolean {
  const game = new Chess(fen);
  const board = game.board();
  let knights = 0;
  let bishops = 0;
  const bishopColors = new Set<string>();
  let others = 0;
  for (const row of board) {
    for (const sq of row) {
      if (!sq || sq.color !== color || sq.type === 'k') continue;
      if (sq.type === 'n') knights++;
      else if (sq.type === 'b') {
        bishops++;
        bishopColors.add((('abcdefgh'.indexOf(sq.square[0]) + parseInt(sq.square[1], 10)) % 2).toString());
      } else others++;
    }
  }
  if (others > 0) return true; // pawn, rook or queen
  if (knights >= 1 && bishops >= 1) return true; // BN helpmates
  if (knights >= 2) return true; // KNN helpmates exist (documented approximation)
  if (bishops >= 2 && bishopColors.size >= 2) return true; // opposite-color bishops
  return false; // lone king, single minor, or same-colored bishops only
}
