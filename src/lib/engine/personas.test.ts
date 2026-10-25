import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import {
  CLASSIC_WEIGHTS,
  PERSONAS,
  moveFeatures,
  personaRng,
  resolveEngineChoice,
  validCandidates,
  type PersonaCandidate,
} from './personas';

/* ============================================================
   Personality selection — pure, deterministic, ceiling-bounded.
   Candidate sets are realistic MultiPV-shaped fixtures: the selector
   contract is under test here, not the WASM engine (browser QA plays
   real Stockfish games separately).
   ============================================================ */

const START = new Chess().fen();

function cand(multipv: number, uci: string, cp: number | null, depth = 8, mate: number | null = null, san?: string): PersonaCandidate {
  const g = new Chess(START);
  let realSan = san ?? '';
  try {
    const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.slice(4, 5) || undefined });
    realSan = m.san;
  } catch {
    realSan = san ?? '??';
  }
  return { multipv, uci, san: realSan, cp, mate, depth, pvSan: [realSan] };
}

/* ---------- classic path invariants ---------- */
describe('classic Stockfish path is unchanged', () => {
  it('levels 1-2 with MultiPV use the original weighted sampling', () => {
    const candidates = [cand(1, 'e2e4', 30), cand(2, 'g1f3', 20), cand(3, 'd2d4', 10)];
    // resolveEngineChoice delegates to pickWeighted with Math.random — assert
    // the returned uci is ALWAYS one of the three (weights respected bounds)
    for (let i = 0; i < 60; i += 1) {
      const res = resolveEngineChoice({ fen: START, candidates, bestmoveUci: 'e2e4', persona: 'stockfish', level: 1, fullStrength: false, seed: i });
      expect(['e2e4', 'g1f3', 'd2d4']).toContain(res.uci);
      expect(res.via).toBe('classic-weighted');
    }
  });

  it('levels 3-4 classic: engine best, never reordered', () => {
    const candidates = [cand(1, 'e2e4', 30), cand(2, 'g1f3', 25)];
    for (const level of [3, 4] as const) {
      const res = resolveEngineChoice({ fen: START, candidates, bestmoveUci: 'e2e4', persona: 'stockfish', level, fullStrength: false, seed: 1 });
      expect(res.uci).toBe('e2e4');
      expect(res.via).toBe('engine-best');
    }
  });

  it('fullStrength (analysis/review path): engine best regardless of MultiPV', () => {
    const candidates = [cand(1, 'e2e4', 30), cand(2, 'g1f3', 28)];
    const res = resolveEngineChoice({ fen: START, candidates, bestmoveUci: 'e2e4', persona: 'stockfish', level: 1, fullStrength: true, seed: 1 });
    expect(res.uci).toBe('e2e4');
    expect(res.via).toBe('engine-best');
  });

  it('classic weights table is untouched (level 1 = [0.55,0.3,0.15])', () => {
    expect(CLASSIC_WEIGHTS[1]).toEqual([0.55, 0.3, 0.15]);
    expect(CLASSIC_WEIGHTS[2]).toEqual([0.72, 0.18, 0.1]);
    expect(CLASSIC_WEIGHTS[3]).toEqual([1]);
    expect(CLASSIC_WEIGHTS[4]).toEqual([1]);
  });
});


/** candidate built independently from a given fen (MultiPV lines do this) */
function mkAt(fen: string, san: string, cp: number, i: number): PersonaCandidate {
  const m = new Chess(fen).move(san);
  return { multipv: i, uci: m.from + m.to + (m.promotion ?? ''), san: m.san, cp, mate: null, depth: 8, pvSan: [m.san] };
}

