import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import GameBoard from '../components/GameBoard';
import EvalBar from '../components/EvalBar';
import { useEngine } from '../lib/engine/useEngine';
import { isValidFen, normalizeFen, copyText } from '../lib/pgn';
import { playSound } from '../lib/sound';
import { useToast } from '../components/Toast';
import { useClickToMove } from '../hooks/useClickToMove';
import { FlipIcon, XIcon } from '../components/Icons';
import type { EvalResult } from '../lib/engine/engine';
import type { SFLine } from '../lib/engine/stockfish';
import { START_FEN } from '../lib/chessUtils';
import {
  applySan,
  createTree,
  deleteMove,
  findNode,
  fromPgn,
  lineTo,
  promote,
  setComment,
  toggleNag,
  toPgn,
  type GameTreeData,
  type TreeNode,
} from '../lib/gameTree';

const ANALYSIS_DEPTH = 14;
const LINES = 3;
const NAG_CHOICES = ['!', '!!', '!?', '?!', '?', '??'];

export default function Analysis() {
  const location = useLocation();
  const engine = useEngine();
  const { toast } = useToast();

  const [tree, setTree] = useState<GameTreeData>(() => createTree());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [fenInput, setInput] = useState('');
  const [pgnInput, setPgnInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const treeRef = useRef(tree);
  treeRef.current = tree;

  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [lines, setLines] = useState<SFLine[]>([]);
  const [thinking, setThinking] = useState(false);
  const [selectedLine, setSelectedLine] = useState(0);

  const current = currentId ? findNode(tree, currentId) : null;
  const fen = current ? current.fenAfter : tree.startFen;

  const turn = useMemo(() => {
    try {
      return new Chess(fen).turn();
    } catch {
      return 'w';
    }
  }, [fen]);

  /** Play a move on the board: navigates into an existing variation or appends a new mainline move. */
  const commitLocal = useCallback(
    (from: Square, to: Square, promotion: 'q' | 'r' | 'b' | 'n' = 'q'): 'ok' | 'illegal' => {
      const t = treeRef.current;
      const probe = new Chess();
      try {
        probe.load(fen);
      } catch {
        return 'illegal';
      }
      let m;
      try {
        m = probe.move({ from, to, promotion });
      } catch {
        return 'illegal';
      }
      playSound(m.san.includes('+') ? 'check' : 'move');
      const r = applySan(t, currentId, m.san);
      if (!r.ok) return 'illegal';
      if (r.created) {
        // a newly played move becomes the mainline continuation of its position
        while (promote(t, r.id));
      }
      setTree({ ...t });
      setCurrentId(r.id);
      setSelectedLine(0);
      return 'ok';
    },
    [fen, currentId],
  );

  const click = useClickToMove({
    fen,
    movableColor: turn,
    tryMove: (from, to) => commitLocal(from, to),
  });

  const handleDrop = useCallback(
    (from: Square, to: Square) => {
      const ok = commitLocal(from, to);
      if (!ok) playSound('illegal');
      click.clear();
      return ok === 'ok';
    },
    [commitLocal, click],
  );

  // import a PGN passed from another page (e.g. "open in analysis")
  useEffect(() => {
    const statePgn = (location.state as { pgn?: string } | null)?.pgn;
    if (statePgn) loadPgnText(statePgn);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // engine evaluation, debounced; single request per position
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setThinking(true);
      try {
        const res = await engine.evaluate(fen, ANALYSIS_DEPTH);
        if (!cancelled) setEvalResult(res);
      } catch {
        if (!cancelled) setEvalResult(null);
      }
      if (!cancelled) setThinking(false);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fen, engine]);

  // MultiPV lines: separate request so the main evaluation stays snappy
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { sfSearch } = await import('../lib/engine/stockfish');
        const res = await sfSearch(fen, { depth: 12, movetime: 1200, multipv: LINES, fullStrength: true });
        if (!cancelled && res) {
          setLines(res.lines);
          setSelectedLine(0);
        }
      } catch {
        if (!cancelled) setLines([]);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fen]);

  // arrow keys walk the mainline around the current position
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') {
        const node = currentId ? findNode(treeRef.current, currentId) : null;
        const next = node ? node.children[0] : treeRef.current.moves[0];
        if (next) {
          setCurrentId(next.id);
          e.preventDefault();
        }
      } else if (e.key === 'ArrowLeft') {
        const node = currentId ? findNode(treeRef.current, currentId) : null;
        if (!node) return;
        const chain = lineTo(treeRef.current, node.id);
        setCurrentId(chain.length >= 2 ? chain[chain.length - 2].id : null);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [currentId, tree]);

  const loadPgnText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const { tree: parsed, headers } = fromPgn(trimmed);
      const n = countAll(parsed);
      if (n === 0) {
        toast('No moves found in that PGN.');
        return;
      }
      setTree(parsed);
      const ml = mainlineIds(parsed);
      setCurrentId(ml[ml.length - 1] ?? null);
      setFenError(null);
      void headers;
      toast(`Loaded ${n} moves.`);
    },
    [toast],
  );

  const loadFenText = useCallback(
    (text: string) => {
      const normalized = normalizeFen(text);
      if (!normalized) {
        setFenError('That FEN is not a valid position.');
        return;
      }
      setFenError(null);
      setTree(createTree(normalized));
      setCurrentId(null);
      toast('Position loaded.');
    },
    [toast],
  );

  const bestArrow = useMemo(() => {
    const line = lines[selectedLine] ?? lines[0];
    if (!line?.san) return [];
    try {
      const g = new Chess(fen);
      const m = g.move(line.pvSan[0]);
      return [{ startSquare: m.from, endSquare: m.to, color: 'rgba(154, 160, 192, 0.85)' }];
    } catch {
      return [];
    }
  }, [lines, selectedLine, fen]);

  const copy = useCallback(
    async (text: string, label: string) => {
      const ok = await copyText(text);
      toast(ok ? `${label} copied.` : `Couldn't copy, select the text instead.`);
    },
    [toast],
  );

  const fullPgn = useMemo(() => toPgn(tree, { Event: 'Gambit analysis' }), [tree]);

  const annotate = useCallback(
    (fn: (t: GameTreeData) => void) => {
      const t = treeRef.current;
      fn(t);
      setTree({ ...t });
      bump();
    },
    [bump],
  );

  return (
    <div className="page container">
      <div className="page-head row between wrap" style={{ gap: '1rem' }}>
        <div>
          <h1>Analysis board</h1>
          <p className="sub">
            Load any position or game, build variations, annotate moves and read Stockfish. Everything runs locally.
          </p>
        </div>
      </div>

      <div className="analysis-layout">
        <div>
          <div className="row" style={{ alignItems: 'stretch', gap: '0.6rem' }}>
            <EvalBar evaluation={evalResult} thinking={thinking} />
            <div className="grow">
              <GameBoard
                boardId="analysis"
                fen={fen}
                orientation={orientation}
                movableColor={turn}
                onSquareClick={click.onSquareClick}
                selected={click.selected}
                legalTargets={click.legalTargets}
                onDrop={handleDrop}
                arrows={bestArrow}
              />
            </div>
          </div>
          <div className="board-under">
            <button className="btn btn-ghost btn-sm" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
              <FlipIcon /> Flip
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setTree(createTree());
                setCurrentId(null);
                setFenError(null);
              }}
            >
              Reset
            </button>
            <span className="board-hint mono">{turn === 'w' ? 'White' : 'Black'} to move</span>
          </div>
        </div>

        <aside className="col" style={{ gap: '0.9rem' }}>
          <div className="panel panel-pad">
            <div className="section-label">
              Engine lines
              <span className="small muted">{thinking ? 'thinking…' : evalResult ? `depth ${evalResult.depth}` : 'idle'}</span>
            </div>
            <div className="engine-rows">
              {lines.length === 0 && (
                <p className="small muted" style={{ margin: 0 }}>
                  Stockfish lines appear here once the engine has evaluated the position.
                </p>
              )}
              {lines.map((line, i) => (
                <EngineRow key={`${i}-${line.san}`} line={line} fen={fen} selected={selectedLine === i} onSelect={() => setSelectedLine(i)} />
              ))}
            </div>
            <p className="small muted mt-1" style={{ marginBottom: 0 }}>
              Click a line to show it on the board.
            </p>
          </div>

          <div className="panel panel-pad">
            <div className="section-label">
              Moves &amp; variations
              <span className="small muted">{tree.moves.length === 0 ? 'empty' : `${countAll(tree)} nodes`}</span>
            </div>
            {tree.moves.length === 0 ? (
              <div className="empty-state">
                <p>No moves yet — play on the board, paste a FEN, or import a PGN with variations.</p>
              </div>
            ) : (
              <>
                <div className="tree-view" role="list" aria-label="Move tree">
                  <TreeLevel siblings={tree.moves} prev={null} currentId={currentId} onSelect={setCurrentId} />
                </div>
                <div className="tree-nav row" style={{ gap: '0.35rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setCurrentId(null)}>
                    ⏮ Start
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const node = currentId ? findNode(tree, currentId) : null;
                      const parentId = node ? lineTo(tree, node.id).slice(-2, -1)[0]?.id ?? null : null;
                      setCurrentId(parentId);
                    }}
                    disabled={!currentId}
                  >
                    ← Back
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const node = currentId ? findNode(tree, currentId) : null;
                      const next = node ? node.children[0] : tree.moves[0];
                      if (next) setCurrentId(next.id);
                    }}
                  >
                    Forward →
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const ml = mainlineIds(tree);
                      setCurrentId(ml[ml.length - 1] ?? null);
                    }}
                    disabled={tree.moves.length === 0}
                  >
                    End ⏭
                  </button>
                </div>

                {current && (
                  <div className="anno-zone mt-2">
                    <div className="row between wrap" style={{ gap: '0.4rem' }}>
                      <span className="mono small" style={{ color: 'var(--ice)' }}>
                        {current.moveNumber}
                        {current.color === 'w' ? '.' : '…'} {current.san}
                        {current.nags.length > 0 && <span className="nag-tag"> {current.nags.join('')}</span>}
                      </span>
                      <div className="row" style={{ gap: '0.35rem' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => annotate((t) => promoteToMainline(t, current.id))}
                          disabled={(findNode(tree, current.id) ? siblingCount(tree, current.id) : 0) < 2}
                        >
                          Promote
                        </button>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            annotate((t) => deleteMove(t, current.id));
                            setCurrentId(null);
                            toast('Variation deleted.');
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="anno-bar">
                      {NAG_CHOICES.map((nag) => (
                        <button
                          key={nag}
                          type="button"
                          className={`nag-btn${current.nags.includes(nag) ? ' on' : ''}`}
                          aria-pressed={current.nags.includes(nag)}
                          onClick={() => annotate((t) => toggleNag(t, current.id, nag))}
                        >
                          {nag}
                        </button>
                      ))}
                    </div>
                    <textarea
                      className="input"
                      rows={2}
                      placeholder="Comment on this move…"
                      defaultValue={current.comment ?? ''}
                      key={current.id}
                      onBlur={(e) => {
                        if ((current.comment ?? '') !== e.target.value.trim()) {
                          annotate((t) => setComment(t, current.id, e.target.value));
                        }
                      }}
                    />
                  </div>
                )}
              </>
            )}
          </div>

          <div className="panel panel-pad col" style={{ gap: '0.75rem' }}>
            <div className="section-label">Import / export</div>
            <div className="io-buttons">
              <button className="btn btn-ghost btn-sm" onClick={() => copy(fen, 'FEN')}>
                Copy FEN
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => copy(fullPgn, 'PGN')} disabled={tree.moves.length === 0}>
                Copy PGN
              </button>
            </div>
            <div className="field">
              <label htmlFor="an-fen">Position (FEN)</label>
              <input
                id="an-fen"
                className="input mono"
                placeholder={START_FEN}
                value={fenInput}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadFenText(fenInput)}
              />
              {fenError && (
                <span className="small" style={{ color: 'var(--bad)' }}>
                  {fenError}
                </span>
              )}
              <div className="row" style={{ gap: '0.4rem' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => loadFenText(fenInput)} disabled={!fenInput.trim()}>
                  Load position
                </button>
                {fenInput.trim() && !fenError && isValidFen(fenInput) && (
                  <span className="small" style={{ color: 'var(--good)' }}>
                    valid position
                  </span>
                )}
              </div>
            </div>
            <div className="field">
              <label htmlFor="an-pgn">Game (PGN — variations preserved)</label>
              <textarea
                id="an-pgn"
                className="input"
                rows={4}
                placeholder={'1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 …'}
                value={pgnInput}
                onChange={(e) => setPgnInput(e.target.value)}
              />
              <div className="row" style={{ gap: '0.4rem' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => loadPgnText(pgnInput)} disabled={!pgnInput.trim()}>
                  Import game
                </button>
                {pgnInput.trim() && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setPgnInput('')} aria-label="Clear PGN">
                    <XIcon /> Clear
                  </button>
                )}
              </div>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              ← → walk the mainline around the current move. Newly played moves become the main line of their position.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ---------- helpers ---------- */

