import { Link } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import GameBoard from '../components/GameBoard';
import { useToast } from '../components/Toast';

/** 45-second coordinates drill: a square is named, you click it. */
const DURATION = 45;
const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1';
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function randomSquare(exclude?: string): string {
  for (;;) {
    const sq = `${FILES[Math.floor(Math.random() * 8)]}${1 + Math.floor(Math.random() * 8)}`;
    if (sq !== exclude) return sq;
  }
}

export default function Coordinates() {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [left, setLeft] = useState(DURATION);
  const [target, setTarget] = useState(() => randomSquare());
  const [score, setScore] = useState(0);
  const [misses, setMisses] = useState(0);
  const [last, setLast] = useState<'hit' | 'miss' | null>(null);

  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          setRunning(false);
          return 0;
        }
        return v - 1;
      });
    }, 1000);
    return () => window.clearInterval(t);
  }, [running]);

  const start = useCallback(() => {
    setRunning(true);
    setLeft(DURATION);
    setScore(0);
    setMisses(0);
    setTarget(randomSquare());
    setLast(null);
  }, []);

  const finishStats = useMemo(() => `${score} hits · ${misses} misses`, [score, misses]);

  useEffect(() => {
    if (!running && left === 0) toast(`Done — ${finishStats}.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, left]);

  const onSquare = useCallback(
    (sq: string) => {
      if (!running) return;
      if (sq === target) {
        setScore((n) => n + 1);
        setLast('hit');
        setTarget(randomSquare(target));
        play();
      } else {
        setMisses((n) => n + 1);
        setLast('miss');
      }
    },
    [running, target],
  );

  return (
    <div className="page container">
      <div className="page-head">
        <h1>Coordinates trainer</h1>
        <p className="sub">See a square name, click it. Forty-five seconds — the board is empty on purpose.</p>
        <nav className="page-tabs mt-2" aria-label="Training area">
          <Link to="/puzzles">Puzzles</Link>
          <Link to="/repertoire">Repertoire</Link>
          <Link to="/coordinates" className="on">
            Coordinates
          </Link>
        </nav>
      </div>

      <div className="coords-layout">
        <div>
          <GameBoard boardId="coords" fen={EMPTY_FEN} orientation="white" movableColor={null} onSquareClick={(sq) => onSquare(sq)} />
          <div className="board-under">
            <button className="btn btn-accent btn-sm" onClick={start}>
              {running ? 'Restart' : 'Start drill'}
            </button>
            <span className="board-hint mono">{running ? `${left}s` : `${DURATION}s drill`}</span>
          </div>
        </div>

        <aside className="panel panel-pad col" style={{ gap: '0.8rem' }}>
          <div className="section-label">Find</div>
          <div className="coords-target">{running ? target : '—'}</div>
          <div className="rep-stats">
            <div>
              <div className="v">{score}</div>
              <div className="k">hits</div>
            </div>
            <div>
              <div className="v">{misses}</div>
              <div className="k">misses</div>
            </div>
            <div>
              <div className="v">{score + misses > 0 ? Math.round((score / (score + misses)) * 100) : '—'}</div>
              <div className="k">accuracy</div>
            </div>
          </div>
          {last && (
            <span className={`small ${last === 'hit' ? '' : 'muted'}`} style={{ color: last === 'hit' ? 'var(--good)' : undefined }}>
              {last === 'hit' ? 'Hit.' : 'Miss.'}
            </span>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            Knowing the board by name is the base skill for reading notation, following commentary and visualising
            variations.
          </p>
        </aside>
      </div>
    </div>
  );
}

function play() {
  // no audio dependency — a silent tick keeps the drill calm
  void 0;
}
