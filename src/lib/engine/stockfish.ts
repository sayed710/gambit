import { Chess } from 'chess.js';
import type { Level } from './engine';
import {
  resolveEngineChoice,
  personaSeed,
  CLASSIC_WEIGHTS,
  type EnginePersonaId,
  type PersonaCandidate,
  type SelectionResult,
  type ClassicLevel,
} from './personas';

/**
 * Stockfish 18 (lite, single-threaded WASM) running as a raw UCI worker.
 * UCI is strictly sequential, so every search is funneled through one queue.
 * If the worker fails to load, callers fall back to the bundled local engine.
 */

export interface SFLine {
  multipv: number;
  cp: number | null;
  mate: number | null;
  depth: number;
  /** root move in UCI, e.g. "e2e4" or "e7e8q" — from the engine's actual PV */
  uci: string | null;
  san: string | null;
  pvSan: string[];
}

export interface SFSearchResult {
  /** chosen move in UCI, e.g. "e2e4" or "e7e8q" */
  bestmove: string | null;
  /** score in centipawns, side-to-move perspective */
  cp: number | null;
  /** mate distance, side-to-move perspective (positive = side to move mates) */
  mate: number | null;
  depth: number;
  /** chosen move converted to SAN, when legal */
  san: string | null;
  /** engine's best line in SAN (up to a few plies) */
  pvSan: string[];
  /** all collected lines, sorted by MultiPV rank (length 1 unless MultiPV was requested) */
  lines: SFLine[];
}

const ENGINE_PATH = '/stockfish/stockfish-18-lite-single.js';
const INIT_TIMEOUT_MS = 15_000;

let worker: Worker | null = null;
let initPromise: Promise<Worker> | null = null;
let crashed = false;
let queue: Promise<unknown> = Promise.resolve();

const listeners = new Set<(line: string) => void>();

function handleLine(raw: string) {
  const lines = String(raw).split('\n');
  for (const line of lines) listeners.forEach((fn) => fn(line.trim()));
}

function getWorker(): Promise<Worker> {
  if (crashed) return Promise.reject(new Error('stockfish crashed'));
  if (!initPromise) {
    initPromise = new Promise<Worker>((resolve, reject) => {
      let settled = false;
      const w = new Worker(ENGINE_PATH);
      const timer = window.setTimeout(() => {
        if (!settled) {
          crashed = true;
          w.terminate();
          reject(new Error('stockfish init timeout'));
        }
      }, INIT_TIMEOUT_MS);

      const onMessage = (e: MessageEvent) => {
        const text = typeof e.data === 'string' ? e.data : (e.data?.line as string | undefined);
        if (!text) return;
        if (!settled && text.includes('uciok')) {
          settled = true;
          window.clearTimeout(timer);
          resolve(w);
        }
        handleLine(text);
      };
      w.addEventListener('message', onMessage);
      w.addEventListener('error', () => {
        crashed = true;
        window.clearTimeout(timer);
        listeners.clear();
        if (!settled) {
          settled = true;
          reject(new Error('stockfish failed to load'));
        }
      });
      w.postMessage('uci');
    }).then((w) => {
      worker = w;
      return w;
    });
  }
  return initPromise;
}

function send(cmd: string) {
  worker?.postMessage(cmd);
}

/** Serialize access to the engine: UCI forbids interleaved searches. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function waitFor(marker: (line: string) => boolean, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const fn = (line: string) => {
      if (marker(line)) {
        listeners.delete(fn);
        window.clearTimeout(timer);
        resolve(line);
      }
    };
    const timer = window.setTimeout(() => {
      listeners.delete(fn);
      reject(new Error('stockfish timeout'));
    }, timeoutMs);
    listeners.add(fn);
  });
}

async function ready(): Promise<void> {
  await getWorker();
  send('isready');
  await waitFor((l) => l === 'readyok', 8000);
}

/** Levels map to UCI skill + depth/movetime budgets; low levels sample from MultiPV. */
export const SF_LEVELS: Record<Level, { skill: number; depth: number; movetime: number; multipv: number; weights: number[] }> = {
  1: { skill: 0, depth: 1, movetime: 200, multipv: 3, weights: [0.55, 0.3, 0.15] },
  2: { skill: 2, depth: 4, movetime: 450, multipv: 3, weights: [0.72, 0.18, 0.1] },
  3: { skill: 10, depth: 8, movetime: 900, multipv: 1, weights: [1] },
  4: { skill: 20, depth: 12, movetime: 1600, multipv: 1, weights: [1] },
};

function uciToSan(fen: string, uci: string): string | null {
  if (!uci || uci.length < 4) return null;
  try {
    const g = new Chess(fen);
    const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
    return m.san;
  } catch {
    return null;
  }
}

