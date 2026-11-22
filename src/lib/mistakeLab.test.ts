import { beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { CLASSIFICATION_META, isReportCacheUsable, verifyReportAgainstGame, type GameReport, type MoveClass } from './review';
import type { GameRecord } from './types';
import type { SrRecord } from './trainingStore';
import {
  abandonSession,
  applyOutcome,
  completeCurrent,
  currentExercise,
  dueExercises,
  emptyLabState,
  gradeLabMove,
  loadLab,
  harvestAll,
  harvestFromGame,
  isMastered,
  labStats,
  MASTERED_INTERVAL_DAYS,
  MAX_PER_GAME,
  outcomeToGrade,
  promotionPieceFor,
  startSession,
  type LabExercise,
  type MistakeLabState,
} from './mistakeLab';
import { resetOnboardingForTests } from './onboarding';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function makeRecord(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    id: 'g1',
    date: NOW - DAY,
    mode: 'ai',
    timeControl: { id: 'rapid10', label: '10 min', category: 'Rapid', minutes: 10, increment: 0 },
    playerColor: 'w',
    opponentName: 'Engine',
    opponentRating: 1200,
    result: 'win',
    reason: 'checkmate',
    moves: [],
    pgn: '',
    ratingBefore: 1200,
    ratingAfter: 1216,
    ...overrides,
  };
}

/** A real 7-ply game; the fixture replays it for REAL mover colors. */
const GAME_MOVES = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];

function reportFor(moves: string[], mistakes: Record<number, { classification: MoveClass; cpl: number; bestSan: string }>): GameReport {
  const reviews = moves.map((san, i) => ({
    san,
    color: (i % 2 === 0 ? 'w' : 'b') as 'w' | 'b',
    cpl: mistakes[i]?.cpl ?? 0,
    classification: (mistakes[i]?.classification ?? 'best') as MoveClass,
  }));
  const evals: GameReport['evals'] = [];
  for (let i = 0; i <= moves.length; i++) {
    evals.push({ cp: 0, mateIn: null, bestSan: mistakes[i]?.bestSan ?? null });
  }
  return {
    reviews,
    evals,
    accuracy: { w: 90, b: 85 },
    counts: { w: fullCounts(), b: fullCounts() } as unknown as GameReport['counts'],
    avgCpl: { w: 10, b: 20 },
  };
}


function fullCounts(): Record<string, number> {
  return Object.fromEntries(Object.keys(CLASSIFICATION_META).map((k) => [k, 0]));
}

const MISTAKE_AT_2 = { classification: 'blunder' as MoveClass, cpl: 320, bestSan: 'Nf3' };

function gameWithMistake(): { rec: GameRecord; report: GameReport } {
  const rec = makeRecord({ moves: GAME_MOVES, pgn: GAME_MOVES.join(' ') });
  const report = reportFor(GAME_MOVES, { 2: MISTAKE_AT_2 });
  return { rec, report };
}

beforeEach(() => {
  resetOnboardingForTests();
  localStorage.clear();
});

