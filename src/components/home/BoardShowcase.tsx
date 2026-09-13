import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chess } from 'chess.js';
import GameBoard from '../GameBoard';
import { LANDING_GAME } from '../../data/landingGame';
import { START_FEN } from '../../lib/chessUtils';
import { identifyOpening } from '../../lib/openings';
import { exportPgn } from '../../lib/pgn';
import { ArrowRight } from '../Icons';

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Real material balance, counted from the position on the board. */
function materialBalance(fen: string): { diff: number; white: number; black: number } {
  let white = 0;
  let black = 0;
  try {
    for (const row of new Chess(fen).board()) {
      for (const sq of row) {
        if (!sq) continue;
        const v = PIECE_VALUE[sq.type] ?? 0;
        if (sq.color === 'w') white += v;
        else black += v;
      }
    }
  } catch {
    /* unreachable for replays built by chess.js */
  }
  return { diff: white - black, white, black };
}

/**
 * The Home showcase: the Opera-game replay inside a frost-glass frame,
 * with a live strip of real facts — opening name, current move, material
 * count, replay progress — and a deep link into the analysis board with
 * the full PGN attached.
 */
export default function BoardShowcase() {
  const plies = LANDING_GAME.plies;
  const [plyIndex, setPlyIndex] = useState(0); // 0 = start position
  const [paused, setPaused] = useState(false);
  const hoverRef = useRef(false);

  const reducedMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  useEffect(() => {
    if (paused || reducedMotion) return;
    const t = window.setInterval(() => {
      if (hoverRef.current) return;
      setPlyIndex((i) => (i + 1 > plies.length ? 0 : i + 1));
    }, 2100);
    return () => window.clearInterval(t);
  }, [paused, reducedMotion, plies.length]);

  // Reduced motion: hold the finished artwork instead of animating.
  const shownPly = reducedMotion ? Math.max(plyIndex, plies.length) : plyIndex;
  const current = shownPly > 0 ? plies[shownPly - 1] : null;
  const fen = current?.fenAfter ?? START_FEN;

  const opening = useMemo(
    () => identifyOpening(plies.slice(0, shownPly).map((p) => p.san)),
    [plies, shownPly],
  );
  const material = useMemo(() => materialBalance(fen), [fen]);

  const moveNo = Math.ceil(shownPly / 2);
  const moveText = current
    ? `${moveNo}${current.color === 'w' ? '.' : '…'} ${current.san}`
    : 'Opening position';
  const materialLabel =
    material.diff > 0 ? `White +${material.diff}` : material.diff < 0 ? `Black +${-material.diff}` : 'Level';
  const whiteShare = material.white + material.black > 0 ? (material.white / (material.white + material.black)) * 100 : 50;

  const pgn = useMemo(
    () =>
      exportPgn(
        plies.map((p) => p.san),
        { white: LANDING_GAME.white, black: LANDING_GAME.black, result: '1-0' },
      ),
    [plies],
  );

  return (
    <section className="showcase" aria-label="Live replay of Morphy's Opera game, Paris 1858">
      <div className="showcase-glass">
        <header className="showcase-head">
          <span className="showcase-live" aria-hidden="true">
            <i className="live-dot" />
            Opera House, Paris · 1858
          </span>
          <button className="showcase-pause" onClick={() => setPaused((p) => !p)}>
            {paused ? 'Resume' : 'Pause'}
          </button>
        </header>

        <div className="showcase-board" onMouseEnter={() => (hoverRef.current = true)} onMouseLeave={() => (hoverRef.current = false)}>
          <GameBoard
            boardId="landing"
            fen={fen}
            orientation="white"
            lastMove={current ? { from: current.from, to: current.to } : null}
            movableColor={null}
          />
        </div>

        <div className="showcase-rail">
          <div className="rail-progress" aria-hidden="true">
            <i style={{ transform: `scaleX(${shownPly / plies.length})` }} />
          </div>
          <div className="rail-facts">
            <div className="rail-fact">
              <span className="rail-k">Opening</span>
              <span className="rail-v">{opening ? opening.name : 'King’s Pawn'}</span>
            </div>
            <div className="rail-fact">
              <span className="rail-k">Move</span>
              <span className="rail-v rail-move">{moveText}</span>
            </div>
            <div className="rail-fact">
              <span className="rail-k">Material</span>
              <span className="rail-v">
                <span className="rail-meter" aria-hidden="true">
                  <i className="rail-meter-w" style={{ transform: `scaleX(${whiteShare / 100})` }} />
                </span>
                {materialLabel}
              </span>
            </div>
          </div>
        </div>

        <footer className="showcase-foot">
          <span className="showcase-players">
            {LANDING_GAME.white} <em>vs</em> {LANDING_GAME.black}
          </span>
          <Link className="showcase-cta" to="/analysis" state={{ pgn }}>
            Analyse this game <ArrowRight />
          </Link>
        </footer>
      </div>
    </section>
  );
}
