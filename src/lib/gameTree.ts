import { Chess } from 'chess.js';
import type { Color, Square } from 'chess.js';
import { START_FEN } from './chessUtils';

/* ============================================================
   gameTree — a real variation tree for analysis, studies and
   repertoire. chess.js 1.4 silently drops variations when
   loading PGN, so the PGN reader/writer live here.

   children[0] of any node is the mainline continuation; the
   remaining children are alternative variations of the same
   position. Every node stores the position before its move so
   variations can be applied and replayed independently.
   ============================================================ */

export interface TreeNode {
  id: string;
  san: string;
  from: Square;
  to: Square;
  promotion?: 'q' | 'r' | 'b' | 'n';
  fenBefore: string;
  fenAfter: string;
  moveNumber: number;
  color: Color;
  comment?: string;
  /** glyph annotations: !! ! !? ?! ? ?? */
  nags: string[];
  children: TreeNode[];
}

export interface GameTreeData {
  startFen: string;
  moves: TreeNode[];
}

export type TreeHeaders = Record<string, string>;

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `n${idCounter}`;
}

function numberAt(fen: string): number {
  const fullmove = Number(fen.split(' ')[5]);
  return Number.isFinite(fullmove) && fullmove > 0 ? fullmove : 1;
}

export function createTree(startFen: string = START_FEN): GameTreeData {
  return { startFen, moves: [] };
}

/* ---------- operations ---------- */

export type ApplyResult = { ok: true; id: string; created: boolean } | { ok: false };

/** Apply a SAN move in the position after `parentId` (null = start). Dedupes among siblings. */
export function applySan(tree: GameTreeData, parentId: string | null, sanInput: string): ApplyResult {
  const siblings = parentId ? findNode(tree, parentId)?.children : tree.moves;
  if (!siblings) return { ok: false };
  const parent = parentId ? findNode(tree, parentId) : null;
  const fenBefore = parent ? parent.fenAfter : tree.startFen;

  const game = new Chess();
  try {
    game.load(fenBefore);
  } catch {
    return { ok: false };
  }
  let move;
  try {
    move = game.move(sanInput);
  } catch {
    return { ok: false };
  }
  if (!move) return { ok: false };

  const existing = siblings.find((c) => c.san === move.san);
  if (existing) return { ok: true, id: existing.id, created: false };

  const node: TreeNode = {
    id: nextId(),
    san: move.san,
    from: move.from as Square,
    to: move.to as Square,
    ...(move.promotion ? { promotion: move.promotion as 'q' | 'r' | 'b' | 'n' } : {}),
    fenBefore,
    fenAfter: game.fen(),
    moveNumber: numberAt(fenBefore),
    color: move.color,
    nags: [],
    children: [],
  };
  siblings.push(node);
  return { ok: true, id: node.id, created: true };
}

export function findNode(tree: GameTreeData, id: string): TreeNode | null {
  const stack = [...tree.moves];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    stack.push(...n.children);
  }
  return null;
}

export function parentOf(tree: GameTreeData, id: string): TreeNode | null {
  const stack = [...tree.moves];
  while (stack.length) {
    const n = stack.pop()!;
    for (const c of n.children) {
      if (c.id === id) return n;
      stack.push(c);
    }
  }
  return null;
}

/** Nodes on the path from root to `id`, inclusive. */
export function lineTo(tree: GameTreeData, id: string): TreeNode[] {
  const path: TreeNode[] | null = (function dfs(nodes: TreeNode[], acc: TreeNode[]): TreeNode[] | null {
    for (const n of nodes) {
      const next = [...acc, n];
      if (n.id === id) return next;
      const deep = dfs(n.children, next);
      if (deep) return deep;
    }
    return null;
  })(tree.moves, []);
  return path ?? [];
}

export function mainline(tree: GameTreeData): TreeNode[] {
  const out: TreeNode[] = [];
  let level = tree.moves;
  while (level.length) {
    out.push(level[0]);
    level = level[0].children;
  }
  return out;
}

