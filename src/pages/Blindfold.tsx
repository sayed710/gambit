import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import { loadRepertoires } from '../lib/repertoireStore';
import { expectedChildAt } from '../lib/repertoireTrain';
import { loadTraining, saveTraining, scheduleSr, type SrGrade } from '../lib/trainingStore';
import {
  blindfoldLevelKey,
  blindfoldSrKey,
  generateExerciseAny,
  gradeBlindMate,
  gradeSanOrigin,
  gradeSanToSquare,
  gradeTrackPieces,
  squaresOfPieces,
  type BlindfoldExercise,
  type BlindfoldLevel,
} from '../lib/blindfold';
import GameBoard from '../components/GameBoard';
import TrainTabs from '../components/TrainTabs';
import { playSound } from '../lib/sound';

/* ============================================================
   Blindfold — visualization training, 4 levels.

   The board is a REVEAL surface, not an input cheat: pieces are
   hidden (level 1–3) or shown only after grading. Answers come from
   square clicks or type-in (L3), graded by pure functions, recorded
   per exercise into spaced repetition.
   ============================================================ */

const LEVEL_INFO: Record<BlindfoldLevel, { title: string; how: string; visibility: 'none' | 'ghost' }> = {
  1: { title: 'Level 1 — Where does it land?', how: 'A move is announced (e.g. Nf3). Click the square the piece lands on.', visibility: 'none' },
  2: { title: 'Level 2 — Where did it start?', how: 'A move is announced. Click the square the piece came FROM.', visibility: 'none' },
  3: { title: 'Level 3 — Track the position', how: 'A short line is played move by move. Then type every square holding the asked piece, comma-separated.', visibility: 'none' },
  4: { title: 'Level 4 — Blind mate', how: 'A position is described on the board list (invisible). Find ANY move that delivers checkmate.', visibility: 'none' },
};

const LEVELS: BlindfoldLevel[] = [1, 2, 3, 4];

