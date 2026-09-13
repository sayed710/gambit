import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Square } from 'chess.js';
import GameBoard from '../components/GameBoard';
import { playSound } from '../lib/sound';
import { useToast } from '../components/Toast';
import { copyText } from '../lib/pgn';
import {
  availableCastling,
  buildFen,
  placementFromFen,
  startingPlacement,
  validatePosition,
  type PiecePlacement,
  type PieceType,
} from '../lib/positionEditor';

type Tool = { kind: 'place'; c: 'w' | 'b'; t: PieceType } | { kind: 'erase' } | { kind: 'move' };

const PALETTE: { c: 'w' | 'b'; t: PieceType; label: string }[] = [
  { c: 'w', t: 'k', label: 'King' },
  { c: 'w', t: 'q', label: 'Queen' },
  { c: 'w', t: 'r', label: 'Rook' },
  { c: 'w', t: 'b', label: 'Bishop' },
  { c: 'w', t: 'n', label: 'Knight' },
  { c: 'w', t: 'p', label: 'Pawn' },
  { c: 'b', t: 'k', label: 'King' },
  { c: 'b', t: 'q', label: 'Queen' },
  { c: 'b', t: 'r', label: 'Rook' },
  { c: 'b', t: 'b', label: 'Bishop' },
  { c: 'b', t: 'n', label: 'Knight' },
  { c: 'b', t: 'p', label: 'Pawn' },
];

