import { evaluatePosition, searchBestMove } from './engine';
import type { EvalResult, Level, SearchResult } from './engine';

export type EngineRequest =
  | { requestId: number; type: 'search'; fen: string; level: Level; recentFens?: string[] }
  | { requestId: number; type: 'eval'; fen: string; depth?: number };

export type EngineResponse =
  | { requestId: number; type: 'result'; payload: SearchResult | null }
  | { requestId: number; type: 'eval'; payload: EvalResult | null };

self.addEventListener('message', (e: MessageEvent<EngineRequest>) => {
  const msg = e.data;
  let response: EngineResponse;
  try {
    if (msg.type === 'search') {
      response = { requestId: msg.requestId, type: 'result', payload: searchBestMove(msg.fen, msg.level, msg.recentFens ?? []) };
    } else {
      response = { requestId: msg.requestId, type: 'eval', payload: evaluatePosition(msg.fen, msg.depth ?? 2) };
    }
  } catch {
    response =
      msg.type === 'search'
        ? { requestId: msg.requestId, type: 'result', payload: null }
        : { requestId: msg.requestId, type: 'eval', payload: null };
  }
  (self as unknown as Worker).postMessage(response);
});