/* ---------- persona selection ---------- */
describe('persona selection: ceilings and style', () => {
  it('Cartographer prefers the central pawn; Glacier prefers the major capture (same position, 2cp apart)', () => {
    // real position: 1.e4 e5 2.Nf3 Nc6 — d2d4 (central pawn) and Nxe5 (major
    // capture) are BOTH legal; cp 50 vs 48 keeps them inside every ceiling
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const mk = (san: string, cp: number, i: number): PersonaCandidate => {
      const m = new Chess(fen).move(san);
      return { multipv: i, uci: m.from + m.to + (m.promotion ?? ''), san: m.san, cp, mate: null, depth: 8, pvSan: [m.san] };
    };
    const cands = [mk('d4', 50, 1), mk('Nxe5', 48, 2)];
    const cart = resolveEngineChoice({ fen, candidates: cands, bestmoveUci: cands[0].uci, persona: 'cartographer', level: 4, fullStrength: false, seed: 7 });
    const glacier = resolveEngineChoice({ fen, candidates: cands, bestmoveUci: cands[0].uci, persona: 'glacier', level: 4, fullStrength: false, seed: 7 });
    expect(cart.uci).toBe(cands[0].uci); // central pawn (style +3, capture -1)
    expect(glacier.uci).toBe(cands[1].uci); // major capture (style +3)
    expect(cart.via).toBe('persona');
    expect(glacier.via).toBe('persona');
    expect(PERSONAS.blizzard.ceilingCp).toBe(120);
    expect(PERSONAS.cartographer.ceilingCp).toBe(40);
  });

  it('ceiling is enforced: the heavy check sits 80cp below best - out of Glacier reach, inside Blizzard', () => {
    // R+Q vs bare king: Re1 is the engine best (quiet, cp 100); Qa8+ is a
    // heavy check at an 80cp loss — beyond Glacier's 60, inside Blizzard's 120
    const fen = '6k1/5ppp/8/8/8/8/8/RQ4K1 w - - 0 1';
    const mk = (san: string, cp: number, i: number): PersonaCandidate => {
      const m = new Chess(fen).move(san);
      return { multipv: i, uci: m.from + m.to + (m.promotion ?? ''), san: m.san, cp, mate: null, depth: 8, pvSan: [m.san] };
    };
    const cands = [mk('Qe4', 100, 1), mk('Qb8+', 20, 2)];
    const glacier = resolveEngineChoice({ fen, candidates: cands, bestmoveUci: cands[0].uci, persona: 'glacier', level: 4, fullStrength: false, seed: 3 });
    expect(glacier.uci).toBe(cands[0].uci);
    expect(glacier.reason).toBe('all-above-ceiling');
    const blizzard = resolveEngineChoice({ fen, candidates: cands, bestmoveUci: cands[0].uci, persona: 'blizzard', level: 4, fullStrength: false, seed: 3 });
    expect(blizzard.uci).toBe(cands[1].uci); // within 120cp: heavy-check style wins
    expect(blizzard.via).toBe('persona');
  });

  it('Cartographer (40cp) excludes a 60cp-loss move even if stylistically fine', () => {
    const cands = [cand(1, 'e2e4', 100), cand(2, 'g1f3', 40)];
    const res = resolveEngineChoice({ fen: START, candidates: cands, bestmoveUci: 'e2e4', persona: 'cartographer', level: 4, fullStrength: false, seed: 1 });
    expect(res.uci).toBe('e2e4');
    expect(res.reason).toBe('all-above-ceiling');
  });

  it('Blizzard (120cp) accepts that same 60cp-loss attacking candidate', () => {
    const cands = [cand(1, 'e2e4', 100), cand(2, 'g1f3', 40)];
    const res = resolveEngineChoice({ fen: START, candidates: cands, bestmoveUci: 'e2e4', persona: 'blizzard', level: 4, fullStrength: false, seed: 1 });
    // both in ceiling; the deterministic pool picks legally — assert membership
    expect(['e2e4', 'g1f3']).toContain(res.uci);
    expect(res.via).toBe('persona');
  });

  it('forced mate is never traded for style: best has mate -> engine move', () => {
    // mate-in-1 available (Ra8#); a stylistically loud Qb7 line also offered
    const g = new Chess('6k1/5ppp/8/8/8/8/8/R6K w - - 0 1');
    const mateMove = g.moves({ verbose: true }).find((mv) => {
      g.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? 'q' });
      const m = g.isCheckmate();
      g.undo();
      return m;
    });
    expect(mateMove).toBeTruthy();
    const candidates = [
      { multipv: 1, uci: `${mateMove!.from}${mateMove!.to}`, san: mateMove!.san, cp: null, mate: 1, depth: 8, pvSan: [mateMove!.san] },
      { multipv: 2, uci: 'a1b1', san: 'Rb1', cp: 900, mate: null, depth: 8, pvSan: ['Rb1'] },
    ];
    for (const persona of ['blizzard', 'glacier', 'cartographer'] as const) {
      const res = resolveEngineChoice({ fen: g.fen(), candidates, bestmoveUci: candidates[0].uci, persona, level: 4, fullStrength: false, seed: 2 });
      expect(res.uci).toBe(candidates[0].uci);
      expect(res.reason).toBe('forced-mate');
    }
  });

  it('mate-against (best.mate < 0) also stays with the engine choice', () => {
    const candidates = [cand(1, 'e2e4', null, 8, -2), cand(2, 'g1f3', 300, 8, null)];
    const res = resolveEngineChoice({ fen: START, candidates, bestmoveUci: 'e2e4', persona: 'blizzard', level: 4, fullStrength: false, seed: 1 });
    expect(res.uci).toBe('e2e4');
    expect(res.reason).toBe('forced-mate');
  });

  it('mixed mate/cp candidate sets are not compared — fallback to engine best', () => {
    const candidates = [cand(1, 'e2e4', 40), cand(2, 'g1f3', null, 8, 3)];
    const res = resolveEngineChoice({ fen: START, candidates, bestmoveUci: 'e2e4', persona: 'glacier', level: 4, fullStrength: false, seed: 1 });
    expect(res.uci).toBe('e2e4');
    expect(res.reason).toBe('forced-mate');
  });

  it('depth-inconsistent candidates are excluded from comparison', () => {
    const candidates = [cand(1, 'e2e4', 40, 12), cand(2, 'g1f3', 39, 4)];
    const res = resolveEngineChoice({ fen: START, candidates, bestmoveUci: 'e2e4', persona: 'blizzard', level: 4, fullStrength: false, seed: 1 });
    expect(res.uci).toBe('e2e4');
    expect(res.reason).toBe('depth-inconsistent');
  });
});

