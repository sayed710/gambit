# Review UX patch part 2: shared glyphs, MoveList, EvalGraph, CSS
import io, sys

def read(p): return open(p, encoding="utf-8").read()
def write(p, s): open(p, "w", encoding="utf-8", newline="\n").write(s)

# 1. shared glyph map in review.ts
s = read("src/lib/review.ts")
anchor = "/** Classifications that mark a move worth revisiting. */"
add = """/**
 * One source of truth for classification punctuation. The board verdict,
 * the move list and the graph markers all read from here.
 */
export const CLASSIFICATION_GLYPH: Record<MoveClass, string> = {
  brilliant: '!!',
  great: '!',
  best: '\\u2605',
  excellent: '!',
  good: '',
  book: '\\u25a4',
  inaccuracy: '?!',
  mistake: '?',
  miss: '\\u2047',
  blunder: '??',
};

/** Classifications that mark a move worth revisiting. */"""
if "CLASSIFICATION_GLYPH" not in s:
    assert anchor in s
    s = s.replace(anchor, add, 1)
    write("src/lib/review.ts", s)
print("review.ts glyphs: ok")

# 2. Review.tsx uses the shared map
r = read("src/pages/Review.tsx")
r = r.replace(
    "import { criticalMoments, refineGreatMoves, CLASSIFICATION_META, CRITICAL_CLASSES } from '../lib/review';",
    "import { criticalMoments, refineGreatMoves, CLASSIFICATION_META, CLASSIFICATION_GLYPH, CRITICAL_CLASSES } from '../lib/review';")
old_glyph = """const VERDICT_GLYPH: Record<MoveClass, string> = {
  brilliant: '!!',
  great: '!',
  best: '\\u2605',
  excellent: '!',
  good: '',
  book: '\\u25a4',
  inaccuracy: '?!',
  mistake: '?',
  miss: '\\u2047',
  blunder: '??',
};

"""
if old_glyph in r:
    r = r.replace(old_glyph, "")
r = r.replace("const glyph = VERDICT_GLYPH[review.classification];", "const glyph = CLASSIFICATION_GLYPH[review.classification];")
write("src/pages/Review.tsx", r)
print("Review.tsx glyph source: ok")

# 3. MoveList upgrade
m = read("src/components/MoveList.tsx")
m = m.replace("import { CLASSIFICATION_META, CLASSIFICATION_SYMBOL } from '../lib/review';",
              "import { CLASSIFICATION_META, CLASSIFICATION_GLYPH } from '../lib/review';")
m = m.replace("const sym = (cls?: string) => (cls ? CLASSIFICATION_SYMBOL[cls as keyof typeof CLASSIFICATION_SYMBOL] : null);",
              "const sym = (cls?: string) => (cls ? CLASSIFICATION_GLYPH[cls as keyof typeof CLASSIFICATION_GLYPH] : null);")
old_cells = """                <td
                  className={`mv${currentPly === r.wi ? ' current' : ''}${selectable ? ' selectable' : ''}`}
                  onClick={() => onSelect?.(r.wi)}
                >
                  {wMeta && <span className="mv-dot" style={{ background: wMeta.color }} title={wMeta.label} />}
                  {r.white?.san}
                  {wMeta && wSym && <span className="mv-sym">{wSym}</span>}
                </td>
                <td
                  className={`mv${currentPly === r.bi ? ' current' : ''}${selectable ? ' selectable' : ''}`}
                  onClick={() => r.black && onSelect?.(r.bi)}
                >
                  {bMeta && <span className="mv-dot" style={{ background: bMeta.color }} title={bMeta.label} />}
                  {r.black?.san ?? ''}
                  {bMeta && bSym && <span className="mv-sym">{bSym}</span>}
                </td>"""
new_cells = """                <td
                  className={`mv${currentPly === r.wi ? ' current' : ''}${selectable ? ' selectable' : ''}`}
                  onClick={() => onSelect?.(r.wi)}
                  title={wMeta ? `${r.white?.san} \\u2014 ${wMeta.label}` : r.white?.san}
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
                  title={bMeta && r.black ? `${r.black.san} \\u2014 ${bMeta.label}` : r.black?.san}
                  aria-label={bMeta && r.black ? `${r.no}\\u2026 ${r.black.san}, ${bMeta.label}` : undefined}
                >
                  {r.black?.san ?? ''}
                  {bMeta && bSym && (
                    <span className="mv-sym" style={{ color: bMeta.color }}>
                      {bSym}
                    </span>
                  )}
                  {bMeta && !bSym && <span className="mv-dot" style={{ background: bMeta.color }} aria-hidden="true" />}
                </td>"""
