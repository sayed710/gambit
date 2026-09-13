import { useCallback, useEffect, useMemo, useState } from 'react';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import type { Arrow } from 'react-chessboard';
import GameBoard from './GameBoard';
import { useClickToMove } from '../hooks/useClickToMove';
import { playSound } from '../lib/sound';
import { useToast } from './Toast';
import { copyText } from '../lib/pgn';
import { FlipIcon, XIcon } from './Icons';
import {
  applySan,
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

const NAG_CHOICES = ['!', '!!', '!?', '?!', '?', '??'];

export interface TreeWorkspaceProps {
  tree: GameTreeData;
  currentId: string | null;
  boardId: string;
  onTreeChange: (tree: GameTreeData) => void;
  onNavigate: (id: string | null) => void;
  /** extra content rendered under the import/export panel */
  footer?: React.ReactNode;
  /** content rendered at the top of the side column (e.g. engine lines) */
  asideTop?: React.ReactNode;
  /** content rendered to the left of the board (e.g. evaluation bar) */
  boardLeft?: React.ReactNode;
  arrows?: Arrow[];
}

/**
 * The shared annotated-tree workspace: board + variation tree + move
 * annotations + PGN I/O. Used by the Analysis board and by Studies.
 */
export default function TreeWorkspace({ tree, currentId, boardId, onTreeChange, onNavigate, footer, asideTop, boardLeft, arrows = [] }: TreeWorkspaceProps) {
  const { toast } = useToast();
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [pgnInput, setPgnInput] = useState('');
  const [fenInput, setInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);

  const current = currentId ? findNode(tree, currentId) : null;
  const fen = current ? current.fenAfter : tree.startFen;

  const turn = useMemo(() => {
    try {
      return new Chess(fen).turn();
    } catch {
      return 'w';
    }
  }, [fen]);

  const commitLocal = useCallback(
    (from: Square, to: Square, promotion: 'q' | 'r' | 'b' | 'n' = 'q'): 'ok' | 'illegal' => {
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
      const t: GameTreeData = { ...tree };
      const r = applySan(t, currentId, m.san);
      if (!r.ok) return 'illegal';
      if (r.created) while (promote(t, r.id));
      onTreeChange(t);
      onNavigate(r.id);
      return 'ok';
    },
    [fen, currentId, tree, onTreeChange, onNavigate],
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

  // arrow keys walk the mainline around the current position
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') {
        const node = currentId ? findNode(tree, currentId) : null;
        const next = node ? node.children[0] : tree.moves[0];
        if (next) {
          onNavigate(next.id);
          e.preventDefault();
        }
      } else if (e.key === 'ArrowLeft') {
        const node = currentId ? findNode(tree, currentId) : null;
        if (!node) return;
        const chain = lineTo(tree, node.id);
        onNavigate(chain.length >= 2 ? chain[chain.length - 2].id : null);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tree, currentId, onNavigate]);

  const countAll = (t: GameTreeData): number => {
    let c = 0;
    const stack = [...t.moves];
    while (stack.length) {
      const n = stack.pop()!;
      c += 1;
      stack.push(...n.children);
    }
    return c;
  };

  const mainlineIds = (t: GameTreeData): string[] => {
    const ids: string[] = [];
    let level = t.moves;
    while (level.length) {
      ids.push(level[0].id);
      level = level[0].children;
    }
    return ids;
  };

  const promoteToMainline = (t: GameTreeData, id: string): void => {
    while (promote(t, id));
  };

  const siblingCount = (t: GameTreeData, id: string): number => {
    const node = findNode(t, id);
    if (!node) return 0;
    const chain = lineTo(t, id);
    const parent = chain.length >= 2 ? chain[chain.length - 2] : null;
    return (parent ? parent.children : t.moves).length;
  };

  const annotate = (fn: (t: GameTreeData) => void) => {
    const t: GameTreeData = { ...tree };
    fn(t);
    onTreeChange(t);
  };

  const importPgnText = () => {
    const trimmed = pgnInput.trim();
    if (!trimmed) return;
    const { tree: parsed, headers } = fromPgn(trimmed);
    const n = countAll(parsed);
    if (n === 0) {
      toast('No moves found in that PGN.');
      return;
    }
    onTreeChange(parsed);
    const ml = mainlineIds(parsed);
    onNavigate(ml[ml.length - 1] ?? null);
    setFenError(null);
    void headers;
    toast(`Loaded ${n} moves.`);
  };

  const loadFenText = () => {
    const raw = fenInput.trim();
    const probe = new Chess();
    try {
      probe.load(raw);
    } catch {
      setFenError('That FEN is not a valid position.');
      return;
    }
    setFenError(null);
    onTreeChange({ startFen: raw, moves: [] });
    onNavigate(null);
    toast('Position loaded.');
  };

  const copy = async (text: string, label: string) => {
    const ok = await copyText(text);
    toast(ok ? `${label} copied.` : `Couldn't copy, select the text instead.`);
  };

  const fullPgn = useMemo(() => toPgn(tree, { Event: 'Gambit study' }), [tree]);

  return (
    <div className="workspace-layout">
      <div>
        <div className="row" style={{ alignItems: 'stretch', gap: '0.6rem' }}>
          {boardLeft}
          <div className="grow">
            <GameBoard
              boardId={boardId}
              fen={fen}
              orientation={orientation}
              movableColor={turn}
              onSquareClick={click.onSquareClick}
              selected={click.selected}
              legalTargets={click.legalTargets}
              onDrop={handleDrop}
              arrows={arrows}
            />
          </div>
        </div>
        <div className="board-under">
          <button className="btn btn-ghost btn-sm" onClick={() => setOrientation((o) => (o === 'white' ? 'black' : 'white'))}>
            <FlipIcon /> Flip
          </button>
          <span className="board-hint mono">{turn === 'w' ? 'White' : 'Black'} to move</span>
        </div>
      </div>

      <aside className="col" style={{ gap: '0.9rem' }}>
        {asideTop}
        <div className="panel panel-pad">
          <div className="section-label">
            Moves &amp; variations
            <span className="small muted">{tree.moves.length === 0 ? 'empty' : `${countAll(tree)} nodes`}</span>
          </div>
          {tree.moves.length === 0 ? (
            <div className="empty-state">
              <p>No moves yet — play on the board or import a PGN with variations.</p>
            </div>
          ) : (
            <>
              <div className="tree-view" role="list" aria-label="Move tree">
                <TreeLevel siblings={tree.moves} prev={null} currentId={currentId} onSelect={onNavigate} />
              </div>
              <div className="tree-nav row" style={{ gap: '0.35rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => onNavigate(null)}>
                  ⏮ Start
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (!currentId) return;
                    const chain = lineTo(tree, currentId);
                    onNavigate(chain.length >= 2 ? chain[chain.length - 2].id : null);
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
                    if (next) onNavigate(next.id);
                  }}
                >
                  Forward →
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const ml = mainlineIds(tree);
                    onNavigate(ml[ml.length - 1] ?? null);
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
                        disabled={siblingCount(tree, current.id) < 2}
                      >
                        Promote
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          annotate((t) => deleteMove(t, current.id));
                          onNavigate(null);
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
            <label htmlFor={`${boardId}-pgn`}>Game (PGN — variations preserved)</label>
            <textarea
              id={`${boardId}-pgn`}
              className="input"
              rows={4}
              placeholder={'1. e4 e5 (1... c5 2. Nf3) 2. Nf3 Nc6 …'}
              value={pgnInput}
              onChange={(e) => setPgnInput(e.target.value)}
            />
            <div className="row" style={{ gap: '0.4rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={importPgnText} disabled={!pgnInput.trim()}>
                Import game
              </button>
              {pgnInput.trim() && (
                <button className="btn btn-ghost btn-sm" onClick={() => setPgnInput('')} aria-label="Clear PGN">
                  <XIcon /> Clear
                </button>
              )}
            </div>
          </div>
          <div className="field">
            <label htmlFor={`${boardId}-fen`}>Replace with position (FEN)</label>
            <input
              id={`${boardId}-fen`}
              className="input mono"
              placeholder="Paste a FEN to start a fresh line"
              value={fenInput}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && loadFenText()}
            />
            {fenError && (
              <span className="small" style={{ color: 'var(--bad)' }}>
                {fenError}
              </span>
            )}
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            ← → walk the mainline around the current move. Newly played moves become the main line of their position.
          </p>
          {footer}
        </div>
      </aside>
    </div>
  );
}

/* ---------- tree rendering (shared) ---------- */

export function TreeLevel({
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