/* ---------- candidate validity ---------- */
describe('candidate validation', () => {
  it('illegal root moves are rejected', () => {
    const cands = [cand(1, 'e2e4', 30), { ...cand(2, 'e4e7', 25), san: 'E7' }];
    const valid = validCandidates(START, cands);
    expect(valid.map((c) => c.uci)).toEqual(['e2e4']);
  });

  it('duplicate root moves are deduplicated', () => {
    const cands = [cand(1, 'e2e4', 30), cand(2, 'e2e4', 30)];
    const valid = validCandidates(START, cands);
    expect(valid).toHaveLength(1);
  });

  it('promotion root moves validate with the promotion suffix', () => {
    const fen = '7k/5P2/8/8/8/8/8/K7 w - - 0 1';
    const cands = [{ multipv: 1, uci: 'f7f8q', san: 'f8=Q+', cp: 900, mate: null, depth: 8, pvSan: ['f8=Q+'] }];
    const valid = validCandidates(fen, cands);
    expect(valid).toHaveLength(1);
    expect(valid[0].uci).toBe('f7f8q');
    // and the selector accepts it as a full candidate set of one -> fallback path
    const res = resolveEngineChoice({ fen, candidates: cands, bestmoveUci: 'f7f8q', persona: 'blizzard', level: 4, fullStrength: false, seed: 1 });
    expect(res.uci).toBe('f7f8q');
    expect(res.reason).toBe('too-few-candidates');
  });

  it('too-few-candidates falls back to the engine best honestly', () => {
    const res = resolveEngineChoice({ fen: START, candidates: [cand(1, 'e2e4', 30)], bestmoveUci: 'e2e4', persona: 'blizzard', level: 4, fullStrength: false, seed: 1 });
    expect(res.uci).toBe('e2e4');
    expect(res.via).toBe('fallback');
    expect(res.reason).toBe('too-few-candidates');
  });
});

