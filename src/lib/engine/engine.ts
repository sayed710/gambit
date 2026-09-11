import { Chess } from 'chess.js';
import type { Move } from 'chess.js';

/**
 * A compact negamax engine with alpha-beta pruning, MVV-LVA move ordering,
 * quiescence search and piece-square tables. Strong enough to punish
 * blunders at higher levels while staying beatable and fast in a worker.
 */

export type Level = 1 | 2 | 3 | 4;

/** Human-equivalent strength labels (Stockfish drives all levels; see stockfish.ts). */
export const LEVEL_RATINGS: Record<Level, number> = { 1: 900, 2: 1400, 3: 1900, 4: 2400 };

const LEVEL_DEPTH: Record<Level, number> = { 1: 1, 2: 2, 3: 3, 4: 4 };
const LEVEL_BLUNDER: Record<Level, number> = { 1: 0.38, 2: 0.14, 3: 0.04, 4: 0 }; // chance of a random-ish move

export const MATE_SCORE = 100_000;

const PIECE_VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables, written visually (index 0 = a8 ... 63 = h1), white's perspective.
const PST: Record<string, number[]> = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0,
  ],
  n: [
    -50,-40,-30,-30,-30,-30,-40,-50,
    -40,-20,  0,  0,  0,  0,-20,-40,
    -30,  0, 10, 15, 15, 10,  0,-30,
    -30,  5, 15, 20, 20, 15,  5,-30,
    -30,  0, 15, 20, 20, 15,  0,-30,
    -30,  5, 10, 15, 15, 10,  5,-30,
    -40,-20,  0,  5,  5,  0,-20,-40,
    -50,-40,-30,-30,-30,-30,-40,-50,
  ],
  b: [
    -20,-10,-10,-10,-10,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5, 10, 10,  5,  0,-10,
    -10,  5,  5, 10, 10,  5,  5,-10,
    -10,  0, 10, 10, 10, 10,  0,-10,
    -10, 10, 10, 10, 10, 10, 10,-10,
    -10,  5,  0,  0,  0,  0,  5,-10,
    -20,-10,-10,-10,-10,-10,-10,-20,
  ],
  r: [
      0,  0,  0,  0,  0,  0,  0,  0,
      5, 10, 10, 10, 10, 10, 10,  5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
     -5,  0,  0,  0,  0,  0,  0, -5,
      0,  0,  0,  5,  5,  0,  0,  0,
  ],
  q: [
    -20,-10,-10, -5, -5,-10,-10,-20,
    -10,  0,  0,  0,  0,  0,  0,-10,
    -10,  0,  5,  5,  5,  5,  0,-10,
     -5,  0,  5,  5,  5,  5,  0, -5,
      0,  0,  5,  5,  5,  5,  0, -5,
    -10,  5,  5,  5,  5,  5,  0,-10,
    -10,  0,  5,  0,  0,  0,  0,-10,
    -20,-10,-10, -5, -5,-10,-10,-20,
  ],
  k: [
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -30,-40,-40,-50,-50,-40,-40,-30,
    -20,-30,-30,-40,-40,-30,-30,-20,
    -10,-20,-20,-20,-20,-20,-20,-10,
     20, 20,  0,  0,  0,  0, 20, 20,
     20, 30, 10,  0,  0, 10, 30, 20,
  ],
};

/** Static evaluation from the perspective of the side to move (centipawns). */
export function evaluate(game: Chess): number {
  let score = 0;
  const board = game.board();
  for (let r = 0; r < 8; r++) {
    const row = board[r];
    for (let f = 0; f < 8; f++) {
      const sq = row[f];
      if (!sq) continue;
      const base = PIECE_VALUE[sq.type];
      const idx = sq.color === 'w' ? r * 8 + f : (7 - r) * 8 + f;
      const pst = PST[sq.type][idx];
      score += sq.color === 'w' ? base + pst : -(base + pst);
    }
  }
  return game.turn() === 'w' ? score : -score;
}

function orderMoves(moves: Move[]): Move[] {
  return [...moves].sort((a, b) => scoreMove(b) - scoreMove(a));
  function scoreMove(m: Move): number {
    let s = 0;
    if (m.captured) s += 10 * PIECE_VALUE[m.captured] - PIECE_VALUE[m.piece];
    if (m.promotion) s += PIECE_VALUE[m.promotion] ?? 800;
    if (m.san.includes('+') || m.san.includes('#')) s += 40;
    return s;
  }
}

interface SearchState {
  nodes: number;
  deadline: number;
  aborted: boolean;
}

