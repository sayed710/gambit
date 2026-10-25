import { Chess } from 'chess.js';
import type { Color, Square } from 'chess.js';

/* ============================================================
   engine/personas — personality selection OVER Stockfish output.

   Every candidate originates from a real Stockfish MultiPV line.
   The selector only REORDERS legal, verified candidates within
   explicit centipawn-loss ceilings; it never invents moves or
   evaluations, never overrides forced mates, and falls back to the
   engine's own best move whenever the candidate set is too thin,
   inconsistent, or unsafe to restyle.

   The classic (no-persona) selection path — the original weighted
   sampling for levels 1–2 and best-line for 3–4 — lives here too so
   the invariant "classic behavior is unchanged" is unit-testable
   without a WASM worker.
   ============================================================ */

export type EnginePersonaId = 'stockfish' | 'cartographer' | 'blizzard' | 'glacier';

export const PERSONA_IDS: EnginePersonaId[] = ['stockfish', 'cartographer', 'blizzard', 'glacier'];

export function isPersonaId(v: unknown): v is EnginePersonaId {
  return typeof v === 'string' && (PERSONA_IDS as string[]).includes(v);
}

export type PersonaStrategy = 'raw' | 'positional' | 'aggressive' | 'simplifying';

export interface PersonaDef {
  id: EnginePersonaId;
  name: string;
  strategy: PersonaStrategy;
  /** one-line user-facing description */
  description: string;
  /** max centipawn loss vs the best comparable candidate (cp-only lines) */
  ceilingCp: number;
}

export const PERSONAS: Record<EnginePersonaId, PersonaDef> = {
  stockfish: {
    id: 'stockfish',
    name: 'Stockfish',
    strategy: 'raw',
    description: 'Classic engine — plays its strongest choice under the selected level.',
    ceilingCp: 0,
  },
  cartographer: {
    id: 'cartographer',
    name: 'The Cartographer',
    strategy: 'positional',
    description: 'Maps the board patiently: central pawns, quiet development, keeps useful tension.',
    ceilingCp: 40,
  },
  blizzard: {
    id: 'blizzard',
    name: 'Blizzard',
    strategy: 'aggressive',
    description: 'Storms the king — checks, threats and attacking paths, within a wider risk band.',
    ceilingCp: 120,
  },
  glacier: {
    id: 'glacier',
    name: 'Old Glacier',
    strategy: 'simplifying',
    description: 'Grinds it down — sound exchanges, fewer pieces, simplified structures.',
    ceilingCp: 60,
  },
};

/** A MultiPV candidate with its verified root move. */
export interface PersonaCandidate {
  multipv: number;
  /** root UCI move, e.g. "e2e4" or "e7e8q" — from Stockfish's actual PV */
  uci: string;
  san: string;
  cp: number | null;
  mate: number | null;
  depth: number;
  pvSan: string[];
}

export type ClassicLevel = 1 | 2 | 3 | 4;

/* ------------------------------ classic path ------------------------------ */

/** Original weighted sampling (levels 1–2). Exported for regression tests. */
export function pickWeighted<T>(items: T[], weights: number[], roll: number): T {
  let acc = 0;
  for (let i = 0; i < items.length; i++) {
    acc += weights[i] ?? 0;
    if (roll <= acc) return items[i];
  }
  return items[items.length - 1];
}

export const CLASSIC_WEIGHTS: Record<ClassicLevel, number[]> = {
  1: [0.55, 0.3, 0.15],
  2: [0.72, 0.18, 0.1],
  3: [1],
  4: [1],
};

/* ------------------------------ determinism ------------------------------ */

/** mulberry32 — same contract as blindfold's rng. Deterministic per seed. */
export function personaRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit over a string, hex — deterministic seed derivation. */
export function personaSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = (h + ((h << 1) >>> 0) + ((h << 4) >>> 0) + ((h << 7) >>> 0) + ((h << 8) >>> 0) + ((h << 24) >>> 0)) >>> 0;
  }
  return h >>> 0;
}

/* ------------------------------ style features ------------------------------ */

