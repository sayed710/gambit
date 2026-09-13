import { loadJSON, saveJSON } from './storage';
import type { GameTreeData } from './gameTree';

/* ============================================================
   studyStore — local chess studies. Versioned schema under
   gambit.studies.v1; loadStudies is defensive so a corrupt or
   older payload degrades instead of breaking the app.
   ============================================================ */

export const STUDIES_KEY = 'studies.v1'; // storage layer adds the gambit. prefix

export interface StudyChapter {
  id: string;
  name: string;
  tree: GameTreeData;
}

export interface Study {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  chapters: StudyChapter[];
}

let seq = 0;
export function uid(prefix = 's'): string {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

export function createStudy(title: string): Study {
  const now = Date.now();
  return {
    id: uid(),
    title: title.trim() || 'Untitled study',
    createdAt: now,
    updatedAt: now,
    chapters: [{ id: uid('c'), name: 'Chapter 1', tree: { startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [] } }],
  };
}

export function createChapter(study: Study, name?: string): StudyChapter {
  const chapter: StudyChapter = {
    id: uid('c'),
    name: uniqueChapterName(study, name?.trim() || `Chapter ${study.chapters.length + 1}`),
    tree: { startFen: study.chapters[0]?.tree.startFen ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [] },
  };
  study.chapters.push(chapter);
  return chapter;
}

function uniqueChapterName(study: Study, base: string): string {
  if (!study.chapters.some((c) => c.name === base)) return base;
  let n = 2;
  while (study.chapters.some((c) => c.name === `${base} (${n})`)) n += 1;
  return `${base} (${n})`;
}

export function duplicateChapter(study: Study, chapterId: string): Study | null {
  const i = study.chapters.findIndex((c) => c.id === chapterId);
  if (i === -1) return null;
  const src = study.chapters[i];
  const copy: StudyChapter = JSON.parse(JSON.stringify(src));
  copy.id = uid('c');
  copy.name = uniqueChapterName(study, `${src.name} copy`);
  study.chapters.splice(i + 1, 0, copy);
  return study;
}

export function normalizeStudyList(raw: unknown): Study[] {
  if (!Array.isArray(raw)) return [];
  const out: Study[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Partial<Study>;
    if (typeof s.id !== 'string' || typeof s.title !== 'string') continue;
    const chapters = Array.isArray(s.chapters)
      ? s.chapters
          .filter((c): c is StudyChapter => !!c && typeof c === 'object' && typeof (c as StudyChapter).id === 'string')
          .map((c) => ({
            id: c.id,
            name: typeof c.name === 'string' ? c.name : 'Chapter',
            tree:
              c.tree && typeof c.tree === 'object' && Array.isArray((c.tree as GameTreeData).moves)
                ? c.tree
                : { startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [] },
          }))
      : [];
    out.push({
      id: s.id,
      title: s.title,
      createdAt: typeof s.createdAt === 'number' ? s.createdAt : 0,
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
      chapters: chapters.length ? chapters : [{ id: uid('c'), name: 'Chapter 1', tree: { startFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', moves: [] } }],
    });
  }
  return out;
}

export function loadStudies(): Study[] {
  return normalizeStudyList(loadJSON<unknown>(STUDIES_KEY, []));
}

export function saveStudies(list: Study[]): void {
  saveJSON(STUDIES_KEY, list);
}

export function exportStudyJson(study: Study): string {
  return JSON.stringify(study, null, 2);
}