function pvToSan(fen: string, pv: string[], max = 4): string[] {
  const g = new Chess(fen);
  const out: string[] = [];
  for (const uci of pv.slice(0, max)) {
    try {
      const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
      out.push(m.san);
    } catch {
      break;
    }
  }
  return out;
}

function pickWeighted<T>(items: T[], weights: number[]): T {
  const roll = Math.random();
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += weights[i] ?? 0;
    if (roll <= acc) return items[i];
  }
  return items[items.length - 1];
}


/**
 * PURE: map (final info lines + engine bestmove + personality selection)
 * to the SFSearchResult. Integration contract:
 * - a chosen candidate attaches ONLY its own cp/mate/depth/PV;
 * - an unlisted legal bestmove (candidate null) keeps its move + SAN with
 *   null/unknown score metadata — never MultiPV #1's numbers;
 * - no legal selected UCI and no legal bestmove => null (safe failure;
 *   callers fall back to the bundled engine).
 */
export function composeSearchResult(
  fen: string,
  infos: InfoLine[],
  bestmoveUci: string | null,
  choice: SelectionResult | null,
  ctx: { useMulti: boolean; fullStrength: boolean; level: ClassicLevel },
): SFSearchResult | null {
  const lines: SFLine[] = infos.map((info) => ({
    multipv: info.multipv,
    cp: info.cp,
    mate: info.mate,
    depth: info.depth,
    uci: info.pv[0] ?? null,
    san: pvToSan(fen, info.pv.slice(0, 1))[0] ?? null,
    pvSan: pvToSan(fen, info.pv, 10),
  }));

  let chosenUci: string | null = bestmoveUci;
  let chosen: InfoLine | null = infos.find((i) => i.pv[0] === bestmoveUci) ?? null;
  let unknownMeta = false;

  if (choice) {
    if (choice.uci) {
      chosenUci = choice.uci;
      if (choice.candidate) {
        const info = infos.find((i) => i.pv[0] === choice.candidate!.uci) ?? null;
        if (info) chosen = info;
        else unknownMeta = true; // candidate verified but its info vanished
      } else {
        unknownMeta = true; // unlisted legal bestmove: NO verified metadata
      }
    } else {
      // selector found nothing usable; keep the engine bestmove, but if even
      // that has no legal SAN the caller must fail over to the legacy engine
      const san = bestmoveUci ? uciToSan(fen, bestmoveUci) : null;
      if (!san) return null;
      unknownMeta = true;
      chosenUci = bestmoveUci;
    }
  } else if (ctx.useMulti && infos.length > 1 && !ctx.fullStrength) {
    const pick = pickWeighted(infos, CLASSIC_WEIGHTS[ctx.level]);
    if (pick && pick.pv[0]) {
      chosenUci = pick.pv[0];
      chosen = pick;
    }
  }

  const san = chosenUci ? uciToSan(fen, chosenUci) : null;
  if (!chosenUci || !san) return null; // safe failure — never propagate a malformed move

  return {
    bestmove: chosenUci,
    // unlisted/unknown metadata stays null/0 — MultiPV #1 numbers never leak
    cp: unknownMeta ? null : (chosen?.cp ?? null),
    mate: unknownMeta ? null : (chosen?.mate ?? null),
    depth: unknownMeta ? 0 : (chosen?.depth ?? 0),
    san,
    pvSan: unknownMeta ? [] : chosen ? pvToSan(fen, chosen.pv) : [],
    lines,
  };
}

interface InfoLine {
  cp: number | null;
  mate: number | null;
  depth: number;
  multipv: number;
  pv: string[];
  /** true when the score was a UCI lowerbound/upperbound — not comparable */
  bounded: boolean;
}

function parseInfo(line: string): InfoLine | null {
  if (!line.startsWith('info') || !line.includes(' pv ')) return null;
  const depthMatch = line.match(/ depth (\d+)/);
  const cpMatch = line.match(/score cp (-?\d+)/);
  const mateMatch = line.match(/score mate (-?\d+)/);
  const mpvMatch = line.match(/multipv (\d+)/);
  const pv = line.split(' pv ')[1]?.trim().split(/\s+/) ?? [];
  // UCI bounded scores: 'score cp X lowerbound/upperbound' are NOT precise
  // evaluations — they must never be compared as centipawns
  const bounded = line.includes(' lowerbound') || line.includes(' upperbound');
  return {
    cp: cpMatch ? parseInt(cpMatch[1], 10) : null,
    mate: mateMatch ? parseInt(mateMatch[1], 10) : null,
    depth: depthMatch ? parseInt(depthMatch[1], 10) : 0,
    multipv: mpvMatch ? parseInt(mpvMatch[1], 10) : 1,
    pv,
    bounded,
  };
}

/** Ask the engine to finish the current search early (UCI stop). */
export function sfStop(): void {
  try {
    worker?.postMessage('stop');
  } catch {
    /* engine not started */
  }
}

