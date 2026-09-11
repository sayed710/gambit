import { Chess } from 'chess.js';
import type { Ply } from '../lib/types';

/**
 * Morphy vs. Karl, Count of Brunswick & Isouard — Paris Opera, 1858.
 * The most famous miniature ever played; replayed on the landing board.
 */
const OPERA_GAME_SAN = [
  'e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5',
  'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5', 'Nxb5', 'cxb5',
  'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8', 'Rxd7', 'Rxd7', 'Rd1', 'Qe6', 'Bxd7+', 'Nxd7',
  'Qb8+', 'Nxb8', 'Rd8#',
];

export interface ReplayGame {
  title: string;
  white: string;
  black: string;
  venue: string;
  plies: Ply[];
  finalFen: string;
  valid: boolean;
}

function buildReplay(sanList: string[]): ReplayGame {
  const game = new Chess();
  const plies: Ply[] = [];
  let valid = true;
  for (const san of sanList) {
    try {
      const m = game.move(san);
      plies.push({
        san: m.san,
        from: m.from,
        to: m.to,
        color: m.color,
        fenAfter: m.after,
        isCapture: m.isCapture(),
        isCheck: m.san.includes('+') || m.san.includes('#'),
      });
    } catch {
      valid = false;
      break;
    }
  }
  return {
    title: 'The Opera Game',
    white: 'Paul Morphy',
    black: 'Duke of Brunswick & Count Isouard',
    venue: 'Paris, 1858',
    plies,
    finalFen: game.fen(),
    valid,
  };
}

export const LANDING_GAME: ReplayGame = buildReplay(OPERA_GAME_SAN);
