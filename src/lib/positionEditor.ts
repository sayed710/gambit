import { Chess } from 'chess.js';
import type { Square } from 'chess.js';

/* ============================================================
   positionEditor — pure logic behind the Position Editor page.
   The editor works on a piece placement map; FEN building and
   validation live here so the UI stays declarative and the
   rules are testable.
   ============================================================ */

export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type PlacedPiece = { c: 'w' | 'b'; t: PieceType };
export type PiecePlacement = Partial<Record<Square, PlacedPiece>>;

export interface CastlingRights {
  K: boolean;
  Q: boolean;
  k: boolean;
  q: boolean;
}

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

export function allSquares(): Square[] {
  const out: Square[] = [];
  for (let r = 8; r >= 1; r--) for (const f of FILES) out.push(`${f}${r}` as Square);
  return out;
}

export function startingPlacement(): PiecePlacement {
  const p = placementFromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  return p;
}

const FEN_LETTER: Record<string, string> = {
  'wp': 'P', 'wn': 'N', 'wb': 'B', 'wr': 'R', 'wq': 'Q', 'wk': 'K',
  'bp': 'p', 'bn': 'n', 'bb': 'b', 'br': 'r', 'bq': 'q', 'bk': 'k',
};

export function buildFen(placement: PiecePlacement, turn: 'w' | 'b', castling: CastlingRights, ep: string): string {
  const rows: string[] = [];
  for (let r = 8; r >= 1; r--) {
    let row = '';
    let empty = 0;
    for (const f of FILES) {
      const piece = placement[`${f}${r}` as Square];
      if (!piece) {
        empty += 1;
        continue;
      }
      if (empty) {
        row += String(empty);
        empty = 0;
      }
      row += FEN_LETTER[piece.c + piece.t] ?? '';
    }
    if (empty) row += String(empty);
    rows.push(row || '8');
  }
  const castleStr =
    `${castling.K ? 'K' : ''}${castling.Q ? 'Q' : ''}${castling.k ? 'k' : ''}${castling.q ? 'q' : ''}` || '-';
  return `${rows.join('/')} ${turn} ${castleStr} ${ep || '-'} 0 1`;
}

/** Rights only make sense while the king and rook sit on their home squares. */
export function availableCastling(placement: PiecePlacement): CastlingRights {
  const has = (sq: Square, c: 'w' | 'b', t: PieceType) => placement[sq]?.c === c && placement[sq]?.t === t;
  return {
    K: has('e1', 'w', 'k') && has('h1', 'w', 'r'),
    Q: has('e1', 'w', 'k') && has('a1', 'w', 'r'),
    k: has('e8', 'b', 'k') && has('h8', 'b', 'r'),
    q: has('e8', 'b', 'k') && has('a8', 'b', 'r'),
  };
}

export type ValidateResult = { ok: true; fen: string } | { ok: false; reason: string };

/** Full legality gate: piece counts, chess.js parse, back-rank pawns, check paradox. */
export function validatePosition(fen: string): ValidateResult {
  const rows = fen.split(' ')[0].split('/');
  let whiteKings = 0;
  let blackKings = 0;
  rows.forEach((row, i) => {
    const rank = 8 - i;
    for (const ch of row) {
      if (ch === 'K') whiteKings += 1;
      if (ch === 'k') blackKings += 1;
      if (ch === 'P' || ch === 'p') {
        if (rank === 8 || rank === 1) {
          // early exit via thrown check below keeps this pure
        }
      }
    }
  });
  if (whiteKings === 0) return { ok: false, reason: 'The white king is missing.' };
  if (blackKings === 0) return { ok: false, reason: 'The black king is missing.' };
  if (whiteKings > 1) return { ok: false, reason: 'There is more than one white king.' };
  if (blackKings > 1) return { ok: false, reason: 'There is more than one black king.' };

  for (const ch of rows[0]) {
    if (ch === 'P' || ch === 'p') return { ok: false, reason: 'A pawn sits on the back rank.' };
  }
  for (const ch of rows[7]) {
    if (ch === 'P' || ch === 'p') return { ok: false, reason: 'A pawn sits on the first rank.' };
  }

  let game: Chess;
  try {
    game = new Chess(fen);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message.replace(/^Invalid FEN: /i, '') : 'Invalid position.' };
  }

  // the side NOT to move may not already be in check
  const parts = fen.split(' ');
  const flipped = `${parts[0]} ${parts[1] === 'w' ? 'b' : 'w'} ${parts[2]} ${parts[3]} 0 1`;
  try {
    const flippedGame = new Chess(flipped);
    if (flippedGame.isCheck()) {
      return { ok: false, reason: 'The side not to move is in check — illegal position.' };
    }
  } catch {
    /* flipped parse failure is surfaced by the primary load */
  }
  void game;
  return { ok: true, fen };
}

export function placementFromFen(fen: string): PiecePlacement {
  const out: PiecePlacement = {};
  const placement = fen.split(' ')[0];
  const rows = placement.split('/');
  rows.forEach((row, i) => {
    const rank = 8 - i;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) {
        file += Number(ch);
        continue;
      }
      const c = ch === ch.toUpperCase() ? 'w' : 'b';
      const t = ch.toLowerCase();
      if (['p', 'n', 'b', 'r', 'q', 'k'].includes(t)) {
        out[`${FILES[file]}${rank}` as Square] = { c: c as 'w' | 'b', t: t as PieceType };
      }
      file += 1;
    }
  });
  return out;
}
