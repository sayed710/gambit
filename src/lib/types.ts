import type { Square } from 'chess.js';

export type Color = 'w' | 'b';
export type Theme = 'light' | 'dark';
export type BoardTheme = 'glacier' | 'seaice' | 'polarnight' | 'aurora' | 'frost' | 'walnut';

export type GameMode = 'ai' | 'pass';

export interface TimeControl {
  id: string;
  label: string;
  category: 'Bullet' | 'Blitz' | 'Rapid' | 'Classical' | 'Unlimited';
  /** initial minutes per side */
  minutes: number;
  /** increment seconds per move */
  increment: number;
}

export interface GameConfig {
  mode: GameMode;
  timeControl: TimeControl;
  playerColor: Color | 'random';
  aiLevel: 1 | 2 | 3 | 4;
  /** play from a custom position (Position Editor deep link) */
  initialFen?: string;
}

export type GameResultType = 'win' | 'loss' | 'draw';

export interface GameRecord {
  id: string;
  date: number;
  mode: GameMode;
  timeControl: TimeControl;
  playerColor: Color;
  opponentName: string;
  opponentRating: number;
  result: GameResultType;
  reason: string;
  moves: string[];
  pgn: string;
  ratingBefore: number;
  ratingAfter: number;
  pinned?: boolean;
}

export type PuzzleTheme = 'mate1' | 'mate2' | 'fork' | 'skewer' | 'pin' | 'hanging' | 'discovered';

export interface PuzzleRecord {
  id: string;
  fen: string;
  solution: string; // SAN of the winning move
  sideToMove: Color;
  mate: boolean;
  materialWin: number; // centipawns gained by solution, 0 for mate
  difficulty: number; // rough signal: piece count on the board
  theme: PuzzleTheme;
}

export interface Ply {
  san: string;
  from: Square;
  to: Square;
  color: Color;
  fenAfter: string;
  isCapture: boolean;
  isCheck: boolean;
}
