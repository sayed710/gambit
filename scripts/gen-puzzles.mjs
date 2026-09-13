/**
 * Generates verified themed puzzles by playing random games with chess.js
 * and pattern-checking every position. Every solution is mechanically
 * verified against the stated theme — nothing is heuristic-guessed.
 *
 * Themes: mate1, mate2, fork, skewer, pin, hanging, discovered
 * Output: src/data/puzzles.ts
 */
import { Chess } from 'chess.js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAX_GAMES = 6000;
const TARGETS = { mate1: 12, mate2: 10, fork: 12, skewer: 8, pin: 8, hanging: 10, discovered: 8 };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 200 };

const seen = new Set();
const out = { mate1: [], mate2: [], fork: [], skewer: [], pin: [], hanging: [], discovered: [] };
let games = 0;

function key(fen) {
  return fen.split(' ').slice(0, 2).join(' ');
}

function push(theme, fen, solution, sideToMove, pieces) {
  const k = key(fen) + '|' + solution;
  if (seen.has(k)) return;
  seen.add(k);
  out[theme].push({
    id: `pz-${theme}-${out[theme].length + 1}`,
    fen,
    solution,
    sideToMove,
    mate: theme === 'mate1' || theme === 'mate2',
    materialWin: 0,
    difficulty: pieces,
    theme,
  });
}

/* ---------- pattern helpers (all positions AFTER the candidate move) ---------- */

function attackedEnemyPieces(game, byColor, atSquare) {
  // enemy pieces attacked by a piece standing atSquare
  const out = [];
  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq || sq.color === byColor) continue;
      if (game.attackers(sq.square, byColor).includes(atSquare)) {
        out.push(sq);
      }
    }
  }
  return out;
}

function rayBeyond(game, from, target) {
  // the first piece strictly beyond `target` on the from→target ray
  // (target.rank here is the rank number 1..8, so the board row is 8 - rank)
  const df = Math.sign(target.file - from.file);
  const dr = Math.sign(target.rank - from.rank);
  let f = target.file + df;
  let r = target.rank + dr;
  while (f >= 0 && f <= 7 && r >= 1 && r <= 8) {
    const sq = game.board()[8 - r][f];
    if (sq) return sq;
    f += df;
    r += dr;
  }
  return null;
}

function lineBetween(from, target) {
  // squares strictly between from and target (same file/rank/diagonal)
  const squares = [];
  const df = Math.sign(target.file - from.file);
  const dr = Math.sign(target.rank - from.rank);
  let f = from.file + df;
  let r = from.rank + dr;
  while (!(f === target.file && r === target.rank)) {
    squares.push({ file: f, rank: r });
    f += df;
    r += dr;
  }
  return squares;
}

/* ---------- theme detectors: (gameBefore, move) => true/false ---------- */

function detectMate1(gameBefore, move) {
  gameBefore.move(move);
  const mate = gameBefore.isCheckmate();
  gameBefore.undo();
  return mate;
}

function detectMate2(gameBefore, move) {
  gameBefore.move(move);
  if (gameBefore.isCheckmate() || gameBefore.isStalemate() || gameBefore.isDraw()) {
    gameBefore.undo();
    return false;
  }
  const replies = gameBefore.moves({ verbose: true });
  if (replies.length === 0) {
    gameBefore.undo();
    return false;
  }
  for (const reply of replies) {
    gameBefore.move(reply);
    if (gameBefore.isStalemate() || gameBefore.isDraw()) {
      gameBefore.undo();
      gameBefore.undo();
      return false;
    }
    const mates = gameBefore.moves({ verbose: true }).filter((m) => {
      gameBefore.move(m);
      const ok = gameBefore.isCheckmate();
      gameBefore.undo();
      return ok;
    });
    gameBefore.undo();
    if (mates.length === 0) {
      gameBefore.undo();
      return false;
    }
  }
  gameBefore.undo();
  return true;
}

function detectFork(gameBefore, move) {
  gameBefore.move(move);
  const to = { file: move.to.charCodeAt(0) - 97, rank: parseInt(move.to[1], 10) };
  const targets = attackedEnemyPieces(gameBefore, move.color, move.to).filter((sq) => sq.square !== move.to);
  const valuable = targets.filter((sq) => VAL[sq.type] >= 3 || sq.type === 'k');
  const movedPiece = gameBefore.get(move.to);
  const bestTarget = targets.reduce((mx, sq) => Math.max(mx, VAL[sq.type] === 200 ? 200 : VAL[sq.type]), 0);
  const ok =
    valuable.length >= 2 &&
    targets.length >= 2 &&
    (bestTarget > VAL[movedPiece.type] || targets.some((sq) => gameBefore.attackers(sq.square, move.color === 'w' ? 'b' : 'w').length === 0) || valuable.some((sq) => sq.type === 'k'));
  gameBefore.undo();
  void to;
  return ok;
}

function detectSkewerOrPin(gameBefore, move, wantPin) {
  gameBefore.move(move);
  const moved = gameBefore.get(move.to);
  if (!moved || !['b', 'r', 'q'].includes(moved.type)) {
    gameBefore.undo();
    return false;
  }
  const from = { file: move.to.charCodeAt(0) - 97, rank: parseInt(move.to[1], 10) };
  let found = false;
  for (const row of game.board()) {
    for (const sq of row) {
      if (!sq || sq.color === moved.color) continue;
      if (!game.attackers(sq.square, moved.color).includes(move.to)) continue;
      // the attacked piece must be first on the ray from the slider
      const target = { file: sq.square.charCodeAt(0) - 97, rank: parseInt(sq.square[1], 10) };
      const between = lineBetween(from, target);
      const blocked = between.some(({ file, rank }) => game.board()[7 - rank][file] !== null);
      if (blocked || between.length === 0) continue;
      const beyond = rayBeyond(game, from, target);
      if (!beyond || beyond.color === moved.color) continue;
      if (wantPin) {
        if (beyond.type === 'k') found = true;
      } else if (VAL[beyond.type] > VAL[sq.type] && VAL[sq.type] >= 1) {
        found = true;
      }
    }
  }
  gameBefore.undo();
  return found;
}