describe('harvestFromGame', () => {
  it('extracts ONLY critical plies with a verified, different best move', () => {
    const { rec, report } = gameWithMistake();
    const harvest = harvestFromGame(rec, report, NOW);
    expect(harvest.status).toBe('ok');
    expect(harvest.exercises).toHaveLength(1);
    const ex = harvest.exercises[0];
    expect(ex.id).toBe('g1:2');
    expect(ex.playedSan).toBe('Qh5');
    expect(ex.bestSan).toBe('Nf3'); // the verified engine move from the report
    expect(ex.classification).toBe('blunder');
    expect(ex.side).toBe('w');
    // the before-position is REAL: replaying to ply 2 must match
    const probe = new Chess();
    probe.move('e4');
    probe.move('e5');
    expect(ex.fenBefore).toBe(probe.fen());
  });

  it('refuses a game whose SAN list length diverges from the cached report', () => {
    const { rec, report } = gameWithMistake();
    const corrupted = { ...rec, moves: [...GAME_MOVES, 'Ke7'] }; // extra move
    expect(harvestFromGame(corrupted, report, NOW)).toEqual({ status: 'rejected', exercises: [] });
  });

  it('skips plies whose eval has no verified best move (no fabrication)', () => {
    const { rec, report } = gameWithMistake();
    const noBest: GameReport = {
      ...report,
      evals: report.evals.map((e) => (e ? { ...e, bestSan: null } : e)),
    };
    expect(harvestFromGame(rec, noBest, NOW)).toEqual({ status: 'ok', exercises: [] });
  });

  it("REGRESSION: the OPPONENT's critical moves are never harvested (personal lab)", () => {
    // black (the opponent) blunders at ply 3 — white's lab must not train it
    const mistakes: Record<number, { classification: MoveClass; cpl: number; bestSan: string }> = {
      2: { classification: 'blunder', cpl: 320, bestSan: 'Nf3' }, // white (player)
      3: { classification: 'blunder', cpl: 400, bestSan: 'Qe7' }, // black (opponent)
    };
    const rec = makeRecord({ moves: GAME_MOVES, playerColor: 'w' });
    const report = reportFor(GAME_MOVES, mistakes);
    const harvest = harvestFromGame(rec, report, NOW);
    expect(harvest.exercises.map((x) => x.ply)).toEqual([2]);
  });

  it('REGRESSION: a same-length cache from DIFFERENT moves is rejected (SAN+color verified per ply)', () => {
    const { rec } = gameWithMistake();
    // same length, but the cached review describes a different game
    const otherMoves = ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3'];
    const report = reportFor(otherMoves, { 2: MISTAKE_AT_2 });
    expect(harvestFromGame(rec, report, NOW).status).toBe('rejected');
  });

  it('REGRESSION: a divergence found LATER rejects the WHOLE game — no partial harvest', () => {
    // a valid mistake at ply 2, then the record's ply-5 move differs from
    // the cached review (same length) — nothing from this game is accepted
    const moves = [...GAME_MOVES];
    moves[5] = 'Ke2'; // legal from the position, but NOT what the cache describes
    const rec = makeRecord({ moves, playerColor: 'w' });
    const report = reportFor(GAME_MOVES, { 2: MISTAKE_AT_2 }); // cache built for the ORIGINAL line
    expect(harvestFromGame(rec, report, NOW)).toEqual({ status: 'rejected', exercises: [] });
  });

  it('REGRESSION: an illegal bestSan is rejected as UNSOLVABLE (legal answers still harvest)', () => {
    // the eval claims Qxg7 — the queen on h5 has no line to g7: illegal in
    // the presented position, so the exercise would be unsolvable
    const mistakes: Record<number, { classification: MoveClass; cpl: number; bestSan: string }> = {
      2: { classification: 'blunder', cpl: 320, bestSan: 'Qxg7' },
    };
    const rec = makeRecord({ moves: GAME_MOVES, playerColor: 'w' });
    expect(harvestFromGame(rec, reportFor(GAME_MOVES, mistakes), NOW)).toEqual({ status: 'ok', exercises: [] });
    // a legal best move beside it still harvests — skip, not abort
    const both: Record<number, { classification: MoveClass; cpl: number; bestSan: string }> = {
      2: { classification: 'blunder', cpl: 320, bestSan: 'Qxg7' },
      4: { classification: 'mistake', cpl: 180, bestSan: 'Qf3' }, // before Bc4, Qf3 is legal for white
    };
    const harvest = harvestFromGame(rec, reportFor(GAME_MOVES, both), NOW);
    expect(harvest.exercises.map((x) => x.ply)).toEqual([4]); // only the solvable one
  });

  it('ADVERSARIAL: a CUSTOM-START game harvests from its real replay', () => {
    // K+R vs K drill start; white wastes time with Kd1?? instead of
    // cutting with Ra7 — the before-position must come from the CUSTOM
    // start, never the standard one
    const initialFen = '4k3/8/8/8/8/8/8/R3K3 w - - 0 1';
    const moves = ['Kd1', 'Kd7'];
    const rec = makeRecord({ moves, initialFen, playerColor: 'w' });
    const report = reportFor(moves, { 0: { classification: 'blunder', cpl: 250, bestSan: 'Ra7' } });
    const harvest = harvestFromGame(rec, report, NOW);
    expect(harvest.status).toBe('ok');
    expect(harvest.exercises).toHaveLength(1);
    const ex = harvest.exercises[0];
    expect(ex.fenBefore).toBe(initialFen); // the CUSTOM start, not the standard one
    expect(ex.bestSan).toBe('Ra7'); // legal from the custom position (rook a1 -> a7)
  });

  it('REGRESSION: a NONCANONICAL stored move still replays (zeros-style castling)', () => {
    // the STORED text uses '0-0' (zeros — a restored/legacy game); the
    // review cache describes the CANONICAL replay ('O-O'), exactly like a
    // real review cache would. The stored spelling must not reject the
    // game: legality + canonical-vs-cache is the contract.
    const stored = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', '0-0'];
    const canonical = ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O'];
    const mistakes: Record<number, { classification: MoveClass; cpl: number; bestSan: string }> = {
      2: { classification: 'mistake', cpl: 150, bestSan: 'Bb5' }, // Bb5 is legal before Nf3
    };
    const rec = makeRecord({ moves: stored, playerColor: 'w' });
    const report = reportFor(canonical, mistakes);
    const harvest = harvestFromGame(rec, report, NOW);
    expect(harvest.status).toBe('ok');
    expect(harvest.exercises.map((x) => x.ply)).toEqual([2]);
  });

  it('REGRESSION: a legal-but-NONCANONICAL bestSan (dropped mate suffix) is not harvestable', () => {
    // the cached answer says Qxf7 — legal, but the canonical SAN here is
    // Qxf7# (mate): grading is exact-SAN, so the answer as stored would be
    // unenterable — the exercise is skipped rather than made unsolvable
    const mistakes: Record<number, { classification: MoveClass; cpl: number; bestSan: string }> = {
      6: { classification: 'blunder', cpl: 300, bestSan: 'Qxf7' }, // canonical: Qxf7#
    };
    const rec = makeRecord({ moves: GAME_MOVES, playerColor: 'w' });
    const harvest = harvestFromGame(rec, reportFor(GAME_MOVES, mistakes), NOW);
    expect(harvest).toEqual({ status: 'ok', exercises: [] });
  });

  it('caps the harvest per game at the worst MAX_PER_GAME mistakes', () => {
    const moves: string[] = [];
    const mistakes: Record<number, { classification: MoveClass; cpl: number; bestSan: string }> = {};
    // a long shuffling line where white makes many distinct legal mistakes
    const game = new Chess();
    const sans: string[] = [];
    let ply = 0;
    while (ply < 30) {
      const legal = game.moves();
      if (legal.length === 0) break;
      const san = legal[ply % legal.length];
      // keep it deterministic and legal
      let chosen = san;
      try {
        game.move(chosen);
      } catch {
        break;
      }
      sans.push(chosen);
      if (game.turn() === 'b') {
        mistakes[ply] = { classification: 'mistake', cpl: 100 + ply, bestSan: legal.find((l) => l !== chosen) ?? chosen };
      }
      ply += 1;
    }
    moves.push(...sans);
    const rec = makeRecord({ moves, pgn: moves.join(' ') });
    const report = reportFor(moves, mistakes);
    const harvest = harvestFromGame(rec, report, NOW);
    expect(harvest.exercises.length).toBeLessThanOrEqual(MAX_PER_GAME);
    // worst-cpl first
    for (let i = 1; i < harvest.exercises.length; i++) {
      expect(harvest.exercises[i - 1].cpl).toBeGreaterThanOrEqual(harvest.exercises[i].cpl);
    }
  });
});

