import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, waitFor } from '@testing-library/react';
import { Chess } from 'chess.js';
import { validateGameRecord, parseBackupText } from './backup/validate';
import { buildBackup } from './backup/exportBackup';
import { matchRepertoire } from './repertoireMatch';
import { applySan, createTree } from './gameTree';
import { START_FEN } from './chessUtils';
import MoveList from '../components/MoveList';
import { buildReport } from './review';
import { exportPgn, importPgn } from './pgn';
import { useGame, type SavedGame } from '../hooks/useGame';
import type { GameConfig, GameRecord, Ply, TimeControl } from './types';
import type { Square } from 'chess.js';

/* ============================================================
   PR-C — custom-FEN correctness regressions.
   Games started from a non-standard position (Position Editor
   deep link) must be first-class everywhere: lifecycle, records,
   PGN, review replay, backup validation.
   ============================================================ */

const UNLIMITED: TimeControl = { id: 'unlimited', label: 'No clock', category: 'Unlimited', minutes: 0, increment: 0 };
const RAPID: TimeControl = { id: '5+0', label: '5 min', category: 'Rapid', minutes: 5, increment: 0 };

// black to move, white's e-pawn missing: "e4" is legal HERE and illegal
// from the standard start — a custom-position proof SAN
const NO_E_PAWN_BLACK: string = 'rnbqkbnr/pppp1ppp/8/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
// bare kings, white to move: any move ends the game (insufficient material)
const K_VS_K: string = '8/8/8/8/8/8/8/K6k w - - 0 1';

function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    mode: 'pass',
    timeControl: UNLIMITED,
    playerColor: 'w',
    aiLevel: 2,
    ...overrides,
  };
}

/** Real app shape: gameRef.pgn() always carries SetUp/FEN headers for
 *  custom-start games (chess.js 1.4 writes them from the constructor FEN). */
function customPgn(sans: string[]): string {
  const g = new Chess(NO_E_PAWN_BLACK);
  for (const san of sans) g.move(san);
  return g.pgn();
}

function record(overrides: Partial<GameRecord> = {}): GameRecord {
  return {
    id: 'cf-1',
    date: Date.now(),
    mode: 'ai',
    timeControl: UNLIMITED,
    playerColor: 'b',
    opponentName: 'Engine · Club',
    opponentRating: 1900,
    result: 'win',
    reason: 'resignation',
    // black moves first (custom start); Nc6 as a FIRST move is illegal at the
    // standard start, so an accepted record proves the FEN was actually used
    moves: ['Nc6', 'Nf3'],
    pgn: customPgn(['Nc6', 'Nf3']),
    initialFen: NO_E_PAWN_BLACK,
    ratingBefore: 1200,
    ratingAfter: 1200,
    ...overrides,
  };
}

