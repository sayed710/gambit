import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import GameBoard from '../components/GameBoard';
import { PUZZLES } from '../data/puzzles';
import type { PuzzleRecord } from '../lib/types';
import { useProfile } from '../state/ProfileContext';
import { playSound } from '../lib/sound';
import { useClickToMove } from '../hooks/useClickToMove';
import { ArrowRight, LightbulbIcon, PlayIcon } from '../components/Icons';

type Phase = 'solving' | 'solved' | 'failed';

interface Session {
  order: number[];
  index: number;
  streak: number;
}

function shuffle(n: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function Puzzles() {
  const { profile, recordPuzzle } = useProfile();
  const [session, setSession] = useState<Session>(() => ({ order: shuffle(PUZZLES.length), index: 0, streak: 0 }));
  const [phase, setPhase] = useState<Phase>('solving');
  const [attempted, setAttempted] = useState(false);
  const [hintSquare, setHintSquare] = useState<Square | null>(null);
  const [wrongMove, setWrongMove] = useState<Square | null>(null);

  const puzzle: PuzzleRecord = PUZZLES[session.order[session.index] % PUZZLES.length];
  const puzzleRating = useMemo(() => 900 + puzzle.difficulty * 35, [puzzle]);

  const game = useMemo(() => {
    try {
      return new Chess(puzzle.fen);
    } catch {
      return new Chess();
    }
  }, [puzzle.fen]);
  const solutionMove = useMemo(() => game.moves({ verbose: true }).find((m) => m.san === puzzle.solution) ?? null, [game, puzzle.solution]);

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

  const fail = useCallback(() => {
    if (phase !== 'solving' || attempted) return;
    setPhase('failed');
    playSound('lose');
    recordPuzzle(false, puzzleRating, session.streak);
    setSession((s) => ({ ...s, streak: 0 }));
  }, [phase, attempted, recordPuzzle, puzzleRating, session.streak]);

  const succeed = useCallback(() => {
    setPhase('solved');
    playSound('promote');
    const newStreak = session.streak + 1;
    recordPuzzle(true, puzzleRating, newStreak);
    setSession((s) => ({ ...s, streak: newStreak }));
    window.setTimeout(() => nextPuzzle(), 2400);
  }, [nextPuzzle, recordPuzzle, puzzleRating, session.streak]);

  const handleMove = useCallback(
    (from: Square, to: Square) => {
      if (!movable) return false;
      const g = new Chess(liveFen);
      const candidates = g.moves({ verbose: true }).filter((m) => m.from === from && m.to === to);
      // for promotions prefer the under-promotion when it is the actual solution
      const legal = candidates.find((m) => m.san === puzzle.solution) ?? candidates[0];
      if (!legal) return false;
      if (legal.san === puzzle.solution) {
        g.move(legal);
        setLiveFen(g.fen());
        setLastMove({ from, to });
        succeed();
        return true;
      }
      // wrong try — flash the attempted move, then reset the board
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

  return (
    <div className="page container">
      <div className="page-head">
        <h1>Mate in one</h1>
        <p className="sub">
          Every puzzle is generated and verified in the browser — one move ends the game. Find it. A wrong first try
          counts as a miss, so look before you leap.
        </p>
      </div>

      <div className="puzzle-layout">
        <div>
          <div className={`status-banner mb-2${phase === 'failed' ? ' check' : ''}`} role="status">
            {phase === 'solving' && (
              <>
                {sideName} to play — <strong>mate in one</strong>.
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ marginLeft: 'auto' }}
                  onClick={() => solutionMove && setHintSquare(solutionMove.from)}
                >
                  <LightbulbIcon /> Hint
                </button>
              </>
            )}
            {phase === 'solved' && <>Checkmate — well spotted. Loading the next puzzle…</>}
            {phase === 'failed' && (
              <>
                Missed. The answer was <strong className="mono">{puzzle.solution}</strong>.
                <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={nextPuzzle}>
                  Next puzzle <ArrowRight />
                </button>
              </>
            )}
          </div>

          <div
            style={{
              transform: wrongMove ? 'translateX(0)' : undefined,
              animation: wrongMove ? 'shake 0.35s ease' : undefined,
            }}
          >
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
          <style>{`@keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }`}</style>
        </div>

        <aside className="puzzle-side">
          <div className="panel panel-pad">
            <div className="section-label">Session</div>
            <div className="row between">
              <div className="streak">
                {session.streak}
                <small>current streak</small>
              </div>
              <div className="right small muted" style={{ textAlign: 'right' }}>
                Puzzle {session.index + 1} of {PUZZLES.length}
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
            <div className="small muted mt-1">
              Solving harder puzzles (more pieces, quieter positions) pushes your number up; misses pull it back.
            </div>
          </div>

          <div className="row wrap" style={{ gap: '0.5rem' }}>
            <button className="btn btn-ghost btn-sm" onClick={showSolution}>
              Show solution
            </button>
            <button className="btn btn-ghost btn-sm" onClick={nextPuzzle}>
              Skip <ArrowRight />
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setSession({ order: shuffle(PUZZLES.length), index: 0, streak: 0 })}
            >
              <PlayIcon /> New set
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