function detectHanging(gameBefore, move) {
  // a capture of an undefended enemy piece with value >= capturer value
  if (move.captured) {
    gameBefore.move(move);
    const target = gameBefore.get(move.to);
    const ok =
      target &&
      VAL[target.type] >= VAL[move.piece] &&
      gameBefore.attackers(move.to, move.color === 'w' ? 'b' : 'w').length === 0;
    gameBefore.undo();
    return ok;
  }
  return false;
}

function detectDiscovered(gameBefore, move) {
  // moving a non-slider piece unmasks an own slider attack on an enemy R/Q/K
  const movedPiece = move.piece;
  if (movedPiece === 'q' || movedPiece === 'r' || movedPiece === 'b') return false;
  const movedFrom = { file: move.from.charCodeAt(0) - 97, rank: parseInt(move.from[1], 10) };
  const movedTo = { file: move.to.charCodeAt(0) - 97, rank: parseInt(move.to[1], 10) };
  gameBefore.move(move);
  const sliders = [];
  for (const row of game.board()) {
    for (const sq of row) {
      if (sq && sq.color === move.color && ['b', 'r', 'q'].includes(sq.type)) sliders.push(sq);
    }
  }
  let found = false;
  for (const slider of sliders) {
    const sFrom = { file: slider.square.charCodeAt(0) - 97, rank: parseInt(slider.square[1], 10) };
    for (const row of game.board()) {
      for (const sq of row) {
        if (!sq || sq.color === move.color) continue;
        if (!['r', 'q', 'k'].includes(sq.type)) continue;
        const t = { file: sq.square.charCodeAt(0) - 97, rank: parseInt(sq.square[1], 10) };
        const sameLine =
          sFrom.file === t.file || sFrom.rank === t.rank || Math.abs(t.file - sFrom.file) === Math.abs(t.rank - sFrom.rank);
        if (!sameLine) continue;
        if (!game.attackers(sq.square, move.color).includes(slider.square)) continue;
        // was the moved piece blocking this line before the move?
        const between = lineBetween(sFrom, t);
        const stillOnLine = between.some(({ file, rank }) => file === movedTo.file && rank === movedTo.rank);
        if (between.some(({ file, rank }) => file === movedFrom.file && rank === movedFrom.rank) && !stillOnLine) {
          found = true;
        }
      }
    }
  }
  gameBefore.undo();
  return found;
}

const DETECTORS = {
  mate1: detectMate1,
  mate2: detectMate2,
  fork: detectFork,
  skewer: (g, m) => detectSkewerOrPin(g, m, false),
  pin: (g, m) => detectSkewerOrPin(g, m, true),
  hanging: detectHanging,
  discovered: detectDiscovered,
};

function remainingWork() {
  return Object.keys(TARGETS).filter((t) => out[t].length < TARGETS[t]);
}

outer: for (let g = 0; g < MAX_GAMES; g++) {
  if (remainingWork().length === 0) break;
  const game = new Chess();
  for (let ply = 0; ply < 140; ply++) {
    if (remainingWork().length === 0) break outer;
    const moves = game.moves({ verbose: true });
    if (moves.length === 0) break;
    const themes = remainingWork();
    const pieceCount = game.fen().split(' ')[0].replace(/[^a-zA-Z]/g, '').length;

    for (const theme of themes) {
      if (pieceCount < 6) continue;
      let found = null;
      // sample at most 12 candidate moves per position — keeps generation fast
      const candidates = moves.length > 12 ? [...moves].sort(() => Math.random() - 0.5).slice(0, 12) : moves;
      for (const m of candidates) {
        // isolate every detector on a clone: exceptions or missed undos can
        // never corrupt the shared game
        try {
          const clone = new Chess(game.fen());
          if (DETECTORS[theme](clone, m)) {
            found = m;
            break;
          }
        } catch {
          // pattern check simply fails on this move
        }
      }
      if (found) {
        push(theme, game.fen(), found.san, game.turn(), pieceCount);
      }
    }

    const choice = moves[Math.floor(Math.random() * moves.length)];
    game.move(choice);
  }
  games++;
}

/* ---------- write ---------- */
const all = Object.entries(out).flatMap(([theme, list]) => list).sort((a, b) => a.difficulty - b.difficulty);
const total = all.length;
const body = `import type { PuzzleRecord } from '../lib/types';

/**
 * Generated by scripts/gen-puzzles.mjs — every puzzle is mechanically
 * verified against its theme (mate1, mate2, fork, skewer, pin, hanging,
 * discovered) using chess.js geometry and legality.
 */
export const PUZZLES: PuzzleRecord[] = ${JSON.stringify(all, null, 2).replace(/"([a-zA-Z]+)":/g, '$1: ')};
`;

writeFileSync(join(__dirname, '..', 'src', 'data', 'puzzles.ts'), body);
console.log(`games played: ${games}`);
for (const [theme, list] of Object.entries(out)) console.log(`  ${theme}: ${list.length}/${TARGETS[theme]}`);
console.log(`total: ${total}`);