/* ---------- backup validation accepts and enforces custom starts ---------- */
describe('validateGameRecord with custom initialFen (PR-C)', () => {
  it('accepts a custom-start record whose first move is illegal at the standard start', () => {
    expect(() => validateGameRecord(record())).not.toThrow();
  });

  it('a legacy record without initialFen replays from the STANDARD start (black-first SAN rejected)', () => {
    // without initialFen the validator must NOT invent a custom position:
    // Nc6 is a black move and is illegal as white's first move
    const rec = record({ moves: ['Nc6'], initialFen: undefined, pgn: '1... Nc6' });
    expect(() => validateGameRecord(rec)).toThrow();
  });

  it('rejects a SAN that is illegal in the declared custom position', () => {
    // K vs K has no pawn: e4 is illegal there
    expect(() => validateGameRecord(record({ initialFen: K_VS_K, moves: ['e4'] }))).toThrow();
  });

  it('rejects a malformed initialFen (non-string and invalid FEN)', () => {
    expect(() => validateGameRecord(record({ initialFen: 42 as unknown as string }))).toThrow();
    expect(() => validateGameRecord(record({ initialFen: 'not a fen' }))).toThrow();
    expect(() => validateGameRecord(record({ initialFen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNK w KQkq - 0 1' }))).toThrow(); // two white kings? no — K on h1 + standard K = 2 kings → invalid
  });

  it('PGN SetUp/FEN headers survive a chess.js round trip for custom starts', () => {
    const g = new Chess(NO_E_PAWN_BLACK);
    g.move('Nc6');
    g.move('Nf3');
    const pgn = g.pgn();
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${NO_E_PAWN_BLACK}"]`);
    const restored = new Chess();
    restored.loadPgn(pgn);
    expect(restored.fen()).toBe(g.fen());
    expect(restored.history()).toEqual(['Nc6', 'Nf3']);
  });

  it('a STANDARD game writes no FEN header (legacy compatibility)', () => {
    const g = new Chess();
    g.move('e4');
    expect(g.pgn()).not.toContain('[FEN');
    expect(g.pgn()).not.toContain('[SetUp');
  });
});

/* ---------- repertoire matching never fabricates opening lines ---------- */
describe('matchRepertoire with custom starts (PR-C)', () => {
  function e4Repertoire() {
    const tree = createTree(START_FEN);
    const e4 = applySan(tree, null, 'e4');
    if (!e4.ok) throw new Error('e4 failed');
    applySan(tree, e4.id, 'c5');
    return [
      {
        id: 'rep-1',
        name: 'e4 repertoire',
        side: 'w' as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lines: [{ id: 'line-1', name: 'main', tree, preferred: {} }],
      },
    ];
  }

  it('returns no match for a custom-start game even with identical moves', () => {
    const result = matchRepertoire(e4Repertoire() as never, 'w', ['e4', 'c5'], NO_E_PAWN_BLACK);
    expect(result).toBeNull();
  });

  it('still matches standard-start games (unchanged)', () => {
    const result = matchRepertoire(e4Repertoire() as never, 'w', ['e4', 'c5']);
    expect(result?.followedPlies).toBe(2);
  });
});

/* ---------- backup validation of custom-start active games (PR #6 review) ---------- */
describe('activeGame backup validation with custom starts (PR-C review)', () => {
  function activeGameBackup(activeGame: Record<string, unknown>): string {
    localStorage.setItem('gambit.activeGame', JSON.stringify(activeGame));
    return buildBackup().text;
  }

  it('accepts a custom legacy active game: headerless pgn validated from its declared FEN', () => {
    const text = activeGameBackup({
      config: config({ mode: 'pass', initialFen: NO_E_PAWN_BLACK }),
      playerColor: 'b',
      pgn: '1... Nc6', // black-first — illegal from the standard start, valid from the declared FEN
      clocks: null,
      savedAt: 5,
    });
    expect(() => parseBackupText(text)).not.toThrow();
  });

  it('accepts a headered custom active game whose FEN header agrees with the config', () => {
    const g = new Chess(NO_E_PAWN_BLACK);
    g.move('Nc6');
    const text = activeGameBackup({
      config: config({ mode: 'pass', initialFen: NO_E_PAWN_BLACK }),
      playerColor: 'b',
      pgn: g.pgn(),
      clocks: null,
      savedAt: 5,
    });
    expect(() => parseBackupText(text)).not.toThrow();
  });

  it('rejects an active game whose PGN FEN header disagrees with config.initialFen', () => {
    const g = new Chess(NO_E_PAWN_BLACK);
    g.move('Nc6');
    const text = activeGameBackup({
      config: config({ mode: 'pass', initialFen: NO_E_PAWN_BLACK }),
      playerColor: 'b',
      pgn: g.pgn().replace(`[FEN "${NO_E_PAWN_BLACK}"]`, `[FEN "${START_FEN}"]`),
      clocks: null,
      savedAt: 5,
    });
    expect(() => parseBackupText(text)).toThrow();
  });

  it('rejects an active game whose move text is illegal from its declared start', () => {
    // K-vs-K has no pawns: e4 cannot be played there
    const text = activeGameBackup({
      config: config({ mode: 'pass', initialFen: K_VS_K }),
      playerColor: 'w',
      pgn: '1. e4',
      clocks: null,
      savedAt: 5,
    });
    expect(() => parseBackupText(text)).toThrow();
  });

  it('rejects an active game with a non-string or invalid initialFen', () => {
    const bad = activeGameBackup({
      config: config({ mode: 'pass', initialFen: 'not a fen' }),
      playerColor: 'w',
      pgn: '',
      clocks: null,
      savedAt: 5,
    });
    expect(() => parseBackupText(bad)).toThrow();
  });

  it('standard legacy active games validate unchanged (format-v1 compatibility)', () => {
    const text = activeGameBackup({ config: { mode: 'pass' }, playerColor: 'w', pgn: '1. e4 e5', clocks: null, savedAt: 5 });
    expect(() => parseBackupText(text)).not.toThrow();
  });

  it('a game RECORD whose PGN FEN header disagrees with initialFen is rejected', () => {
    const g = new Chess(NO_E_PAWN_BLACK);
    g.move('Nc6');
    g.move('Nf3');
    expect(() => validateGameRecord(record({ pgn: g.pgn().replace(`[FEN "${NO_E_PAWN_BLACK}"]`, `[FEN "${START_FEN}"]`) }))).toThrow();
  });
});

/* ---------- MoveList fullmove numbering (PR #6 review) ---------- */
describe('MoveList numbering from the start FEN (PR-C review)', () => {
  const ply = (san: string, color: 'w' | 'b', i: number): Ply => ({
    san,
    from: 'e2' as Square,
    to: 'e4' as Square,
    color,
    fenAfter: `after-${i}`,
    isCapture: false,
    isCheck: false,
  });

  it('a black-first custom game at fullmove 23 numbers its opening move 23... in the BLACK column', () => {
    const fen23 = 'rnbqkbnr/pppp1ppp/8/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 23';
    const onSelect = vi.fn();
    const { container } = render(<MoveList plies={[ply('Nc6', 'b', 0), ply('Nf3', 'w', 1)]} startFen={fen23} onSelect={onSelect} />);
    const nos = [...container.querySelectorAll('.mv-no')].map((e) => e.textContent);
    expect(nos).toEqual(['23...', '24.']);
    const cells = [...container.querySelectorAll('.mv')].map((e) => e.textContent);
    expect(cells[0]).toBe(''); // white column empty: black moved first
    expect(cells[1]).toBe('Nc6');
    expect(cells[2]).toBe('Nf3');
    // selection indices are ply positions, unaffected by the black-first row
    fireEvent.click(container.querySelectorAll('.mv')[1]!);
    expect(onSelect).toHaveBeenCalledWith(0);
    fireEvent.click(container.querySelectorAll('.mv')[2]!);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('a white-first custom game at fullmove 30 numbers rows 30., 31. in the white column', () => {
    const fen30 = 'rnbqkbnr/pppp1ppp/8/8/8/8/PPPP1PPP/RNBQKBNR w KQkq - 0 30';
    const { container } = render(<MoveList plies={[ply('Nf3', 'w', 0), ply('Nc6', 'b', 1)]} startFen={fen30} />);
    const nos = [...container.querySelectorAll('.mv-no')].map((e) => e.textContent);
    expect(nos).toEqual(['30.']); // two plies = ONE full-move row
    const cells = [...container.querySelectorAll('.mv')].map((e) => e.textContent);
    expect(cells[0]).toBe('Nf3'); // white column first, as in standard chess
    expect(cells[1]).toBe('Nc6');
  });

  it('standard games keep 1.-numbering (no startFen → unchanged behavior)', () => {
    const { container } = render(<MoveList plies={[ply('e4', 'w', 0), ply('e5', 'b', 1)]} />);
    const nos = [...container.querySelectorAll('.mv-no')].map((e) => e.textContent);
    expect(nos).toEqual(['1.']);
    const cells = [...container.querySelectorAll('.mv')].map((e) => e.textContent);
    expect(cells).toEqual(['e4', 'e5']);
  });
});

/* ---------- game lifecycle from custom positions ---------- */
describe('useGame with custom initialFen (PR-C)', () => {
  // NOTE: this test runs FIRST in this describe deliberately — in a full-file
  // run after several other hook tests it can exceed the 5s budget in
  // test-environment teardown timing (verified passing in isolation and
  // here, with every assertion — over at mount, clock stopped, zero engine
  // searches — holding either way).
  it('a checkmate START position (engine to move) never issues an engine search', async () => {
    // fool's mate final position: white to move, white is checkmated — and
    // the ENGINE owns white here (player is black), so without the
    // synchronous over-guard the mount effect would search for a mated side
    const mate = (() => {
      const g = new Chess();
      g.move('f3');
      g.move('e5');
      g.move('g4');
      g.move('Qh4');
      return g.fen();
    })();
    const engineSearch = vi.fn(async () => null);
    const over = vi.fn();
    const { result } = renderHook(() =>
      useGame({
        config: config({ mode: 'ai', timeControl: RAPID, playerColor: 'b', initialFen: mate }),
        engineSearch,
        initialFen: mate,
        onGameOver: over,
      }),
    );
    await waitFor(() => expect(result.current.over).not.toBeNull());
    expect(result.current.over?.winnerColor).toBe('b'); // black delivered mate
    expect(result.current.over?.reason).toBe('Checkmate');
    expect(result.current.clock.runningSide).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 60)); // give any (wrong) engine effect a chance to fire
    });
    expect(engineSearch).not.toHaveBeenCalled();
    expect(over).toHaveBeenCalledTimes(1);
  });


  it('black-to-move start: turn state and the RUNNING CLOCK follow the position, not white', async () => {
    const { result } = renderHook(() =>
      useGame({
        config: config({ mode: 'ai', timeControl: RAPID, playerColor: 'w', initialFen: NO_E_PAWN_BLACK }),
        engineSearch: vi.fn(async () => null),
        initialFen: NO_E_PAWN_BLACK,
      }),
    );
    await waitFor(() => expect(result.current.turn).toBe('b'));
    expect(result.current.clock.runningSide).toBe('b');
    expect(result.current.fen.startsWith(NO_E_PAWN_BLACK.split(' ')[0])).toBe(true);
  });

  it('a K-vs-K custom start is ALREADY terminal at mount: no playable turn, no clock, zero-move end', async () => {
    // insufficient material at the start position — adjudicated immediately,
    // before any move can be played
    const over = vi.fn();
    const { result } = renderHook(() =>
      useGame({
        config: config({ mode: 'pass', initialFen: K_VS_K }),
        engineSearch: vi.fn(async () => null),
        initialFen: K_VS_K,
        onGameOver: over,
      }),
    );
    await waitFor(() => expect(result.current.over).not.toBeNull());
    expect(result.current.over?.winnerColor).toBeNull();
    expect(result.current.over?.reason).toContain('Insufficient material');
    expect(result.current.clock.runningSide).toBeNull();
    act(() => {
      expect(result.current.tryMove('a1', 'a2')).toBe('illegal'); // no playable turn remains
    });
    expect(over).toHaveBeenCalledTimes(1); // exactly one zero-move game-over
  });

  it('a stalemate START position ends immediately as a draw', async () => {
    const stalemate = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    const over = vi.fn();
    const { result } = renderHook(() =>
      useGame({
        config: config({ mode: 'pass', initialFen: stalemate }),
        engineSearch: vi.fn(async () => null),
        initialFen: stalemate,
        onGameOver: over,
      }),
    );
    await waitFor(() => expect(result.current.over).not.toBeNull());
    expect(result.current.over?.winnerColor).toBeNull();
    expect(result.current.over?.reason).toBe('Stalemate');
  });

  it('a fifty-move START position (99 halfmove clock, mating material) ends on the first move', async () => {
    // sufficient material (R can mate) so the mount check does not fire;
    // white's first move makes the 100th halfmove — an applicable draw
    const fifty = '8/8/8/8/8/8/8/RK5k w - - 99 99';
    const over = vi.fn();
    const { result } = renderHook(() =>
      useGame({
        config: config({ mode: 'pass', initialFen: fifty }),
        engineSearch: vi.fn(async () => null),
        initialFen: fifty,
        onGameOver: over,
      }),
    );
    await waitFor(() => expect(result.current.over).toBeNull()); // playable at start
    act(() => {
      expect(result.current.tryMove('a1', 'a2')).toBe('ok');
    });
    expect(result.current.over?.winnerColor).toBeNull();
    expect(result.current.over?.reason).toBe('Fifty-move rule');
  });

  it('headerless black-first resume: move text legal only from the CUSTOM start replays correctly', async () => {
    // "1... Nc6" is a BLACK first move — chess.js loadPgn from the standard
    // start rejects it outright; the replay must apply it to the custom FEN
    const resume: SavedGame = {
      config: config({ initialFen: NO_E_PAWN_BLACK }),
      playerColor: 'b',
      pgn: '1... Nc6',
      clocks: null,
    };
    const { result } = renderHook(() =>
      useGame({
        config: config({ initialFen: NO_E_PAWN_BLACK }),
        engineSearch: vi.fn(async () => null),
        resume,
      }),
    );
    await waitFor(() => expect(result.current.plies).toHaveLength(1));
    const expected = new Chess(NO_E_PAWN_BLACK);
    expected.move('Nc6');
    expect(result.current.fen).toBe(expected.fen());
    expect(result.current.turn).toBe('w');
  });

  it('headerless resume with malformed move text falls back to a fresh custom game (no throw)', async () => {
    const resume: SavedGame = {
      config: config({ initialFen: NO_E_PAWN_BLACK }),
      playerColor: 'b',
      pgn: '1... zz9 absolutely-not-a-move 2. e4',
      clocks: null,
    };
    const { result } = renderHook(() =>
      useGame({
        config: config({ initialFen: NO_E_PAWN_BLACK }),
        engineSearch: vi.fn(async () => null),
        resume,
      }),
    );
    await waitFor(() => expect(result.current.plies).toHaveLength(0));
    const fresh = new Chess(NO_E_PAWN_BLACK);
    expect(result.current.fen).toBe(fresh.fen());
  });

  it('resume restores a custom-start position even when the saved PGN has no FEN header', async () => {
    // legacy snapshot shape: headerless move text. chess.js loadPgn RESETS to
    // the standard start, so without the manual-replay path the custom
    // position (missing h1 rook) would silently become a standard game.
    const CUSTOM_WHITE = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 w Qkq - 0 1';
    const resume: SavedGame = {
      config: config({ initialFen: CUSTOM_WHITE }),
      playerColor: 'w',
      pgn: '1. Nf3',
      clocks: null,
    };
    const { result } = renderHook(() =>
      useGame({
        config: config({ initialFen: CUSTOM_WHITE }),
        engineSearch: vi.fn(async () => null),
        resume,
      }),
    );
    await waitFor(() => expect(result.current.plies).toHaveLength(1));
    const expected = new Chess(CUSTOM_WHITE);
    expected.move('Nf3');
    expect(result.current.fen).toBe(expected.fen());
    // the custom board is preserved: NOT the standard position after 1.Nf3
    const stdAfter = new Chess();
    stdAfter.move('Nf3');
    expect(result.current.fen).not.toBe(stdAfter.fen());
    expect(result.current.turn).toBe('b');
  });

  it('resume with a header-bearing PGN restores the exact custom position', async () => {
    const g = new Chess(NO_E_PAWN_BLACK);
    g.move('Nc6');
    g.move('Nf3');
    const resume: SavedGame = {
      config: config({ initialFen: NO_E_PAWN_BLACK }),
      playerColor: 'b',
      pgn: g.pgn(),
      clocks: null,
    };
    const { result } = renderHook(() =>
      useGame({
        config: config({ initialFen: NO_E_PAWN_BLACK }),
        engineSearch: vi.fn(async () => null),
        resume,
      }),
    );
    await waitFor(() => expect(result.current.plies).toHaveLength(2));
    expect(result.current.fen).toBe(g.fen());
  });

  it('standard-start games keep white-to-move/white-clock behavior (regression)', async () => {
    const { result } = renderHook(() =>
      useGame({
        config: config({ mode: 'ai', timeControl: RAPID, playerColor: 'w' }),
        engineSearch: vi.fn(async () => null),
      }),
    );
    await waitFor(() => expect(result.current.turn).toBe('w'));
    expect(result.current.clock.runningSide).toBe('w');
  });
});

/* ---------- Qodo review round: downstream custom-FEN correctness ---------- */
describe('PR #6 Qodo findings — downstream fixes', () => {
  const ply = (san: string, color: 'w' | 'b', i: number): Ply => ({
    san,
    from: 'e2' as Square,
    to: 'e4' as Square,
    color,
    fenAfter: `after-${i}`,
    isCapture: false,
    isCheck: false,
  });
  const ev = (cp: number) => ({ cp, mateIn: null, bestSan: null });

  it('exportPgn from a black-first custom start emits SetUp/FEN headers AND the moves', () => {
    const pgn = exportPgn(['Nc6', 'Nf3'], {}, NO_E_PAWN_BLACK);
    expect(pgn).toContain('[SetUp "1"]');
    expect(pgn).toContain(`[FEN "${NO_E_PAWN_BLACK}"]`);
    expect(pgn).toContain('Nc6');
    expect(pgn).toContain('Nf3');
    // and it round-trips through a fresh parser
    const restored = new Chess();
    restored.loadPgn(pgn);
    expect(restored.history()).toEqual(['Nc6', 'Nf3']);
  });

  it('exportPgn for standard games stays header-free (no FEN/SetUp)', () => {
    const pgn = exportPgn(['e4', 'e5']);
    expect(pgn).not.toContain('[FEN');
    expect(pgn).not.toContain('[SetUp');
  });

  it('a black-first game scores centipawn loss for the REAL mover (was even/odd)', () => {
    // black opens with a blunder: eval swings from -100 (black better) to +300
    const plies = [ply('Qh1+', 'b', 0), ply('Kd8', 'w', 1)];
    const evals = [ev(-100), ev(300), ev(300)];
    const report = buildReport(plies, evals, NO_E_PAWN_BLACK);
    expect(report.reviews[0].cpl).toBe(400); // black loses 400cp — counted for BLACK
    expect(report.reviews[0].classification).toBe('blunder');
    expect(report.counts.b.blunder).toBe(1);
    expect(report.counts.w.blunder).toBe(0);
  });

  it('custom-start games are never classified as opening book (standard-start book only)', () => {
    // d4 d5 IS a standard book line — from a custom start it is not theory
    const plies = [ply('d4', 'w', 0), ply('d5', 'b', 1)];
    const evals = [ev(0), ev(0), ev(0)];
    const custom = buildReport(plies, evals, NO_E_PAWN_BLACK);
    expect(custom.reviews[0].classification).not.toBe('book');
    const standard = buildReport(plies, evals);
    expect(standard.reviews[0].classification).toBe('book');
  });

  it('a timed black-first resume with NULL clocks re-targets the clock to the replayed turn', async () => {
    const resume: SavedGame = {
      config: config({ mode: 'ai', timeControl: RAPID, playerColor: 'b', initialFen: NO_E_PAWN_BLACK }),
      playerColor: 'b',
      pgn: '1... Nc6', // one saved move → it is WHITE's turn after resume
      clocks: null, // legacy snapshot shape without saved clocks
    };
    const { result } = renderHook(() =>
      useGame({
        config: config({ mode: 'ai', timeControl: RAPID, playerColor: 'b', initialFen: NO_E_PAWN_BLACK }),
        engineSearch: vi.fn(async () => null),
        resume,
      }),
    );
    await waitFor(() => expect(result.current.plies).toHaveLength(1));
    expect(result.current.turn).toBe('w');
    // the running clock must be WHITE's (the side to move), never black's
    expect(result.current.clock.runningSide).toBe('w');
  });
});

describe('PR #6 final review — importPgn actual start + editor reset', () => {
  const FEN_23 = 'rnbqkbnr/pppp1ppp/8/8/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 23';

  it('exportPgn → importPgn round trip keeps the black-first custom start (fullmove 23)', () => {
    const exported = exportPgn(['Nc6', 'Nf3'], {}, FEN_23);
    const parsed = importPgn(exported);
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.game.startFen).toBe(FEN_23); // the ACTUAL start, never START_FEN
    expect(parsed.game.moves).toEqual(['Nc6', 'Nf3']);
    expect(new Chess(parsed.game.startFen).turn()).toBe('b'); // initial side to move
    const expected = new Chess(FEN_23);
    expected.move('Nc6');
    expected.move('Nf3');
    expect(parsed.game.finalFen).toBe(expected.fen());
    expect(parsed.game.pgn).toContain('[SetUp "1"]');
    expect(parsed.game.pgn).toContain(`[FEN "${FEN_23}"]`);
  });

  it('a STANDARD pgn imports with the standard start (compatibility)', () => {
    const parsed = importPgn('1. e4 e5 2. Nf3');
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(parsed.game.startFen).toBe(START_FEN);
    expect(parsed.game.moves).toEqual(['e4', 'e5', 'Nf3']);
  });

  it('rejects contradictory metadata: SetUp "1" without a FEN header', () => {
    const parsed = importPgn(['[SetUp "1"]', '', '1. e4 e5'].join('\n'));
    expect(parsed.ok).toBe(false);
  });

  it('rejects contradictory metadata: SetUp "0" with a FEN header', () => {
    const parsed = importPgn(`[SetUp "0"]
[FEN "${FEN_23}"]

1... Nc6`);
    expect(parsed.ok).toBe(false);
  });

  it('rejects a malformed FEN header', () => {
    const parsed = importPgn(['[SetUp "1"]', '[FEN "not a fen"]', '', '1. e4'].join('\n'));
    expect(parsed.ok).toBe(false);
  });
});
