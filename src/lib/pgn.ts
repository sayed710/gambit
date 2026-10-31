import { Chess } from 'chess.js';
import { START_FEN } from './chessUtils';

export interface ParsedGame {
  moves: string[]; // SAN list
  pgn: string; // normalized PGN
  startFen: string;
  finalFen: string;
  headers: { white?: string; black?: string; result?: string; date?: string; event?: string };
  moveCount: number;
}

export interface PgnImportError {
  stage: 'parse' | 'empty';
  message: string;
}

/** Parse a PGN string; throws PgnImportError-shaped objects via `ok:false`. */
export function importPgn(text: string): { ok: true; game: ParsedGame } | { ok: false; error: PgnImportError } {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { ok: false, error: { stage: 'empty', message: 'No PGN text provided.' } };
  const game = new Chess();
  try {
    game.loadPgn(trimmed);
  } catch (e) {
    return { ok: false, error: { stage: 'parse', message: e instanceof Error ? e.message : 'Invalid PGN.' } };
  }
  const history = game.history();
  if (history.length === 0) {
    return { ok: false, error: { stage: 'empty', message: 'The PGN contains no moves.' } };
  }
  // The actual starting position: the PGN's own FEN header when present.
  // loadPgn has ALREADY replayed the moves from that header FEN (chess.js
  // applies it before validating the move text), so header legality and
  // first-move legality are enforced upstream — here we reject metadata
  // that is malformed or self-contradictory instead of silently assuming
  // the standard start.
  const fenHeader = /\[FEN "([^"]*)"\]/.exec(trimmed)?.[1];
  const setUp = /\[SetUp "([^"]*)"\]/.exec(trimmed)?.[1];
  if (fenHeader !== undefined) {
    try {
      new Chess(fenHeader);
    } catch {
      return { ok: false, error: { stage: 'parse', message: 'The PGN FEN header is not a valid chess position.' } };
    }
    if (setUp === '0') {
      return { ok: false, error: { stage: 'parse', message: 'Contradictory PGN metadata: SetUp "0" with a FEN header.' } };
    }
  } else if (setUp === '1') {
    return { ok: false, error: { stage: 'parse', message: 'Contradictory PGN metadata: SetUp "1" without a FEN header.' } };
  }
  const headers = game.getHeaders();
  return {
    ok: true,
    game: {
      moves: history,
      pgn: game.pgn(),
      startFen: fenHeader ?? START_FEN,
      finalFen: game.fen(),
      headers: {
        white: headers.White,
        black: headers.Black,
        result: headers.Result,
        date: headers.Date,
        event: headers.Event,
      },
      moveCount: history.length,
    },
  };
}

/** Export a move list (SAN) as a clean PGN with headers. `startFen`
 *  replays the moves from a NON-standard starting position (chess.js then
 *  emits the required SetUp/FEN headers automatically); omit it for games
 *  from the standard start. */
export function exportPgn(moves: string[], headers: { white?: string; black?: string; result?: string } = {}, startFen?: string): string {
  const game = new Chess(startFen);
  for (const san of moves) {
    try {
      game.move(san);
    } catch {
      break; // stop at first illegal move; export what we have
    }
  }
  game.header('Event', 'Casual game', 'Site', 'Gambit (local)', 'Date', pgnDate(), 'White', headers.white ?? 'White', 'Black', headers.black ?? 'Black', 'Result', headers.result ?? '*');
  return game.pgn();
}

function pgnDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

export function isValidFen(fen: string): boolean {
  try {
    new Chess(fen.trim());
    return true;
  } catch {
    return false;
  }
}

export function normalizeFen(fen: string): string | null {
  try {
    return new Chess(fen.trim()).fen();
  } catch {
    return null;
  }
}

/** Replay SAN moves onto a fresh board; stops at the first illegal move. */
export function replaySan(moves: string[], startFen: string = START_FEN): { game: Chess; played: string[] } {
  const game = new Chess(startFen);
  const played: string[] = [];
  for (const san of moves) {
    try {
      game.move(san);
      played.push(san);
    } catch {
      break;
    }
  }
  return { game, played };
}

/** Copy helper with a Promise<boolean> result (works on http and secure contexts). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