/** Swap a node one slot toward mainline among its siblings. */
export function promote(tree: GameTreeData, id: string): boolean {
  const siblings = parentOf(tree, id)?.children ?? tree.moves;
  const i = siblings.findIndex((n) => n.id === id);
  if (i <= 0) return false;
  [siblings[i - 1], siblings[i]] = [siblings[i], siblings[i - 1]];
  return true;
}

export function deleteMove(tree: GameTreeData, id: string): boolean {
  const siblings = parentOf(tree, id)?.children ?? tree.moves;
  const i = siblings.findIndex((n) => n.id === id);
  if (i === -1) return false;
  siblings.splice(i, 1);
  return true;
}

export function setComment(tree: GameTreeData, id: string, comment: string): void {
  const n = findNode(tree, id);
  if (n) n.comment = comment.trim() || undefined;
}

export function toggleNag(tree: GameTreeData, id: string, nag: string): void {
  const n = findNode(tree, id);
  if (!n) return;
  n.nags = n.nags.includes(nag) ? n.nags.filter((g) => g !== nag) : [...n.nags, nag];
}

export function countNodes(tree: GameTreeData): number {
  let c = 0;
  const stack = [...tree.moves];
  while (stack.length) {
    const n = stack.pop()!;
    c += 1;
    stack.push(...n.children);
  }
  return c;
}

/* ---------- structural equality (tests + save diffing) ---------- */

export function treeKey(tree: GameTreeData): string {
  const enc = (nodes: TreeNode[]): unknown =>
    nodes.map((n) => [n.san, n.nags, n.comment ?? '', enc(n.children)]);
  return JSON.stringify([tree.startFen, enc(tree.moves)]);
}

/* ---------- PGN import ---------- */

const NAG_GLYPHS: Record<number, string> = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };

type Token = { type: 'move' | 'number' | 'comment' | 'nag' | 'paren-start' | 'paren-end' | 'result'; value: string };

function tokenize(body: string): Token[] {
  const tokens: Token[] = [];
  let rest = body;
  const moveRe =
    /^(O-O-O|O-O|0-0-0|0-0|[NBRQK][a-h]?[1-8]?x?[a-h][1-8](?:=[NBRQ])?|[a-h][1-8](?:=[NBRQ])?|[a-h]x[a-h][1-8](?:=[NBRQ])?)([+#])?([!?]{1,2})?/;

  while (rest.length) {
    rest = rest.replace(/^\s+/, '');
    if (!rest.length) break;
    const ch = rest[0];
    if (ch === '{') {
      const end = rest.indexOf('}');
      if (end === -1) break;
      tokens.push({ type: 'comment', value: rest.slice(1, end).trim() });
      rest = rest.slice(end + 1);
      continue;
    }
    if (ch === ';') {
      const end = rest.indexOf('\n');
      rest = end === -1 ? '' : rest.slice(end + 1);
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'paren-start', value: '(' });
      rest = rest.slice(1);
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'paren-end', value: ')' });
      rest = rest.slice(1);
      continue;
    }
    if (ch === '$') {
      const m = rest.match(/^\$(\d+)/);
      if (m) {
        tokens.push({ type: 'nag', value: NAG_GLYPHS[Number(m[1])] ?? '' });
        rest = rest.slice(m[0].length);
        continue;
      }
    }
    if (ch === '[') {
      const end = rest.indexOf(']');
      rest = end === -1 ? '' : rest.slice(end + 1);
      continue;
    }
    const result = rest.match(/^(1-0|0-1|1\/2-1\/2|\*)/);
    if (result) {
      tokens.push({ type: 'result', value: result[1] });
      rest = rest.slice(result[1].length);
      continue;
    }
    const num = rest.match(/^\d+\.(\.\.)?/);
    if (num) {
      rest = rest.slice(num[0].length);
      continue;
    }
    const mv = rest.match(moveRe);
    if (mv) {
      tokens.push({ type: 'move', value: mv[1] + (mv[2] ?? '') });
      rest = rest.slice(mv[0].length);
      if (mv[3]) tokens.push({ type: 'nag', value: mv[3] });
      continue;
    }
    rest = rest.slice(1); // unknown char — guarantee progress
  }
  return tokens.filter((t) => t.type !== 'nag' || t.value !== '');
}

