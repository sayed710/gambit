import { loadJSON, saveJSON } from './storage';
import type { GameTreeData } from './gameTree';

/* ============================================================
   repertoireStore — personal opening repertoires, one per
   creation with a fixed side. Versioned schema under
   gambit.repertoire.v1 with defensive loading.
   ============================================================ */

export const REPERTOIRE_KEY = 'repertoire.v1'; // storage layer adds the gambit. prefix

export interface RepLine {
  id: string;
  name: string;
  tree: GameTreeData;
  /** parent node id -> preferred child node id */
  preferred: Record<string, string>;
}

export interface Repertoire {
  id: string;
  name: string;
  side: 'w' | 'b';
  createdAt: number;
  updatedAt: number;
  lines: RepLine[];
}

export function uid(prefix = 'r'): string {
  const n = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${n}`;
}

export function createRepertoire(name: string, side: 'w' | 'b'): Repertoire {
  const now = Date.now();
  return {
    id: uid(),
    name: name.trim() || 'Untitled repertoire',
    side,
    createdAt: now,
    updatedAt: now,
    lines: [{ id: uid('l'), name: 'Main line', tree: { startFen: START, moves: [] }, preferred: {} }],
  };
}

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const ROOT_KEY = '__root__';

export function markPreferred(line: RepLine, parentId: string | null, on: boolean): void {
  const key = parentId ?? ROOT_KEY;
  if (!on) {
    delete line.preferred[key];
    return;
  }
  const siblings = parentId ? findIn(line.tree, parentId)?.children : line.tree.moves;
  if (siblings && siblings.length > 0) {
    line.preferred[key] = siblings[0].id;
  }
}

export function setPreferredChild(line: RepLine, parentId: string | null, childId: string): void {
  const key = parentId ?? ROOT_KEY;
  const siblings = parentId ? findIn(line.tree, parentId)?.children : line.tree.moves;
  if (siblings && siblings.some((c) => c.id === childId)) {
    line.preferred[key] = childId;
  }
}

function findIn(tree: GameTreeData, id: string) {
  const stack = [...tree.moves];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.id === id) return n;
    stack.push(...n.children);
  }
  return null;
}

export function normalizeRepertoireList(raw: unknown): Repertoire[] {
  if (!Array.isArray(raw)) return [];
  const out: Repertoire[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Partial<Repertoire>;
    if (typeof r.id !== 'string' || typeof r.name !== 'string') continue;
    const side = r.side === 'b' ? 'b' : 'w';
    const lines = Array.isArray(r.lines)
      ? r.lines
          .filter((l): l is RepLine => !!l && typeof l === 'object' && typeof (l as RepLine).id === 'string')
          .map((l) => ({
            id: l.id,
            name: typeof l.name === 'string' ? l.name : 'Line',
            tree:
              l.tree && typeof l.tree === 'object' && Array.isArray((l.tree as GameTreeData).moves)
                ? l.tree
                : { startFen: START, moves: [] },
            preferred: l.preferred && typeof l.preferred === 'object' ? l.preferred : {},
          }))
      : [];
    out.push({
      id: r.id,
      name: r.name,
      side,
      createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
      updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
      lines: lines.length ? lines : [{ id: uid('l'), name: 'Main line', tree: { startFen: START, moves: [] }, preferred: {} }],
    });
  }
  return out;
}

export function loadRepertoires(): Repertoire[] {
  return normalizeRepertoireList(loadJSON<unknown>(REPERTOIRE_KEY, []));
}

export function saveRepertoires(list: Repertoire[]): void {
  saveJSON(REPERTOIRE_KEY, list);
}
