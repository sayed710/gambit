import { useCallback, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import type { Color } from 'chess.js';
import { playSound } from '../lib/sound';

interface Options {
  fen: string;
  /** which color the human may move for; null locks the board */
  movableColor: Color | null;
  /** attempt a move; returns 'ok' | 'promote' | 'illegal' */
  tryMove: (from: Square, to: Square) => 'ok' | 'promote' | 'illegal';
  /** called when a move is committed via click (for clearing hints etc.) */
  onMoveCommitted?: () => void;
}

/** Shared click-to-move + legal-target selection state for any board. */
export function useClickToMove({ fen, movableColor, tryMove, onMoveCommitted }: Options) {
  const [selected, setSelected] = useState<Square | null>(null);

  const legalTargets = useMemo<Square[]>(() => {
    if (!selected || !movableColor) return [];
    try {
      return new Chess(fen)
        .moves({ verbose: true })
        .filter((m) => m.from === selected)
        .map((m) => m.to);
    } catch {
      return [];
    }
  }, [fen, selected, movableColor]);

  const clear = useCallback(() => setSelected(null), []);

  const onSquareClick = useCallback(
    (square: Square, pieceType: string | null) => {
      if (!movableColor) return;
      const ownPiece = pieceType?.[0] === movableColor;
      if (selected && !ownPiece) {
        const result = tryMove(selected, square);
        if (result === 'ok' || result === 'promote') {
          onMoveCommitted?.();
          if (result === 'ok') setSelected(null);
        } else {
          setSelected(null);
          playSound('illegal');
        }
        return;
      }
      if (ownPiece) {
        setSelected((cur) => (cur === square ? null : square));
        playSound('click');
      } else {
        setSelected(null);
      }
    },
    [movableColor, selected, tryMove, onMoveCommitted],
  );

  // selection must reset when the position moves on
  const selectedStillValid = useMemo(() => {
    if (!selected) return true;
    try {
      return new Chess(fen).get(selected)?.color === movableColor;
    } catch {
      return false;
    }
  }, [fen, selected, movableColor]);

  return {
    selected: selectedStillValid ? selected : null,
    legalTargets,
    onSquareClick,
    clear,
  };
}
