import { useCallback, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ENDGAME_LESSONS } from '../data/endgames';
import { buildAdaptiveSession, type AdaptiveItem } from '../lib/adaptiveEngine';
import { enumerateRepertoirePositions, trainingStatsFor } from '../lib/repertoireTrain2';
import { loadRepertoires } from '../lib/repertoireStore';
import { reviewMistakesFromReports } from '../lib/reviewSummary';
import type { GameReport } from '../lib/review';
import { loadJSON } from '../lib/storage';
import { loadTraining } from '../lib/trainingStore';
import { assessPracticeMove, loadPractice, recordPracticeAttempt, savePractice, solveOutcome, type PracticeItem } from '../lib/practiceQueue';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import GameBoard from '../components/GameBoard';
import { useClickToMove } from '../hooks/useClickToMove';
import { playSound } from '../lib/sound';
import { useProfile } from '../state/ProfileContext';
import TrainTabs from '../components/TrainTabs';

const KIND_LABEL: Record<AdaptiveItem['kind'], string> = {
  puzzle: 'Puzzle',
  mistake: 'Review',
  repertoire: 'Repertoire',
  endgame: 'Endgame',
  motif: 'Tactics',
  visualization: 'Visualization',
};

/** Route an adaptive item to its destination. */
function itemLink(item: AdaptiveItem): { to: string; cta: string } {
  switch (item.kind) {
    default:
    case 'puzzle':
      return { to: item.ref.theme ? `/puzzles?theme=${item.ref.theme}` : '/puzzles', cta: 'Solve' };
    case 'mistake':
      return { to: `/review/${item.ref.gameId}`, cta: 'Review' };
    case 'repertoire':
      return { to: `/repertoire/${item.ref.repertoireId}`, cta: 'Drill' };
    case 'endgame':
      return { to: `/endgames/${item.ref.lessonId}`, cta: 'Play out' };
    case 'motif':
      return { to: '/puzzles', cta: 'Practice' };
    case 'visualization':
      return { to: '/coordinates', cta: 'Warm up' };
  }
}