describe('harvestAll + dedupe + reconcile', () => {
  it('adds new (game,ply) pairs once; re-harvest never duplicates or resets SR', () => {
    const { rec, report } = gameWithMistake();
    localStorage.setItem('gambit.review.g1', JSON.stringify(report));
    let state = emptyLabState();
    const first = harvestAll({ games: [rec] }, state, NOW);
    state = first.state;
    expect(first.added).toBe(1);
    expect(first.gamesScanned).toBe(1);
    // practice it to mastery, then re-harvest
    state = applyOutcome(state, 'g1:2', 'clean', NOW);
    const masteredSr: SrRecord = { ...state.exercises[0].sr, interval: MASTERED_INTERVAL_DAYS + 5, due: NOW + DAY };
    state = { ...state, exercises: state.exercises.map((x) => (x.id === 'g1:2' ? { ...x, sr: masteredSr } : x)) };
    const second = harvestAll({ games: [rec] }, state, NOW);
    expect(second.added).toBe(0);
    expect(second.state.exercises).toHaveLength(1);
    expect(second.state.exercises[0].sr.interval).toBe(masteredSr.interval); // progress kept
  });

  it('scans only games that have a review cache', () => {
    const { rec } = gameWithMistake();
    const result = harvestAll({ games: [rec] }, emptyLabState(), NOW);
    expect(result.gamesScanned).toBe(0);
    expect(result.added).toBe(0);
  });

  it('a malformed cache (reviews but no evals) is SKIPPED — sync continues to the next game', () => {
    const { rec, report } = gameWithMistake();
    localStorage.setItem(
      'gambit.review.gbad',
      JSON.stringify({ reviews: [{ san: 'e4', color: 'w', cpl: 0, classification: 'blunder' }] }),
    ); // no evals array
    localStorage.setItem('gambit.review.g1', JSON.stringify(report));
    const bad = makeRecord({ id: 'gbad', moves: ['e4'] });
    const result = harvestAll({ games: [bad, rec] }, emptyLabState(), NOW);
    expect(result.added).toBe(1); // the healthy game still harvested
    expect(result.gamesScanned).toBe(2); // the malformed cache counts as scanned
    expect(result.gamesRejected).toBe(1); // and is named as rejected
  });

  it('REGRESSION: deleted games leave the Lab (sync reconciles orphans + session refs)', () => {
    const { rec, report } = gameWithMistake();
    localStorage.setItem('gambit.review.g1', JSON.stringify(report));
    let state = harvestAll({ games: [rec] }, emptyLabState(), NOW).state;
    expect(state.exercises).toHaveLength(1);
    state = startSession(state, NOW);
    const survivor = makeRecord({ id: 'other-game', moves: ['e4'] });
    // g1 no longer exists in the profile — its exercises and session leave
    const result = harvestAll({ games: [survivor] }, state, NOW);
    expect(result.state.exercises).toEqual([]);
    expect(result.state.session).toBeNull();
  });
});

