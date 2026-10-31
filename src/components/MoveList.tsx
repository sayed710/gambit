import { useEffect, useRef } from 'react';
import type { Ply } from '../lib/types';
import { CLASSIFICATION_META, CLASSIFICATION_GLYPH } from '../lib/review';

interface MoveListProps {
  plies: Ply[];
  /** index of the ply currently shown (review mode), null = live */
  currentPly?: number | null;
  onSelect?: (index: number) => void;
  resultLabel?: string | null;
  /** per-ply classification markers (review) */
  markers?: (import('../lib/review').MoveClass | undefined)[];
  maxHeight?: number;
  /** the game's starting position: its fullmove counter seeds the row
   *  numbering (a custom start at fullmove 23 labels its first move 23,
   *  not 1). Omitted = standard start = fullmove 1. */
  startFen?: string;
}

export default function MoveList({ plies, currentPly = null, onSelect, resultLabel, markers, startFen }: MoveListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (currentPly === null && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [plies.length, currentPly]);

  if (plies.length === 0) {
    return (
      <div className="move-list" ref={scrollRef}>
        <div className="empty">Moves will appear here.</div>
      </div>
    );
  }

  const rows: { no: number; white?: Ply; black?: Ply; wi: number; bi: number }[] = [];
  // Rows group a white ply with the black reply. Custom starts may begin
  // with black to move: the first row then holds ONLY black's move, and the
  // move numbering follows the start FEN's real fullmove counter instead of
  // assuming white opened the game at move 1.
  const startFullmove = (() => {
    const n = Number(startFen?.split(' ')[5]);
    return Number.isFinite(n) && n > 0 ? n : 1;
  })();
  let i = 0;
  let no = startFullmove;
  if (plies[0]?.color === 'b') {
    rows.push({ no, white: undefined, black: plies[0], wi: -1, bi: 0 });
    no += 1;
    i = 1;
  }
  for (; i < plies.length; i += 2) {
    rows.push({ no, white: plies[i], black: plies[i + 1], wi: i, bi: i + 1 });
    no += 1;
  }
  const selectable = typeof onSelect === 'function';

  return (
    <div className="move-list" ref={scrollRef}>
      <table>
        <tbody>
          {rows.map((r) => {
            const meta = (cls?: string) =>
              cls ? (CLASSIFICATION_META as Record<string, { label: string; color: string }>)[cls] : null;
            const wCls = markers?.[r.wi];
            const bCls = markers?.[r.bi];
            const sym = (cls?: string) => (cls ? CLASSIFICATION_GLYPH[cls as keyof typeof CLASSIFICATION_GLYPH] : null);
            const wMeta = meta(wCls);
            const bMeta = bCls ? meta(bCls) : null;
            const wSym = sym(wCls);
            const bSym = sym(bCls);
            return (
              <tr key={`${r.no}-${r.wi}-${r.bi}`}>
                {/* a row holding only BLACK's move (black-to-move custom
                    start) is numbered PGN-style: "23..." not "23." */}
                <td className="mv-no">{r.white === undefined ? `${r.no}...` : `${r.no}.`}</td>
                <td
                  className={`mv${currentPly === r.wi ? ' current' : ''}${selectable && r.white ? ' selectable' : ''}`}
                  onClick={() => r.white && onSelect?.(r.wi)}
                  title={wMeta ? `${r.white?.san} \u2014 ${wMeta.label}` : r.white?.san}
                  aria-label={wMeta ? `${r.no}. ${r.white?.san}, ${wMeta.label}` : undefined}
                >
                  {r.white?.san}
                  {wMeta && wSym && (
                    <span className="mv-sym" style={{ color: wMeta.color }}>
                      {wSym}
                    </span>
                  )}
                  {wMeta && !wSym && <span className="mv-dot" style={{ background: wMeta.color }} aria-hidden="true" />}
                </td>
                <td
                  className={`mv${currentPly === r.bi ? ' current' : ''}${selectable ? ' selectable' : ''}`}
                  onClick={() => r.black && onSelect?.(r.bi)}
                  title={bMeta && r.black ? `${r.black.san} \u2014 ${bMeta.label}` : r.black?.san}
                  aria-label={bMeta && r.black ? `${r.no}\u2026 ${r.black.san}, ${bMeta.label}` : undefined}
                >
                  {r.black?.san ?? ''}
                  {bMeta && bSym && (
                    <span className="mv-sym" style={{ color: bMeta.color }}>
                      {bSym}
                    </span>
                  )}
                  {bMeta && !bSym && <span className="mv-dot" style={{ background: bMeta.color }} aria-hidden="true" />}
                </td>
              </tr>
            );
          })}
          {resultLabel && (
            <tr>
              <td colSpan={3} className="result-row">
                {resultLabel}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