function quiescence(game: Chess, alpha: number, beta: number, state: SearchState, depth: number): number {
  state.nodes++;
  const stand = evaluate(game);
  if (depth === 0) return stand;
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  const caps = orderMoves(game.moves({ verbose: true })).filter((m) => m.captured || m.promotion);
  for (const m of caps) {
    if (state.nodes % 512 === 0 && performance.now() > state.deadline) { state.aborted = true; return alpha; }
    game.move(m);
    const score = -quiescence(game, -beta, -alpha, state, depth - 1);
    game.undo();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(game: Chess, depth: number, alpha: number, beta: number, ply: number, state: SearchState): number {
  state.nodes++;
  if (game.isCheckmate()) return -MATE_SCORE + ply;
  if (game.isDraw() || game.isStalemate()) return 0;
  if (depth === 0) return quiescence(game, alpha, beta, state, 6);
  if (state.nodes % 512 === 0 && performance.now() > state.deadline) { state.aborted = true; return alpha; }

  let best = -Infinity;
  for (const m of orderMoves(game.moves({ verbose: true }))) {
    game.move(m);
    const score = -negamax(game, depth - 1, -beta, -alpha, ply + 1, state);
    game.undo();
    if (state.aborted) return alpha;
    if (score >= beta) return beta;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
  }
  return best;
}

export interface SearchResult {
  from: string;
  to: string;
  promotion?: string;
  san: string;
  scoreCp: number; // from mover's perspective
  depth: number;
  nodes: number;
  ms: number;
}

/** Search a position for the best move at a given level. */
export function searchBestMove(fen: string, level: Level, recentFens: string[] = [], timeBudgetMs = 3000): SearchResult | null {
  const game = new Chess(fen);
  const rootMoves = game.moves({ verbose: true });
  if (rootMoves.length === 0) return null;

  // Low levels sometimes play a plausible-but-not-best move, so beginners can breathe.
  if (Math.random() < LEVEL_BLUNDER[level]) {
    const pool = rootMoves.filter((m) => !m.san.includes('#'));
    const pick = pool[Math.floor(Math.random() * pool.length)] ?? rootMoves[0];
    game.move(pick);
    const scoreCp = -evaluate(game);
    game.undo();
    return { ...pick, scoreCp, depth: 0, nodes: 0, ms: 0 };
  }

  const state: SearchState = { nodes: 0, deadline: performance.now() + timeBudgetMs, aborted: false };
  let bestMove = rootMoves[0];
  let bestScore = -Infinity;
  let reachedDepth = 0;

  for (let depth = 1; depth <= LEVEL_DEPTH[level]; depth++) {
    let alpha = -Infinity;
    let localBest: Move | null = null;
    let localScore = -Infinity;
    for (const m of orderMoves(rootMoves)) {
      game.move(m);
      let score = -negamax(game, depth - 1, -Infinity, -alpha, 1, state);
      game.undo();
      if (state.aborted) break;
      // Slight repetition aversion: never willingly repeat when clearly ahead.
      if (recentFens.length > 0) {
        const undo = game.move(m);
        if (undo && recentFens.includes(game.fen().split(' ').slice(0, 4).join(' ')) && bestScore > 150) score -= 60;
        game.undo();
      }
      score += (Math.random() - 0.5) * 8; // tiny jitter for variety
      if (score > localScore) { localScore = score; localBest = m; }
      if (score > alpha) alpha = score;
    }
    if (localBest && (!state.aborted || depth === 1)) {
      bestMove = localBest;
      bestScore = localScore;
      reachedDepth = depth;
    }
    if (state.aborted) break;
    if (bestScore > MATE_SCORE - 1000) break; // found mate, stop deepening
  }

  return {
    from: bestMove.from,
    to: bestMove.to,
    promotion: bestMove.promotion,
    san: bestMove.san,
    scoreCp: Math.round(bestScore === -Infinity ? 0 : bestScore),
    depth: reachedDepth,
    nodes: state.nodes,
    ms: 0,
  };
}

export interface EvalResult {
  cp: number; // white's perspective, clamped
  mateIn: number | null; // plies to mate for the side delivering, null if none
  bestSan: string | null;
  depth: number;
}

/** Static-ish evaluation for the analysis bar: shallow search, white perspective. */
export function evaluatePosition(fen: string, depth = 2, timeBudgetMs = 1200): EvalResult {
  const game = new Chess(fen);
  if (game.isCheckmate()) {
    const winner = game.turn() === 'w' ? 'b' : 'w';
    return { cp: winner === 'w' ? MATE_SCORE : -MATE_SCORE, mateIn: 0, bestSan: null, depth: 0 };
  }
  if (game.isGameOver()) return { cp: 0, mateIn: null, bestSan: null, depth: 0 };

  const result = searchBestMove(fen, Math.min(4, Math.max(2, depth)) as Level, [], timeBudgetMs);
  if (!result) return { cp: 0, mateIn: null, bestSan: null, depth: 0 };
  const whiteCp = game.turn() === 'w' ? result.scoreCp : -result.scoreCp;
  const mate = Math.abs(result.scoreCp) > MATE_SCORE - 1000;
  return {
    cp: Math.max(-1500, Math.min(1500, whiteCp)),
    mateIn: mate ? Math.ceil((MATE_SCORE - Math.abs(result.scoreCp)) / 2) : null,
    bestSan: result.san,
    depth: result.depth,
  };
}
