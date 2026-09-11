import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import GameBoard from '../components/GameBoard';
import { LANDING_GAME } from '../data/landingGame';
import { START_FEN } from '../lib/chessUtils';
import { ArrowRight, LightbulbIcon } from '../components/Icons';

function OperaBoard() {
  const plies = LANDING_GAME.plies;
  const [plyIndex, setPlyIndex] = useState(0); // 0 = start position
  const [paused, setPaused] = useState(false);
  const reducedMotion = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )[0];
  const hoverRef = useRef(false);

  useEffect(() => {
    if (paused || reducedMotion) return;
    const t = window.setInterval(() => {
      if (hoverRef.current) return;
      setPlyIndex((i) => {
        const next = i + 1;
        if (next > plies.length) return 0;
        return next;
      });
    }, 2100);
    return () => window.clearInterval(t);
  }, [paused, reducedMotion, plies.length]);

  const current = plyIndex > 0 ? plies[plyIndex - 1] : null;
  const fen = current?.fenAfter ?? START_FEN;
  const moveNo = Math.ceil(plyIndex / 2);
  const moveText = current ? `${moveNo}${current.color === 'w' ? '.' : '…'} ${current.san}` : 'Opening position';

  return (
    <figure
      className="aside"
      onMouseEnter={() => (hoverRef.current = true)}
      onMouseLeave={() => (hoverRef.current = false)}
    >
      <GameBoard
        boardId="landing"
        fen={fen}
        orientation="white"
        lastMove={current ? { from: current.from, to: current.to } : null}
        movableColor={null}
      />
      <figcaption className="board-caption">
        <span>
          {LANDING_GAME.white} vs {LANDING_GAME.black} — {moveText}
        </span>
        <button
          className="small"
          style={{ color: 'var(--accent-ink)', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? 'Resume replay' : 'Pause replay'}
        </button>
      </figcaption>
    </figure>
  );
}

const FEATURES = [
  {
    title: 'An opponent at your tempo',
    body: 'Four engine strengths, from gentle to genuinely sharp, each with a rating you can climb. The engine thinks in a worker thread — the board never stutters, the clock never lies.',
  },
  {
    title: 'Real chess, real clocks',
    body: 'Bullet to classical with increments, take-backs, resign and draw offers, promotion pickers, and every rule handled — en passant included. The board flips to whoever is thinking.',
  },
  {
    title: 'Puzzles and honest review',
    body: 'Mate-in-one trainers generated from real positions, then replay your games move by move with an evaluation bar and the engine’s preferred move at every step.',
  },
];

export default function Home() {
  return (
    <>
      <section className="container">
        <div className="hero">
          <div>
            <h1>
              A quiet place to <em>play chess</em>.
            </h1>
            <p className="lede">
              Gambit gives you a beautiful board, a thoughtful engine, honest clocks and a review bench — and then gets
              out of your way. Free, in your browser, no account.
            </p>
            <div className="cta">
              <Link to="/play" className="btn btn-primary btn-lg">
                Play now <ArrowRight />
              </Link>
              <Link to="/puzzles" className="btn btn-ghost btn-lg">
                <LightbulbIcon /> Solve a puzzle
              </Link>
            </div>
          </div>
          <OperaBoard />
        </div>
      </section>

      <section className="container features">
        <div className="ledger">
          {FEATURES.map((f) => (
            <div className="ledger-row" key={f.title}>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="quote-band">
        <div className="container">
          <blockquote>
            “When you see a good move, sit on your hands and look for a better one.”
          </blockquote>
          <cite>— Emanuel Lasker, World Champion 1894–1921</cite>
        </div>
      </section>
    </>
  );
}
