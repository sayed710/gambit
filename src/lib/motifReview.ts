import type { Chess } from 'chess.js';
import type { GameReport } from './review';
import { CRITICAL_CLASSES } from './review';
import { detectMotifsForMove, type MotifDetection } from './motifDetection';
import { loadTraining, saveTraining, type MotifStat, type TrainingState } from './trainingStore';

/* ============================================================
   motifReview — connects motif detection to REAL Game Review
   output. For every player move the engine classified as critical
   (blunder/mistake/miss/inaccuracy), both the played move and the
   engine's best move are scanned for confirmed motifs:
   - played motif  = tactical idea the player's move created
   - missed motif  = confirmed motif inside the engine's best move

   Statistics are updated additively in the training store; only
   CONFIRMED detections count. No result-based synthesis.
   ============================================================ */

export interface PlyMotifs {
  ply: number;
  played: MotifDetection[];
  missed: MotifDetection[];
}

/** Scan a full game's fens + report. Expensive — call once and cache. */
export function motifAnalysisForReport(
  fens: string[], // fens[i] = position BEFORE ply i (length = plies + 1)
  report: GameReport,
  playerColor: 'w' | 'b',
): PlyMotifs[] {
  const out: PlyMotifs[] = [];
  report.reviews.forEach((r, i) => {
    if (r.color !== playerColor) return;
    if (!CRITICAL_CLASSES.includes(r.classification)) return;
    const fenBefore = fens[i];
    const bestSan = report.evals[i]?.bestSan ?? null;

    const played = detectMotifsForMove(fenBefore, r.san)?.motifs.filter((m) => m.confidence === 'confirmed') ?? [];
    const missed = bestSan && bestSan !== r.san
      ? detectMotifsForMove(fenBefore, bestSan)?.motifs.filter((m) => m.confidence === 'confirmed') ?? []
      : [];

    if (played.length > 0 || missed.length > 0) {
      out.push({ ply: i + 1, played, missed });
    }
  });
  return out;
}

/**
 * Load-modify-save wrapper used by BOTH Review paths (fresh analysis
 * completion AND cached-report load). Because applyMotifAnalysis is the
 * idempotence set, calling this on every cached load is safe: a report
 * cached before contributions existed (or after an interrupted
 * refinement) backfills exactly once, and an already-contributed game
 * never increments again.
 */
export function contributeGameMotifs(
  fens: string[],
  report: GameReport,
  gameId: string,
  playerColor: 'w' | 'b',
  now: number,
): boolean {
  const analysis = motifAnalysisForReport(fens, report, playerColor);
  const state = loadTraining();
  if (!applyMotifAnalysis(state, analysis, gameId, now)) return false;
  saveTraining(state);
  return true;
}

/**
 * Idempotent per-game contribution: the FIRST completed review of a game
 * feeds the motif statistics exactly once (recorded in state.motifGames).
 * Re-opened reviews, cache loads and re-analyses with refined
 * classifications never double-count — first analysis wins, by policy.
 * Returns true when a new contribution was recorded.
 */
export function applyMotifAnalysis(
  state: TrainingState,
  analysis: PlyMotifs[],
  gameId: string,
  now: number,
): boolean {
  if (state.motifGames[gameId] !== undefined) return false;
  state.motifGames[gameId] = now;
  recordMotifAnalysis(state, analysis, gameId, now);
  return true;
}

/** Fold a per-game motif analysis into the training store (additive). */
export function recordMotifAnalysis(
  state: TrainingState,
  analysis: PlyMotifs[],
  gameId: string,
  now: number,
): void {
  for (const plyItem of analysis) {
    for (const m of plyItem.missed) {
      const stat = ensureStat(state, m.type);
      stat.opportunities += 1;
      stat.missed += 1;
      stat.lastSeen = now;
      stat.recentMisses = [...stat.recentMisses, { gameId, ply: plyItem.ply }].slice(-5);
    }
    for (const m of plyItem.played) {
      const stat = ensureStat(state, m.type);
      stat.opportunities += 1;
      stat.found += 1;
      stat.lastSeen = now;
    }
  }
}

function ensureStat(state: TrainingState, type: string): MotifStat {
  if (!state.motifs[type]) {
    state.motifs[type] = { opportunities: 0, found: 0, missed: 0, lastSeen: null, recentMisses: [] };
  }
  return state.motifs[type];
}

/**
 * Motifs for ONE position pair — used by Review UI to explain the current
 * move ("You played Qd2?" vs "Best: Nf6! — knight fork on king + queen").
 */
export function plyMotifExplanation(
  game: Chess,
  fenBefore: string,
  playedSan: string,
  bestSan: string | null,
): { playedText: string | null; missedText: string | null } {
  const played = detectMotifsForMove(fenBefore, playedSan)?.motifs.filter((m) => m.confidence === 'confirmed') ?? [];
  const missed = bestSan && bestSan !== playedSan
    ? detectMotifsForMove(fenBefore, bestSan)?.motifs.filter((m) => m.confidence === 'confirmed') ?? []
    : [];
  void game;
  return {
    playedText: played[0]?.explanation ?? null,
    missedText: missed[0]?.explanation ?? null,
  };
}
