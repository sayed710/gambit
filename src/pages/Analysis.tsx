import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import GameBoard from '../components/GameBoard';
import EvalBar from '../components/EvalBar';
import MoveList from '../components/MoveList';
import { useEngine } from '../lib/engine/useEngine';
import { importPgn, isValidFen, normalizeFen, copyText } from '../lib/pgn';
import { playSound } from '../lib/sound';
import { useToast } from '../components/Toast';
import { useClickToMove } from '../hooks/useClickToMove';
import { FlipIcon, XIcon } from '../components/Icons';
import type { EvalResult } from '../lib/engine/engine';
import type { SFLine } from '../lib/engine/stockfish';
import { START_FEN } from '../lib/chessUtils';

interface PlyEntry {
  san: string;
  fenAfter: string;
}

const ANALYSIS_DEPTH = 14;
const LINES = 3;

export default function Analysis() {
  const location = useLocation();
  const engine = useEngine();
  const { toast } = useToast();

  const gameRef = useRef(new Chess());
  const [history, setHistory] = useState<PlyEntry[]>([]);
  const [plyIndex, setPlyIndex] = useState(0); // 0 = root position
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [fenInput, setInput] = useState('');
  const [pgnInput, setPgnInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);

  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);
  const [lines, setLines] = useState<SFLine[]>([]);
  const [thinking, setThinking] = useState(false);
  const [selectedLine, setSelectedLine] = useState(0);

  const fen = useMemo(
    () => (plyIndex === 0 ? gameRef.current.fen() : history[plyIndex - 1]?.fenAfter ?? gameRef.current.fen()),
    [plyIndex, history],
  );

  const turn = useMemo(() => {
    try {
      return new Chess(fen).turn();
    } catch {
      return 'w';
    }
  }, [fen]);

  const commitLocal = useCallback(
    (from: Square, to: Square): 'ok' | 'illegal' => {
      try {
        const base = plyIndex === 0 ? new Chess(gameRef.current.fen()) : new Chess(fen);
        const m = base.move({ from, to, promotion: 'q' });
        playSound(m.san.includes('+') ? 'check' : 'move');
        const entry: PlyEntry = { san: m.san, fenAfter: base.fen() };
        const kept = history.slice(0, plyIndex); // moving from an earlier ply truncates the line
        setHistory([...kept, entry]);
        setPlyIndex(kept.length + 1);
        setSelectedLine(0);
        return 'ok';
      } catch {
        return 'illegal';
      }
    },
    [fen, plyIndex, history],
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

  const loadPgnText = useCallback(
    (text: string) => {
      const res = importPgn(text);
      if (!res.ok) {
        toast(res.error.message);
        return;
      }
      const g = new Chess();
      const entries: PlyEntry[] = [];
      for (const san of res.game.moves) {
        try {
          const m = g.move(san);
          entries.push({ san: m.san, fenAfter: g.fen() });
        } catch {
          break;
        }
      }
      gameRef.current = new Chess();
      setHistory(entries);
      setPlyIndex(entries.length);
      setFenError(null);
      toast(`Loaded ${entries.length} moves.`);
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
      gameRef.current = new Chess(normalized);
      setHistory([]);
      setPlyIndex(0);
      toast('Position loaded.');
    },
    [toast],
  );

  const visibleHistory = useMemo(() => history.slice(0, plyIndex), [history, plyIndex]);

  const currentPgn = useMemo(() => {
    const g = new Chess();
    for (const h of visibleHistory) {
      try {
        g.move(h.san);
      } catch {
        break;
      }
    }
    return g.pgn();
  }, [visibleHistory]);

  const listPlies = useMemo(
    () =>
      visibleHistory.map((h, i) => {
        // derive from/to for the list by replaying
        const g = new Chess();
        for (let j = 0; j <= i; j++) {
          try {
            g.move(history[j].san);
          } catch {
            break;
          }
        }
        const last = g.history({ verbose: true }).pop();
        return {
          san: h.san,
          from: (last?.from ?? 'a1') as Square,
          to: (last?.to ?? 'a1') as Square,
          color: 'w' as const,
          fenAfter: h.fenAfter,
          isCapture: false,
          isCheck: h.san.includes('+') || h.san.includes('#'),
        };
      }),
    [visibleHistory, history],
  );

  const evalBarData: EvalResult | null = evalResult;

  const bestArrow = useMemo(() => {
    const line = lines[selectedLine] ?? lines[0];
    if (!line?.san) return [];
    try {
      const g = new Chess(fen);
      const m = g.move(line.pvSan[0]);
      return [{ startSquare: m.from, endSquare: m.to, color: 'rgba(108, 92, 231, 0.85)' }];
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

  return (
    <div className="page container">
      <div className="page-head row between wrap" style={{ gap: '1rem' }}>
        <div>
          <h1>Analysis board</h1>
          <p className="sub">
            Load any position or game, move pieces freely, and read Stockfish’s evaluation, best lines and
            suggestions. Everything runs locally.
          </p>
        </div>
      </div>

      <div className="analysis-layout">
        <div>
          <div className="row" style={{ alignItems: 'stretch', gap: '0.6rem' }}>
            <EvalBar evaluation={evalBarData} thinking={thinking} />
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
                gameRef.current = new Chess();
                setHistory([]);
                setPlyIndex(0);
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
              Moves
              <span className="small muted">
                {plyIndex} / {history.length}
              </span>
            </div>
            {history.length === 0 ? (
              <div className="empty-state">
                <p>No moves yet, play on the board, paste a FEN, or import a PGN.</p>
              </div>
            ) : (
              <MoveList plies={listPlies} currentPly={plyIndex - 1} onSelect={(i) => setPlyIndex(i + 1)} />
            )}
          </div>

          <div className="panel panel-pad col" style={{ gap: '0.75rem' }}>
            <div className="section-label">Import / export</div>
            <div className="io-buttons">
              <button className="btn btn-ghost btn-sm" onClick={() => copy(fen, 'FEN')}>
                Copy FEN
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => copy(currentPgn, 'PGN')}>
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
              <label htmlFor="an-pgn">Game (PGN)</label>
              <textarea
                id="an-pgn"
                className="input"
                rows={4}
                placeholder="1. e4 e5 2. Nf3 …"
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
          </div>
        </aside>
      </div>
    </div>
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
