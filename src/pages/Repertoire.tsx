import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import GameBoard from '../components/GameBoard';
import TreeWorkspace from '../components/TreeWorkspace';
import { useClickToMove } from '../hooks/useClickToMove';
import { useToast } from '../components/Toast';
import { TrashIcon } from '../components/Icons';
import { playSound } from '../lib/sound';
import { findNode, fromPgn, lineTo } from '../lib/gameTree';
import {
  createRepertoire,
  loadRepertoires,
  markPreferred,
  saveRepertoires,
  setPreferredChild,
  type Repertoire,
} from '../lib/repertoireStore';
import { trainerStep } from '../lib/repertoireTrain';

export function RepertoireList() {
  const { toast } = useToast();
  const [reps, setReps] = useState(() => loadRepertoires());
  const [name, setName] = useState('');
  const [side, setSide] = useState<'w' | 'b'>('w');

  useEffect(() => {
    saveRepertoires(reps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reps]);

  const create = () => {
    const rep = createRepertoire(name || (side === 'w' ? 'White repertoire' : 'Black repertoire'), side);
    setReps((list) => [rep, ...list]);
    setName('');
    toast('Repertoire created.');
  };

  const whiteReps = reps.filter((r) => r.side === 'w');
  const blackReps = reps.filter((r) => r.side === 'b');

  return (
    <div className="page container">
      <div className="page-head">
        <h1>Repertoire</h1>
        <p className="sub">
          Build your lines, mark the moves you want to play, then train them — the trainer asks for your repertoire
          move and flags every deviation.
        </p>
        <nav className="page-tabs mt-2" aria-label="Training area">
          <Link to="/puzzles">Puzzles</Link>
          <Link to="/repertoire" className="on">
            Repertoire
          </Link>
          <Link to="/coordinates">Coordinates</Link>
        </nav>
      </div>

      <form
        className="row mb-2"
        style={{ gap: '0.5rem', maxWidth: 560 }}
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input
          className="input"
          placeholder="New repertoire name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="New repertoire name"
        />
        <div className="seg" role="radiogroup" aria-label="Side">
          <button type="button" className={side === 'w' ? 'on' : ''} onClick={() => setSide('w')}>
            White
          </button>
          <button type="button" className={side === 'b' ? 'on' : ''} onClick={() => setSide('b')}>
            Black
          </button>
        </div>
        <button className="btn btn-accent" type="submit">
          Create
        </button>
      </form>

      {(['w', 'b'] as const).map((s) => (
        <section key={s} className="mb-2">
          <div className="section-label">{s === 'w' ? 'White repertoires' : 'Black repertoires'}</div>
          {(s === 'w' ? whiteReps : blackReps).length === 0 ? (
            <p className="small muted">None yet.</p>
          ) : (
            <div className="study-list">
              {(s === 'w' ? whiteReps : blackReps).map((r) => (
                <div key={r.id} className="study-card">
                  <Link to={`/repertoire/${r.id}`} className="study-main">
                    <span className="study-title">{r.name}</span>
                    <span className="study-meta">
                      {r.lines.length} {r.lines.length === 1 ? 'line' : 'lines'} ·{' '}
                      {new Date(r.updatedAt || Date.now()).toLocaleDateString()}
                    </span>
                  </Link>
                  <button className="icon-btn" aria-label={`Delete ${r.name}`} onClick={() => {
                    setReps((list) => list.filter((x) => x.id !== r.id));
                    toast('Repertoire deleted.');
                  }}>
                    <TrashIcon />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export function RepertoireDetail() {
  const { id } = useParams();
  const { toast } = useToast();
  const [reps, setReps] = useState(() => loadRepertoires());
  const [mode, setMode] = useState<'edit' | 'train'>('edit');
  const rep = reps.find((r) => r.id === id) ?? null;

  useEffect(() => {
    if (!rep) return;
    const timer = window.setTimeout(() => {
      rep.updatedAt = Date.now();
      saveRepertoires(reps);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [rep, reps]);

  if (!rep) {
    return (
      <div className="page container">
        <div className="empty-state">
          <p>That repertoire no longer exists.</p>
          <Link className="btn btn-primary" to="/repertoire">
            Back to repertoires
          </Link>
        </div>
      </div>
    );
  }

  const mutate = (fn: (r: Repertoire) => void) => {
    setReps((list) => {
      const copy = list.map((r) => (r.id === rep.id ? { ...r } : r));
      fn(copy.find((r) => r.id === rep.id)!);
      return copy;
    });
  };

  return (
    <div className="page container">
      <div className="page-head row between wrap" style={{ gap: '1rem' }}>
        <div className="col" style={{ gap: '0.35rem' }}>
          <Link to="/repertoire" className="small muted" style={{ textDecoration: 'none' }}>
            ← Repertoire
          </Link>
          <input
            className="study-title-input"
            value={rep.name}
            aria-label="Repertoire name"
            onChange={(e) => mutate((r) => void (r.name = e.target.value))}
          />
        </div>
        <div className="seg" role="radiogroup" aria-label="Mode">
          <button className={mode === 'edit' ? 'on' : ''} onClick={() => setMode('edit')}>
            Edit lines
          </button>
          <button className={mode === 'train' ? 'on' : ''} onClick={() => setMode('train')}>
            Train
          </button>
        </div>
      </div>

      {mode === 'edit' ? (
        <EditLines rep={rep} mutate={mutate} toast={toast} />
      ) : (
        <Trainer rep={rep} />
      )}
    </div>
  );
}

/* ---------- edit mode ---------- */

function EditLines({
  rep,
  mutate,
  toast,
}: {
  rep: Repertoire;
  mutate: (fn: (r: Repertoire) => void) => void;
  toast: (msg: string) => void;
}) {
  const line = rep.lines[0];
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [pgnDraft, setPgnDraft] = useState('');

  // kept intentionally small: one line per repertoire in v1; TreeWorkspace edits it
  const setTree = useCallback(
    (tree: typeof line.tree) => {
      mutate((r) => {
        r.lines[0].tree = tree;
      });
    },
    [mutate],
  );

  const current = currentId ? findNode(line.tree, currentId) : null;
  const parentChain = current ? lineTo(line.tree, current.id) : [];
  const parentNode = parentChain.length >= 2 ? parentChain[parentChain.length - 2] : null;
  const isPreferred =
    current ? (line.preferred[parentNode?.id ?? '__root__'] ?? line.preferred['__root__'] ?? null) === current.id : false;
  const parentKey = parentNode?.id ?? '__root__';

  return (
    <div className="repertoire-layout">
      <div className="panel panel-pad rep-tools">
        <div className="section-label">Repertoire moves</div>
        <p className="small muted" style={{ margin: 0 }}>
          Play through your line on the board. At any move, mark it as the move you want to play over the alternatives.
        </p>
        {current ? (
          <div className="col mt-2" style={{ gap: '0.5rem' }}>
            <span className="mono small" style={{ color: 'var(--ice)' }}>
              {current.moveNumber}
              {current.color === 'w' ? '.' : '…'} {current.san}
            </span>
            {isPreferred ? (
              <button
                className="btn btn-ghost btn-sm tool-on"
                onClick={() => {
                  mutate((r) => markPreferred(r.lines[0], parentNode ? parentNode.id : null, false));
                  toast('Preferred marking removed — the first move of the position is used.');
                }}
              >
                ★ Repertoire move — remove marking
              </button>
            ) : (
              <button
                className="btn btn-ghost btn-sm"
                disabled={!current}
                onClick={() => {
                  mutate((r) => setPreferredChild(r.lines[0], parentNode ? parentNode.id : null, current.id));
                  toast('Marked as the repertoire move.');
                }}
              >
                ☆ Mark as repertoire move
              </button>
            )}
            <span className="small muted">
              Preferred key for this position: {parentKey === '__root__' ? 'line start' : parentKey}
            </span>
          </div>
        ) : (
          <p className="small muted mt-2">Select a move in the tree to mark it.</p>
        )}

        <div className="field mt-2">
          <label htmlFor="rep-pgn">Import PGN into this line</label>
          <textarea
            id="rep-pgn"
            className="input"
            rows={3}
            value={pgnDraft}
            onChange={(e) => setPgnDraft(e.target.value)}
            placeholder="Replaces the line's moves…"
          />
          <button
            className="btn btn-ghost btn-sm"
            disabled={!pgnDraft.trim()}
            onClick={() => {
              const { tree } = fromPgn(pgnDraft.trim());
              let n = 0;
              const stack = [...tree.moves];
              while (stack.length) {
                const x = stack.pop()!;
                n += 1;
                stack.push(...x.children);
              }
              if (n === 0) {
                toast('No moves found in that PGN.');
                return;
              }
              setTree(tree);
              setCurrentId(null);
              setPgnDraft('');
              toast(`Imported ${n} moves.`);
            }}
          >
            Import
          </button>
        </div>
      </div>

      <TreeWorkspaceLazy
        line={line}
        currentId={currentId}
        setCurrentId={setCurrentId}
        setTree={setTree}
      />
    </div>
  );
}

/* thin wrapper so EditLines stays readable */
function TreeWorkspaceLazy({
  line,
  currentId,
  setCurrentId,
  setTree,
}: {
  line: Repertoire['lines'][number];
  currentId: string | null;
  setCurrentId: (id: string | null) => void;
  setTree: (tree: Repertoire['lines'][number]['tree']) => void;
}) {
  return (
    <TreeWorkspace tree={line.tree} currentId={currentId} boardId={`rep-${line.id}`} onTreeChange={setTree} onNavigate={setCurrentId} />
  );
}

/* ---------- train mode ---------- */

interface DrillState {
  nodeId: string | null;
  asked: number;
  correct: number;
  deviations: number;
  lastDeviation: string | null;
  done: boolean;
}

function Trainer({ rep }: { rep: Repertoire }) {
  const line = rep.lines[0];
  const mySide = rep.side;
  const sideName = mySide === 'w' ? 'White' : 'Black';

  const [drill, setDrill] = useState<DrillState>({ nodeId: null, asked: 0, correct: 0, deviations: 0, lastDeviation: null, done: false });
  const [reveal, setReveal] = useState<string | null>(null);

  const current = drill.nodeId ? findNode(line.tree, drill.nodeId) : null;
  const fen = current ? current.fenAfter : line.tree.startFen;
  const done = drill.nodeId ? findNode(line.tree, drill.nodeId)?.children.length === 0 : line.tree.moves.length === 0;

  const tryMove = useCallback(
    (from: Square, to: Square): 'ok' | 'illegal' => {
      const probe = new Chess();
      try {
        probe.load(fen);
      } catch {
        return 'illegal';
      }
      let m;
      try {
        m = probe.move({ from, to, promotion: 'q' });
      } catch {
        return 'illegal';
      }
      const step = trainerStep(line, drill.nodeId, m.san);
      if (step.status === 'line-end') return 'illegal';
      if (step.status === 'deviation') {
        playSound('illegal');
        setReveal(step.expectedSan);
        setDrill((d) => ({ ...d, deviations: d.deviations + 1, lastDeviation: m.san }));
        return 'illegal'; // move is not committed — try again
      }
      playSound('move');
      setReveal(null);
      setDrill((d) => ({
        ...d,
        asked: d.asked + 1,
        correct: d.correct + 1,
        nodeId: step.oppReply ? step.oppReply.id : step.nodeId,
        done: !step.oppReply,
      }));
      return 'ok';
    },
    [fen, line, drill.nodeId],
  );

  const click = useClickToMove({
    fen,
    movableColor: mySide,
    tryMove,
  });

  const handleDrop = useCallback(
    (from: Square, to: Square) => {
      const ok = tryMove(from, to);
      if (!ok) playSound('illegal');
      click.clear();
      return ok === 'ok';
    },
    [tryMove, click],
  );

  const restart = () => setDrill({ nodeId: null, asked: 0, correct: 0, deviations: 0, lastDeviation: null, done: false });

  const progress = drill.asked > 0 ? Math.round((drill.correct / drill.asked) * 100) : null;

  return (
    <div className="trainer-layout">
      <div>
        <GameBoard
          boardId="rep-train"
          fen={fen}
          orientation={mySide === 'w' ? 'white' : 'black'}
          movableColor={mySide}
          onSquareClick={click.onSquareClick}
          selected={click.selected}
          legalTargets={click.legalTargets}
          onDrop={handleDrop}
        />
        <div className="board-under">
          <button className="btn btn-ghost btn-sm" onClick={restart}>
            Restart drill
          </button>
          <span className="board-hint mono">{sideName} to find the repertoire move</span>
        </div>
      </div>

      <aside className="panel panel-pad col" style={{ gap: '0.7rem' }}>
        <div className="section-label">Drill</div>
        {done ? (
          <div className="col" style={{ gap: '0.5rem' }}>
            <p className="rep-verdict">Line complete.</p>
            <p className="small muted" style={{ margin: 0 }}>
              {drill.asked} repertoire moves, {drill.deviations} deviation{drill.deviations === 1 ? '' : 's'}.
            </p>
            <button className="btn btn-accent btn-sm" onClick={restart}>
              Run it again
            </button>
          </div>
        ) : (
          <>
            <p className="rep-prompt">
              {reveal
                ? (
                  <>
                    <strong style={{ color: 'var(--bad)' }}>{drill.lastDeviation}</strong> deviates. The repertoire move
                    here is <strong style={{ color: 'var(--sea)' }}>{reveal}</strong> — play it.
                  </>
                )
                : `Find the ${sideName.toLowerCase()} repertoire move.`}
            </p>
            <div className="rep-stats">
              <div>
                <div className="v">{drill.correct}</div>
                <div className="k">played</div>
              </div>
              <div>
                <div className="v">{drill.deviations}</div>
                <div className="k">deviations</div>
              </div>
              <div>
                <div className="v">{progress === null ? '—' : `${progress}%`}</div>
                <div className="k">clean</div>
              </div>
            </div>
            {reveal && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setReveal(null)}
              >
                Got it — hide
              </button>
            )}
          </>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          Deviations are not played on the board — the position stays until you find the repertoire move.
        </p>
      </aside>
    </div>
  );
}
