import { beforeEach, describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import type { GameReport, MoveClass } from './review';
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
  harvestAll,
  harvestFromGame,
  isMastered,
  labStats,
  MASTERED_INTERVAL_DAYS,
  MAX_PER_GAME,
  outcomeToGrade,
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

/** A real 3-ply game: 1. e4 (blunder: plays f3?) — use a legal short line
    where white's 2nd move is a genuine mistake with a verified best move. */
const GAME_MOVES = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'];

function reportFor(moves: string[], mistakes: Record<number, { classification: MoveClass; cpl: number; bestSan: string }>): GameReport {
  // replay for real so evals/fens line up with an actual engine pass
  const reviews = moves.map((san, i) => {
    const m = mistakes[i];
    const classification: MoveClass = m?.classification ?? 'best';
    return { san, color: (i % 2 === 0 ? 'w' : 'b') as 'w' | 'b', cpl: m?.cpl ?? 0, classification };
  });
  // build evals BEFORE each ply by replaying step by step
  const evals: GameReport['evals'] = [];
  const probe = new Chess();
  for (let i = 0; i <= moves.length; i++) {
    const m = mistakes[i];
    evals.push({
      cp: 0,
      mateIn: null,
      bestSan: m?.bestSan ?? null,
    });
    if (i < moves.length) probe.move(moves[i]);
  }
  return {
    reviews,
    evals,
    accuracy: { w: 90, b: 85 },
    counts: { w: {}, b: {} } as GameReport['counts'],
    avgCpl: { w: 10, b: 20 },
  };
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
    const exercises = harvestFromGame(rec, report, NOW);
    expect(exercises).toHaveLength(1);
    const ex = exercises[0];
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

  it('refuses a game whose SAN replay diverges from the cached report', () => {
    const { rec, report } = gameWithMistake();
    const corrupted = { ...rec, moves: ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#', 'Ke7'] }; // extra move
    expect(harvestFromGame(corrupted, report, NOW)).toEqual([]);
  });

  it('skips plies whose eval has no verified best move (no fabrication)', () => {
    const { rec, report } = gameWithMistake();
    const noBest: GameReport = {
      ...report,
      evals: report.evals.map((e) => (e ? { ...e, bestSan: null } : e)),
    };
    expect(harvestFromGame(rec, noBest, NOW)).toEqual([]);
  });

  it("REGRESSION: the OPPONENT's critical moves are never harvested (personal lab)", () => {
    // black (the opponent) blunders at ply 3 — white's lab must not train it
    const mistakes: Record<number, { classification: MoveClass; cpl: number; bestSan: string }> = {
      2: { classification: 'blunder', cpl: 320, bestSan: 'Nf3' }, // white (player)
      3: { classification: 'blunder', cpl: 400, bestSan: 'Qe7' }, // black (opponent)
    };
    const rec = makeRecord({ moves: GAME_MOVES, playerColor: 'w' });
    const report = reportFor(GAME_MOVES, mistakes);
    const exercises = harvestFromGame(rec, report, NOW);
    expect(exercises.map((x) => x.ply)).toEqual([2]);
  });

  it('REGRESSION: a same-length cache from DIFFERENT moves is rejected (SAN+color verified per ply)', () => {
    const { rec } = gameWithMistake();
    // same length, but the cached review describes a different game
    const otherMoves = ['d4', 'd5', 'Bf4', 'Nf6', 'e3', 'e6', 'Nf3'];
    const report = reportFor(otherMoves, { 2: MISTAKE_AT_2 });
    expect(harvestFromGame(rec, report, NOW)).toEqual([]);
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
        mistakes[ply] = { classification: 'mistake', cpl: 100 + ply, bestSan: (legal.find((l) => l !== chosen) ?? chosen) };
      }
      ply += 1;
    }
    moves.push(...sans);
    const rec = makeRecord({ moves, pgn: moves.join(' ') });
    const report = reportFor(moves, mistakes);
    const exercises = harvestFromGame(rec, report, NOW);
    expect(exercises.length).toBeLessThanOrEqual(MAX_PER_GAME);
    // worst-cpl first
    for (let i = 1; i < exercises.length; i++) {
      expect(exercises[i - 1].cpl).toBeGreaterThanOrEqual(exercises[i].cpl);
    }
  });
});

describe('harvestAll + dedupe', () => {
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
    const [ex] = harvestFromGame(rec, report, NOW);
    expect(gradeLabMove(ex, 'Nf3')).toBe('correct');
    expect(gradeLabMove(ex, 'Qxf7')).toBe('wrong');
  });

  it('outcomes map to honest SR grades', () => {
    expect(outcomeToGrade('clean')).toBe('good');
    expect(outcomeToGrade('after-wrong')).toBe('hard');
    expect(outcomeToGrade('assisted')).toBe('hard');
  });

  it('applyOutcome records the attempt and schedules SR', () => {
    const { rec, report } = gameWithMistake();
    const [ex] = harvestFromGame(rec, report, NOW);
    let state: MistakeLabState = { ...emptyLabState(), exercises: [ex] };
    state = applyOutcome(state, ex.id, 'clean', NOW);
    expect(state.exercises[0].attempts).toBe(1);
    expect(state.exercises[0].solved).toBe(1);
    expect(state.exercises[0].sr.reps).toBe(1);
    expect(state.exercises[0].lastPracticed).toBe(NOW);
  });

  it('mastery is interval-based, never a fake counter', () => {
    const { rec, report } = gameWithMistake();
    const [ex] = harvestFromGame(rec, report, NOW);
    expect(isMastered(ex)).toBe(false);
    const mastered: LabExercise = { ...ex, sr: { ...ex.sr, interval: MASTERED_INTERVAL_DAYS } };
    expect(isMastered(mastered)).toBe(true);
  });
});

describe('sessions (resumable)', () => {
  function stateWith(ids: string[]): MistakeLabState {
    const { rec, report } = gameWithMistake();
    const [ex] = harvestFromGame(rec, report, NOW);
    const exercises = ids.map((id, i) => ({ ...ex, id, gameId: `g${i}` }));
    return { ...emptyLabState(), exercises };
  }

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
