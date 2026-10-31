import { Link } from 'react-router-dom';
import { Chess } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { ArrowRight } from '../components/Icons';

/* ------------------------------------------------------------------
   Home — the APPROVED design (owner reference, 2026-10-31).

   Structure:
     .home
       .hero      inset dark band: cinematic chess photograph
                  (black queen, warm directional light) + editorial copy
       #features  three substantial cards with genuine UI previews
       .closing   dark band: "A calmer, deeper way to play chess."

   Honesty rules: no online-play claims, no accounts, no community,
   no fabricated metrics — every CTA goes to a real route.
   ------------------------------------------------------------------ */

/* Ruy Lopez Exchange — the same game the Review preview shows in the
   approved reference (the Bxc6/dxc6 exchange highlighted). */
const REVIEW_GAME_SAN = [
  'e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O', 'f6',
  'd4', 'exd4', 'Nxd4', 'c5', 'Ne2', 'Qxd1', 'Rxd1', 'Bd7',
];

interface PreviewPly {
  san: string;
  color: 'w' | 'b';
  from: string;
  to: string;
  fenAfter: string;
}

function buildReplay(sanList: string[]): { plies: PreviewPly[]; finalFen: string } | null {
  const game = new Chess();
  const plies: PreviewPly[] = [];
  try {
    for (const san of sanList) {
      const m = game.move(san);
      plies.push({ san: m.san, color: m.color, from: m.from, to: m.to, fenAfter: m.after });
    }
  } catch {
    return null;
  }
  return { plies, finalFen: game.fen() };
}

const REVIEW_REPLAY = buildReplay(REVIEW_GAME_SAN);

/* ---------------- hero ---------------- */

