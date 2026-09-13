import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  glacier: { light: '#C7D9E6', dark: '#3E637F', border: '#2C4A63' },
  seaice: { light: '#F2F7FA', dark: '#C2D8E4', border: '#9DB9CB' },
  polarnight: { light: '#2E4358', dark: '#12212F', border: '#0C1822' },
  aurora: { light: '#24404A', dark: '#101E28', border: '#0B161E' },
  frost: { light: '#E4EBEF', dark: '#9FB4C4', border: '#8399AB' },
  walnut: { light: '#E8D9C0', dark: '#9A6B45', border: '#7D5836' },
};
const PALETTES_DARK: Record<string, { light: string; dark: string; border: string }> = {
  glacier: { light: '#4C657E', dark: '#263A52', border: '#1C2C40' },
  seaice: { light: '#54708A', dark: '#31485E', border: '#253950' },
  polarnight: { light: '#2C4058', dark: '#141F2C', border: '#0E1622' },
  aurora: { light: '#333A58', dark: '#202540', border: '#161A2E' },
  frost: { light: '#54708A', dark: '#31485E', border: '#253950' },
  walnut: { light: '#54412E', dark: '#33251A', border: '#241A12' },
};export function boardColors(theme: string, resolved: 'light' | 'dark'): BoardColors {
  const p = (resolved === 'dark' ? PALETTES_DARK : PALETTES)[theme] ?? PALETTES.glacier;
  return { ...p, dot: 'rgba(125, 160, 190, 0.5)' };
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
  /** editor mode: allow dragging pieces of either color */
  dragAnyColor?: boolean;
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
  dragAnyColor = false,
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

  // --- drag lifecycle invariant ----------------------------------------
  // react-chessboard renders the source piece as a 0.5-opacity ghost while
  // its internal draggingPiece is set, and dnd-core can leave a drag
  // "active" when the pointer-up is lost (released outside the window,
  // blur mid-drag, touch cancel). Nothing in the library self-heals that,
  // so this watchdog notices a stuck ghost after pointer-up / blur and
  // cancels the drag through the library's own cancel path (an Escape
  // keydown, which the KeyboardSensor handles), guaranteeing the piece is
  // fully visible and immediately re-grabbable.
  const dragActiveRef = useRef(false);
  const lastDropAtRef = useRef(0);
  const [stuckReset, setStuckReset] = useState(0);

  const hasStuckGhost = useCallback((): boolean => {
    const board = document.getElementById(`${boardId}-board`);
    if (!board) return false;
    return Array.from(board.querySelectorAll<HTMLElement>('[data-piece]')).some((el) => {
      const op = getComputedStyle(el).opacity;
      return op !== '' && parseFloat(op) < 0.9;
    });
  }, [boardId]);

  /**
   * A pointerup that never reaches the page (release outside the window,
   * browser blur mid-drag, touch cancel) leaves the library's draggingPiece
   * set forever: the source piece stays at ghost opacity 0.5 and cannot be
   * picked up again. Nothing in the library self-heals this, so the
   * watchdog remounts the board — the ghost unmounts and the position
   * re-renders clean. Rare, momentary, and guarantees the invariant.
   */
  const cancelStuckDrag = useCallback(() => {
    if (!hasStuckGhost()) return;
    setStuckReset((k) => k + 1);
    onClearSelection?.();
  }, [hasStuckGhost, onClearSelection]);

  useEffect(() => {
    const onPointerEnd = () => {
      if (!dragActiveRef.current) return;
      // give the library a beat to finish its own drop/cancel handling
      window.setTimeout(() => {
        dragActiveRef.current = false;
        cancelStuckDrag();
      }, 140);
    };
    const onBlur = () => {
      if (!dragActiveRef.current) return;
      window.setTimeout(cancelStuckDrag, 220);
    };
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
      window.removeEventListener('blur', onBlur);
    };
  }, [cancelStuckDrag]);

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
        data-fen={fen}
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
          key={stuckReset}
          options={{
            id: boardId,
            position: fen,
            boardOrientation: orientation,
            animationDurationInMs: ANIMATION_MS[animationSpeed],
            showNotation: showCoordinates,
            allowDragging: movableColor !== null,
            canDragPiece: ({ piece }) => movableColor !== null && (dragAnyColor || piece.pieceType[0] === movableColor),
            onPieceDrag: () => {
              dragActiveRef.current = true;
              // a real drag supersedes click-to-move; never leave stale selection
              onClearSelection?.();
            },
            onPieceDragCancel: () => {
              dragActiveRef.current = false;
              onClearSelection?.();
            },
            onPieceDrop: ({ sourceSquare, targetSquare }) => {
              dragActiveRef.current = false;
              lastDropAtRef.current = performance.now();
              if (!targetSquare) return false;
              return onDrop ? onDrop(sourceSquare as Square, targetSquare as Square) : false;
            },
            onSquareClick: ({ piece, square }) => {
              // swallow the synthetic click that trails a completed drag
              if (performance.now() - lastDropAtRef.current < 120) return;
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
            dropSquareStyle: { boxShadow: 'inset 0 0 0 4px rgba(113, 159, 148, 0.6)' },          }}
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
