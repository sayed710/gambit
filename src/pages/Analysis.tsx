import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Chess } from 'chess.js';
import EvalBar from '../components/EvalBar';
import TreeWorkspace from '../components/TreeWorkspace';
import { useEngine } from '../lib/engine/useEngine';
import { useToast } from '../components/Toast';
import { fromPgn, createTree, type GameTreeData } from '../lib/gameTree';
import { normalizeFen } from '../lib/pgn';
import type { EvalResult } from '../lib/engine/engine';
import type { SFLine } from '../lib/engine/stockfish';

const ANALYSIS_DEPTH = 14;
const LINES = 3;

export default function Analysis() {
  const location = useLocation();
  const engine = useEngine();
  const { toast } = useToast();

  const [tree, setTree] = useState<GameTreeData>(() => createTree());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [lines, setLines] = useState<SFLine[]>([]);
  const [thinking, setThinking] = useState(false);
  const [selectedLine, setSelectedLine] = useState(0);

  const current = currentId ? findNodeLocal(tree, currentId) : null;
  const fen = current ? current.fenAfter : tree.startFen;

  // imports passed from other pages (Opera-game deep link, Position Editor)
  useEffect(() => {
    const state = location.state as { pgn?: string; fen?: string } | null;
    if (state?.pgn) {
      const { tree: parsed } = fromPgn(state.pgn);
      const count = countAll(parsed);
      if (count > 0) {
        setTree(parsed);
        const ids = mainlineIds(parsed);
        setCurrentId(ids[ids.length - 1] ?? null);
        toast(`Loaded ${count} moves.`);
      }
    } else if (state?.fen) {
      const normalized = normalizeFen(state.fen);
      if (normalized) {
        setTree(createTree(normalized));
        setCurrentId(null);
        toast('Position loaded.');
      }
    }
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

  const enginePanel = (
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
        <div className="row" style={{ gap: '0.45rem' }}>
          <Link className="btn btn-ghost btn-sm" to="/editor">
            Position editor
          </Link>
          <Link className="btn btn-ghost btn-sm" to="/studies">
            Studies
          </Link>
        </div>
      </div>

      <TreeWorkspace
        tree={tree}
        currentId={currentId}
        boardId="analysis"
        onTreeChange={setTree}
        onNavigate={setCurrentId}
        arrows={bestArrow}
        boardLeft={<EvalBar evaluation={evalResult} thinking={thinking} />}
        asideTop={enginePanel}
      />
    </div>
  );
}

/* ---------- helpers ---------- */

function findNodeLocal(tree: GameTreeData, id: string) {
  const stack = [...tree.moves];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    stack.push(...n.children);
  }
  return null;
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