assert old_cells in m, "MoveList cells not found"
m = m.replace(old_cells, new_cells)
write("src/components/MoveList.tsx", m)
print("MoveList: ok")

# 4. EvalGraph markers + cursor dot
r = read("src/pages/Review.tsx")
old_markers = """          if (r.classification === 'best' || r.classification === 'excellent' || r.classification === 'good') return null;
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
          );"""
new_markers = """          // restrained markers: mistakes/blunders/inaccuracies/misses stand out,
          // brilliant/great get a smaller quiet positive dot, ordinary moves none
          const positive = r.classification === 'brilliant' || r.classification === 'great';
          if (
            r.classification === 'best' ||
            r.classification === 'excellent' ||
            r.classification === 'good' ||
            r.classification === 'book'
          ) {
            return null;
          }
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={positive ? 2.5 : 4}
              fill={CLASSIFICATION_META[r.classification].color}
              opacity={positive ? 0.8 : 1}
              stroke="var(--surface)"
              strokeWidth={1}
            />
          );"""
assert old_markers in r, "markers not found"
r = r.replace(old_markers, new_markers)

old_cursor = """        {points.length > 1 && (
          <line
            x1={(plyIndex / (points.length - 1)) * w}"""
new_cursor = """        {plyIndex > 0 && points[plyIndex] !== undefined && (
          <circle
            cx={(plyIndex / Math.max(1, points.length - 1)) * w}
            cy={(1 - points[plyIndex]) * h}
            r={5}
            fill="none"
            stroke="var(--ice)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {points.length > 1 && (
          <line
            x1={(plyIndex / (points.length - 1)) * w}"""
assert old_cursor in r, "cursor not found"
r = r.replace(old_cursor, new_cursor, 1)
write("src/pages/Review.tsx", r)
print("EvalGraph: ok")

# 5. CSS
s = read("src/index.css")
anchor = "/* ---------- review insights + drill ---------- */"
add = """/* ---------- review verdict + board navigation ---------- */
.move-navbar {
  display: flex; align-items: center; gap: 0.35rem; flex-wrap: wrap;
  margin-top: 0.7rem; padding: 0.35rem 0.5rem;
  border: 1px solid var(--border); border-radius: 10px; background: var(--surface);
}
.move-navbar-group { display: flex; align-items: center; gap: 0.15rem; }
.move-navbar .icon-btn {
  width: 2.4rem; height: 2.4rem; font-size: 0.95rem; font-family: var(--mono);
  border: 1px solid var(--border); background: var(--bg-raised);
}
.move-navbar .icon-btn:hover:not(:disabled) { border-color: var(--border-strong); color: var(--ink); }
.move-navbar .icon-btn:disabled { opacity: 0.35; }
.move-position { font-size: 0.85rem; color: var(--ink-soft); padding: 0 0.45rem; font-variant-numeric: tabular-nums; min-width: 5.5ch; text-align: center; }
.move-navbar-sep { width: 1px; height: 1.5rem; background: var(--border); margin: 0 0.35rem; }
.move-critical { white-space: nowrap; padding: 0 0.2rem; }

.verdict-strip {
  display: grid; grid-template-columns: auto auto 1fr; gap: 0.3rem 1rem; align-items: baseline;
  margin-top: 0.7rem; padding: 0.6rem 0.85rem;
  border: 1px solid var(--border); border-left: 3px solid var(--border-strong);
  border-radius: 10px; background: var(--surface);
}
.verdict-move { font-size: 1.05rem; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.verdict-class { font-size: 0.95rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; }
.verdict-glyph { margin-right: 0.3rem; }
.verdict-whose { font-size: 0.72rem; color: var(--muted); text-transform: none; letter-spacing: 0.02em; font-weight: 500; }
.verdict-facts { display: flex; gap: 0.9rem; justify-content: flex-end; align-items: baseline; }
.verdict-loss { color: var(--bad); font-weight: 700; font-size: 0.95rem; }
.verdict-best { color: var(--ice); font-size: 0.85rem; }
.verdict-copy { grid-column: 1 / -1; font-family: var(--serif); font-style: italic; font-size: 0.88rem; color: var(--muted); }
@media (max-width: 640px) {
  .verdict-strip { grid-template-columns: 1fr auto; }
  .verdict-facts { grid-column: 1 / -1; justify-content: flex-start; }
}

.mv-sym { font-weight: 800; }

/* ---------- review insights + drill ---------- */"""
assert anchor in s
s = s.replace(anchor, add, 1)
write("src/index.css", s)
print("CSS: ok")