describe('practice semantics', () => {
  it('grading is exact-SAN against the verified best move', () => {
    const { rec, report } = gameWithMistake();
    const [ex] = harvestFromGame(rec, report, NOW).exercises;
    expect(gradeLabMove(ex, 'Nf3')).toBe('correct');
    expect(gradeLabMove(ex, 'Qxf7')).toBe('wrong');
  });

  it('the promotion piece follows the VERIFIED answer', () => {
    expect(promotionPieceFor('g8=N')).toBe('n');
    expect(promotionPieceFor('axb1=R')).toBe('r');
    expect(promotionPieceFor('g8=Q+')).toBe('q');
    expect(promotionPieceFor('Nf3')).toBe('q'); // no promotion -> queen default
  });

  it('outcomes map to honest SR grades', () => {
    expect(outcomeToGrade('clean')).toBe('good');
    expect(outcomeToGrade('after-wrong')).toBe('hard');
    expect(outcomeToGrade('assisted')).toBe('hard');
  });

  it('applyOutcome records the attempt and schedules SR', () => {
    const { rec, report } = gameWithMistake();
    const [ex] = harvestFromGame(rec, report, NOW).exercises;
    let state: MistakeLabState = { ...emptyLabState(), exercises: [ex] };
    state = applyOutcome(state, ex.id, 'clean', NOW);
    expect(state.exercises[0].attempts).toBe(1);
    expect(state.exercises[0].solved).toBe(1);
    expect(state.exercises[0].sr.reps).toBe(1);
    expect(state.exercises[0].lastPracticed).toBe(NOW);
  });

  it('mastery is interval-based, never a fake counter', () => {
    const { rec, report } = gameWithMistake();
    const [ex] = harvestFromGame(rec, report, NOW).exercises;
    expect(isMastered(ex)).toBe(false);
    const mastered: LabExercise = { ...ex, sr: { ...ex.sr, interval: MASTERED_INTERVAL_DAYS } };
    expect(isMastered(mastered)).toBe(true);
  });
});