export default function Training() {
  const { profile } = useProfile();
  const training = useMemo(() => loadTraining(), []);
  const repertoires = useMemo(() => loadRepertoires(), []);
  const [practiceNonce, setPracticeNonce] = useState(0);
  const practice = useMemo(() => loadPractice(), [practiceNonce]); // refresh after attempts
  const [activePractice, setActivePractice] = useState<PracticeItem | null>(null);

  const session = useMemo(() => {
    const now = Date.now();
    // REAL classifications only: read the per-game Review cache. Games
    // without a reviewed report contribute nothing — never synthesize
    // mistakes from results.
    const reviewMistakes = reviewMistakesFromReports(profile.games, (id) =>
      loadJSON<GameReport | null>(`review.${id}`, null),
    );
    return buildAdaptiveSession({
      now,
      puzzleThemes: profile.puzzle.byTheme,
      motifStats: training.motifs,
      endgame: training.endgame,
      repScheduling: training.repScheduling,
      repertoirePositions: enumerateRepertoirePositions(repertoires),
      reviewMistakes,
    });
  }, [profile, training, repertoires]);

  const positions = useMemo(() => enumerateRepertoirePositions(repertoires), [repertoires]);
  const repStats = useMemo(() => trainingStatsFor(training, positions, Date.now()), [training, positions]);
  const repDue = repStats.due;

  const endgameRec = useMemo(() => {
    const entries = Object.entries(training.endgame);
    if (entries.length === 0) return null;
    const [id, p] = entries.sort((a, b) => a[1].mastery - b[1].mastery)[0];
    return { id, mastery: p.mastery };
  }, [training]);

  const trainDays = useMemo(() => {
    const days = new Set<string>();
    for (const g of profile.games) if (g.date) days.add(new Date(g.date).toDateString());
    for (const l of Object.values(training.endgame)) if (l.lastPracticed) days.add(new Date(l.lastPracticed).toDateString());
    return days.size;
  }, [profile.games, training]);

  return (
    <div className="page container">
      <div className="page-head">
        <h1>Train</h1>
        <p className="sub">Today’s session, built from your own misses, due reviews and weakest endings.</p>
        <TrainTabs current="/training" />
      </div>

      <p className="small muted mb-1" style={{ margin: 0 }}>
        Deep-dive into your record on the{' '}
        <Link to="/insights" style={{ color: 'var(--ice)' }}>
          Insights
        </Link>{' '}
        page.
      </p>
      <div className="rep-stats mb-2" style={{ maxWidth: 640 }}>
        <div>
          <div className="v">{repDue}</div>
          <div className="k">repertoire due</div>
        </div>
        <div>
          <div className="v">{repStats.mastered}</div>
          <div className="k">mastered</div>
        </div>
        <div>
          <div className="v">{session.length}</div>
          <div className="k">session items</div>
        </div>
        <div>
          <div className="v">{trainDays}</div>
          <div className="k">training days</div>
        </div>
      </div>

      <div className="section-label">Today’s training</div>
      <div className="study-list mb-2">
        {session.map((item) => {
          const link = itemLink(item);
          return (
            <div key={item.id} className="study-card">
              <Link to={link.to} className="study-main">
                <span className="study-title">{KIND_LABEL[item.kind]}</span>
                <span className="adaptive-reason">{item.reason}</span>
              </Link>
              <Link to={link.to} className="btn btn-ghost btn-sm">
                {link.cta}
              </Link>
            </div>
          );
        })}
      </div>

      {practice.length > 0 && (
        <div className="mb-2">
          <div className="section-label">Saved practice</div>
          <div className="study-list">
            {practice.slice(0, 6).map((item) => (
              <div key={item.id} className="study-card">
                <button type="button" className="study-main" style={{ background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer' }} onClick={() => setActivePractice(item)}>
                  <span className="study-title">{item.objective}</span>
                  <span className="study-meta">
                    {item.kind} · attempts {item.attempts} · solved {item.solved}
                  </span>
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setActivePractice(item)}>
                  Practice
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activePractice && (
        <PracticeRunner
          item={activePractice}
          onResolved={() => setPracticeNonce((n) => n + 1)}
          onExit={() => {
            setActivePractice(null);
            setPracticeNonce((n) => n + 1);
          }}
        />
      )}

      <div className="row wrap" style={{ gap: '0.9rem' }}>
        <div className="panel panel-pad" style={{ minWidth: 260 }}>
          <div className="section-label">Endgame recommendation</div>
          {endgameRec ? (
            <>
              <p className="small" style={{ margin: 0 }}>
                {ENDGAME_LESSONS.find((l) => l.id === endgameRec.id)?.title} — mastery{' '}
                {Math.round(endgameRec.mastery * 100)}%.
              </p>
              <Link className="btn btn-ghost btn-sm mt-1" to={`/endgames/${endgameRec.id}`}>
                Practice it
              </Link>
            </>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              Finish one Endgame Academy drill and recommendations will use your record.
            </p>
          )}
        </div>
        <div className="panel panel-pad" style={{ minWidth: 260 }}>
          <div className="section-label">Review failed puzzles</div>
          <p className="small muted" style={{ margin: 0 }}>
            Missed {profile.puzzle.failed} puzzles so far. The Puzzles page keeps every miss in its record.
          </p>
          <Link className="btn btn-ghost btn-sm mt-1" to="/puzzles">
            Open puzzles
          </Link>
        </div>
      </div>
    </div>
  );
}


/** Exact-position practice: find the verified best move; retry, hint, reveal.
 * Grading v1: exact SAN vs the engine best. No verified best -> ungraded
 * (playable, never counted as solved). Hint/Reveal before finding the move
 * marks the attempt assisted: recorded, but not as a clean solve.
 * Promotions auto-queen (documented v1 — no underpromotion dialog here). */
function PracticeRunner({ item, onResolved, onExit }: { item: PracticeItem; onResolved: () => void; onExit: () => void }) {
  const game = useMemo(() => new Chess(item.fen), [item.fen]);
  const fen = game.fen();
  const [hint, setHint] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const assistedRef = useRef(false); // hint or reveal used this session
  const firstTryRef = useRef(true); // no wrong guess yet this session
  const resolvedRef = useRef(false);

  const resolveAttempt = useCallback(
    (solvedCleanly: boolean) => {
      if (resolvedRef.current) return; // one recorded attempt per runner session
      resolvedRef.current = true;
      const list = loadPractice();
      recordPracticeAttempt(list, item.id, solvedCleanly);
      savePractice(list);
      onResolved();
    },
    [item.id, onResolved],
  );

  const onMove = useCallback(
    (from: Square, to: Square): 'ok' | 'illegal' => {
      const probe = new Chess(fen);
      let move;
      try {
        move = probe.move({ from, to, promotion: 'q' }); // v1: auto-queen
      } catch {
        return 'illegal';
      }
      if (!move) return 'illegal';
      const assessment = assessPracticeMove(item, move.san);
      if (assessment === 'wrong') {
        firstTryRef.current = false; // a wrong guess ends first-try candidacy
        // click path already plays 'illegal' via useClickToMove
        setFeedback(`${move.san} is not it — the target move is different. Try again.`);
        return 'illegal'; // position stays until the target move is found
      }
      if (assessment === 'ungraded') {
        // no verified best move: playable, but never a solve
        resolveAttempt(false);
        setFeedback(`${move.san} played — this position has no verified best move, so it stays ungraded.`);
        return 'ok';
      }
      // clean = first try AND no hint/reveal; anything else is an attempt,
      // never silently counted as perfect
      const outcome = solveOutcome({
        firstTry: firstTryRef.current,
        assisted: assistedRef.current,
        expectedMove: true,
      });
      resolveAttempt(outcome === 'clean');
      playSound(outcome === 'clean' ? 'win' : 'click');
      if (outcome === 'clean') {
        setFeedback(`Found it — ${move.san}. Clean first-try solve.`);
      } else if (outcome === 'after-wrong') {
        setFeedback(`Found it — ${move.san}, after wrong tries. Recorded as an attempt, not a clean solve.`);
      } else {
        setFeedback(`Found it — ${move.san} (with help). Recorded as an assisted attempt, not a clean solve.`);
      }
      return 'ok';
    },
    [fen, item, resolveAttempt],
  );

  const click = useClickToMove({ fen, movableColor: item.side, tryMove: onMove });

  const showHint = () => {
    assistedRef.current = true;
    setHint((h) => !h);
  };
  const toggleReveal = () => {
    if (!revealed) assistedRef.current = true;
    setRevealed((r) => !r);
  };

  return (
    <div className="analysis-layout">
      <div>
        <GameBoard
          boardId="practice-runner"
          fen={fen}
          orientation={item.side === 'w' ? 'white' : 'black'}
          movableColor={item.side}
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
          <button className="btn btn-ghost btn-sm" onClick={showHint}>
            {hint ? 'Hide hint' : 'Hint'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={toggleReveal}>
            {revealed ? 'Hide answer' : 'Reveal'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onExit}>
            Exit
          </button>
        </div>
        {hint && <p className="small muted mt-1">Look for the move that changes the evaluation most.</p>}
        {revealed && (
          <p className="small mt-1" style={{ color: 'var(--sea)' }}>
            Answer: {item.expectedSan ?? 'no verified best move (ungraded position)'}
          </p>
        )}
        {feedback && <div className="status-banner mt-2" role="status">{feedback}</div>}
      </div>
      <aside className="panel panel-pad">
        <div className="section-label">Practice</div>
        <p className="small" style={{ margin: 0 }}>
          {item.objective}
        </p>
        <p className="small muted mt-1" style={{ marginBottom: 0 }}>
          {item.expectedSan
            ? 'The board holds until you find the target move — wrong tries do not advance the position.'
            : 'Ungraded position: play any reasonable move; nothing is counted as solved.'}
        </p>
      </aside>
    </div>
  );
}
