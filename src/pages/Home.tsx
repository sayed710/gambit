import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import BoardShowcase from '../components/home/BoardShowcase';
import AuroraNight from '../components/home/AuroraNight';
import { ArrowRight } from '../components/Icons';
import { CLASSIFICATION_META, CLASSIFICATION_SYMBOL, type MoveClass } from '../lib/review';

/* ------------------------------------------------------------------
   Home — the Aurora Arctic poster page.

   Structure (deliberately unlike the old hero + ledger layout):
     .home
       AuroraNight                 full-bleed arctic environment
       .home-hero                  editorial zone + board showcase
       .hero-foot                  quote + vertical word stack
       .home-more#more             "More than a board." mosaic
       .home-close                 notation strip + Lasker quote
   ------------------------------------------------------------------ */

const BENEFITS = [
  { stat: '900–2400', label: 'Stockfish 18, four honest strengths' },
  { stat: 'Book → Brilliant', label: 'every move classified in review' },
  { stat: '100% local', label: 'your games never leave the tab' },
];

const TIME_CONTROLS = ['Bullet', 'Blitz', 'Rapid', 'Classical'];

const PANEL_CHIPS: MoveClass[] = ['brilliant', 'great', 'best', 'inaccuracy', 'blunder'];

/** Decorative ridge line used inside the Play panel's horizon strip. */
function MiniRidge() {
  return (
    <svg viewBox="0 0 560 72" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 62 L60 34 L118 54 L196 18 L268 52 L340 30 L414 54 L486 38 L560 50 L560 72 L0 72 Z" fill="#050A11" />
      <path
        d="M0 62 L60 34 L118 54 L196 18 L268 52 L340 30 L414 54 L486 38 L560 50"
        fill="none"
        stroke="rgba(142,216,240,0.28)"
        strokeWidth="1.2"
      />
    </svg>
  );
}

/** Decorative evaluation curve for the Analysis panel. */
function EvalCurve() {
  return (
    <svg viewBox="0 0 320 110" preserveAspectRatio="none" aria-hidden="true" focusable="false" className="mp-curve">
      <defs>
        <linearGradient id="mp-curve-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#A99CFF" />
          <stop offset="1" stopColor="#8ED8F0" />
        </linearGradient>
        <linearGradient id="mp-curve-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#A99CFF" stopOpacity="0.28" />
          <stop offset="1" stopColor="#A99CFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" y1="55" x2="320" y2="55" stroke="rgba(220,236,242,0.14)" strokeDasharray="3 5" />
      <path
        d="M0 52 C 30 48, 48 60, 74 58 C 104 55, 118 34, 148 36 C 178 38, 190 70, 220 72 C 250 74, 262 40, 292 30 C 304 26, 314 24, 320 22 L 320 110 L 0 110 Z"
        fill="url(#mp-curve-fill)"
      />
      <path
        d="M0 52 C 30 48, 48 60, 74 58 C 104 55, 118 34, 148 36 C 178 38, 190 70, 220 72 C 250 74, 262 40, 292 30 C 304 26, 314 24, 320 22"
        fill="none"
        stroke="url(#mp-curve-stroke)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="292" cy="30" r="3.4" fill="#8ED8F0" />
    </svg>
  );
}

/** Decorative tactic motif for the Puzzles panel: knight, target, glow. */
function TacticGrid() {
  const cells = new Map<string, { glyph?: string; target?: boolean }>([
    ['a1', { glyph: '♟' }],
    ['b1', {}],
    ['c1', {}],
    ['d1', {}],
    ['a2', {}],
    ['b2', { glyph: '♞', target: true }],
    ['c2', {}],
    ['d2', { glyph: '♝' }],
    ['a3', {}],
    ['b3', {}],
    ['c3', {}],
    ['d3', {}],
    ['a4', { glyph: '♛' }],
    ['b4', {}],
    ['c4', {}],
    ['d4', {}],
  ]);
  const files = ['a', 'b', 'c', 'd'];
  const ranks = [4, 3, 2, 1];
  return (
    <div className="mp-tactic" aria-hidden="true">
      {ranks.map((r) =>
        files.map((f) => {
          const cell = cells.get(`${f}${r}`) ?? {};
          const dark = (files.indexOf(f) + r) % 2 === 0;
          return (
            <span key={`${f}${r}`} className={`mp-cell${dark ? ' dark' : ''}${cell.target ? ' target' : ''}`}>
              {cell.glyph ?? ''}
            </span>
          );
        }),
      )}
    </div>
  );
}

/** Decorative game-graph for the Review panel, dotted with real classification colors. */
function ReviewRibbon() {
  const dots = [
    { x: 38, y: 44, c: '#26c2a3' },
    { x: 128, y: 30, c: '#5c8bb0' },
    { x: 214, y: 58, c: '#f7c631' },
    { x: 282, y: 22, c: '#fa412d' },
  ];
  return (
    <svg viewBox="0 0 320 78" preserveAspectRatio="none" aria-hidden="true" focusable="false" className="mp-ribbon">
      <defs>
        <linearGradient id="mp-ribbon-stroke" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#DCECF2" stopOpacity="0.85" />
          <stop offset="1" stopColor="#8ED8F0" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <path
        d="M0 40 C 22 38, 30 46, 38 44 C 60 40, 72 34, 96 33 C 118 32, 130 30, 152 32 C 176 34, 192 52, 214 58 C 236 64, 250 40, 268 32 C 274 29, 278 26, 282 22 C 294 16, 308 18, 320 20"
        fill="none"
        stroke="url(#mp-ribbon-stroke)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.75"
      />
      {dots.map((d) => (
        <g key={d.x}>
          <circle cx={d.x} cy={d.y} r="7" fill={d.c} opacity="0.18" />
          <circle cx={d.x} cy={d.y} r="3" fill={d.c} />
        </g>
      ))}
    </svg>
  );
}


