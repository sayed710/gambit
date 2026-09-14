import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import GameBoard from '../components/GameBoard';
import { useEngine } from '../lib/engine/useEngine';
import { useClickToMove } from '../hooks/useClickToMove';
import { useToast } from '../components/Toast';
import { playSound } from '../lib/sound';
import { ENDGAME_LESSONS, type EndgameLesson } from '../data/endgames';
import { evaluateDrill, type DrillOutcome } from '../lib/endgameDetect';
import { loadTraining, recordEndgameAttempt, saveTraining, type TrainingState } from '../lib/trainingStore';

const CATEGORIES: { id: 'mates' | 'pawns' | 'rooks'; label: string }[] = [
  { id: 'mates', label: 'Basic mates' },
  { id: 'pawns', label: 'Pawn endgames' },
  { id: 'rooks', label: 'Rook endgames' },
];

export function Endgames() {
  const [training] = useState(() => loadTraining());

  return (
    <div className="page container">
      <div className="page-head">
        <h1>Endgame Academy</h1>
        <p className="sub">
          Tablebase-verified conversion and defense drills. The engine defends — complete the objective inside the move
          limit. Progress is saved locally.
        </p>
        <nav className="page-tabs mt-2" aria-label="Training area">
          <Link to="/puzzles">Puzzles</Link>
          <Link to="/repertoire">Repertoire</Link>
          <Link to="/endgames" className="on">
            Endgames
          </Link>
          <Link to="/coordinates">Coordinates</Link>
        </nav>
      </div>

      {CATEGORIES.map((cat) => (
        <section key={cat.id} className="mb-2">
          <div className="section-label">{cat.label}</div>
          <div className="study-list">
            {ENDGAME_LESSONS.filter((l) => l.category === cat.id).map((lesson) => {
              const p = training.endgame[lesson.id];
              return (
                <Link key={lesson.id} to={`/endgames/${lesson.id}`} className="study-main study-card" style={{ padding: '0.75rem 0.5rem' }}>
                  <span className="study-title">{lesson.title}</span>
                  <span className="study-meta">
                    {lesson.success.kind === 'survive' ? 'hold the draw' : 'mate'} · limit {lesson.moveLimit}
                    {p ? ` · solved ${p.solved}/${p.attempted}` : ' · new'}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

interface DrillState {
  game: Chess;
  learnerMoves: number;
  startMaterial: number;
  promoted: boolean;
  outcome: DrillOutcome;
  engineThinking: boolean;
}

export function EndgameDrill() {
  const { id } = useParams();
  const lesson = ENDGAME_LESSONS.find((l) => l.id === id) ?? null;
  const engine = useEngine();
  const { toast } = useToast();
  const [resetKey, setResetKey] = useState(0);

  if (!lesson) {
    return (
      <div className="page container">
        <div className="empty-state">
          <p>That lesson does not exist.</p>
          <Link className="btn btn-primary" to="/endgames">
            Back to Endgame Academy
          </Link>
        </div>
      </div>
    );
  }

  return (
    <DrillInner
      key={resetKey}
      lesson={lesson}
      engine={engine}
      toast={toast}
      onRestart={() => setResetKey((k) => k + 1)}
    />
  );
}

function DrillInner({
  lesson,
  engine,
  toast,
  onRestart,
}: {
  lesson: EndgameLesson;
  engine: ReturnType<typeof useEngine>;
  toast: (msg: string) => void;
  onRestart: () => void;
}) {
  const [training, setTraining] = useState<TrainingState>(() => loadTraining());
  const [drill, setDrill] = useState<DrillState>(() => {
    const game = new Chess(lesson.fen);
    const startMaterial = materialFor(game, lesson.side);
    return { game, learnerMoves: 0, startMaterial, promoted: false, outcome: { status: 'playing' } as DrillOutcome, engineThinking: false };
  });
  const [hintShown, setHintShown] = useState(false);
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const attemptsRef = useRef(0);

  const fen = drill.game.fen();
  const turn = drill.game.turn();
  const learnerToMove = turn === lesson.side && drill.outcome.status === 'playing';

  const persistResult = useCallback(
    (solved: boolean, attempts: number) => {
      const next = { ...training, endgame: { ...training.endgame } };
      next.endgame[lesson.id] = recordEndgameAttempt(training.endgame[lesson.id], solved, attempts, Date.now());
      setTraining(next);
      saveTraining(next);
    },
    [training, lesson.id],
  );

  // outcome is computed synchronously after each move instead
  const evaluateNow = useCallback(
    (game: Chess, learnerMoves: number, promoted: boolean) => {
      const out = evaluateDrill(game, lesson, learnerMoves, drill.startMaterial, promoted);
      if (out.status !== 'playing') {
        setDrill((d) => ({ ...d, outcome: out }));
        persistResult(out.status === 'success', learnerMoves);
        playSound(out.status === 'success' ? 'win' : 'lose');
      }
      return out;
    },
    [lesson, drill.startMaterial, persistResult],
  );

  // the engine defends: auto-move whenever it is the defender's turn
  useEffect(() => {
    if (drill.outcome.status !== 'playing') return;
    if (turn === lesson.side) return;
    let cancelled = false;
    setDrill((d) => ({ ...d, engineThinking: true }));
    const fenAtRequest = fen;
    engineRef.current
      .search(fen, lesson.verified.category === 'win' ? 2 : 3, [])
      .then((result) => {
        if (cancelled || drill.outcome.status !== 'playing') return;
        try {
          const game = new Chess(fen);
          const m = result ? game.move({ from: result.from, to: result.to, promotion: result.promotion ?? 'q' }) : null;
          const fallback = m ?? game.moves({ verbose: true })[0] ?? null;
          const final = m ? m : fallback ? game.move(fallback) : null;
          if (!final) {
            setDrill((d) => ({ ...d, engineThinking: false }));
            return;
          }
          playSound(final.isCapture() ? 'capture' : 'move');
          setDrill((d) => ({ ...d, game, engineThinking: false }));
          evaluateNow(game, attemptsRef.current, promotedRef.current);
        } catch {
          setDrill((d) => ({ ...d, engineThinking: false }));
        }
        void fenAtRequest;
      })
      .catch(() => setDrill((d) => ({ ...d, engineThinking: false })));
    return () => {
      cancelled = true;
    };
  }, [turn, drill.outcome.status, fen, lesson, evaluateNow]);

  const promotedRef = useRef(false);

  const onLearnerMove = useCallback(
    (from: Square, to: Square, promotion?: 'q' | 'r' | 'b' | 'n'): 'ok' | 'promote' | 'illegal' => {
      if (drill.outcome.status !== 'playing' || turn !== lesson.side) return 'illegal';
      const probe = new Chess(fen);
      const legal = probe.moves({ verbose: true }).filter((m) => m.from === from && m.to === to);
      if (legal.length === 0) return 'illegal';
      if (legal.some((m) => m.promotion) && !promotion) return 'promote';
      try {
        const m = probe.move({ from, to, promotion: promotion ?? 'q' });
        playSound(m.isCapture() ? 'capture' : 'move');
        const learnerMoves = attemptsRef.current + 1;
        attemptsRef.current = learnerMoves;
        const promotedNow = promotedRef.current || m.promotion !== undefined;
        promotedRef.current = promotedNow;
        const out = evaluateDrill(probe, lesson, learnerMoves, drill.startMaterial, promotedNow);
        setDrill((d) => ({
          ...d,
          game: probe,
          learnerMoves,
          promoted: promotedNow,
          outcome: out.status === 'playing' ? d.outcome : out,
        }));
        if (out.status !== 'playing') {
          persistResult(out.status === 'success', learnerMoves);
          playSound(out.status === 'success' ? 'win' : 'lose');
        }
        return 'ok';
      } catch {
        return 'illegal';
      }
    },
    [fen, drill.outcome.status, turn, lesson.side, evaluateNow, persistResult],
  );

  const click = useClickToMove({
    fen,
    movableColor: learnerToMove ? lesson.side : null,
    tryMove: (from, to) => onLearnerMove(from, to),
  });

  const handleDrop = useCallback(
    (from: Square, to: Square) => {
      const r = onLearnerMove(from, to);
      if (r === 'promote') {
        toast('Choose the promotion piece.');
        return false;
      }
      if (r === 'illegal') playSound('illegal');
      click.clear();
      return r === 'ok';
    },
    [onLearnerMove, click],
  );

  // promotion picker for click/drag that returned 'promote'
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);
  useEffect(() => {
    if (pendingPromotion) {
      const r = onLearnerMove(pendingPromotion.from, pendingPromotion.to);
      if (r !== 'promote') setPendingPromotion(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPromotion]);

  const outcomeBanner =
    drill.outcome.status === 'playing'
      ? drill.engineThinking
        ? 'The defense is thinking…'
        : learnerToMove
          ? lesson.objective
          : 'Defender to move.'
      : drill.outcome.status === 'success'
        ? `Solved — ${drill.outcome.reason}`
        : `Failed — ${drill.outcome.reason}`;

  return (
    <div className="page container">
      <div className="page-head row between wrap" style={{ gap: '1rem' }}>
        <div className="col" style={{ gap: '0.35rem' }}>
          <Link to="/endgames" className="small muted" style={{ textDecoration: 'none' }}>
            ← Endgame Academy
          </Link>
          <h1>{lesson.title}</h1>
          <p className="sub">{lesson.objective}</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onRestart}>
          Restart drill
        </button>
      </div>

      <div className="analysis-layout">
        <div>
          <GameBoard
            boardId="endgame-drill"
            fen={fen}
            orientation={lesson.side === 'w' ? 'white' : 'black'}
            movableColor={learnerToMove ? lesson.side : null}
            onSquareClick={click.onSquareClick}
            selected={click.selected}
            legalTargets={click.legalTargets}
            onDrop={handleDrop}
            pendingPromotion={
              pendingPromotion ? { from: pendingPromotion.from, to: pendingPromotion.to, color: lesson.side } : null
            }
            onChoosePromotion={(piece) => {
              if (!pendingPromotion) return;
              onLearnerMove(pendingPromotion.from, pendingPromotion.to, piece);
              setPendingPromotion(null);
            }}
            onCancelPromotion={() => setPendingPromotion(null)}
          />
          <div className="board-under">
            <span className="board-hint mono">
              {lesson.side === 'w' ? 'You play White' : 'You play Black'} · move {attemptsRef.current + 1}/{lesson.moveLimit}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setHintShown((v) => !v)} aria-pressed={hintShown}>
              {hintShown ? 'Hide hint' : 'Hint'}
            </button>
          </div>
          {hintShown && <p className="small muted mt-1">{lesson.hint}</p>}
          <div
            className={`status-banner mt-2 ${drill.outcome.status === 'success' ? '' : drill.outcome.status === 'failure' ? 'check' : ''}`}
            role="status"
          >
            {outcomeBanner}
          </div>
        </div>

        <aside className="col" style={{ gap: '0.9rem' }}>
          <div className="panel panel-pad">
            <div className="section-label">Technique</div>
            <p className="small" style={{ margin: 0, lineHeight: 1.7 }}>
              {lesson.explanation}
            </p>
          </div>
          <div className="panel panel-pad">
            <div className="section-label">Your record</div>
            {(() => {
              const p = training.endgame[lesson.id];
              return p ? (
                <div className="small">
                  attempted {p.attempted} · solved {p.solved} · best {p.bestAttempts ?? '—'} moves · mastery{' '}
                  {Math.round(p.mastery * 100)}%
                </div>
              ) : (
                <div className="small muted">First attempt — it will be saved when the drill ends.</div>
              );
            })()}
            <p className="small muted mt-1" style={{ marginBottom: 0 }}>
              Verified {lesson.verified.category} (tablebase, DTM {lesson.verified.dtm ?? 0} plies from the start).
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function materialFor(game: Chess, side: 'w' | 'b'): number {
  const v: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  let total = 0;
  for (const row of game.board()) {
    for (const sq of row) {
      if (sq && sq.color === side) total += v[sq.type] ?? 0;
    }
  }
  return total;
}
