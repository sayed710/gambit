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
          {LANDING_GAME.white} vs {LANDING_GAME.black}, {moveText}
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
    title: 'Stockfish, at your tempo',
    body: 'Stockfish 18 runs at four strengths, from gentle to genuinely sharp, each with a rating you can climb. The engine thinks in a worker thread: the board never stutters, the clock never lies.',
  },
  {
    title: 'A workspace, not a widget',
    body: 'Bullet to classical clocks with increments, an analysis board for any FEN or PGN, opening identification as you play, and a zen mode when you just want the pieces.',
  },
  {
    title: 'Reviews that teach',
    body: 'Every finished game gets a full report: accuracies, move classifications from Book to Brilliant, the evaluation graph, and one-click jumps to the moments that decided the game.',
  },
  {
    title: 'Training that adapts',
    body: 'Mate-in-one to discovered attacks, every puzzle is generated and mechanically verified in your browser, filtered by theme, scored by streak, and stored only on your machine.',
  },
];

export default function Home() {
  return (
    <>
      <section className="container">
        <div className="hero">
          <div>
            <h1>
              Chess, played on <em>thin ice</em>.
            </h1>
            <p className="lede">
              Gambit pairs Stockfish with a calm, arctic-clean interface: honest clocks, a full analysis board, and game
              reviews that teach. All free, in your browser, no account.
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

      <section className="container divider-band">
        <div className="notation-strip" aria-hidden>
          1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6 5.Nf3 <span className="lit">O-O</span> 6.Be2 e5 7.O-O Nc6 8.d5 Ne7
          <span className="lit">9.Ne1</span> Nd7 10.f5 <span className="lit">11.Bg5</span> h6 12.Bh4 c6 13.Qd2 Qe7
          <span className="lit">14.O-O-O</span> , a King's Indian, mapped move by move.
        </div>
        <blockquote>
          “When you see a good move, sit on your hands and look for a better one.”
        </blockquote>
        <cite>Emanuel Lasker, World Champion 1894-1921</cite>
      </section>
    </>
  );
}
