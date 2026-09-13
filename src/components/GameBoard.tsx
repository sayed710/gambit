import { useCallback, useMemo, useState } from 'react';
import { Chessboard, defaultPieces } from 'react-chessboard';
import type { Arrow } from 'react-chessboard';
import type { Color, PieceSymbol, Square } from 'chess.js';
import type { PendingPromotion } from '../hooks/useGame';
import { useSettings, ANIMATION_MS } from '../state/SettingsContext';
import { playSound } from '../lib/sound';
import { PIECE_NAMES } from '../lib/chessUtils';

export interface BoardColors {
  light: string;
  dark: string;
  border: string;
  dot: string;
}

const PALETTES: Record<string, { light: string; dark: string; border: string }> = {
  glacier: { light: '#dce9f2', dark: '#5d84a0', border: '#4a6c86' },
  frost: { light: '#eef3f6', dark: '#a8bfd0', border: '#8ba6ba' },
  polar: { light: '#31465c', dark: '#17222f', border: '#101a26' },
  walnut: { light: '#e8dcc8', dark: '#9a6b45', border: '#7d5836' },
  tundra: { light: '#e6ebe4', dark: '#6f8f7a', border: '#577260' },
  aurora: { light: '#2a2f45', dark: '#171b2b', border: '#101321' },
};
const PALETTES_DARK: Record<string, { light: string; dark: string; border: string }> = {
  glacier: { light: '#43596e', dark: '#22334a', border: '#182635' },
  frost: { light: '#5d7488', dark: '#33465a', border: '#263748' },
  polar: { light: '#27384d', dark: '#121b28', border: '#0c141e' },
  walnut: { light: '#4a3a2a', dark: '#2b1f14', border: '#1e150c' },
  tundra: { light: '#3c4a42', dark: '#222d26', border: '#18211c' },
  aurora: { light: '#2c3350', dark: '#1a1f33', border: '#12162a' },
};
export function boardColors(theme: string, resolved: 'light' | 'dark'): BoardColors {
  const p = (resolved === 'dark' ? PALETTES_DARK : PALETTES)[theme] ?? PALETTES.walnut;
  return { ...p, dot: 'rgba(32, 29, 24, 0.35)' };
}

export interface GameBoardProps {
  fen: string;
  orientation: 'white' | 'black';
  /** squares of the last move, highlighted */
  lastMove?: { from: Square; to: Square } | null;
  /** square of a king in check */
  checkSquare?: Square | null;
  selected?: Square | null;
  legalTargets?: Square[];
  /** which color may move pieces (null = locked board) */
  movableColor?: 'w' | 'b' | null;
  onSquareClick?: (square: Square, pieceType: string | null) => void;
  onDrop?: (from: Square, to: Square) => boolean;
  pendingPromotion?: PendingPromotion | null;
  onChoosePromotion?: (piece: 'q' | 'r' | 'b' | 'n') => void;
  onCancelPromotion?: () => void;
  /** clear the current selection (Escape key) */
  onClearSelection?: () => void;
  /** spoken after each position change, e.g. "White to move" */
  turnAnnouncement?: string;
  arrows?: Arrow[];
  boardId: string;
}

const PROMO_PIECES: ('q' | 'n' | 'r' | 'b')[] = ['q', 'n', 'r', 'b'];