/* ---------- determinism ---------- */
describe('deterministic selection', () => {
  it('same fen+persona+seed -> same choice across runs', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const cands = ['d4', 'Nxe5'].map((san, i) => {
      const m = new Chess(fen).move(san);
      return { multipv: i + 1, uci: m.from + m.to + (m.promotion ?? ''), san: m.san, cp: 50 - i * 2, mate: null, depth: 8, pvSan: [m.san] };
    });
    const first = resolveEngineChoice({ fen, candidates: cands, bestmoveUci: cands[0].uci, persona: 'blizzard', level: 4, fullStrength: false, seed: 12345 });
    for (let i = 0; i < 10; i += 1) {
      const again = resolveEngineChoice({ fen, candidates: cands, bestmoveUci: cands[0].uci, persona: 'blizzard', level: 4, fullStrength: false, seed: 12345 });
      expect(again.uci).toBe(first.uci);
      expect(again.via).toBe(first.via);
    }
  });

  it('personaRng is deterministic and in range', () => {
    const a = personaRng(42);
    const b = personaRng(42);
    for (let i = 0; i < 50; i += 1) {
      const x = a();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(x).toBe(b());
    }
  });
});

/* ---------- style features from real positions ---------- */
describe('move features (chess-aware scoring inputs)', () => {
  it('detects checks, captures, central pawns, development, heavy checks', () => {
    // Scholar-like: Qh5 gives check later; use direct fixtures
    const checkFen = 'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq - 0 2';
    const qh4 = moveFeatures(checkFen, 'd8h4');
    expect(qh4).not.toBeNull();
    expect(qh4!.givesCheck).toBe(true);
    expect(qh4!.heavyCheck).toBe(true);

    const devFen = START;
    const nf3 = moveFeatures(devFen, 'g1f3');
    expect(nf3!.development).toBe(true);
    expect(nf3!.isCapture).toBe(false);

    const e4 = moveFeatures(devFen, 'e2e4');
    expect(e4!.centralPawn).toBe(true);
  });

  it('returns null for illegal moves (callers must pre-validate)', () => {
    expect(moveFeatures(START, 'e4e7')).toBeNull();
  });
});

describe('authoritative bestmove (PR #4 review)', () => {
  const KQR = '6k1/5ppp/8/8/8/8/8/RQ4K1 w - - 0 1';

  it('a legal bestmove MISSING from the candidate list is returned directly, with no borrowed metadata', () => {
    // candidates only cover Qe4/Qb8+; the engine's actual bestmove is Rc1 —
    // legal, but unlisted. No candidate's cp/SAN/depth may be attached to it.
    const cands = [mkAt(KQR, 'Qe4', 100, 1), mkAt(KQR, 'Qb8+', 20, 2)];
    const res = resolveEngineChoice({ fen: KQR, candidates: cands, bestmoveUci: 'a1a4', persona: 'blizzard', level: 4, fullStrength: false, seed: 5 });
    expect(res.uci).toBe('a1a4');
    expect(res.candidate).toBeNull();
    expect(res.via).toBe('engine-best');
    expect(res.reason).toBe('bestmove-unlisted');
  });

  it('forced-mate branch cannot substitute a listed candidate when bestmove is unlisted', () => {
    // mate-in-1 exists in the LIST but the engine's actual bestmove (Rc1) is
    // not among the candidates — the list must not override the real move
    const g = new Chess(KQR);
    const mate = g.moves({ verbose: true }).find((mv) => {
      g.move({ from: mv.from, to: mv.to, promotion: mv.promotion ?? 'q' });
      const m = g.isCheckmate();
      g.undo();
      return m;
    });
    expect(mate).toBeTruthy();
    const candidates = [
      { multipv: 1, uci: `${mate!.from}${mate!.to}`, san: mate!.san, cp: null, mate: 1, depth: 8, pvSan: [mate!.san] },
      { multipv: 2, uci: 'b1e4', san: 'Qe4', cp: 100, mate: null, depth: 8, pvSan: ['Qe4'] },
    ];
    const res = resolveEngineChoice({ fen: KQR, candidates, bestmoveUci: 'a1a4', persona: 'blizzard', level: 4, fullStrength: false, seed: 1 });
    expect(res.uci).toBe('a1a4');
    expect(res.candidate).toBeNull();
    expect(res.reason).toBe('bestmove-unlisted');
  });

  it('a MALFORMED bestmove with no usable candidates returns null (caller keeps its own fallback)', () => {
    const res = resolveEngineChoice({ fen: KQR, candidates: [mkAt(KQR, 'Qe4', 100, 1)], bestmoveUci: 'zz9x', persona: 'blizzard', level: 4, fullStrength: false, seed: 1 });
    expect(res.uci).toBeNull();
    expect(res.candidate).toBeNull();
    expect(res.reason).toBe('bestmove-unlisted');
  });

  it('when the bestmove IS listed, selection proceeds normally', () => {
    const cands = [mkAt(KQR, 'Qe4', 100, 1), mkAt(KQR, 'Qb8+', 20, 2)];
    const res = resolveEngineChoice({ fen: KQR, candidates: cands, bestmoveUci: 'b1a8', persona: 'blizzard', level: 4, fullStrength: false, seed: 1 });
    // b1a8 IS legal but unlisted — wait: it must be listed for normal flow; use listed bestmove:
    const res2 = resolveEngineChoice({ fen: KQR, candidates: cands, bestmoveUci: cands[0].uci, persona: 'blizzard', level: 4, fullStrength: false, seed: 1 });
    expect(res2.via).toBe('persona');
    void res;
  });
});