/** today's deterministic seed: same exercises all day, fresh tomorrow */
function todaySeed(): number {
  const d = new Date();
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** the user's repertoire mainline (SAN list) for level 3, when one exists.
 *  Walked through the REAL preferred maps via expectedChildAt. */
function repertoireMainline(): string[] | null {
  const reps = loadRepertoires();
  for (const rep of reps) {
    for (const line of rep.lines) {
      const sans: string[] = [];
      let id: string | null = null;
      for (;;) {
        const next = expectedChildAt(line, id);
        if (!next) break;
        sans.push(next.san);
        id = next.id;
        if (sans.length >= 12) break;
      }
      if (sans.length >= 6) return sans;
    }
  }
  return null;
}

interface SessionState {
  level: BlindfoldLevel;
  ex: BlindfoldExercise;
  /** L3: sans revealed so far (announced one by one) */
  announced: number;
}

export default function Blindfold() {
  const [searchParams] = useSearchParams();
  const deepLevel = Number(searchParams.get('level'));
  const [level, setLevel] = useState<BlindfoldLevel>(() => ([1, 2, 3, 4].includes(deepLevel) ? (deepLevel as BlindfoldLevel) : 1));
  const [session, setSession] = useState<SessionState | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [selection, setSelection] = useState<Square | null>(null);
  const [typedAnswer, setTypedAnswer] = useState('');
  const [stats, setStats] = useState(() => loadTraining().blindfold);
  /** L4 fair-study: the position is SHOWN for inspection first; grading
   *  begins only after the user hides it. Studying is never a hint. */
  const [studyOpen, setStudyOpen] = useState(false);

  const repertoireLine = useMemo(() => repertoireMainline(), [session?.ex.id]);

  const nextExercise = useCallback(
    (lvl: BlindfoldLevel) => {
      // per-exercise spaced repetition: due exercises first, else a fresh seed
      const training = loadTraining();
      const day = todaySeed();
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const ex = generateExerciseAny(lvl, day * 97 + attempt * 13 + 1, { repertoireLine: repertoireLine ?? undefined });
        const key = blindfoldSrKey(ex);
        const rec = training.blindfold.scheduling[key];
        if (!rec || rec.due <= Date.now()) {
          setSession({ level: lvl, ex, announced: ex.kind === 'track-pieces' ? 1 : 0 });
          setFeedback(null);
          setRevealed(false);
          setSelection(null);
          setTypedAnswer('');
          setStudyOpen(ex.kind === 'blind-mate');
          return;
        }
      }
      // everything due later: still serve the first (honest about it)
      const ex = generateExerciseAny(lvl, day * 97 + 1, { repertoireLine: repertoireLine ?? undefined });
      setSession({ level: lvl, ex, announced: ex.kind === 'track-pieces' ? 1 : 0 });
      setFeedback(null);
      setRevealed(false);
      setSelection(null);
      setTypedAnswer('');
      setStudyOpen(ex.kind === 'blind-mate');
    },
    [repertoireLine],
  );

  // start/switch on level change
  useEffect(() => {
    nextExercise(level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level]);

  const announce = (text: string) => {
    setFeedback({ ok: true, text }); // aria-live handles it; visual feedback separate below
  };

  const record = useCallback(
    (ok: boolean) => {
      if (!session) return;
      const grade: SrGrade = ok ? 'good' : 'again';
      const training = loadTraining();
      const key = blindfoldSrKey(session.ex);
      const prev = training.blindfold.scheduling[key] ?? { due: 0, interval: 0, reps: 0, ease: 2.5, lapses: 0, lastResult: null };
      training.blindfold.scheduling[key] = scheduleSr(prev, grade, Date.now());
      const lk = blindfoldLevelKey(session.level);
      const st = training.blindfold.levels[lk] ?? { attempted: 0, solved: 0, lastPracticed: null };
      training.blindfold.levels[lk] = { attempted: st.attempted + 1, solved: st.solved + (ok ? 1 : 0), lastPracticed: Date.now() };
      saveTraining(training);
      setStats(loadTraining().blindfold);
    },
    [session],
  );

  /** click-based answering (L1, L2, L4) */
  const onSquareClick = useCallback(
    (square: Square) => {
      if (!session || revealed) return;
      if (session.ex.kind === 'blind-mate' && studyOpen) return; // study phase: no grading yet
      const ex = session.ex;
      if (ex.kind === 'san-to-square') {
        const res = gradeSanToSquare(ex, square);
        setRevealed(true);
        setFeedback({ ok: res.correct, text: res.correct ? `Correct — ${ex.san} lands on ${res.expected}.` : `That's ${square}. ${ex.san} lands on ${res.expected}.` });
        playSound(res.correct ? 'win' : 'illegal');
        record(res.correct);
      } else if (ex.kind === 'san-origin') {
        const res = gradeSanOrigin(ex, square);
        setRevealed(true);
        setFeedback({ ok: res.correct, text: res.correct ? `Correct — the ${ex.san.startsWith('O') ? 'king/rook' : 'piece'} started on ${res.expected}.` : `That's ${square}. The move came from ${res.expected}.` });
        playSound(res.correct ? 'win' : 'illegal');
        record(res.correct);
      } else if (ex.kind === 'blind-mate') {
        if (selection === null) {
          setSelection(square);
          return;
        }
        const res = gradeBlindMate(ex, selection, square);
        setRevealed(true);
        setFeedback({ ok: res.correct, text: res.correct ? `Mate — ${res.expected}.` : `${selection}-${square} is not mate. The answer: ${res.expected}.` });
        playSound(res.correct ? 'win' : 'illegal');
        record(res.correct);
        setSelection(null);
      }
    },
    [session, revealed, studyOpen, selection, record],
  );

  /** type-in answering (L3) */
  const submitTyped = useCallback(() => {
    if (!session || session.ex.kind !== 'track-pieces' || revealed) return;
    if (session.announced < session.ex.sans.length) return; // premature submission refused
    const ex = session.ex;
    const given = typedAnswer
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .map((s) => (s[0] >= '1' && s[0] <= '8' ? `${s[1]}${s[0]}` : s)); // tolerate rank-first entry
    const res = gradeTrackPieces(ex, given as Square[]);
    setRevealed(true);
    setFeedback({ ok: res.correct, text: res.correct ? `Correct — every ${ex.askColor === 'w' ? 'white' : 'black'} ${ex.askPiece}: ${res.expected}.` : `Not exact. The squares: ${res.expected}.` });
    playSound(res.correct ? 'win' : 'illegal');
    record(res.correct);
  }, [session, revealed, typedAnswer, record]);

  const revealNow = useCallback(() => {
    if (!session) return;
    const ex = session.ex;
    let expected = '';
    if (ex.kind === 'san-to-square') {
      const g = new Chess(ex.fen);
      expected = g.move(ex.san).to;
    } else if (ex.kind === 'san-origin') {
      const g = new Chess(ex.fen);
      expected = g.move(ex.san).from;
    } else if (ex.kind === 'track-pieces') {
      expected = squaresOfPieces(ex.sans, ex.askColor, ex.askPiece).join(', ');
    } else {
      const probe = new Chess(ex.fen);
      const mate = probe.moves({ verbose: true }).find((mv) => {
        probe.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? 'q' });
        const m = probe.isCheckmate();
        probe.undo();
        return m;
      });
      expected = mate?.san ?? 'a mating move';
    }
    setRevealed(true);
    setFeedback({ ok: false, text: `Answer: ${expected}. This attempt is recorded as a miss — the exercise returns sooner.` });
    record(false);
  }, [session, record]);

  const info = LEVEL_INFO[level];
  const ex = session?.ex;
  const isInputClick = ex?.kind === 'san-to-square' || ex?.kind === 'san-origin' || ex?.kind === 'blind-mate';
  /** L3 gate: grading only ever sees the COMPLETE announced sequence. */
  const allAnnounced = ex?.kind === 'track-pieces' ? (session?.announced ?? 0) >= ex.sans.length : true;

  /** the board position to render: hidden for click levels; for L3 the FINAL
   *  position only after grading (a reveal surface, never an input cheat) */
  const boardFen = useMemo(() => {
    if (!ex) return new Chess().fen();
    if (ex.kind === 'san-to-square' || ex.kind === 'san-origin' || ex.kind === 'blind-mate') return ex.fen;
    if (ex.kind === 'track-pieces') {
      const g = new Chess();
      for (const san of ex.sans) g.move(san);
      return revealed ? g.fen() : new Chess().fen();
    }
    return new Chess().fen();
  }, [ex, revealed]);

  /** L4: pieces visible during the study phase, hidden once grading starts. */
  const l4Visibility: 'full' | 'none' = studyOpen ? 'full' : 'none';

  const lastMoveForBoard = useMemo(() => {
    if (!ex || !revealed) return null;
    if (ex.kind === 'san-to-square' || ex.kind === 'san-origin') {
      const g = new Chess(ex.fen);
      const m = g.move(ex.san);
      return { from: m.from, to: m.to };
    }
    return null;
  }, [ex, revealed]);

  const levelStat = (lvl: BlindfoldLevel) => stats.levels[blindfoldLevelKey(lvl)] ?? { attempted: 0, solved: 0, lastPracticed: null };
  const dueCount = (lvl: BlindfoldLevel) => {
    const training = loadTraining();
    let n = 0;
    for (const [key, rec] of Object.entries(training.blindfold.scheduling)) {
      if (key.startsWith(`bf:l${lvl}:`) && rec.due <= Date.now()) n += 1;
    }
    return n;
  };

  return (
    <div className="page container">
      <TrainTabs current="/blindfold" />
      <div className="page-head row between wrap" style={{ gap: '1rem' }}>
        <div>
          <h1>Blindfold training</h1>
          <p className="sub">See nothing, calculate everything. Exercises are graded exactly and return on a spaced schedule.</p>
        </div>
      </div>

      <div className="seg mb-2" role="radiogroup" aria-label="Blindfold level">
        {LEVELS.map((lvl) => {
          const st = levelStat(lvl);
          const due = dueCount(lvl);
          return (
            <button key={lvl} role="radio" aria-checked={level === lvl} className={level === lvl ? 'on' : ''} onClick={() => setLevel(lvl)}>
              {LEVEL_INFO[lvl].title.split('—')[0].trim()}
              {st.attempted > 0 && <span className="small muted"> · {Math.round((st.solved / st.attempted) * 100)}%</span>}
              {due > 0 && <span className="small" style={{ color: 'var(--sea)' }}> · {due} due</span>}
            </button>
          );
        })}
      </div>

      <div className="trainer-layout">
        <div>
          <div className="board-frame">
            <GameBoard
              boardId={`blindfold-${level}`}
              fen={boardFen}
              orientation="white"
              pieceVisibility={ex?.kind === 'blind-mate' && !revealed ? l4Visibility : revealed ? 'full' : info.visibility}
              selectable={isInputClick && !(ex?.kind === 'blind-mate' && studyOpen)}
              lastMove={lastMoveForBoard}
              movableColor={null}
              onSquareClick={isInputClick ? (sq) => onSquareClick(sq) : undefined}
              selected={selection}
              legalTargets={[]}
              turnAnnouncement={undefined}
            />
          </div>
          <div className="board-under">
            <button className="btn btn-ghost btn-sm" onClick={revealNow} disabled={revealed}>
              Reveal answer
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => nextExercise(level)}>
              Next exercise
            </button>
          </div>
          {feedback && (
            <div className={`status-banner mt-2`} role="status" aria-live="assertive" style={{ borderColor: feedback.ok ? 'var(--sea)' : 'var(--bad)' }}>
              {feedback.text}
            </div>
          )}
        </div>

        <aside className="panel panel-pad">
          <div className="section-label">{info.title}</div>
          <p className="small" style={{ margin: 0 }}>{info.how}</p>

          {ex?.kind === 'san-to-square' && (
            <div className="mt-2">
              <div className="section-label">Move</div>
              <div style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 700 }}>{ex.san}</div>
            </div>
          )}
          {ex?.kind === 'san-origin' && <OriginContext fen={ex.fen} san={ex.san} />}
          {ex?.kind === 'track-pieces' && (
            <div className="mt-2">
              <div className="section-label">
                Line played — move {session?.announced ?? 0} of {ex.sans.length}
              </div>
              <progress
                value={session?.announced ?? 0}
                max={ex.sans.length}
                aria-label={`Sequence progress: move ${session?.announced ?? 0} of ${ex.sans.length}`}
                style={{ width: '100%', accentColor: 'var(--sea)' }}
              />
              <ol className="small" style={{ margin: '0.2rem 0 0.6rem', paddingLeft: '1.2rem' }}>
                {ex.sans.slice(0, session?.announced ?? 0).map((san, i) => (
                  <li key={i}>{i % 2 === 0 ? `${i / 2 + 1}.` : ''} {san}</li>
                ))}
              </ol>
              <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                {session && session.announced < ex.sans.length && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setSession({ ...session, announced: session.announced + 1 });
                      announce(`Move ${session.announced + 1}: ${ex.sans[session.announced]}`);
                    }}
                  >
                    Play next move
                  </button>
                )}
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (!session) return;
                    setSession({ ...session, announced: 1 }); // restart the announcement from move 1
                    announce(`Restarting — move 1: ${ex.sans[0]}`);
                  }}
                >
                  Restart line
                </button>
              </div>
              <label className="small mt-2 row" style={{ gap: '0.4rem' }}>
                Every square with a white {ex.askPiece}:
                <input
                  className="input"
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && allAnnounced && submitTyped()}
                  placeholder="e2, d2, a2 …"
                  aria-label="Type the squares, comma separated"
                  disabled={!allAnnounced}
                />
              </label>
              <button
                className="btn btn-primary btn-sm mt-1"
                onClick={submitTyped}
                disabled={revealed || !allAnnounced}
                title={!allAnnounced ? 'Announce every move of the line first — grading grades the FULL announced position.' : undefined}
              >
                Check answer
              </button>
              {!allAnnounced && (
                <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
                  The answer input opens only after the whole line is announced — grading always grades the complete position.
                </p>
              )}
            </div>
          )}
          {ex?.kind === 'blind-mate' && (
            <div className="mt-2">
              <div className="section-label">Find mate</div>
              {studyOpen ? (
                <>
                  <p className="small" style={{ margin: 0 }}>
                    Study phase: the position is on the board. Memorize it — when you hide it, the pieces disappear and you must find mate from memory. Studying is not a hint.
                  </p>
                  <button
                    className="btn btn-primary btn-sm mt-1"
                    onClick={() => {
                      setStudyOpen(false);
                      setSelection(null);
                    }}
                  >
                    Hide the board and start
                  </button>
                </>
              ) : (
                <p className="small" style={{ margin: 0 }}>
                  {selection ? `From ${selection} — now click the destination.` : 'Board hidden. Click the FROM square, then the destination. Any true mate counts.'}
                </p>
              )}
            </div>
          )}

          <div className="rep-stats mt-2" style={{ maxWidth: 'none' }}>
            <div>
              <div className="v">{levelStat(level).attempted}</div>
              <div className="k">attempts</div>
            </div>
            <div>
              <div className="v">{levelStat(level).attempted ? `${Math.round((levelStat(level).solved / levelStat(level).attempted) * 100)}%` : '—'}</div>
              <div className="k">success</div>
            </div>
          </div>
          <p className="small muted mt-1" style={{ marginBottom: 0 }}>
            Missed exercises return sooner (spaced repetition). Answers are graded against the actual position, never the clock.
          </p>
        </aside>
      </div>
    </div>
  );
}

/** L2 fair context: the position's last move (and side to move) so an
 *  ambiguous SAN can be resolved mentally without seeing the board. */
function OriginContext({ fen, san }: { fen: string; san: string }) {
  const context = useMemo(() => {
    try {
      const g = new Chess(fen);
      const hist = g.history({ verbose: true });
      const last = hist[hist.length - 1];
      const side = g.turn() === 'w' ? 'White' : 'Black';
      return {
        lastText: last ? `Previous move: ${Math.ceil(hist.length / 2)}${hist.length % 2 === 1 ? '.' : '...'} ${last.san}` : 'Starting position — no moves played yet.',
        askText: `${side} to play move ${Math.ceil(hist.length / 2) + 1}:`,
      };
    } catch {
      return { lastText: '', askText: '' };
    }
  }, [fen]);
  return (
    <div className="mt-2">
      <div className="section-label">Move</div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', fontWeight: 700 }}>{san}</div>
      <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
        {context.lastText} · {context.askText}
      </p>
    </div>
  );
}