describe('sessions (resumable)', () => {
  function stateWith(ids: string[]): MistakeLabState {
    const { rec, report } = gameWithMistake();
    const [ex] = harvestFromGame(rec, report, NOW).exercises;
    const exercises = ids.map((id, i) => ({ ...ex, id, gameId: `g${i}` }));
    return { ...emptyLabState(), exercises };
  }

  it('ADVERSARIAL: a persisted session referencing MISSING exercises is sanitized on load (no UI deadlock)', () => {
    // a corrupt/partial write left a queue entry whose exercise is gone:
    // loadLab must reconcile, or the page deadlocks between runner and summary
    const state = stateWith(['real-a', 'real-b']);
    const corrupted = {
      ...state,
      session: { queue: ['ghost', 'real-a', 'real-b'], index: 0, startedAt: NOW, results: [], flags: { ghost: { assisted: true, firstTry: false } } },
    };
    localStorage.setItem('gambit.mistakeLab.v1', JSON.stringify(corrupted));
    const loaded = loadLab();
    expect(loaded.session?.queue).toEqual(['real-a', 'real-b']);
    expect(currentExercise(loaded)?.id).toBe('real-a'); // serves a LIVE exercise
  });

  it('ADVERSARIAL: a session whose ENTIRE queue is missing is dropped on load', () => {
    const state = stateWith(['real-a']);
    const corrupted = {
      ...state,
      session: { queue: ['ghost-1', 'ghost-2'], index: 1, startedAt: NOW, results: [], flags: {} },
    };
    localStorage.setItem('gambit.mistakeLab.v1', JSON.stringify(corrupted));
    expect(loadLab().session).toBeNull(); // back to a clean, startable state
  });

  it('ADVERSARIAL: malformed EXERCISES are quarantined individually — valid siblings survive', () => {
    const { rec, report } = gameWithMistake();
    const [good] = harvestFromGame(rec, report, NOW).exercises;
    const brokenFen = { ...good, id: 'bad-fen', fenBefore: 'not-a-fen' };
    const badSide = { ...good, id: 'bad-side', side: 'x' as never };
    const badClass = { ...good, id: 'bad-class', classification: 'hacked-class' as never };
    const negativeCpl = { ...good, id: 'bad-cpl', cpl: -10 };
    const unplayableAnswer = { ...good, id: 'bad-answer', bestSan: 'Qxg7' }; // queen h5 has no line to g7
    const state: MistakeLabState = {
      ...emptyLabState(),
      exercises: [brokenFen, badSide, badClass, negativeCpl, unplayableAnswer, good],
    };
    localStorage.setItem('gambit.mistakeLab.v1', JSON.stringify(state));
    const loaded = loadLab();
    expect(loaded.exercises.map((x) => x.id)).toEqual([good.id]); // ONLY the valid one survives
  });

  it('ADVERSARIAL: a FRACTIONAL cursor is recovered honestly (no deadlock, no fake completion)', () => {
    const state = stateWith(['a', 'b', 'c']);
    const corrupted = {
      ...state,
      session: { queue: ['a', 'b', 'c'], index: 0.5, startedAt: NOW, results: [], flags: {} },
    };
    localStorage.setItem('gambit.mistakeLab.v1', JSON.stringify(corrupted));
    const loaded = loadLab();
    // an unusable cursor restarts the session honestly: every exercise is
    // due again and the FIRST live one is served — never undefined
    expect(loaded.session?.index).toBe(0);
    expect(currentExercise(loaded)?.id).toBe('a');
    expect(loaded.session?.results).toEqual([]);
  });

  it('ADVERSARIAL: negative and out-of-range cursors are recovered safely', () => {
    const negative = { ...stateWith(['a', 'b']), session: { queue: ['a', 'b'], index: -2, startedAt: NOW, results: [{ id: 'a', outcome: 'clean' as const }], flags: {} } };
    localStorage.setItem('gambit.mistakeLab.v1', JSON.stringify(negative));
    const loadedNegative = loadLab();
    expect(loadedNegative.session?.index).toBe(0);
    expect(loadedNegative.session?.results).toEqual([]); // an untrustworthy cursor voids progress claims

    const outOfRange = { ...stateWith(['a', 'b']), session: { queue: ['a', 'b'], index: 99, startedAt: NOW, results: [], flags: {} } };
    localStorage.setItem('gambit.mistakeLab.v1', JSON.stringify(outOfRange));
    // 99 is an integer beyond the queue: the COMPLETED interpretation is the
    // only sane one — index clamps to the queue length
    expect(loadLab().session?.index).toBe(2);
  });

  it('ADVERSARIAL: a NaN-equivalent persisted cursor (null after JSON) is recovered', () => {
    const state = stateWith(['a', 'b']);
    const corrupted = { ...state, session: { queue: ['a', 'b'], index: null, startedAt: NOW, results: [], flags: {} } };
    localStorage.setItem('gambit.mistakeLab.v1', JSON.stringify(corrupted)); // NaN serializes to null
    const loaded = loadLab();
    expect(loaded.session?.index).toBe(0);
    expect(currentExercise(loaded)?.id).toBe('a');
  });

  it('ADVERSARIAL: malformed RESULTS cannot unmask answers or fake completion', () => {
    const state = stateWith(['a', 'b', 'c']);
    const started = startSession(state, NOW); // cursor 0 — NOTHING resolved yet
    const poisoned = {
      ...started,
      session: {
        ...started.session!,
        // a corrupted writer claims the CURRENT exercise was solved (with a
        // bogus outcome) and pads with an unrecognized outcome
        results: [
          { id: 'a', outcome: 'clean' as const }, // current/unresolved — must be dropped
          { id: 'b', outcome: 'hacked' as never }, // unrecognized outcome — dropped
        ],
      },
    };
    localStorage.setItem('gambit.mistakeLab.v1', JSON.stringify(poisoned));
    const loaded = loadLab();
    expect(loaded.session?.results).toEqual([]); // no fake progress survives
    expect(loaded.session?.index).toBe(0); // no fake completion
    // and the page would keep BOTH answers masked (nothing was "resolved")
    const hidden = loaded.session!.queue.filter((id) => !loaded.session!.results.some((r) => r.id === id));
    expect(hidden).toEqual(['a', 'b', 'c']);
  });

  it('ADVERSARIAL: a DUPLICATE queue id cannot expose its answer via an earlier result', () => {
    // corrupted persistence: queue [a, a, b], cursor 1 (the SECOND 'a' is
    // unresolved), but a result claims 'a' was solved — the duplicate would
    // let hiddenAnswers treat the unresolved copy as resolved
    const state = stateWith(['a', 'a', 'b']);
    const corrupted = {
      ...state,
      session: {
        queue: ['a', 'a', 'b'],
        index: 1,
        startedAt: NOW,
        results: [{ id: 'a', outcome: 'clean' as const }], // for the EARLIER 'a'
        flags: {},
      },
    };
    localStorage.setItem('gambit.mistakeLab.v1', JSON.stringify(corrupted));
    const loaded = loadLab();
    // the duplicate collapses; the cursor re-anchors onto the SAME exercise
    expect(loaded.session?.queue).toEqual(['a', 'b']);
    expect(loaded.session?.index).toBe(0);
    // the corrupt result is DROPPED (it claimed the still-unresolved copy)
    expect(loaded.session?.results).toEqual([]);
    // -> 'a' is served UNRESOLVED with its answer masked, no fake completion
    expect(currentExercise(loaded)?.id).toBe('a');
  });


  it('ADVERSARIAL: valid completed progress SURVIVES sanitation', () => {
    const state = stateWith(['a', 'b', 'c']);
    const started = startSession(state, NOW);
    const partial = completeCurrent(completeCurrent(started, 'clean', NOW), 'after-wrong', NOW); // a, b resolved
    localStorage.setItem('gambit.mistakeLab.v1', JSON.stringify(partial));
    const loaded = loadLab();
    expect(loaded.session?.index).toBe(2);
    expect(loaded.session?.results).toEqual([
      { id: 'a', outcome: 'clean' },
      { id: 'b', outcome: 'after-wrong' },
    ]);
  });

  it('startSession queues due exercises (capped) and currentExercise serves them in order', () => {
    const state = stateWith(['a', 'b', 'c']);
    const started = startSession(state, NOW);
    expect(started.session?.queue).toEqual(['a', 'b', 'c']);
    expect(currentExercise(started)?.id).toBe('a');
    const afterOne = completeCurrent(started, 'clean', NOW);
    expect(currentExercise(afterOne)?.id).toBe('b');
    expect(afterOne.session?.results).toEqual([{ id: 'a', outcome: 'clean' }]);
  });

  it('a session persists in the state object — resumable after reload', () => {
    const state = stateWith(['a', 'b']);
    const started = startSession(state, NOW);
    const partial = completeCurrent(started, 'after-wrong', NOW);
    // simulate reload: the persisted partial state re-reads the same session
    const resumed = currentExercise(partial);
    expect(resumed?.id).toBe('b');
  });

  it('abandonSession lapses only the UNRESOLVED remainder', () => {
    const state = stateWith(['a', 'b', 'c']);
    const started = startSession(state, NOW);
    const partial = completeCurrent(started, 'clean', NOW); // 'a' resolved
    const abandoned = abandonSession(partial, NOW);
    expect(abandoned.session).toBeNull();
    const a = abandoned.exercises.find((x) => x.id === 'a')!;
    const b = abandoned.exercises.find((x) => x.id === 'b')!;
    const c = abandoned.exercises.find((x) => x.id === 'c')!;
    expect(a.attempts).toBe(1); // recorded before abandon
    expect(b.attempts).toBe(1); // lapsed
    expect(c.attempts).toBe(1); // lapsed
    expect(b.sr.lastResult).toBe('again');
  });

  it('dueExercises respects the schedule: solved-later items are not due', () => {
    const state = stateWith(['a']);
    let started = startSession(state, NOW);
    started = completeCurrent(started, 'clean', NOW);
    // 'clean' schedules a future due date — nothing is due right now
    expect(dueExercises(started, NOW)).toEqual([]);
    expect(dueExercises(started, NOW + 40 * DAY).length).toBe(1);
  });

  it('stats count due/mastered/sources honestly', () => {
    const state = stateWith(['a', 'b']);
    const stats = labStats(state, NOW);
    expect(stats).toEqual({ total: 2, due: 2, mastered: 0, sources: 2 });
  });
});