function countAll(tree: GameTreeData): number {
  let c = 0;
  const stack = [...tree.moves];
  while (stack.length) {
    const n = stack.pop()!;
    c += 1;
    stack.push(...n.children);
  }
  return c;
}

function mainlineIds(tree: GameTreeData): string[] {
  const ids: string[] = [];
  let level = tree.moves;
  while (level.length) {
    ids.push(level[0].id);
    level = level[0].children;
  }
  return ids;
}

function promoteToMainline(tree: GameTreeData, id: string): void {
  while (promote(tree, id));
}

function siblingCount(tree: GameTreeData, id: string): number {
  const node = findNode(tree, id);
  if (!node) return 0;
  const parent = lineTo(tree, id).slice(-2, -1)[0] ?? null;
  return (parent ? parent.children : tree.moves).length;
}

/* ---------- tree rendering ---------- */

function TreeLevel({
  siblings,
  prev,
  currentId,
  onSelect,
  depth = 0,
}: {
  siblings: TreeNode[];
  prev: TreeNode | null;
  currentId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  if (!siblings.length) return null;
  const main = siblings[0];
  return (
    <span className="tree-line">
      <MoveToken node={main} prev={prev} currentId={currentId} onSelect={onSelect} />
      {main.comment && <span className="tcomment">{main.comment}</span>}
      {siblings.length > 1 && (
        <span className="var">
          {siblings.slice(1).map((alt) => (
            <span className="var-block" key={alt.id}>
              <span className="var-paren" aria-hidden="true">
                (
              </span>
              <TreeLevel siblings={[alt]} prev={null} currentId={currentId} onSelect={onSelect} depth={depth + 1} />
              <span className="var-paren" aria-hidden="true">
                )
              </span>
            </span>
          ))}
        </span>
      )}
      {main.children.length > 0 && <TreeLevel siblings={main.children} prev={main} currentId={currentId} onSelect={onSelect} depth={depth} />}
    </span>
  );
}

function MoveToken({
  node,
  prev,
  currentId,
  onSelect,
}: {
  node: TreeNode;
  prev: TreeNode | null;
  currentId: string | null;
  onSelect: (id: string) => void;
}) {
  const showNumber = node.color === 'w' || !prev || prev.moveNumber !== node.moveNumber;
  return (
    <>
      {node.color === 'w' && <span className="tnum">{node.moveNumber}.</span>}
      {node.color === 'b' && showNumber && <span className="tnum">{node.moveNumber}…</span>}
      <button type="button" role="listitem" className={`tmv${currentId === node.id ? ' cur' : ''}`} onClick={() => onSelect(node.id)}>
        {node.san}
        {node.nags.length > 0 && <span className="nag">{node.nags.join('')}</span>}
      </button>
    </>
  );
}

function EngineRow({ line, fen, selected, onSelect }: { line: SFLine; fen: string; selected: boolean; onSelect: () => void }) {
  const score =
    line.mate != null
      ? `#${Math.abs(line.mate)}${line.mate > 0 ? '' : '-'}`
      : `${(line.cp ?? 0) > 0 ? '+' : ''}${((line.cp ?? 0) / 100).toFixed(1)}`;
  const pvText = useMemo(() => {
    try {
      const g = new Chess(fen);
      const parts: React.ReactNode[] = [];
      let moveNumber = g.moveNumber();
      let whiteToMove = g.turn() === 'w';
      line.pvSan.forEach((san, i) => {
        const startsMove = whiteToMove && i % 2 === 0;
        const blackFirst = !whiteToMove && i === 0;
        if (startsMove) parts.push(<span key={`n${i}`} className="pv-plynum">{`${moveNumber}.`}</span>);
        if (blackFirst) {
          parts.push(<span key="nf" className="pv-plynum">{`${moveNumber}…`}</span>);
        }
        parts.push(<span key={`s${i}`}>{san} </span>);
        if ((whiteToMove && i % 2 === 1) || (!whiteToMove && i % 2 === 0)) moveNumber++;
      });
      return parts;
    } catch {
      return line.pvSan.join(' ');
    }
  }, [line.pvSan, fen]);

  return (
    <button className={`engine-row${selected ? ' on' : ''}`} onClick={onSelect} type="button">
      <span className="score">{score}</span>
      <span className="pv-line">{pvText}</span>
      <span className="depth">d{line.depth}</span>
    </button>
  );
}
