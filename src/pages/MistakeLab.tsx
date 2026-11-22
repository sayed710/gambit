import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Chess, type Square } from 'chess.js';
import { usePageTitle } from '../hooks/usePageTitle';
import { useClickToMove } from '../hooks/useClickToMove';
import GameBoard from '../components/GameBoard';
import TrainTabs from '../components/TrainTabs';
import { CLASSIFICATION_META } from '../lib/review';
import { useProfile } from '../state/ProfileContext';
import { playSound } from '../lib/sound';
import {
  abandonSession,
  completeCurrent,
  currentExercise,
  dueExercises,
  gradeLabMove,
  harvestAll,
  labStats,
  loadLab,
  MASTERED_INTERVAL_DAYS,
  saveLab,
  startSession,
  type LabExercise,
  type LabOutcome,
  type MistakeLabState,
} from '../lib/mistakeLab';

/* ============================================================
   Mistake Lab (Gambit 2.0, milestone 1) — retry the critical
   decisions of YOUR games against the verdict the engine already
   gave them. Every exercise is a real, verified review outcome:
   position before the decision, the move you played, and the
   engine's best move. Spaced repetition schedules the retries;
   mastery is an interval, never a counter.
   ============================================================ */

function OutcomeChip({ outcome }: { outcome: LabOutcome }) {
  const label = outcome === 'clean' ? 'clean solve' : outcome === 'after-wrong' ? 'solved after retries' : 'assisted';
  return <span className="conn-pill conn-live">{label}</span>;
}

/** One lab exercise on the board: find the engine's best move. */
function LabRunner({
  exercise,
  state,
  setState,
  onExit,
}: {
  exercise: LabExercise;
  state: MistakeLabState;
  setState: (s: MistakeLabState) => void;
  onExit: () => void;
}) {
  const meta = CLASSIFICATION_META[exercise.classification];
  const [hint, setHint] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const assistedRef = useRef(false);
  const firstTryRef = useRef(true);
  const resolvedRef = useRef(false);
  const [resolved, setResolved] = useState<LabOutcome | null>(null);

  const settle = useCallback(
    (outcome: LabOutcome) => {
      if (resolvedRef.current) return;
      resolvedRef.current = true;
      const next = completeCurrent(state, outcome, Date.now());
      setState(saveLab(next).state);
      setResolved(outcome);
      playSound(outcome === 'clean' ? 'win' : 'click');
    },
    [state, setState],
  );

  const onMove = useCallback(
    (from: Square, to: Square): 'ok' | 'illegal' => {
      if (resolvedRef.current) return 'ok';
      const probe = new Chess(exercise.fenBefore);
      let move;
      try {
        move = probe.move({ from, to, promotion: 'q' }); // v1: auto-queen
      } catch {
        return 'illegal';
      }
      if (!move) return 'illegal';
      if (gradeLabMove(exercise, move.san) === 'wrong') {
        firstTryRef.current = false;
        setFeedback(`${move.san} is not it — the position calls for something better. Try again.`);
        return 'illegal';
      }
      const outcome: LabOutcome = assistedRef.current ? 'assisted' : firstTryRef.current ? 'clean' : 'after-wrong';
      setFeedback(`Found it — ${move.san}.`);
      settle(outcome);
      return 'ok';
    },
    [exercise, settle],
  );

  const click = useClickToMove({ fen: exercise.fenBefore, movableColor: exercise.side, tryMove: onMove });

  return (
    <div className="analysis-layout">
      <div>
        <GameBoard
          boardId="lab-runner"
          fen={exercise.fenBefore}
          orientation={exercise.side === 'w' ? 'white' : 'black'}
          movableColor={exercise.side}
          onSquareClick={click.onSquareClick}
          selected={click.selected}
          legalTargets={click.legalTargets}
          onDrop={(from, to) => {
            const r = onMove(from, to);
            click.clear();
            return r === 'ok';
          }}
        />
        <div className="board-under">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              assistedRef.current = true;
              setHint((h) => !h);
            }}
          >
            {hint ? 'Hide hint' : 'Hint'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (!revealed) assistedRef.current = true;
              setRevealed((r) => !r);
            }}
          >
            {revealed ? 'Hide answer' : 'Reveal'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const next = abandonSession(state, Date.now());
              setState(saveLab(next).state);
              onExit();
            }}
          >
            End session
          </button>
        </div>
        {hint && (
          <p className="small muted mt-1">
            You are looking for a better {meta.label.toLowerCase()}-class move than what was played.
          </p>
        )}
        {revealed && (
          <p className="small mt-1" style={{ color: 'var(--gold-ink)' }}>
            The engine's move: <strong>{exercise.bestSan}</strong>
          </p>
        )}
        {feedback && (
          <p className="small mt-1" role="status">
            {feedback}
          </p>
        )}
      </div>
      <aside className="panel panel-pad">
        <div className="section-label">The decision</div>
        <p className="small muted" style={{ margin: '0.3rem 0 0.6rem' }}>
          vs {exercise.opponent || 'unknown opponent'} · move {Math.floor(exercise.ply / 2) + 1}
          {exercise.side === 'w' ? '.' : '…'} you played{' '}
          <strong style={{ color: 'var(--clay-ink)' }}>{exercise.playedSan}</strong>
        </p>
        <span
          className="conn-pill"
          style={{ background: meta.color, color: '#fff', display: 'inline-block', marginBottom: '0.6rem' }}
        >
          {meta.label} · {exercise.cpl}cp lost
        </span>
        {resolved ? (
          <>
            <div className="row" style={{ gap: '0.5rem', alignItems: 'center' }}>
              <OutcomeChip outcome={resolved} />
            </div>
            <p className="small muted" style={{ margin: '0.4rem 0' }}>
              The engine's move was <strong>{exercise.bestSan}</strong>. This exercise is scheduled for another visit —
              mastery means solving it cleanly until the interval proves it stuck.
            </p>
            <button className="btn btn-gold" onClick={onExit}>
              Continue
            </button>
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            Find a better move than {exercise.playedSan}. The exact engine move is the only accepted answer — near
            misses count as wrong until a verified equivalence check exists.
          </p>
        )}
      </aside>
    </div>
  );
}