/**
 * Parse the first game of a PGN into a variation tree.
 * A `(` block following a move holds alternatives to that move —
 * i.e. siblings applied at the move's parent position.
 */
export function fromPgn(pgn: string): { tree: GameTreeData; headers: TreeHeaders } {
  const headers: TreeHeaders = {};
  const headerRe = /\[(\w+)\s+"([^"]*)"\]/g;
  for (const m of pgn.matchAll(headerRe)) headers[m[1]] = m[2];

  const tokens = tokenize(pgn.replace(headerRe, ' '));
  const startFen = headers.FEN && isValidFen(headers.FEN) ? headers.FEN : START_FEN;
  const tree = createTree(startFen);

  const state = { i: 0 };
  const attach = (node: TreeNode, nags: string[], comment?: string) => {
    if (nags.length) node.nags = nags;
    if (comment) node.comment = comment;
  };

  function parseLevel(currentParent: string | null, lastParent: string | null): void {
    while (state.i < tokens.length) {
      const t = tokens[state.i];
      if (t.type === 'paren-end') {
        state.i += 1;
        return;
      }
      if (t.type === 'number' || t.type === 'result') {
        state.i += 1;
        continue;
      }
      if (t.type === 'paren-start') {
        // variations of the move just parsed: replay at its parent
        state.i += 1;
        parseLevel(lastParent, lastParent);
        continue;
      }
      if (t.type === 'move') {
        state.i += 1;
        const nags: string[] = [];
        let comment: string | undefined;
        while (state.i < tokens.length && (tokens[state.i].type === 'nag' || tokens[state.i].type === 'comment')) {
          if (tokens[state.i].type === 'nag') nags.push(tokens[state.i].value);
          else comment = tokens[state.i].value;
          state.i += 1;
        }
        const r = applySan(tree, currentParent, t.value);
        if (r.ok) {
          attach(findNode(tree, r.id)!, nags, comment);
          lastParent = currentParent;
          currentParent = r.id;
        }
        continue;
      }
      state.i += 1;
    }
  }

  parseLevel(null, null);
  return { tree, headers };
}

function isValidFen(fen: string): boolean {
  try {
    new Chess().load(fen);
    return true;
  } catch {
    return false;
  }
}

/* ---------- PGN export ---------- */

export function toPgn(tree: GameTreeData, headers: TreeHeaders = {}): string {
  const custom = tree.startFen !== START_FEN;
  const h: TreeHeaders = {
    Event: '?',
    Site: 'Gambit (local)',
    Date: '????.??.??',
    Round: '?',
    White: '?',
    Black: '?',
    Result: '*',
    ...headers,
  };
  if (custom) {
    h.FEN = tree.startFen;
    h.SetUp = '1';
  }
  const headerLines = Object.entries(h)
    .map(([k, v]) => `[${k} "${v}"]`)
    .join('\n');
  const startBlack = tree.startFen.split(' ')[1] === 'b';
  const moveText = emitLevel(tree.moves, numberAt(tree.startFen), startBlack, true);
  return `${headerLines}\n\n${moveText} ${h.Result ?? '*'}`.replace(/\s+/g, ' ').replace(' ]', ']');
}

/**
 * Emit one position's alternatives: siblings[0] continues the line,
 * siblings[1..] become `( ... )` variations at the same position.
 */
function emitLevel(siblings: TreeNode[], number: number, blackToMove: boolean, lineStart: boolean): string {
  if (!siblings.length) return '';
  const main = siblings[0];
  const parts: string[] = [];

  // move-number token: white moves always carry one; black moves only at a line start
  if (main.color === 'w') parts.push(`${number}.`);
  else if (lineStart && blackToMove) parts.push(`${number}...`);

  parts.push(main.san + main.nags.join(''));
  if (main.comment) parts.push(`{${main.comment}}`);

  for (const alt of siblings.slice(1)) {
    parts.push(`(${emitLevel([alt], number, main.color === 'w', true)})`);
  }

  if (main.children.length) {
    const nextNumber = main.color === 'b' ? number + 1 : number;
    parts.push(emitLevel(main.children, nextNumber, false, false));
  }
  return parts.join(' ');
}
