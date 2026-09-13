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
  const headers = game.getHeaders();
  return {
    ok: true,
    game: {
      moves: history,
      pgn: game.pgn(),
      startFen: START_FEN,
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

/** Export a move list (SAN) as a clean PGN with headers. */
export function exportPgn(moves: string[], headers: { white?: string; black?: string; result?: string } = {}): string {
  const game = new Chess();
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
