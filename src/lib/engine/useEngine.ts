import { useCallback, useEffect, useRef } from 'react';
import { Chess } from 'chess.js';
import type { EvalResult, Level, SearchResult } from './engine';
import { sfSearch } from './stockfish';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

type EngineRequest =
  | { requestId: number; type: 'search'; fen: string; level: Level; recentFens: string[] }
  | { requestId: number; type: 'eval'; fen: string; depth: number };

type LegacyCall =
  | { type: 'search'; fen: string; level: Level; recentFens: string[] }
  | { type: 'eval'; fen: string; depth: number };

type EngineResponse = { requestId: number; payload: unknown };

/** Human-equivalent ratings for the four Stockfish-based levels. */
export const LEVEL_RATINGS: Record<Level, number> = { 1: 900, 2: 1400, 3: 1900, 4: 2400 };

const pending = new Map<number, Pending>();
let nextId = 1;

/**
 * Engine access for the app. Primary path is Stockfish 18 (WASM); the bundled
 * lightweight engine stays as an automatic fallback if Stockfish can't load.
 */
export function useEngine() {
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.addEventListener('message', (e: MessageEvent<EngineResponse>) => {
      const { requestId, payload } = e.data;
      const entry = pending.get(requestId);
      if (entry) {
        pending.delete(requestId);
        entry.resolve(payload);
      }
    });
    return () => {
      worker.terminate();
      for (const entry of pending.values()) entry.reject(new Error('engine disposed'));
      pending.clear();
    };
  }, []);

  const legacyRequest = useCallback(<T,>(msg: LegacyCall): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const worker = workerRef.current;
      if (!worker) {
        reject(new Error('engine not ready'));
        return;
      }
      const requestId = nextId++;
      pending.set(requestId, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ ...msg, requestId } satisfies EngineRequest);
    });
  }, []);

  const search = useCallback(
    async (fen: string, level: Level, recentFens: string[] = []): Promise<SearchResult | null> => {
      try {
        const sf = await sfSearch(fen, { level });
        if (sf?.bestmove) {
          return {
            from: sf.bestmove.slice(0, 2),
            to: sf.bestmove.slice(2, 4),
            promotion: sf.bestmove.slice(4, 5) || undefined,
            san: sf.san ?? '',
            // report score from the mover's perspective, matching the legacy engine
            scoreCp: sf.cp ?? (sf.mate !== null ? (sf.mate > 0 ? 99_000 : -99_000) : 0),
            depth: sf.depth,
            nodes: 0,
            ms: 0,
          };
        }
        if (sf) return null; // engine answered but had no move (game over)
      } catch {
        // Stockfish unavailable — fall through to the bundled engine
      }
      return legacyRequest<SearchResult | null>({ type: 'search', fen, level, recentFens });
    },
    [legacyRequest],
  );

  const evaluate = useCallback(
    async (fen: string, depth = 12): Promise<EvalResult | null> => {
      try {
        const sf = await sfSearch(fen, { depth, movetime: 2500 });
        if (sf?.bestmove) {
          const g = new Chess(fen);
          const whiteToMove = g.turn() === 'w';
          let cp = 0;
          let mateIn: number | null = null;
          if (sf.mate !== null) {
            const plies = whiteToMove ? sf.mate : -sf.mate;
            mateIn = Math.ceil(Math.abs(plies) / 2) * (plies > 0 ? 1 : -1);
            cp = plies > 0 ? 99_000 : -99_000;
          } else if (sf.cp !== null) {
            cp = Math.max(-1500, Math.min(1500, whiteToMove ? sf.cp : -sf.cp));
          }
          return { cp, mateIn, bestSan: sf.san, depth: sf.depth };
        }
      } catch {
        // fall through
      }
      return legacyRequest<EvalResult | null>({ type: 'eval', fen, depth: Math.min(depth, 3) });
    },
    [legacyRequest],
  );

  return { search, evaluate };
}
