import { Link } from 'react-router-dom';
import { Chessboard } from 'react-chessboard';
import { ArrowRight } from '../components/Icons';

/* ------------------------------------------------------------------
   Home — the approved Heritage redesign.

   Structure:
     .home
       .hero          dark cinematic band — editorial copy + a real,
                      static board on a warm stage
       #features      four restrained cards, each wired to a real route
   Honest by design: no stats, no testimonials, no sign-in — the app
   has none of those things.
   ------------------------------------------------------------------ */

const HERO_FEN = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3';

const FEATURES = [
  {
    to: '/play',
    kicker: 'Play',
    title: 'Play the engine',
    line: 'Four honest Stockfish strengths, local clocks, pass-and-play, and custom positions from the editor.',
    cta: 'Start a game',
    visual: 'board' as const,
  },
  {
    to: '/analysis',
    kicker: 'Analysis & Review',
    title: 'Understand every move',
    line: 'Full engine analysis with every move classified — Book to Brilliant — plus coach lessons and practice drills.',
    cta: 'Open analysis',
    visual: 'curve' as const,
  },
  {
    to: '/puzzles',
    kicker: 'Training',
    title: 'Train deliberately',
    line: 'Puzzles, blindfold visualization and endgame drills with spaced repetition that remembers what to resurface.',
    cta: 'Visit training',
    visual: 'ring' as const,
  },
  {
    to: '/library',
    kicker: 'Library',
    title: 'Keep every game',
    line: 'All of your games saved locally — search, tag, favorite, export PGN. Nothing leaves your browser.',
    cta: 'Open library',
    visual: 'rows' as const,
  },
];

/** Warm-lit static board: real pieces, no interaction, part of the hero. */
function HeroBoard() {
  return (
    <div className="hero-board" aria-hidden="true">
      <Chessboard
        options={{
          id: 'hero',
          position: HERO_FEN,
          boardOrientation: 'white',
          allowDragging: false,
          allowDrawingArrows: false,
          allowAutoScroll: false,
          animationDurationInMs: 0,
          boardStyle: { borderRadius: '6px', boxShadow: '0 40px 90px -30px rgba(0,0,0,0.75)' },
          lightSquareStyle: { background: '#EFE3CB' },
          darkSquareStyle: { background: '#A98F63' },
          darkSquareNotationStyle: { color: '#EFE3CB', opacity: 0.8, fontSize: '0.5rem', fontWeight: 600 },
          lightSquareNotationStyle: { color: '#7A6438', opacity: 0.8, fontSize: '0.5rem', fontWeight: 600 },
        }}
      />
    </div>
  );
}

/** Decorative mini-visuals for the feature cards (chess imagery, no fake UI). */
function CardVisual({ kind }: { kind: 'board' | 'curve' | 'ring' | 'rows' }) {
  if (kind === 'board') {
    const squares: { x: number; y: number; dark: boolean }[] = [];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 8; c++) squares.push({ x: c, y: r, dark: (r + c) % 2 === 1 });
    return (
      <svg viewBox="0 0 320 120" className="card-art" aria-hidden="true">
        {squares.map((s, i) => (
          <rect key={i} x={s.x * 40} y={s.y * 40} width="40" height="40" fill={s.dark ? '#A98F63' : '#EFE3CB'} />
        ))}
        <circle cx="200" cy="60" r="11" fill="#F8F5EF" stroke="#0F1720" strokeWidth="2" />
        <circle cx="280" cy="20" r="11" fill="#0F1720" stroke="#C9B896" strokeWidth="2" />
        <rect x="0" y="0" width="320" height="120" fill="none" stroke="rgba(15,23,32,0.25)" />
      </svg>
    );
  }
  if (kind === 'curve') {
    return (
      <svg viewBox="0 0 320 120" className="card-art" aria-hidden="true">
        <line x1="0" y1="60" x2="320" y2="60" stroke="rgba(51,65,85,0.18)" strokeDasharray="3 5" />
        <path
          d="M0 66 C40 60 70 44 110 48 C150 52 170 70 210 62 C250 54 280 34 320 30 L320 120 L0 120 Z"
          fill="rgba(201,184,150,0.35)"
        />
        <path
          d="M0 66 C40 60 70 44 110 48 C150 52 170 70 210 62 C250 54 280 34 320 30"
          fill="none"
          stroke="#0F1720"
          strokeWidth="2"
        />
        <circle cx="210" cy="62" r="4.5" fill="#A9654D" />
      </svg>
    );
  }
  if (kind === 'ring') {
    const ring = 2 * Math.PI * 44;
    return (
      <svg viewBox="0 0 320 120" className="card-art" aria-hidden="true">
        <circle cx="160" cy="60" r="44" fill="none" stroke="rgba(51,65,85,0.14)" strokeWidth="10" />
        <circle
          cx="160"
          cy="60"
          r="44"
          fill="none"
          stroke="#597D5B"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${ring * 0.68} ${ring}`}
          transform="rotate(-90 160 60)"
        />
        <text x="160" y="67" textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight="700" fontSize="20" fill="#0F1720">
          68%
        </text>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 320 120" className="card-art" aria-hidden="true">
      {[16, 50, 84].map((y, i) => (
        <g key={i}>
          <rect x="24" y={y} width="272" height="26" rx="7" fill={i === 0 ? '#E7E0D4' : '#F1ECE2'} stroke="rgba(15,23,32,0.12)" />
          <circle cx="44" cy={y + 13} r="7" fill={i === 0 ? '#597D5B' : i === 1 ? '#A9654D' : '#C9B896'} />
          <rect x="60" y={y + 9} width={i === 0 ? 120 : 96} height="8" rx="4" fill="rgba(15,23,32,0.22)" />
        </g>
      ))}
    </svg>
  );
}

export default function Home() {
  return (
    <div className="home">
      <section className="hero">
        <div className="container hero-inner">
          <div className="hero-copy">
            <p className="hero-eyebrow">Local-first chess</p>
            <h1>
              Play chess.
              <br />
              <span className="hero-gold">Think deeper.</span>
            </h1>
            <p className="hero-sub">
              Gambit runs Stockfish entirely in your browser — play, review every move, and train. No account, no
              server; your games stay yours.
            </p>
            <div className="hero-ctas">
              <Link to="/play" className="btn btn-gold">
                Start playing
                <ArrowRight />
              </Link>
              <a href="#features" className="btn btn-ghost-dark">
                Explore features
              </a>
            </div>
          </div>
          <div className="hero-stage" aria-hidden="true">
            <HeroBoard />
          </div>
        </div>
      </section>

      <section id="features" className="features">
        <div className="container">
          <h2 className="features-title">Built for the whole game</h2>
          <div className="feature-grid">
            {FEATURES.map((f) => (
              <Link key={f.to} to={f.to} className="feature-card">
                <CardVisual kind={f.visual} />
                <span className="feature-kicker">{f.kicker}</span>
                <span className="feature-title">{f.title}</span>
                <span className="feature-line">{f.line}</span>
                <span className="feature-cta">
                  {f.cta}
                  <ArrowRight />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
