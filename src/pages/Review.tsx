import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import GameBoard from '../components/GameBoard';
import MoveList from '../components/MoveList';
import EvalBar from '../components/EvalBar';
import { useEngine } from '../lib/engine/useEngine';
import { START_FEN, FULL_DATE } from '../lib/chessUtils';
import { useProfile } from '../state/ProfileContext';
import { loadJSON, saveJSON } from '../lib/storage';
import { ChevronLeft, ChevronRight, XIcon } from '../components/Icons';
import type { GameReport, MoveClass, PlyEval } from '../lib/review';
import { CLASSIFICATION_META, evalToUnit } from '../lib/review';
import { runGameAnalysis, plyEvalFromEngineResult } from '../lib/reviewRunner';
import { criticalMoments } from '../lib/review';
import { identifyOpening } from '../lib/openings';
import type { EvalResult } from '../lib/engine/engine';

const ANALYSIS_DEPTH = 12;

export default function Review() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useProfile();
  const engine = useEngine();

  const record = useMemo(() => profile.games.find((g) => g.id === id) ?? null, [profile.games, id]);

  const plies = useMemo(() => {
    if (!record) return [];
    const game = new Chess();
    const out: { san: string; from: Square; to: Square; color: 'w' | 'b'; fenAfter: string; isCapture: boolean; isCheck: boolean }[] = [];
    for (const san of record.moves) {
      try {
        const m = game.move(san);
        out.push({
          san: m.san,
          from: m.from,
          to: m.to,
          color: m.color,
          fenAfter: m.after,
          isCapture: m.isCapture(),
          isCheck: m.san.includes('+') || m.san.includes('#'),
        });
      } catch {
        break;
      }
    }
    return out;
  }, [record]);

  const [plyIndex, setPlyIndex] = useState(plies.length); // 0 = start
  const [report, setReport] = useState<GameReport | null>(null);
  const [analysis, setAnalysis] = useState<{ done: number; total: number } | null>(null);
  const opening = useMemo(() => (record ? identifyOpening(record.moves) : null), [record]);
  const criticalPlys = useMemo(() => (report ? criticalMoments(report, 99).sort((a, b) => a - b) : []), [report]);
  const [analyzing, setAnalyzing] = useState(false);
  const runTokenRef = useRef(0); // increments per run; stale runs self-abort

  // fens before each ply (index 0 = start position)
  const fens = useMemo(() => [START_FEN, ...plies.map((p) => p.fenAfter)], [plies]);

  const runAnalysis = useCallback(async () => {
    if (plies.length === 0 || analyzing) return;
    // finished games are immutable — cache the report so revisits are instant
    const cached = loadJSON<GameReport | null>(`review.${record?.id}`, null);
    if (cached && cached.reviews.length === plies.length) {
      setReport(cached);
      return;
    }
    const token = ++runTokenRef.current; // stale runs (StrictMode remount, redo) self-abort
    const isStale = () => runTokenRef.current !== token;
    setAnalyzing(true);
    setReport(null);
    await runGameAnalysis(
      plies,
      fens,
      (fen, depth) => engine.evaluate(fen, depth),
      (res) =>
        plyEvalFromEngineResult({
          cp: res.cp >= 9000 ? 10_000 : res.cp <= -9000 ? -10_000 : res.cp,
          mateIn: res.mateIn,
          bestSan: res.bestSan,
        }),
      {
        isStale,
        onProgress: (done, total) => {
          if (isStale()) return;
          setAnalysis({ done, total });
        },
        onComplete: (rep) => {
          if (isStale()) return;
          setReport(rep);
          setAnalyzing(false);
          if (record?.id) saveJSON(`review.${record.id}`, rep);
        },
        // a stale run owns no UI state: the newest run (or unmount) does
        onAbort: () => {},
      },
    );
  }, [plies, fens, engine, analyzing, record?.id]);

  // run the game report automatically, like chess.com
  useEffect(() => {
    runAnalysis();
    return () => {
      runTokenRef.current++; // unmount cancels the in-flight run
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record?.id]);

  const current = plyIndex > 0 ? plies[plyIndex - 1] : null;
  const fen = current?.fenAfter ?? START_FEN;
  const shownGame = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return null;
    }
  }, [fen]);

  const lastMove = current ? { from: current.from, to: current.to } : null;
  const checkSquare = useMemo<Square | null>(() => {
    if (!shownGame?.isCheck()) return null;
    for (const row of shownGame.board())
      for (const sq of row) if (sq && sq.type === 'k' && sq.color === shownGame.turn()) return sq.square;
    return null;
  }, [shownGame]);

  // evaluation for the bar/panel: prefer the analysis, fall back to live evaluation
  const analysisEval = report?.evals[plyIndex] ?? null;
  const [liveEval, setLiveEval] = useState<EvalResult | null>(null);
  useEffect(() => {
    if (analysisEval) return; // the report covers this position
    let cancelled = false;
    engine
      .evaluate(fen, ANALYSIS_DEPTH)
      .then((res) => {
        if (!cancelled) setLiveEval(res);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fen, analysisEval, engine]);

  const evaluation: EvalResult | null = analysisEval
    ? {
        cp: analysisEval.cp,
        mateIn: analysisEval.mateIn !== null ? Math.ceil(Math.abs(analysisEval.mateIn) / 2) * (analysisEval.mateIn > 0 ? 1 : -1) : null,
        bestSan: analysisEval.bestSan,
        depth: ANALYSIS_DEPTH,
      }
    : liveEval;

  const step = useCallback(
    (delta: number) => {
      setPlyIndex((i) => Math.max(0, Math.min(plies.length, i + delta)));
    },
    [plies.length],
  );

  const jumpToCritical = useCallback(
    (dir: 1 | -1) => {
      if (criticalPlys.length === 0) return;
      const next = dir === 1 ? criticalPlys.find((p) => p >= plyIndex) : [...criticalPlys].reverse().find((p) => p < plyIndex - 1);
      setPlyIndex(dir === 1 ? (next ?? plies.length) : (next ?? 0) + 1);
    },
    [criticalPlys, plyIndex, plies.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
      if (e.key === 'Home') setPlyIndex(0);
      if (e.key === 'End') setPlyIndex(plies.length);
      if (e.key === '[') jumpToCritical(-1);
      if (e.key === ']') jumpToCritical(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, plies.length, jumpToCritical]);

  if (!record) {
    return (
      <div className="page container">
        <div className="empty-state">
          <div className="glyph">♟</div>
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: '2rem' }}>Game not found</h1>
          <p>This game is no longer in your local history — it may have been reset or played in another browser.</p>
          <Link className="btn btn-primary" to="/profile">
            Back to profile
          </Link>
        </div>
      </div>
    );
  }

  const resultBadge = record.result === 'win' ? 'Win' : record.result === 'loss' ? 'Loss' : 'Draw';
  const classificationIconHint = (ply: number) => {
    const r = report?.reviews[ply];
    if (!r) return '';
    return ` (${CLASSIFICATION_META[r.classification].label.toLowerCase()} now: ${r.san})`;
  };
  const orientation = record.playerColor === 'b' ? 'black' : 'white';
  const youAreWhite = record.playerColor === 'w';
  const acc = report?.accuracy;
  const youAcc = acc ? (youAreWhite ? acc.w : acc.b) : null;
  const oppAcc = acc ? (youAreWhite ? acc.b : acc.w) : null;
  const youLabel = youAreWhite ? 'White (you)' : 'Black (you)';
  const oppLabel = youAreWhite ? 'Black (engine)' : 'White (engine)';

  const currentReview = plyIndex > 0 ? report?.reviews[plyIndex - 1] ?? null : null;
  const progressPct = analysis ? Math.round((analysis.done / analysis.total) * 100) : 0;

  return (
    <div className="page container">
      <div className="page-head row between wrap" style={{ gap: '1rem' }}>
        <div>
          <h1>
            vs {record.opponentName}{' '}
            <span className={`badge ${record.result}`} style={{ verticalAlign: 'super', fontSize: '0.7rem' }}>
              {resultBadge}
            </span>
          </h1>
          <p className="sub">
            {FULL_DATE.format(record.date)} · {record.reason} · as {record.playerColor === 'w' ? 'White' : 'Black'} ·{' '}
            {record.timeControl.minutes > 0 ? `${record.timeControl.minutes}+${record.timeControl.increment}` : 'no clock'}
            {record.ratingAfter !== record.ratingBefore && (
              <>
                {' '}
                · rating {record.ratingBefore} → {record.ratingAfter} (
                {record.ratingAfter > record.ratingBefore ? '+' : ''}
                {record.ratingAfter - record.ratingBefore})
              </>
            )}
          </p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>
          <XIcon /> Back
        </button>
      </div>

      <div className="review-layout">
        <div>
          <div className="row" style={{ alignItems: 'stretch', gap: '0.6rem' }}>
            <EvalBar evaluation={evaluation} thinking={analyzing} />
            <div className="grow">
              <GameBoard
                boardId="review"
                fen={fen}
                orientation={orientation}
                lastMove={lastMove}
                checkSquare={checkSquare}
                movableColor={null}
              />
            </div>
          </div>

          {report && (
            <EvalGraph
              evals={report.evals}
              reviews={report.reviews}
              plyIndex={plyIndex}
              onSelect={(i) => setPlyIndex(i)}
            />
          )}
          {analyzing && analysis && (
            <div className="analysis-progress mt-1" role="status">
              <span className="small muted">
                {analysis.done === 0 ? 'Waking the engine…' : `Analyzing game — ${progressPct}%`}
              </span>
              <div className="analysis-bar">
                <div className="analysis-bar-fill" style={{ transform: `scaleX(${progressPct / 100})` }} />
              </div>
            </div>
          )}
        </div>

        <aside className="col" style={{ gap: '0.9rem' }}>
          <div className="panel panel-pad">
            <div className="section-label">
              Game report
              {opening && (
                <span className="opening-tag mono" title={`${opening.eco} — ${opening.name}`}>
                  {opening.eco} · {opening.name}
                </span>
              )}
            </div>
            {!report ? (
              <p className="small muted m-0">
                {analyzing
                  ? 'Stockfish is walking through every move of the game. The full report appears here.'
                  : 'The report will appear here once the engine has analyzed the game.'}
              </p>
            ) : (
              <>
                <div className="report-accuracy">
                  <div className="report-side">
                    <span className="report-name">{youLabel}</span>
                    <span className="report-acc">{youAcc != null ? `${youAcc}%` : '—'}</span>
                  </div>
                  <div className="report-side right">
                    <span className="report-name">{oppLabel}</span>
                    <span className="report-acc">{oppAcc != null ? `${oppAcc}%` : '—'}</span>
                  </div>
                </div>
                <div className="report-classes">
                  {(Object.keys(CLASSIFICATION_META) as MoveClass[]).map((cls) => {
                    const meta = CLASSIFICATION_META[cls];
                    const wCount = report.counts[record.playerColor === 'w' ? 'w' : 'b'][cls];
                    const bCount = report.counts[record.playerColor === 'w' ? 'b' : 'w'][cls];
                    if (wCount === 0 && bCount === 0) return null;
                    return (
                      <div className="report-class-row" key={cls} title={meta.label}>
                        <span className="report-dot" style={{ background: meta.color }} />
                        <span className="report-class-label">{meta.label}</span>
                        <span className="report-class-count">{wCount}</span>
                        <span className="report-class-count">{bCount}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="small muted mt-1" style={{ marginBottom: 0 }}>
                  Columns count your moves and the engine’s. Percentages come from average centipawn loss at depth{' '}
                  {ANALYSIS_DEPTH}.
                </p>
              </>
            )}
          </div>

          <div className="panel panel-pad">
            <div className="section-label">
              Moves
              <span className="small muted">
                {plyIndex} / {plies.length}
              </span>
            </div>
            <MoveList
              plies={plies}
              currentPly={plyIndex - 1}
              onSelect={(i) => setPlyIndex(i + 1)}
              markers={report?.reviews.map((r) => r.classification)}
            />
            {currentReview && (
              <div className="small mt-1" style={{ marginBottom: 0 }}>
                <p style={{ marginBottom: '0.3rem' }}>
                  <span className="report-dot" style={{ background: CLASSIFICATION_META[currentReview.classification].color }} />{' '}
                  <strong>{CLASSIFICATION_META[currentReview.classification].label}</strong> — {currentReview.san}{' '}
                  {currentReview.classification === 'book'
                    ? 'follows a known opening line.'
                    : `costs ${(currentReview.cpl / 100).toFixed(2)} pawns of engine value.`}
                </p>
                {(() => {
                  const before = report?.evals[plyIndex - 1] ?? null;
                  if (!before?.bestSan || before.bestSan === currentReview.san) return null;
                  return (
                    <p style={{ margin: 0 }} className="muted">
                      Stronger was <strong className="mono">{before.bestSan}</strong>
                      {classificationIconHint(plyIndex - 1)}
                    </p>
                  );
                })()}
              </div>
            )}
            <div className="nav-steps">
              <button className="icon-btn" onClick={() => setPlyIndex(0)} aria-label="Go to start" disabled={plyIndex === 0}>
                <ChevronLeft />
                <ChevronLeft style={{ marginLeft: '-0.6rem' }} />
              </button>
              <button
                className="icon-btn"
                onClick={() => jumpToCritical(-1)}
                aria-label="Previous mistake"
                title="Previous mistake ( [ )"
                disabled={criticalPlys.length === 0}
              >
                <ChevronLeft />
                <span className="report-dot" style={{ background: 'var(--bad)', width: 6, height: 6, marginLeft: -6 }} />
              </button>
              <button
                className="icon-btn"
                onClick={() => jumpToCritical(1)}
                aria-label="Next mistake"
                title="Next mistake ( ] )"
                disabled={criticalPlys.length === 0}
              >
                <span className="report-dot" style={{ background: 'var(--bad)', width: 6, height: 6, marginRight: -6 }} />
                <ChevronRight />
              </button>
              <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous move" disabled={plyIndex === 0}>
                <ChevronLeft />
              </button>
              <input
                type="range"
                min={0}
                max={plies.length}
                value={plyIndex}
                onChange={(e) => setPlyIndex(Number(e.target.value))}
                aria-label="Move slider"
              />
              <button className="icon-btn" onClick={() => step(1)} aria-label="Next move" disabled={plyIndex === plies.length}>
                <ChevronRight />
              </button>
              <button
                className="icon-btn"
                onClick={() => setPlyIndex(plies.length)}
                aria-label="Go to end"
                disabled={plyIndex === plies.length}
              >
                <ChevronRight />
                <ChevronRight style={{ marginLeft: '-0.6rem' }} />
              </button>
            </div>
          </div>

          <div className="panel panel-pad">
            <div className="section-label">Position</div>
            <p className="small" style={{ lineHeight: 1.6 }}>
              {shownGame?.isCheckmate() ? (
                <>Checkmate — {shownGame.turn() === 'w' ? 'Black' : 'White'} delivered the final blow.</>
              ) : evaluation?.mateIn != null ? (
                <>
                  Stockfish sees <strong>mate in {Math.abs(evaluation.mateIn)}</strong> for{' '}
                  {evaluation.cp > 0 ? 'White' : 'Black'}.
                </>
              ) : evaluation ? (
                <>
                  Stockfish view: {evaluation.cp > 0 ? 'White' : evaluation.cp < 0 ? 'Black' : 'either side'} is better by{' '}
                  <strong className="mono">{(Math.abs(evaluation.cp) / 100).toFixed(1)}</strong>
                  {evaluation.bestSan && (
                    <>
                      {' '}
                      — its move here: <strong className="mono">{evaluation.bestSan}</strong>.
                    </>
                  )}
                  {current && (
                    <>
                      {' '}
                      Played: <strong className="mono">{current.san}</strong>.
                    </>
                  )}
                </>
              ) : (
                <>Scanning this position…</>
              )}
            </p>
            <p className="small muted mt-1">← → to step through moves. The graph below the board shows the whole game.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Eval graph — white advantage area chart with classification markers */
/* ------------------------------------------------------------------ */

function EvalGraph({
  evals,
  reviews,
  plyIndex,
  onSelect,
}: {
  evals: (PlyEval | null)[];
  reviews: { classification: MoveClass; color: 'w' | 'b' }[];
  plyIndex: number;
  onSelect: (ply: number) => void;
}) {
  const points = evals.map((e) => (e ? evalToUnit(e.cp) : 0.5));
  const w = 600;
  const h = 84;

  const path = useMemo(() => {
    const n = points.length;
    if (n < 2) return null;
    const step = w / (n - 1);
    const coords = points.map((p, i) => `${i * step},${(1 - p) * h}`);
    return { line: `M${coords.join(' L')}`, area: `M0,${h} L${coords.join(' L')} L${w},${h} Z`, step };
  }, [points]);

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    onSelect(Math.round(frac * (points.length - 1)));
  };

  return (
    <div className="eval-graph" role="img" aria-label="Evaluation graph of the whole game. Click a point to jump there.">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" onClick={handleClick}>
        {path && <path d={path.area} fill="var(--board-light)" />}
        {path && <path d={path.line} fill="none" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        {reviews.map((r, i) => {
          const step = w / (points.length - 1);
          const x = (i + 1) * step;
          const y = (1 - points[i + 1]) * h;
          if (r.classification === 'best' || r.classification === 'excellent' || r.classification === 'good') return null;
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={4}
              fill={CLASSIFICATION_META[r.classification].color}
              stroke="var(--surface)"
              strokeWidth={1}
            />
          );
        })}
        {points.length > 1 && (
          <line
            x1={(plyIndex / (points.length - 1)) * w}
            x2={(plyIndex / (points.length - 1)) * w}
            y1={0}
            y2={h}
            stroke="var(--accent)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </div>
  );
}
