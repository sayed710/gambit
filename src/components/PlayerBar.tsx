import { defaultPieces } from 'react-chessboard';
import type { PieceSymbol } from 'chess.js';
import { formatClock } from '../lib/chessUtils';

interface PlayerBarProps {
  name: string;
  rating?: number | null;
  avatar: string;
  /** pieces this player has captured */
  captured: PieceSymbol[];
  /** color of the captured pieces shown (opponent's army) */
  capturedColor: 'w' | 'b';
  /** material lead for this player (0 = level) */
  materialDiff: number;
  clockMs?: number;
  clockRunning?: boolean;
  clockActive?: boolean;
  clockHidden?: boolean;
  flagged?: boolean;
  isTurn?: boolean;
  thinking?: boolean;
}

export default function PlayerBar({
  name,
  rating,
  avatar,
  captured,
  capturedColor,
  materialDiff,
  clockMs,
  clockRunning = false,
  clockActive = false,
  clockHidden = false,
  flagged = false,
  isTurn = false,
  thinking = false,
}: PlayerBarProps) {
  const low = typeof clockMs === 'number' && clockMs < 20_000 && clockMs > 0;
  return (
    <div className={`player-bar${isTurn ? ' active' : ''}`}>
      <span className="avatar" aria-hidden>
        {avatar}
      </span>
      <div className="who">
        <div className="name">
          {name}
          {thinking && (
            <span className="muted small" style={{ marginLeft: '0.5rem' }}>
              thinking…
            </span>
          )}
        </div>
        <div className="meta">
          {typeof rating === 'number' && <span className="mono">{rating}</span>}
          <span className="material mono">{materialDiff > 0 ? `+${materialDiff}` : ''}</span>
        </div>
        {captured.length > 0 && (
          <div className="captured" aria-label={`${captured.length} captured pieces`}>
            {captured.map((p, i) => (
              <span key={i}>{defaultPieces[`${capturedColor}${p.toUpperCase()}`]?.({})}</span>
            ))}
          </div>
        )}
      </div>
      {!clockHidden && typeof clockMs === 'number' && (
        <div
          className={`clock${clockRunning && clockActive ? ' running' : ''}${low ? ' low' : ''}${flagged ? ' out' : ''}`}
          aria-label={`${name}'s clock`}
        >
          {formatClock(flagged ? 0 : clockMs)}
        </div>
      )}
    </div>
  );
}