export interface SFOptions {
  level?: Level;
  /** fixed depth (used by analysis); overrides the level's depth when given */
  depth?: number;
  movetime?: number;
  /** request this many MultiPV lines */
  multipv?: number;
  /** full-strength search: skill 20, no low-level sampling */
  fullStrength?: boolean;
  /** personality selection over MultiPV candidates; omitted/'stockfish'
   *  keeps the classic behavior exactly */
  persona?: EnginePersonaId;
}

/** Run one Stockfish search. Resolves with the chosen move + final score. */
export async function sfSearch(fen: string, opts: SFOptions = {}): Promise<SFSearchResult | null> {
  await ready();
  return enqueue(
    () =>
      new Promise<SFSearchResult | null>((resolve) => {
        const level = opts.level ?? 4;
        const cfg = SF_LEVELS[level];
        const depth = opts.depth ?? cfg.depth;
        const movetime = opts.movetime ?? cfg.movetime;
        // persona selection needs candidates at every level; classic callers
        // keep their exact configured MultiPV. Depth/movetime never change.
        const multipv =
          opts.multipv ?? (opts.persona && opts.persona !== 'stockfish' ? Math.max(cfg.multipv, 3) : cfg.multipv);
        const fullStrength = opts.fullStrength ?? false;
        const useMulti = multipv > 1;

        let sentGo = false;
        const done = (result: SFSearchResult | null) => {
          listeners.delete(onLine);
          resolve(result);
        };

        const best = new Map<number, InfoLine>();
        let bestmoveUci: string | null = null;

        const onLine = (line: string) => {
          if (line.startsWith('bestmove')) {
            if (!sentGo) return;
            bestmoveUci = line.split(/\s+/)[1] ?? null;
            const personaActive = !!opts.persona && opts.persona !== 'stockfish';
            // pick from MultiPV candidates on low levels (classic), or via the
            // personality selector when a persona is active
            let choice: SelectionResult | null = null;
            if (personaActive && useMulti && best.size > 1) {
              const candidateList: PersonaCandidate[] = [...best.entries()]
                .sort((a, b) => a[0] - b[0])
                .map(([mpv, info]) => ({
                  multipv: mpv,
                  uci: info.pv[0] ?? '',
                  san: pvToSan(fen, info.pv.slice(0, 1))[0] ?? (null as string | null),
                  cp: info.cp,
                  mate: info.mate,
                  depth: info.depth,
                  pvSan: pvToSan(fen, info.pv, 10),
                  bounded: info.bounded,
                }));
              choice = resolveEngineChoice({
                fen,
                candidates: candidateList,
                bestmoveUci,
                persona: opts.persona!,
                level,
                fullStrength,
                seed: personaSeed(fen),
              });
            }
            done(
              composeSearchResult(fen, [...best.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v), bestmoveUci, choice, {
                useMulti,
                fullStrength,
                level,
              }),
            );
            return;
          }
          if (!sentGo) return;
          const info = parseInfo(line);
          if (info && info.pv.length > 0) best.set(info.multipv, info);
        };

        listeners.add(onLine);
        send('setoption name MultiPV value ' + (useMulti ? multipv : 1));
        send('setoption name Skill Level value ' + (fullStrength ? 20 : cfg.skill));
        send('position fen ' + fen);
        sentGo = true;
        send(`go depth ${depth} movetime ${movetime}`);
        // hard stop: never let a search hang the queue for more than movetime*4
        window.setTimeout(() => {
          if (listeners.has(onLine)) {
            send('stop');
          }
        }, movetime * 4 + 3000);
      }),
  );
}

export interface SFEval {
  /** centipawns, white perspective, clamped to ±1500 (mates map to ±10000-ish) */
  cpWhite: number;
  /** white mates in N plies (sign: positive = white delivers), null otherwise */
  matePlies: number | null;
  bestSan: string | null;
  bestUci: string | null;
  depth: number;
}

/** Evaluate a position at a fixed depth (white-perspective result). */
export async function sfEvaluate(fen: string, depth = 12): Promise<SFEval | null> {
  const result = await sfSearch(fen, { depth, movetime: 2500 });
  if (!result || !result.bestmove) return null;
  const g = new Chess(fen);
  const whiteToMove = g.turn() === 'w';
  let cpWhite = 0;
  let matePlies: number | null = null;
  if (result.mate !== null) {
    // UCI mate is relative to the side to move
    matePlies = whiteToMove ? result.mate : -result.mate;
    cpWhite = matePlies > 0 ? 10000 : -10000;
  } else if (result.cp !== null) {
    cpWhite = Math.max(-1500, Math.min(1500, whiteToMove ? result.cp : -result.cp));
  }
  return {
    cpWhite,
    matePlies,
    bestSan: result.san,
    bestUci: result.bestmove,
    depth: result.depth,
  };
}

export function stockfishAvailable(): Promise<boolean> {
  return getWorker()
    .then(() => true)
    .catch(() => false);
}