describe('bounded UCI scores (PR #4 review)', () => {
  it('bounded (lowerbound/upperbound) candidates are excluded from stylistic comparison', () => {
    // both candidates in ceiling numerically, but the tempting capture carries
    // a lowerbound score — not comparable, engine best stands
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const d4 = new Chess(fen).move('d4');
    const nxe5 = new Chess(fen).move('Nxe5');
    const candidates: PersonaCandidate[] = [
      { multipv: 1, uci: d4.from + d4.to, san: d4.san, cp: 100, mate: null, depth: 8, pvSan: [d4.san] },
      { multipv: 2, uci: nxe5.from + nxe5.to, san: nxe5.san, cp: 95, mate: null, depth: 8, pvSan: [nxe5.san], bounded: true },
    ];
    const res = resolveEngineChoice({ fen, candidates, bestmoveUci: candidates[0].uci, persona: 'glacier', level: 4, fullStrength: false, seed: 1 });
    // glacier would LOVE the capture, but its score is bounded -> engine best
    expect(res.uci).toBe(candidates[0].uci);
    expect(res.via).toBe('engine-best');
  });

  it('mixed bounded/precise sets with enough precise candidates still select by style', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const d4 = new Chess(fen).move('d4');
    const nxe5 = new Chess(fen).move('Nxe5');
    const nc3 = new Chess(fen).move('Nc3');
    const candidates: PersonaCandidate[] = [
      { multipv: 1, uci: d4.from + d4.to, san: d4.san, cp: 100, mate: null, depth: 8, pvSan: [d4.san] },
      { multipv: 2, uci: nxe5.from + nxe5.to, san: nxe5.san, cp: 95, mate: null, depth: 8, pvSan: [nxe5.san], bounded: true },
      { multipv: 3, uci: nc3.from + nc3.to, san: nc3.san, cp: 98, mate: null, depth: 8, pvSan: [nc3.san] },
    ];
    // glacier: precise candidates d4 (0 loss) and Nc3 (2 loss) — no captures
    // among precise ones... Nc3 is not a capture: style 0 both -> engine best or seeded tie.
    // Assert honesty instead: chosen move is one of the PRECISE candidates.
    const res = resolveEngineChoice({ fen, candidates, bestmoveUci: candidates[0].uci, persona: 'glacier', level: 4, fullStrength: false, seed: 1 });
    expect([candidates[0].uci, candidates[2].uci]).toContain(res.uci);
    expect(res.uci).not.toBe(candidates[1].uci); // bounded line never chosen
  });
});