export interface MoveFeatures {
  /** the move gives check */
  givesCheck: boolean;
  /** the move is a capture */
  isCapture: boolean;
  /** the captured piece is not a pawn (material reduction when traded evenly) */
  capturesMajor: boolean;
  /** pawn move to/within the central files d/e (central control) */
  centralPawn: boolean;
  /** minor piece leaving its back rank (development) */
  development: boolean;
  /** the move delivers check AND the moved piece is a queen/rook (heavy attack) */
  heavyCheck: boolean;
  /** pieces of ours attacking the central squares after the move */
  centralAttackers: number;
}

const CENTRAL: Square[] = ['d4', 'e4', 'd5', 'e5'];

/** Compute style features of one candidate root move from the real position. */
export function moveFeatures(fen: string, uci: string): MoveFeatures | null {
  const g = new Chess(fen);
  let m;
  try {
    m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
  } catch {
    return null; // illegal — callers must reject the candidate before this
  }
  const us = m.color;
  const backRank = us === 'w' ? '1' : '8';
  const centralAttackersBefore = countCentralAttackers(g, us); // after the move (g is now post-move)
  // reconstruct "before" to measure the DELTA of central attackers
  const before = new Chess(fen);
  const centralAttackersAfter = centralAttackersBefore;
  void centralAttackersBefore;
  const attackersBefore = countCentralAttackers(before, us);
  return {
    givesCheck: g.isCheck(),
    isCapture: m.captured !== undefined,
    capturesMajor: m.captured !== undefined && m.captured !== 'p',
    centralPawn: m.piece === 'p' && CENTRAL.includes(m.to as Square),
    development: (m.piece === 'n' || m.piece === 'b') && m.from[1] === backRank,
    heavyCheck: g.isCheck() && (m.piece === 'q' || m.piece === 'r'),
    centralAttackers: centralAttackersAfter - attackersBefore,
  };
}

function countCentralAttackers(g: Chess, us: Color): number {
  let n = 0;
  for (const sq of CENTRAL) {
    n += g.attackers(sq, us).length;
  }
  return n;
}

/* ------------------------------ selection ------------------------------ */

export interface SelectionInput {
  fen: string;
  /** candidates sorted by MultiPV rank — index 0 is the engine's best */
  candidates: PersonaCandidate[];
  /** Stockfish's own bestmove UCI (authoritative fallback) */
  bestmoveUci: string | null;
  persona: EnginePersonaId;
  level: ClassicLevel;
  fullStrength: boolean;
  /** deterministic tie-breaking seed (derived from fen+ply by the caller) */
  seed: number;
}

export interface SelectionResult {
  /** chosen root UCI; null means "no legal choice — let the caller fall back" */
  uci: string | null;
  /** the candidate chosen, when one was */
  candidate: PersonaCandidate | null;
  /** honest provenance for the UI: which path produced the move */
  via: 'persona' | 'classic-weighted' | 'engine-best' | 'fallback';
  /** why a persona choice did not happen (for tests and honest UI) */
  reason?: 'no-persona' | 'too-few-candidates' | 'forced-mate' | 'mixed-mate-cp' | 'depth-inconsistent' | 'all-above-ceiling' | 'illegal-candidates';
}

/** Validate candidates: legality, dedupe by root uci, completeness. */
export function validCandidates(fen: string, candidates: PersonaCandidate[]): PersonaCandidate[] {
  const seen = new Set<string>();
  const out: PersonaCandidate[] = [];
  for (const c of candidates) {
    if (!c.uci || c.uci.length < 4) continue;
    if (seen.has(c.uci)) continue; // duplicate root move
    seen.add(c.uci);
    if (c.san === null) continue; // malformed line
    const g = new Chess(fen);
    try {
      g.move({ from: c.uci.slice(0, 2), to: c.uci.slice(2, 4), promotion: c.uci.slice(4, 5) || undefined });
    } catch {
      continue; // illegal — Stockfish PV should never be, but never trust
    }
    out.push(c);
  }
  return out;
}