export default function Home() {
  return (
    <div className="home">
      <AuroraNight />

      <div className="home-inner">
        {/* ————— hero: editorial zone + live showcase ————— */}
        <header className="home-hero">
          <div className="hero-head">
            <p className="hero-eyebrow">
              <i className="eyebrow-rule" aria-hidden="true" />
              66°33′ north — the aurora is out tonight
            </p>
            <h1 className="hero-headline">
              Chess, played
              <br />
              on <em>thin ice</em>.
            </h1>
          </div>

          <p className="hero-lede">
            A quiet, arctic room for serious chess. Real clocks, Stockfish at four strengths, and a review that
            teaches — all inside this browser tab. No account, no server.
          </p>

          <div className="hero-cta">
            <Link to="/play" className="btn btn-lg hero-btn-primary">
              Play now <ArrowRight />
            </Link>
            <button
              type="button"
              className="btn btn-lg hero-btn-ghost"
              onClick={() => {
                const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                document.getElementById('more')?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
              }}
            >
              See what's inside
            </button>
          </div>

          <ul className="hero-benefits">
            {BENEFITS.map((b) => (
              <li key={b.stat}>
                <span className="benefit-stat">{b.stat}</span>
                <span className="benefit-label">{b.label}</span>
              </li>
            ))}
          </ul>

          <div className="hero-show">
            <BoardShowcase />
          </div>
        </header>

        {/* ————— quote foot, like the reference's closing band ————— */}
        <div className="hero-foot">
          <p className="hero-quote">
            “A small gambit
            <br />
            for a sharper tomorrow.”
          </p>
          <div className="hero-words" aria-hidden="true">
            <span>Play</span>
            <span>Learn</span>
            <span>Belong</span>
          </div>
        </div>
      </div>

      {/* ————— More than a board ————— */}
      <section className="home-more" id="more" aria-labelledby="more-title">
        <div className="home-inner">
          <div className="more-head">
            <h2 id="more-title">More than a board.</h2>
            <p>Four rooms under one northern sky — each does one job, properly.</p>
          </div>

          <div className="more-grid">
            <Link to="/play" className="mp mp-play" data-voice="green">
              <div className="mp-body">
                <span className="mp-kicker">Play</span>
                <h3>Find your tempo.</h3>
                <p>
                  Bullet to classical against Stockfish, or a shared board across the sofa. The clock is honest to
                  the tenth of a second.
                </p>
                <div className="mp-chips">
                  {TIME_CONTROLS.map((t) => (
                    <span key={t} className="mp-chip">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mp-horizon" aria-hidden="true">
                <MiniRidge />
              </div>
              <span className="mp-go" aria-hidden="true">
                <ArrowRight />
              </span>
            </Link>

            <Link to="/analysis" className="mp mp-analysis" data-voice="violet">
              <div className="mp-body">
                <span className="mp-kicker">Analysis</span>
                <h3>See further.</h3>
                <p>Load any FEN or PGN and read the position with engine lines, MultiPV and arrows.</p>
              </div>
              <div className="mp-figure" aria-hidden="true">
                <EvalCurve />
              </div>
              <span className="mp-go" aria-hidden="true">
                <ArrowRight />
              </span>
            </Link>

            <Link to="/puzzles" className="mp mp-puzzles" data-voice="green-deep">
              <div className="mp-body">
                <span className="mp-kicker">Puzzles</span>
                <h3>One position, one answer.</h3>
                <p>Mate-in-one to discovered attacks — generated and verified on your machine, scored by streak.</p>
              </div>
              <div className="mp-figure" aria-hidden="true">
                <TacticGrid />
              </div>
              <span className="mp-go" aria-hidden="true">
                <ArrowRight />
              </span>
            </Link>

            <Link to="/review" className="mp mp-review" data-voice="ice">
              <div className="mp-body">
                <span className="mp-kicker">Review</span>
                <h3>Your games, graded kindly.</h3>
                <p>Accuracy per player, a class for every move, and the moments that decided the game.</p>
                <div className="mp-chips mp-chips-class">
                  {PANEL_CHIPS.map((c) => (
                    <span key={c} className="mp-chip class-chip" style={{ '--chip-c': CLASSIFICATION_META[c].color } as CSSProperties}>
                      <b>{CLASSIFICATION_SYMBOL[c] ?? '!'}</b>
                      {CLASSIFICATION_META[c].label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mp-figure" aria-hidden="true">
                <ReviewRibbon />
              </div>
              <span className="mp-go" aria-hidden="true">
                <ArrowRight />
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ————— closing band: notation + Lasker ————— */}
      <section className="home-close">
        <div className="home-inner">
          <div className="close-rule" aria-hidden="true" />
          <div className="close-strip" aria-hidden="true">
            1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6 5.Nf3 <span className="lit">O-O</span> 6.Be2 e5 7.O-O Nc6 8.d5 Ne7
            <span className="lit">9.Ne1</span> Nd7 10.f5 <span className="lit">11.Bg5</span> h6 12.Bh4 c6 13.Qd2 Qe7
            <span className="lit">14.O-O-O</span> — a King's Indian, mapped move by move.
          </div>
          <blockquote className="close-quote">
            “When you see a good move, sit on your hands and look for a better one.”
          </blockquote>
          <cite className="close-cite">Emanuel Lasker, World Champion 1894–1921</cite>
        </div>
      </section>
    </div>
  );
}