export default function GameBoard({
  fen,
  orientation,
  lastMove,
  checkSquare,
  selected,
  legalTargets = [],
  movableColor = null,
  onSquareClick,
  onDrop,
  pendingPromotion,
  onChoosePromotion,
  onCancelPromotion,
  onClearSelection,
  turnAnnouncement,
  arrows,
  boardId,
}: GameBoardProps) {
  const { boardTheme, resolvedTheme, showLegalHints, showCoordinates, animationSpeed } = useSettings();
  const colors = useMemo(() => boardColors(boardTheme, resolvedTheme), [boardTheme, resolvedTheme]);
  const interactive = movableColor !== null;

  // --- keyboard play: arrow keys move a cursor, Enter selects/moves ---
  const [cursor, setCursor] = useState<Square | null>(null);
  const [announce, setAnnounce] = useState('');

  const squareAt = useCallback(
    (file: number, rank: number): Square | null => {
      if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
      return `${'abcdefgh'[file]}${8 - rank}` as Square;
    },
    [],
  );

  const cursorFileRank = useCallback(
    (sq: Square): [number, number] => {
      const file = 'abcdefgh'.indexOf(sq[0]);
      const rank = 8 - parseInt(sq[1], 10);
      return [file, rank];
    },
    [],
  );

  const pieceName = useCallback(
    (sq: Square): string => {
      const p = pieceAt(fen, sq);
      if (!p) return 'empty';
      return `${p.color === 'w' ? 'white' : 'black'} ${PIECE_NAMES[p.type]}`;
    },
    [fen],
  );

  const moveCursor = useCallback(
    (dFile: number, dRank: number) => {
      const base: [number, number] = cursor
        ? cursorFileRank(cursor)
        : orientation === 'white'
          ? [4, 7] // e1 — a natural home square
          : [4, 0]; // e8
      // arrows stay world-relative: with a flipped board, right = lower file
      const [df, dr] = orientation === 'white' ? [dFile, dRank] : [-dFile, -dRank];
      const target = squareAt(base[0] + df, base[1] + dr);
      if (!target) return;
      setCursor(target);
      setAnnounce(`${target}, ${pieceName(target)}`);
    },
    [cursor, cursorFileRank, orientation, pieceName, squareAt],
  );

  const handleBoardKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!interactive) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          moveCursor(-1, 0);
          break;
        case 'ArrowRight':
          e.preventDefault();
          moveCursor(1, 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveCursor(0, -1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveCursor(0, 1);
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (cursor) {
            onSquareClick?.(cursor, pieceTypeAt(fen, cursor));
            setAnnounce(`${cursor}, ${pieceName(cursor)}`);
          } else {
            moveCursor(0, 0);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setCursor(null);
          onClearSelection?.();
          break;
      }
    },
    [interactive, moveCursor, cursor, onSquareClick, pieceName, fen, onClearSelection],
  );

  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (lastMove) {
      styles[lastMove.from] = { background: `var(--hl-last)` };
      styles[lastMove.to] = { background: `var(--hl-last)` };
    }
    if (checkSquare) {
      styles[checkSquare] = { background: 'var(--hl-check)' };
    }
    if (selected) {
      styles[selected] = { background: 'var(--hl-select)', boxShadow: 'inset 0 0 0 3px rgba(15, 122, 141, 0.6)' };
    }
    if (cursor) {
      styles[cursor] = {
        ...styles[cursor],
        boxShadow: 'inset 0 0 0 3px var(--accent)',
        borderRadius: '4px',
      };
    }
    if (showLegalHints) {
      for (const target of legalTargets) {
        const existing = styles[target];
        const layer =
          fen.includes(' ') && hasPiece(fen, target)
            ? `radial-gradient(transparent 55%, ${colors.dot} 56%, ${colors.dot} 73%, transparent 74%)`
            : `radial-gradient(${colors.dot} 17%, transparent 19%)`;
        styles[target] = { ...existing, backgroundImage: layer, backgroundClip: 'content-box' };
      }
    }
    return styles;
  }, [lastMove, checkSquare, selected, cursor, legalTargets, showLegalHints, colors, fen]);

  const promoColor = pendingPromotion?.color ?? 'w';

  return (
    <div className="board-frame">
      <div
        className="board-surface"
        style={{ position: 'relative' }}
        tabIndex={interactive ? 0 : -1}
        role="group"
        aria-label={
          interactive
            ? 'Chessboard. Use arrow keys to explore squares, Enter to pick up or place a piece, Escape to clear.'
            : 'Chessboard'
        }
        onKeyDown={interactive ? handleBoardKeyDown : undefined}
      >
        <span className="sr-only" aria-live="polite">
          {turnAnnouncement ? `${turnAnnouncement}. ` : ''}
          {announce}
        </span>
        <Chessboard
          options={{
            id: boardId,
            position: fen,
            boardOrientation: orientation,
            animationDurationInMs: ANIMATION_MS[animationSpeed],
            showNotation: showCoordinates,
            allowDragging: movableColor !== null,
            canDragPiece: ({ piece }) => movableColor !== null && piece.pieceType[0] === movableColor,
            onPieceDrop: ({ sourceSquare, targetSquare }) => {
              if (!targetSquare) return false;
              return onDrop ? onDrop(sourceSquare as Square, targetSquare as Square) : false;
            },
            onSquareClick: ({ piece, square }) => {
              onSquareClick?.(square as Square, piece?.pieceType ?? null);
            },
            squareStyles: squareStyles,
            darkSquareStyle: { background: colors.dark },
            lightSquareStyle: { background: colors.light },
            darkSquareNotationStyle: {
              color: colors.light,
              opacity: 0.95,
              fontSize: '0.58rem',
              fontWeight: 600,
              lineHeight: 1.4,
            },
            lightSquareNotationStyle: {
              color: colors.dark,
              opacity: 0.95,
              fontSize: '0.58rem',
              fontWeight: 600,
              lineHeight: 1.4,
            },
            alphaNotationStyle: { paddingBottom: '0.3rem', paddingRight: '0.35rem' },
            numericNotationStyle: { paddingTop: '0.3rem', paddingLeft: '0.35rem' },
            allowDrawingArrows: movableColor !== null,
            arrows,
            clearArrowsOnPositionChange: true,
            dropSquareStyle: { boxShadow: 'inset 0 0 0 4px rgba(15, 122, 141, 0.65)' },          }}
        />
        {pendingPromotion && (
          <div
            className="promo-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Choose a promotion piece"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancelPromotion?.();
            }}
          >
            <div className="promo-card">
              {PROMO_PIECES.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    playSound('click');
                    onChoosePromotion?.(p);
                  }}
                  aria-label={`Promote to ${p}`}
                >
                  {defaultPieces[`${promoColor}${p.toUpperCase()}`]?.({})}
                </button>
              ))}
              <button onClick={onCancelPromotion} aria-label="Cancel promotion" style={{ width: 'auto', padding: '0 0.9rem', fontWeight: 600, color: 'var(--muted)' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The piece standing on a square in a FEN, or null. */
function pieceAt(fen: string, square: Square): { color: Color; type: PieceSymbol } | null {
  const files = 'abcdefgh';
  const file = files.indexOf(square[0]);
  const rank = 8 - parseInt(square[1], 10);
  const rows = fen.split(' ')[0].split('/');
  const row = rows[rank];
  if (!row || file < 0) return null;
  let col = 0;
  for (const ch of row) {
    if (/[1-8]/.test(ch)) col += parseInt(ch, 10);
    else {
      if (col === file) return { color: ch === ch.toUpperCase() ? 'w' : 'b', type: ch.toLowerCase() as PieceSymbol };
      col++;
    }
  }
  return null;
}

function pieceTypeAt(fen: string, square: Square): string | null {
  const p = pieceAt(fen, square);
  return p ? `${p.color}${p.type.toUpperCase()}` : null;
}

/** Cheap check whether a square is occupied in a FEN. */
function hasPiece(fen: string, square: Square): boolean {
  return pieceAt(fen, square) !== null;
}