describe('report cache verification (shared by Review fast path + Lab harvest)', () => {
  it('a healthy cache verifies and yields the canonical before-FENs', () => {
    const { rec, report } = gameWithMistake();
    const v = verifyReportAgainstGame(report, rec.moves, rec.initialFen);
    expect(v.ok).toBe(true);
    const probe = new Chess();
    probe.move('e4');
    probe.move('e5');
    expect(v.fensBefore?.[2]).toBe(probe.fen());
    // fast path preserved: a healthy cache avoids redundant engine analysis
    expect(isReportCacheUsable(report, rec.moves, rec.initialFen)).toBe(true);
  });

  it('REGRESSION: a same-length cache with an INCORRECT SAN fails verification (reanalysis, not reuse)', () => {
    const { rec, report } = gameWithMistake();
    const mismatched: GameReport = {
      ...report,
      reviews: report.reviews.map((r, i) => (i === 4 ? { ...r, san: 'Qf3' } : r)), // wrong SAN, same length
    };
    expect(verifyReportAgainstGame(mismatched, rec.moves, rec.initialFen).ok).toBe(false);
    expect(isReportCacheUsable(mismatched, rec.moves, rec.initialFen)).toBe(false); // -> fresh analysis runs
  });

  it('METADATA: an UNKNOWN move classification fails verification (reanalysis, not reuse)', () => {
    const { rec, report } = gameWithMistake();
    const hacked: GameReport = {
      ...report,
      reviews: report.reviews.map((r, i) =>
        i === 2 ? { ...r, classification: 'hacked-class' as MoveClass } : r,
      ),
    };
    expect(verifyReportAgainstGame(hacked, rec.moves, rec.initialFen).ok).toBe(false);
    expect(isReportCacheUsable(hacked, rec.moves, rec.initialFen)).toBe(false);
  });

  it('METADATA: an INVALID cpl (negative / non-numeric) fails verification', () => {
    const { rec, report } = gameWithMistake();
    const negative: GameReport = {
      ...report,
      reviews: report.reviews.map((r, i) => (i === 2 ? { ...r, cpl: -50 } : r)), // CPL is never negative
    };
    expect(verifyReportAgainstGame(negative, rec.moves, rec.initialFen).ok).toBe(false);
    const nonNumeric: GameReport = {
      ...report,
      reviews: report.reviews.map((r, i) => (i === 2 ? { ...r, cpl: 'huge' as unknown as number } : r)),
    };
    expect(verifyReportAgainstGame(nonNumeric, rec.moves, rec.initialFen).ok).toBe(false);
    expect(isReportCacheUsable(nonNumeric, rec.moves, rec.initialFen)).toBe(false);
  });

  it('METADATA: missing/malformed STATISTICS (counts, accuracy, avgCpl) fail verification', () => {
    const { rec, report } = gameWithMistake();
    const missingKey = {
      ...report,
      counts: { w: { brilliant: 0 }, b: fullCounts() }, // most MoveClass keys absent
    } as unknown as GameReport;
    expect(isReportCacheUsable(missingKey, rec.moves, rec.initialFen)).toBe(false);
    const malformedAccuracy = {
      ...report,
      accuracy: { w: 'ninety', b: 85 },
    } as unknown as GameReport;
    expect(isReportCacheUsable(malformedAccuracy, rec.moves, rec.initialFen)).toBe(false);
    const malformedAvg = {
      ...report,
      avgCpl: { w: Number.NaN, b: 20 },
    } as unknown as GameReport;
    expect(isReportCacheUsable(malformedAvg, rec.moves, rec.initialFen)).toBe(false);
    // control: the untouched healthy cache is still usable (fast path preserved)
    expect(isReportCacheUsable(report, rec.moves, rec.initialFen)).toBe(true);
  });

  it('REGRESSION: a same-length cache with a WRONG MOVER COLOR fails verification', () => {
    const { rec, report } = gameWithMistake();
    const mismatched: GameReport = {
      ...report,
      reviews: report.reviews.map((r, i) => (i === 2 ? { ...r, color: 'b' as const } : r)),
    };
    expect(isReportCacheUsable(mismatched, rec.moves, rec.initialFen)).toBe(false);
  });

  it('REGRESSION: a TRUNCATED report (no eval after the final move) is unusable', () => {
    const { rec, report } = gameWithMistake();
    const truncated: GameReport = { ...report, evals: report.evals.slice(0, report.evals.length - 1) };
    expect(verifyReportAgainstGame(truncated, rec.moves, rec.initialFen).ok).toBe(false);
    expect(isReportCacheUsable(truncated, rec.moves, rec.initialFen)).toBe(false); // reanalysis, not reuse
  });

  it('COMPLETENESS: ONE failed position (null eval) makes the report unusable', () => {
    const { rec, report } = gameWithMistake();
    const partial: GameReport = {
      ...report,
      evals: report.evals.map((e, i) => (i === 4 ? null : e)), // one position never analysed
    };
    expect(verifyReportAgainstGame(partial, rec.moves, rec.initialFen).ok).toBe(false);
    expect(isReportCacheUsable(partial, rec.moves, rec.initialFen)).toBe(false); // reanalysis, not reuse
    // and the lab refuses to harvest from it
    expect(harvestFromGame(rec, partial, NOW).status).toBe('rejected');
  });

  it('COMPLETENESS: a report with EVERY evaluation failed is unusable', () => {
    const { rec, report } = gameWithMistake();
    const allFailed: GameReport = { ...report, evals: report.evals.map(() => null) };
    expect(verifyReportAgainstGame(allFailed, rec.moves, rec.initialFen).ok).toBe(false);
    expect(isReportCacheUsable(allFailed, rec.moves, rec.initialFen)).toBe(false);
  });

  it('COMPLETENESS: a complete healthy report verifies with every FEN present', () => {
    const { rec, report } = gameWithMistake();
    const v = verifyReportAgainstGame(report, rec.moves, rec.initialFen);
    expect(v.ok).toBe(true);
    expect(v.fensBefore).toHaveLength(rec.moves.length);
  });

  it('a cache whose moves do not replay is unusable', () => {
    const { report } = gameWithMistake();
    expect(verifyReportAgainstGame(report, ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#', 'Ke7'], undefined).ok).toBe(false);
    expect(verifyReportAgainstGame(report, ['e4', 'Zz9'], undefined).ok).toBe(false);
  });
});