function Hero({ onExplore }: { onExplore: () => void }) {
  return (
    <section className="hero">
      <div className="hero-band">
        <div className="hero-photo" role="img" aria-label="A black queen on a chessboard in warm window light" />
        <div className="hero-veil" aria-hidden="true" />
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="hero-eyebrow">A higher standard for chess</p>
            <h1>
              Play chess.
              <br />
              <em>Think deeper.</em>
            </h1>
            <p className="hero-sub">
              A clean, focused space for real chess.
              <br />
              Play, analyze, train and grow — at your own pace.
            </p>
            <div className="hero-ctas">
              <Link to="/play" className="btn btn-gold">
                Start playing
                <ArrowRight />
              </Link>
              <button type="button" className="btn btn-ghost-light" onClick={onExplore}>
                Explore features
              </button>
            </div>
            <p className="hero-note">Free to get started. A better chess experience for everyone.</p>
          </div>
          <p className="hero-quote">
            <span>
              “A quiet place
              <br />
              to become a
              <br />
              stronger player.”
            </span>
            <span className="hero-quote-by">— The Gambit Team</span>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------------- feature 1 · Play (setup preview) ---------------- */

function PlayPreview() {
  return (
    <div className="ui-preview ui-dark" aria-hidden="true">
      <div className="ui-setup">
        <div className="ui-row between">
          <span className="ui-pill">10 | 0 · Rapid</span>
        </div>
        <div className="ui-clock-row">
          <span className="ui-side">● Black</span>
          <span className="ui-clock">10:00</span>
        </div>
        <div className="ui-mini-board">
          {Array.from({ length: 24 }, (_, i) => {
            const r = Math.floor(i / 8);
            const c = i % 8;
            return <i key={i} style={{ background: (r + c) % 2 ? '#A98F63' : '#EFE3CB' }} />;
          })}
        </div>
        <div className="ui-clock-row">
          <span className="ui-side">○ White</span>
          <span className="ui-clock">10:00</span>
        </div>
        <span className="ui-play-btn">Play</span>
      </div>
    </div>
  );
}

/* ---------------- feature 2 · Review (real game preview) ---------------- */

function ReviewPreview() {
  if (!REVIEW_REPLAY) return null;
  const { plies } = REVIEW_REPLAY;
  // The approved reference highlights 4. Bxc6 dxc6. Ply indexes are
  // 0-based: Bxc6 = ply 6, dxc6 = ply 7 → the preview shows moves 3–5
  // (ply indexes 4–9) with the middle row highlighted, and the board
  // positioned after 4... dxc6.
  const rowStarts = [4, 6, 8];
  const highlightedStart = 6;
  const lastMove = plies[7];
  const position = plies[7].fenAfter;
  return (
    <div className="ui-preview ui-dark" aria-hidden="true">
      <div className="ui-review">
        <div className="ui-review-board">
          <Chessboard
            options={{
              id: 'home-review',
              position,
              boardOrientation: 'white',
              allowDragging: false,
              allowDrawingArrows: false,
              allowAutoScroll: false,
              animationDurationInMs: 0,
              squareStyles: lastMove
                ? {
                    [lastMove.from]: { boxShadow: 'inset 0 0 0 3px rgba(201,184,150,0.9)' },
                    [lastMove.to]: { boxShadow: 'inset 0 0 0 3px rgba(201,184,150,0.9)' },
                  }
                : {},
              lightSquareStyle: { background: '#EFE3CB' },
              darkSquareStyle: { background: '#A98F63' },
            }}
          />
        </div>
        <div className="ui-review-side">
          <span className="ui-eval">+0.3</span>
          <div className="ui-moves">
            {rowStarts.map((idx) => (
              <div key={idx} className={`ui-move-row${idx === highlightedStart ? ' hl' : ''}`}>
                <span className="ui-no">{Math.floor(idx / 2) + 1}.</span>
                <span>{plies[idx]?.san ?? ''}</span>
                <span>{plies[idx + 1]?.san ?? ''}</span>
              </div>
            ))}
          </div>
          <svg viewBox="0 0 200 40" className="ui-curve">
            <path d="M0 24 C30 20 55 28 85 24 C120 20 140 10 170 14 L200 12" fill="none" stroke="#C9B896" strokeWidth="1.6" />
          </svg>
        </div>
      </div>
    </div>
  );
}

/* ---------------- feature 3 · Training (real routes, decorative rows) ---------------- */

function TrainPreview() {
  const items = [
    { to: '/puzzles', label: 'Tactical puzzles' },
    { to: '/endgames', label: 'Curated endgame lessons' },
    { to: '/training', label: 'Track your progress' },
    { to: '/coordinates', label: 'Build board vision' },
  ];
  // Decorative preview: the rows mirror the app's REAL training routes but
  // are non-interactive here (aria-hidden) — the card's own Start-training
  // button is the accessible, working navigation.
  return (
    <div className="ui-phone" aria-hidden="true">
      <div className="ui-phone-screen">
        <div className="ui-phone-head">
          <span className="ui-phone-brand">Gambit</span>
        </div>
        {items.map((it) => (
          <span key={it.to} className="ui-phone-row">
            <span>{it.label}</span>
            <ArrowRight />
          </span>
        ))}
        <span className="ui-phone-puzzle">
          <span className="ui-phone-puzzle-k">Daily puzzle</span>
          <span className="ui-phone-puzzle-s">Find the best move</span>
        </span>
      </div>
    </div>
  );
}

/* ---------------- page ---------------- */

export default function Home() {
  const exploreFeatures = () => {
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById('features')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div className="home">
      <Hero onExplore={exploreFeatures} />

      <section id="features" className="features">
        <div className="container">
          <div className="feature-grid">
            {/* 1 · Play */}
            <article className="feature-card wide">
              <header className="feature-head">
                <span className="feature-icon" aria-hidden="true">
                  ♟
                </span>
                <div>
                  <h2>Play</h2>
                  <p>Jump into a game against the engine. Four honest strengths, local clocks — beautifully simple.</p>
                </div>
              </header>
              <PlayPreview />
              <ul className="feature-points">
                <li>Four honest engine strengths, rated play</li>
                <li>Local clocks — bullet to classical, pass &amp; play</li>
                <li>Custom positions from the editor</li>
              </ul>
              <Link to="/play" className="btn btn-dark feature-btn">
                Start a game
                <ArrowRight />
              </Link>
            </article>

            {/* 2 · Analyze */}
            <article className="feature-card tall">
              <header className="feature-head">
                <span className="feature-icon" aria-hidden="true">
                  📊
                </span>
                <div>
                  <h2>Analyze. Learn. Improve.</h2>
                  <p>Get in-depth game review, clear insights and practical advice to elevate your play.</p>
                </div>
              </header>
              <ReviewPreview />
              <div className="feature-cta-row">
                <Link to="/analysis" className="feature-cta">
                  Analysis board
                  <ArrowRight />
                </Link>
                <Link to="/library" className="feature-cta">
                  Review a saved game
                  <ArrowRight />
                </Link>
              </div>
            </article>

            {/* 3 · Train */}
            <article className="feature-card">
              <header className="feature-head">
                <span className="feature-icon" aria-hidden="true">
                  🎓
                </span>
                <div>
                  <h2>Train Your Game</h2>
                  <p>Tactical puzzles, curated lessons and personalized training to build real progress.</p>
                </div>
              </header>
              <TrainPreview />
              <Link to="/puzzles" className="btn btn-gold feature-btn">
                Start training
                <ArrowRight />
              </Link>
            </article>
          </div>
        </div>
      </section>

      <section className="closing">
        <div className="container closing-inner">
          <div>
            <p className="closing-eyebrow">More than a game</p>
            <h2>A calmer, deeper way to play chess.</h2>
            <p className="closing-line">Gambit is built for players who love the game — from curious beginners to dedicated improvers.</p>
          </div>
          <Link to="/play" className="btn btn-gold">
            Start playing
            <ArrowRight />
          </Link>
        </div>
      </section>
    </div>
  );
}