export default function MistakeLab() {
  usePageTitle('Gambit — Mistake Lab');
  const { profile } = useProfile();
  const [state, setState] = useState<MistakeLabState>(() => loadLab());
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const persist = useCallback((s: MistakeLabState) => {
    const res = saveLab(s);
    setState(res.state);
  }, []);

  const stats = useMemo(() => labStats(state, Date.now()), [state]);
  const session = state.session;
  const exercise = useMemo(() => currentExercise(state), [state]);
  const sessionDone = !!session && session.index >= session.queue.length;
  const cleanCount = session?.results.filter((r) => r.outcome === 'clean').length ?? 0;
  const dueNowIds = useMemo(() => new Set(dueExercises(state, Date.now()).map((x) => x.id)), [state]);

  const sync = () => {
    const result = harvestAll(profile, loadLab(), Date.now());
    persist(result.state);
    setSyncNote(
      result.gamesScanned === 0
        ? 'No reviewed games found — run a Review on a finished game first. The Lab only uses verified analysis.'
        : `Added ${result.added} exercise${result.added === 1 ? '' : 's'} from ${result.gamesScanned} reviewed game${result.gamesScanned === 1 ? '' : 's'}.`,
    );
  };

  return (
    <div className="page container">
      <TrainTabs current="/lab" />
      <header className="page-head">
        <h1>Mistake Lab</h1>
        <p className="sub">
          Your games, your mistakes, scheduled until they are gone. Every exercise comes from a verified engine review
          of a game you actually played — nothing is invented.
        </p>
      </header>

      <div className="row wrap mb-2" style={{ gap: '0.6rem', alignItems: 'center' }}>
        <span className="lbl small">Exercises: {stats.total}</span>
        <span className="lbl small">Due now: {stats.due}</span>
        <span className="lbl small">Mastered: {stats.mastered}</span>
        <span className="lbl small">From {stats.sources} game{stats.sources === 1 ? '' : 's'}</span>
        <button className="btn btn-ghost btn-sm" onClick={sync}>
          Sync from reviewed games
        </button>
      </div>
      {syncNote && (
        <p className="small muted" role="status" style={{ margin: '0 0 0.8rem' }}>
          {syncNote}
        </p>
      )}

      {stats.total === 0 ? (
        <div className="empty-state">
          <p>
            Nothing in the lab yet. Finish a game, open its <strong>Review</strong>, and use{' '}
            <em>“Send mistakes to the Lab”</em> — or press <strong>Sync from reviewed games</strong> above. Only
            positions the engine actually flagged (with a verified best move) become exercises.
          </p>
        </div>
      ) : session && !sessionDone && exercise ? (
        <div>
          <p className="small muted mb-1">
            Session · exercise {session.index + 1} of {session.queue.length} · {cleanCount} clean so far
          </p>
          <LabRunner key={exercise.id} exercise={exercise} state={state} setState={persist} onExit={() => undefined} />
        </div>
      ) : sessionDone && session ? (
        <div className="panel panel-pad">
          <div className="section-label">Session complete</div>
          <p className="small" style={{ margin: '0.3rem 0 0.6rem' }}>
            {session.results.length} exercise{session.results.length === 1 ? '' : 's'} — {cleanCount} clean,{' '}
            {session.results.length - cleanCount} needed help or retries. Each one is scheduled for its next visit.
          </p>
          <div className="row" style={{ gap: '0.5rem' }}>
            {session.results.map((r, i) => (
              <OutcomeChip key={`${r.id}-${i}`} outcome={r.outcome} />
            ))}
          </div>
          <button className="btn btn-gold mt-2" onClick={() => persist({ ...state, session: null })}>
            Finish
          </button>
        </div>
      ) : (
        <div className="panel panel-pad">
          {stats.due > 0 ? (
            <>
              <p className="small" style={{ margin: '0 0 0.6rem' }}>
                {stats.due} exercise{stats.due === 1 ? ' is' : 's are'} due. A session takes the next{' '}
                {Math.min(stats.due, 10)} and ends with a summary.
              </p>
              <button className="btn btn-gold" onClick={() => persist(startSession(state, Date.now()))}>
                Start session ({Math.min(stats.due, 10)})
              </button>
            </>
          ) : (
            <p className="small" style={{ margin: 0 }}>
              Nothing due right now — the schedule will bring exercises back as their intervals expire. That is the
              point: re-meeting a mistake just before you would forget it.
            </p>
          )}
        </div>
      )}

      {state.exercises.length > 0 && (
        <div className="panel panel-pad mt-3">
          <div className="section-label">All exercises</div>
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Decision</th>
                <th>Played</th>
                <th>Engine</th>
                <th>Class</th>
                <th>Attempts</th>
                <th>Schedule</th>
              </tr>
            </thead>
            <tbody>
              {[...state.exercises]
                .sort((a, b) => Number(dueNowIds.has(b.id)) - Number(dueNowIds.has(a.id)) || b.cpl - a.cpl)
                .map((x) => {
                  const meta = CLASSIFICATION_META[x.classification];
                  return (
                    <tr key={x.id}>
                      <td className="small">vs {x.opponent || '?'} · move {Math.floor(x.ply / 2) + 1}{x.side === 'w' ? '.' : '…'}</td>
                      <td className="mono small" style={{ color: 'var(--clay-ink)' }}>{x.playedSan}</td>
                      <td className="mono small">{x.bestSan}</td>
                      <td className="small">{meta.label}</td>
                      <td className="small">{x.attempts}</td>
                      <td className="small muted">{x.sr.interval >= 1 ? `in ${Math.max(0, Math.ceil((x.sr.due - Date.now()) / 86_400_000))}d` : 'due now'}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p className="small muted" style={{ margin: '0.5rem 0 0' }}>
            Mastered = the review interval reached {MASTERED_INTERVAL_DAYS}+ days of clean recalls. Wrong answers and
            hints are recorded as attempts, never as clean solves.
          </p>
        </div>
      )}

      <p className="small muted mt-2">
        Looking for something broader? <Link to="/insights">Insights</Link> tracks where your mistakes come from.
      </p>
    </div>
  );
}