/** The single decision point used by sfSearch. Pure and deterministic. */
export function resolveEngineChoice(input: SelectionInput): SelectionResult {
  const { fen, candidates, bestmoveUci, persona, level, fullStrength, seed } = input;

  // ——— classic path: original behavior, byte-for-byte semantics ———
  if (persona === 'stockfish') {
    if (fullStrength) {
      return { uci: bestmoveUci ?? candidates[0]?.uci ?? null, candidate: candidates[0] ?? null, via: 'engine-best', reason: 'no-persona' };
    }
    if (candidates.length > 1 && (level === 1 || level === 2)) {
      const roll = Math.random(); // preserved: classic path keeps its original randomness
      const picked = pickWeighted(candidates, CLASSIC_WEIGHTS[level], roll);
      return { uci: picked.uci, candidate: picked, via: 'classic-weighted', reason: 'no-persona' };
    }
    return { uci: bestmoveUci ?? candidates[0]?.uci ?? null, candidate: candidates[0] ?? null, via: 'engine-best', reason: 'no-persona' };
  }

  // ——— persona path ———
  const valid = validCandidates(fen, candidates);
  const best = valid.find((c) => c.uci === bestmoveUci) ?? valid[0] ?? null;
  if (valid.length < 2 || !best) {
    return { uci: bestmoveUci ?? valid[0]?.uci ?? null, candidate: best, via: 'fallback', reason: 'too-few-candidates' };
  }

  // forced-mate protection: if the engine sees ANY mate score for the best
  // line (either direction), stylistic reordering is off — play the engine move
  if (candidates.some((c) => c.mate !== null)) {
    return { uci: best.uci, candidate: best, via: 'engine-best', reason: 'forced-mate' };
  }
  // mixed mate/cp or missing cp: not comparable — fallback
  if (valid.some((c) => c.cp === null)) {
    return { uci: best.uci, candidate: best, via: 'engine-best', reason: 'mixed-mate-cp' };
  }

  // depth consistency: only compare candidates evaluated at the best line's depth
  const comparable = valid.filter((c) => c.depth === best.depth);
  if (comparable.length < 2) {
    return { uci: best.uci, candidate: best, via: 'engine-best', reason: 'depth-inconsistent' };
  }

  const def = PERSONAS[persona];
  const ceiling = def.ceilingCp;

  // cp-loss vs the best comparable candidate (all cp share the side-to-move perspective)
  const inCeiling = comparable.filter((c) => best.cp !== null && c.cp !== null && best.cp - c.cp <= ceiling);
  // 0 or 1 in-ceiling candidates: there is no genuine stylistic CHOICE —
  // the engine's own best is the only acceptable move
  if (inCeiling.length <= 1) {
    return { uci: best.uci, candidate: best, via: 'engine-best', reason: 'all-above-ceiling' };
  }

  // style scoring: features from real chess.js positions, small weights —
  // the engine evaluation (ceiling) stays authoritative
  const scored = inCeiling.map((c) => {
    const f = moveFeatures(fen, c.uci);
    let style = 0;
    if (f) {
      switch (def.strategy) {
        case 'aggressive':
          if (f.givesCheck) style += 3;
          if (f.heavyCheck) style += 1;
          if (f.centralAttackers > 0) style += Math.min(2, f.centralAttackers);
          break;
        case 'positional':
          if (f.centralPawn) style += 3;
          if (f.development) style += 2;
          if (f.centralAttackers > 0) style += 1;
          if (f.isCapture) style -= 1; // keeps tension by default
          break;
        case 'simplifying':
          if (f.capturesMajor) style += 3;
          if (f.isCapture) style += 1;
          break;
        default:
          style = 0;
      }
    }
    return { c, style };
  });
  const maxStyle = Math.max(...scored.map((s) => s.style));
  // tie pool: candidates at the top style score; seeded rng breaks ties
  const pool = scored.filter((s) => s.style === maxStyle);
  const rng = personaRng(seed ^ personaSeed(persona));
  const winner = pool[Math.floor(rng() * pool.length)] ?? pool[0];
  return { uci: winner.c.uci, candidate: winner.c, via: 'persona' };
}