export default function Editor() {
  const { toast } = useToast();
  const [placement, setPlacement] = useState<PiecePlacement>(() => startingPlacement());
  const [turn, setTurn] = useState<'w' | 'b'>('w');
  const [castling, setCastling] = useState({ K: true, Q: true, k: true, q: true });
  const [ep, setEp] = useState('-');
  const [tool, setTool] = useState<Tool>({ kind: 'place', c: 'w', t: 'p' });
  const [fenInput, setFenInput] = useState('');
  const [fenError, setFenError] = useState<string | null>(null);

  const rawFen = useMemo(() => buildFen(placement, turn, castling, ep), [placement, turn, castling, ep]);
  const validation = useMemo(() => validatePosition(rawFen), [rawFen]);
  const fen = validation.ok ? validation.fen : rawFen;
  const legal = validation.ok;

  const permittedCastling = useMemo(() => availableCastling(placement), [placement]);
  const toggleCastling = (side: keyof typeof castling) => {
    if (!permittedCastling[side]) return;
    setCastling((c) => ({ ...c, [side]: !c[side] }));
  };

  const place = useCallback(
    (sq: Square) => {
      setPlacement((prev) => {
        const next = { ...prev };
        if (tool.kind === 'erase') {
          delete next[sq];
          return next;
        }
        if (tool.kind !== 'place') return prev;
        if (tool.t === 'p' && (sq.endsWith('8') || sq.endsWith('1'))) {
          return prev; // pawns can never stand on the back ranks
        }
        next[sq] = { c: tool.c, t: tool.t };
        return next;
      });
      if (tool.kind !== 'move') playSound('click');
    },
    [tool],
  );

  const handleDrop = useCallback(
    (from: Square, to: Square) => {
      let ok = false;
      setPlacement((prev) => {
        const piece = prev[from];
        if (!piece) return prev;
        ok = true;
        const next = { ...prev };
        delete next[from];
        if (!(piece.t === 'p' && (to.endsWith('8') || to.endsWith('1')))) next[to] = piece;
        return next;
      });
      if (ok) playSound('move');
      return ok;
    },
    [],
  );

  const loadFen = () => {
    const v = validatePosition(fenInput.trim());
    if (!v.ok) {
      setFenError(v.reason);
      return;
    }
    setFenError(null);
    setPlacement(placementFromFen(v.fen));
    const parts = v.fen.split(' ');
    setTurn(parts[1] === 'b' ? 'b' : 'w');
    const c = parts[2];
    setCastling({ K: c.includes('K'), Q: c.includes('Q'), k: c.includes('k'), q: c.includes('q') });
    setEp(parts[3] === '-' ? '-' : parts[3]);
    setFenInput('');
    toast('Position loaded.');
  };

  // plausible targets: rank 6 when white to move, rank 3 when black to move
  const epChoices = useMemo(() => {
    const opts = ['-'];
    for (const f of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) opts.push(`${f}${turn === 'w' ? 6 : 3}`);
    return opts;
  }, [turn]);

  const copy = async () => {
    const ok = await copyText(fen);
    toast(ok ? 'FEN copied.' : `Couldn't copy, select the text instead.`);
  };

  return (
    <div className="page container">
      <div className="page-head">
        <h1>Position editor</h1>
        <p className="sub">
          Build a position piece by piece — then analyse it or play it against Stockfish. Invalid positions are
          refused, never silently accepted.
        </p>
        <nav className="page-tabs mt-2" aria-label="Analysis area">
          <Link to="/analysis">Analysis board</Link>
          <Link to="/editor" className="on">
            Position editor
          </Link>
          <Link to="/studies">Studies</Link>
        </nav>
      </div>

      <div className="editor-layout">
        <div>
          <div className="board-stage">
            <GameBoard
              boardId="editor"
              fen={fen}
              orientation="white"
              movableColor="w"
              dragAnyColor
              onSquareClick={(sq) => place(sq)}
              onDrop={handleDrop}
            />
          </div>
          <div className="board-under">
            <span className="board-hint">
              {tool.kind === 'place'
                ? `Placing ${tool.c === 'w' ? 'white' : 'black'} ${tool.t}`
                : tool.kind === 'erase'
                  ? 'Erasing pieces'
                  : 'Drag pieces to rearrange'}
            </span>
            <span className={`board-hint mono${legal ? '' : ' invalid'}`}>
              {legal ? 'valid position' : fenErrorOrInvalid(validation)}
            </span>
          </div>
        </div>

        <aside className="col" style={{ gap: '0.9rem' }}>
          <div className="panel panel-pad">
            <div className="section-label">Pieces</div>
            <div className="palette-grid">
              {PALETTE.map((p) => {
                const active = tool.kind === 'place' && tool.c === p.c && tool.t === p.t;
                return (
                  <button
                    key={p.c + p.t}
                    type="button"
                    className={`palette-cell${active ? ' on' : ''}`}
                    aria-pressed={active}
                    title={`${p.c === 'w' ? 'White' : 'Black'} ${p.label}`}
                    onClick={() => setTool({ kind: 'place', c: p.c, t: p.t })}
                  >
                    <span className={`pc ${p.c}`}>{GLYPH[p.t]}</span>
                  </button>
                );
              })}
            </div>
            <div className="row mt-1" style={{ gap: '0.4rem' }}>
              <button
                type="button"
                className={`btn btn-ghost btn-sm${tool.kind === 'erase' ? ' tool-on' : ''}`}
                onClick={() => setTool(tool.kind === 'erase' ? { kind: 'move' } : { kind: 'erase' })}
                aria-pressed={tool.kind === 'erase'}
              >
                Erase
              </button>
              <button
                type="button"
                className={`btn btn-ghost btn-sm${tool.kind === 'move' ? ' tool-on' : ''}`}
                onClick={() => setTool({ kind: 'move' })}
                aria-pressed={tool.kind === 'move'}
              >
                Rearrange
              </button>
            </div>
          </div>

          <div className="panel panel-pad">
            <div className="section-label">Rules</div>
            <div className="setup-row">
              <span className="lbl">Side to move</span>
              <div className="seg" role="radiogroup" aria-label="Side to move">
                <button type="button" className={turn === 'w' ? 'on' : ''} onClick={() => setTurn('w')}>
                  White
                </button>
                <button type="button" className={turn === 'b' ? 'on' : ''} onClick={() => setTurn('b')}>
                  Black
                </button>
              </div>
            </div>
            <div className="setup-row mt-2">
              <span className="lbl">Castling rights</span>
              <div className="castling-row">
                {(['K', 'Q', 'k', 'q'] as const).map((side) => (
                  <label key={side} className={`castle-chip${castling[side] ? ' on' : ''}${permittedCastling[side] ? '' : ' off'}`}>
                    <input
                      type="checkbox"
                      checked={castling[side]}
                      disabled={!permittedCastling[side]}
                      onChange={() => toggleCastling(side)}
                    />
                    {side}
                  </label>
                ))}
              </div>
            </div>
            <div className="setup-row mt-2">
              <span className="lbl">En-passant target</span>
              <select className="input" value={ep} onChange={(e) => setEp(e.target.value)}>
                {epChoices.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </div>
            <div className="row mt-2" style={{ gap: '0.4rem' }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPlacement(startingPlacement()); setTurn('w'); setCastling({ K: true, Q: true, k: true, q: true }); setEp('-'); }}>
                Starting position
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPlacement({})}>
                Clear board
              </button>
            </div>
          </div>

          <div className="panel panel-pad col" style={{ gap: '0.7rem' }}>
            <div className="section-label">Position</div>
            <input className="input mono" value={fen} readOnly aria-label="Current FEN" />
            <div className="io-buttons">
              <button type="button" className="btn btn-ghost btn-sm" onClick={copy} disabled={!legal}>
                Copy FEN
              </button>
              <Link className="btn btn-ghost btn-sm" to="/analysis" state={{ fen }} onClick={(e) => !legal && e.preventDefault()} aria-disabled={!legal}>
                Analyse this position
              </Link>
              <Link className="btn btn-accent btn-sm" to="/play" state={{ fen }} onClick={(e) => !legal && e.preventDefault()} aria-disabled={!legal}>
                Play vs engine
              </Link>
            </div>
            <div className="field">
              <label htmlFor="ed-fen">Load position (FEN)</label>
              <input
                id="ed-fen"
                className="input mono"
                placeholder="Paste a FEN and press Load"
                value={fenInput}
                onChange={(e) => setFenInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadFen()}
              />
              {fenError && (
                <span className="small" style={{ color: 'var(--bad)' }}>
                  {fenError}
                </span>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={loadFen} disabled={!fenInput.trim()}>
                Load position
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function fenErrorOrInvalid(validation: ReturnType<typeof validatePosition>): string {
  return validation.ok ? 'valid position' : validation.reason;
}

const GLYPH: Record<PieceType, string> = { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' };
