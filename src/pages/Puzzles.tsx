import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import GameBoard from '../components/GameBoard';
import { PUZZLES } from '../data/puzzles';
import type { PuzzleRecord, PuzzleTheme } from '../lib/types';
import { useProfile } from '../state/ProfileContext';
import { playSound } from '../lib/sound';
import { useClickToMove } from '../hooks/useClickToMove';
import { ArrowRight, LightbulbIcon, PlayIcon, RetryIcon } from '../components/Icons';

type Phase = 'solving' | 'solved' | 'failed';

interface Session {
  order: number[];
  index: number;
  streak: number;
}

export const THEME_LABELS: Record<PuzzleTheme, string> = {
  mate1: 'Mate in 1',
  mate2: 'Mate in 2',
  fork: 'Forks',
  skewer: 'Skewers',
  pin: 'Pins',
  hanging: 'Free pieces',
  discovered: 'Discovered attacks',
};

const ALL_THEMES: PuzzleTheme[] = [...new Set<string>(PUZZLES.map((p) => p.theme))].sort() as PuzzleTheme[];

function shuffle(arr: number[]): number[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function Puzzles() {
  const { profile, recordPuzzle } = useProfile();
  const [theme, setTheme] = useState<PuzzleTheme | 'all'>('all');
  const [mode, setMode] = useState<'normal' | 'rush' | 'survival'>('normal');
  const [rushLeft, setRushLeft] = useState(60);
  const [lives, setLives] = useState(3);
  const [solvedCount, setSolvedCount] = useState(0);
  const [over, setOver] = useState<null | { reason: string }>(null);
  const pool = useMemo(() => PUZZLES.filter((p) => theme === 'all' || p.theme === theme), [theme]);

  const [session, setSession] = useState<Session>(() => ({ order: shuffle(PUZZLES.map((_, i) => i)), index: 0, streak: 0 }));
  const [phase, setPhase] = useState<Phase>('solving');
  const [attempted, setAttempted] = useState(false);
  const [hintSquare, setHintSquare] = useState<Square | null>(null);
  const [wrongMove, setWrongMove] = useState<Square | null>(null);

  // timed rush: one shared clock, session ends at zero
  useEffect(() => {
    if (mode !== 'rush' || over) return;
    const t = window.setInterval(() => {
      setRushLeft((v) => {
        if (v <= 1) {
          setOver({ reason: `Time — ${solvedCount} solved` });
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [mode, over, solvedCount]);

  // rebuild the session whenever the theme filter changes
  useEffect(() => {
    const indices = pool.map((p) => PUZZLES.indexOf(p));
    setSession({ order: shuffle(indices), index: 0, streak: 0 });
    setPhase('solving');
    setAttempted(false);
    setHintSquare(null);
    setWrongMove(null);
  }, [pool]);

  const puzzleIndex = session.order[session.index] ?? 0;
  const puzzle: PuzzleRecord = PUZZLES[puzzleIndex] ?? PUZZLES[0];
  const puzzleRating = useMemo(() => 900 + puzzle.difficulty * 35, [puzzle]);

  const game = useMemo(() => {
    try {
      return new Chess(puzzle.fen);
    } catch {
      return new Chess();
    }
  }, [puzzle.fen]);
  const norm = (san: string) => san.replace(/[+#]/g, '');
  const solutionMove = useMemo(
    () => game.moves({ verbose: true }).find((m) => norm(m.san) === norm(puzzle.solution)) ?? null,
    [game, puzzle.solution],
  );

  const [liveFen, setLiveFen] = useState(game.fen());
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);

  useEffect(() => {
    setPhase('solving');
    setAttempted(false);
    setHintSquare(null);
    setWrongMove(null);
    setLiveFen(game.fen());
    setLastMove(null);
  }, [game]);

  const movable = phase === 'solving';

  const nextPuzzle = useCallback(() => {
    setSession((s) => ({ ...s, index: (s.index + 1) % s.order.length }));
  }, []);

  const retryPuzzle = useCallback(() => {
    setPhase('solving');
    setAttempted(false);
    setHintSquare(null);
    setLiveFen(game.fen());
    setLastMove(null);
  }, [game]);

  const fail = useCallback(() => {
    if (phase !== 'solving' || attempted) return;
    setPhase('failed');
    playSound('lose');
    recordPuzzle(false, puzzleRating, session.streak, puzzle.theme);
    setSession((s) => ({ ...s, streak: 0 }));
    if (mode === 'survival') {
      setLives((v) => {
        const left = v - 1;
        if (left <= 0) setOver({ reason: `Out of lives — streak ${session.streak}` });
        return Math.max(0, left);
      });
    }
  }, [phase, attempted, recordPuzzle, puzzleRating, session.streak, puzzle.theme, mode]);

  const succeed = useCallback(() => {
    setPhase('solved');
    playSound('promote');
    const newStreak = session.streak + 1;
    recordPuzzle(true, puzzleRating, newStreak, puzzle.theme);
    setSession((s) => ({ ...s, streak: newStreak }));
    setSolvedCount((n) => n + 1);
  }, [recordPuzzle, puzzleRating, session.streak, puzzle.theme]);

  const handleMove = useCallback(
    (from: Square, to: Square) => {
      if (!movable) return false;
      const g = new Chess(liveFen);
      const candidates = g.moves({ verbose: true }).filter((m) => m.from === from && m.to === to);
      const legal = candidates.find((m) => norm(m.san) === norm(puzzle.solution)) ?? candidates[0];
      if (!legal) return false;
      if (legal.san === puzzle.solution) {
        g.move(legal);
        setLiveFen(g.fen());
        setLastMove({ from, to });
        succeed();
        return true;
      }
      setAttempted(true);
      playSound('illegal');
      setWrongMove(to);
      setLiveFen(game.fen());
      setLastMove(null);
      window.setTimeout(() => setWrongMove(null), 600);
      return false;
    },
    [movable, liveFen, puzzle.solution, succeed, game],
  );

  const click = useClickToMove({
    fen: liveFen,
    movableColor: movable ? puzzle.sideToMove : null,
    tryMove: (from, to) => (handleMove(from, to) ? 'ok' : 'illegal'),
  });

  const showSolution = useCallback(() => {
    if (!solutionMove) return;
    if (phase === 'solving') fail();
    setLastMove({ from: solutionMove.from, to: solutionMove.to });
    const g = new Chess(liveFen);
    try {
      g.move(solutionMove);
      setLiveFen(g.fen());
    } catch {
      setLiveFen(game.fen());
    }
  }, [solutionMove, phase, fail, liveFen, game]);

  const sideName = puzzle.sideToMove === 'w' ? 'White' : 'Black';
  const explanation = useMemo(() => {
    switch (puzzle.theme) {
      case 'mate1':
        return `${puzzle.solution} delivers checkmate immediately.`;
      case 'mate2':
        return `${puzzle.solution} forces mate on the next move, every defence collapses.`;
      case 'fork':
        return `${puzzle.solution} attacks two enemy pieces at once, only one can be saved.`;
      case 'skewer':
        return `${puzzle.solution} hits a piece that must move, exposing a more valuable one behind it.`;
      case 'pin':
        return `${puzzle.solution} pins a defender to the king, it is frozen in place.`;
      case 'hanging':
        return `${puzzle.solution} wins material outright: the target was undefended.`;
      case 'discovered':
        return `${puzzle.solution} clears the way for another piece's attack, a discovered strike.`;
      default:
        return '';
    }
  }, [puzzle]);

  const ask = puzzle.theme.startsWith('mate')
    ? `mate ${puzzle.theme === 'mate1' ? 'in one' : 'in two'}`
    : THEME_LABELS[puzzle.theme].toLowerCase().replace(/s$/, '');

  return (
    <div className="page container">
      <div className="page-head">
        <h1>Puzzle training</h1>
        <p className="sub">
          Generated and verified in-browser, every solution is mechanically checked against its theme. One wrong try
          counts as a miss.
        </p>
      </div>

      <div className="theme-chips mb-2" role="group" aria-label="Puzzle themes">
        <button className={`theme-chip${theme === 'all' ? ' on' : ''}`} onClick={() => setTheme('all')}>
          All ({PUZZLES.length})
        </button>
        {ALL_THEMES.map((t) => (
          <button key={t} className={`theme-chip${theme === t ? ' on' : ''}`} onClick={() => setTheme(t)}>
            {THEME_LABELS[t]} ({PUZZLES.filter((p) => p.theme === t).length})
          </button>
        ))}
      </div>

      {pool.length === 0 || session.order.length === 0 ? (
        <div className="empty-state">
          <p>No puzzles for this theme yet, run the generator with different targets.</p>
        </div>
      ) : (
        <div className="puzzle-layout">
          <div>
            <div className="arena-head">
              <span className="objective">
                {puzzle.theme.startsWith('mate') ? (
                  <><strong>Mate</strong> in {puzzle.theme === 'mate1' ? 'one' : 'two'}</>
                ) : (
                  <strong>{THEME_LABELS[puzzle.theme]}</strong>
                )}
              </span>
              <span className="side">{sideName} to move · rating ~{Math.round(puzzleRating)}</span>
            </div>
            <div className={`status-banner mb-2${phase === 'failed' ? ' check' : ''}`} role="status">
              {phase === 'solving' && (
                <>
                  {sideName} to play: <strong>{ask}</strong>.
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ marginLeft: 'auto' }}
                    onClick={() => solutionMove && setHintSquare(solutionMove.from)}
                  >
                    <LightbulbIcon /> Hint
                  </button>
                </>
              )}
              {phase === 'solved' && <>Solved: {explanation}</>}
              {phase === 'failed' && (
                <>
                  Missed.{' '}
                  <span>
                    {explanation.replace(puzzle.solution, '')}
                    <strong className="mono">{puzzle.solution}</strong> was the move.
                  </span>
                </>
              )}
            </div>

            <div style={{ animation: wrongMove ? 'pop-in 0.2s ease' : undefined }}>
              <GameBoard
                boardId={`puzzle-${puzzle.id}`}
                fen={liveFen}
                orientation={puzzle.sideToMove === 'w' ? 'white' : 'black'}
                lastMove={lastMove}
                movableColor={movable ? puzzle.sideToMove : null}
                onDrop={handleMove}
                onSquareClick={click.onSquareClick}
                selected={click.selected || hintSquare}
                legalTargets={click.legalTargets}
              />
            </div>
          </div>

          <aside className="puzzle-side">
            <div className="panel panel-pad">
              <div className="section-label">
                Session
                <span className="row" style={{ gap: 2 }}>
                  {(['normal', 'rush', 'survival'] as const).map((m) => (
                    <button
                      key={m}
                      className={`theme-chip${mode === m ? ' on' : ''}`}
                      style={{ padding: '0.12rem 0.5rem', fontSize: '0.72rem' }}
                      onClick={() => {
                        setMode(m);
                        setSolvedCount(0);
                        setRushLeft(60);
                        setLives(3);
                        setOver(null);
                      }}
                      aria-pressed={mode === m}
                    >
                      {m}
                    </button>
                  ))}
                </span>
              </div>
              {over && (
                <div className="status-banner mb-1" role="status">
                  {over.reason} · restart in the filter bar
                </div>
              )}
              <div className="row between">
                <div className="streak">
                  {mode === 'rush' ? rushLeft : mode === 'survival' ? lives : session.streak}
                  <small>{mode === 'rush' ? 'seconds left' : mode === 'survival' ? 'lives' : 'current streak'}</small>
                </div>
                <div className="right small muted">
                  solved {solvedCount} this run
                  <br />
                  best streak {profile.puzzle.bestStreak}
                </div>
              </div>
            </div>

            <div className="panel panel-pad">
              <div className="section-label">Puzzle rating</div>
              <div className="row between">
                <span className="mono" style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                  {Math.round(profile.puzzle.rating)}
                </span>
                <span className="small muted">
                  solved {profile.puzzle.solved} · missed {profile.puzzle.failed}
                </span>
              </div>
            </div>

            <div className="panel panel-pad">
              <div className="section-label">
                By theme
                <Link to="/coordinates" className="small muted" style={{ textDecoration: 'none' }}>
                  coordinates drill →
                </Link>
              </div>
              <div className="col" style={{ gap: '0.3rem' }}>
                {ALL_THEMES.map((t) => {
                  const st = profile.puzzle.byTheme?.[t] ?? { solved: 0, failed: 0 };
                  const total = st.solved + st.failed;
                  return (
                    <div key={t} className="row between small">
                      <span className="muted">{THEME_LABELS[t]}</span>
                      <span className="mono">
                        {st.solved}/{total}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="row wrap" style={{ gap: '0.5rem' }}>
              {phase === 'failed' && (
                <button className="btn btn-ghost btn-sm" onClick={retryPuzzle}>
                  <RetryIcon /> Retry
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={showSolution}>
                Show solution
              </button>
              <button className="btn btn-ghost btn-sm" onClick={nextPuzzle}>
                Skip <ArrowRight />
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setSession({ order: shuffle(pool.map((p) => PUZZLES.indexOf(p))), index: 0, streak: 0 });
                  setSolvedCount(0);
                  setRushLeft(60);
                  setLives(3);
                  setOver(null);
                }}
              >
                <PlayIcon /> New set
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
