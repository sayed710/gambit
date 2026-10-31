import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { Chess } from 'chess.js';
import { validateGameRecord } from './backup/validate';
import { matchRepertoire } from './repertoireMatch';
import { applySan, createTree } from './gameTree';
import { START_FEN } from './chessUtils';
import { useGame, type SavedGame } from '../hooks/useGame';
import type { GameConfig, GameRecord, TimeControl } from './types';

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

/* ---------- game lifecycle from custom positions ---------- */
describe('useGame with custom initialFen (PR-C)', () => {
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

  it('a K-vs-K custom start terminates as insufficient material after any move', () => {
    const over = vi.fn();
    const { result } = renderHook(() =>
      useGame({
        config: config({ mode: 'pass', initialFen: K_VS_K }),
        engineSearch: vi.fn(async () => null),
        initialFen: K_VS_K,
        onGameOver: over,
      }),
    );
    act(() => {
      expect(result.current.tryMove('a1', 'a2')).toBe('ok');
    });
    expect(result.current.over).not.toBeNull();
    expect(result.current.over?.winnerColor).toBeNull();
    expect(result.current.over?.reason).toContain('Insufficient material');
    expect(over).toHaveBeenCalledTimes(1);
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
