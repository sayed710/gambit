/* ============================================================
   practiceDrill — position/eval indexing for practicing a
   mistake from Game Review.

   Contract: the practice starts from the position BEFORE the
   critical move (fens[ply - 1]), so the player is asked to
   REPLACE their mistake, never to answer the move after it.
   The expected move at that position is report.evals[ply - 1]
   (evals[i] analyses fens[i] — the position before ply i + 1).
   ============================================================ */

/** FEN the practice board must load: the position before `ply` (1-based). */
export function practiceStartFen(fens: string[], ply: number): string | null {
  if (ply < 1 || ply > fens.length - 1) return null;
  return fens[ply - 1];
}

/** Index into report.evals for the move the player faces now. */
export function practiceEvalIndex(startPly: number, movesPlayed: number): number {
  // start position is fens[startPly - 1] (eval index startPly - 1); each
  // committed practice move advances the eval index by one.
  return startPly - 1 + movesPlayed;
}
