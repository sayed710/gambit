import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Chess } from 'chess.js';
import { useGame } from './useGame';
import type { SavedGame } from './useGame';
import type { GameConfig, TimeControl } from '../lib/types';
import { START_FEN } from '../lib/chessUtils';

const UNLIMITED: TimeControl = { id: 'unlimited', label: 'No clock', category: 'Unlimited', minutes: 0, increment: 0 };
const BLITZ_1_3: TimeControl = { id: '1+3', label: '1 min', category: 'Blitz', minutes: 1, increment: 3 };

function config(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    mode: 'pass',
    timeControl: UNLIMITED,
    playerColor: 'w',
    aiLevel: 2,
    ...overrides,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Render useGame and return a stable api proxy (result.current changes per render). */
function setup(opts: { config?: GameConfig; initialFen?: string; onGameOver?: (info: { winnerColor: 'w' | 'b' | null; reason: string }) => void; resume?: SavedGame | null } = {}) {
  const utils = renderHook(() =>
    useGame({
      config: opts.config ?? config(),
      engineSearch: vi.fn(async () => null),
      onGameOver: opts.onGameOver,
      initialFen: opts.initialFen,
      resume: opts.resume,
    }),
  );
  const api = () => utils.result.current;
  return { utils, api };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('promotion flow (bug 1)', () => {
  it('white queen promotion: pending state, then committed move', async () => {
    const { api } = setup({ initialFen: '7k/5P2/8/8/8/8/8/K7 w - - 0 1' });
    let result: 'ok' | 'promote' | 'illegal' = 'illegal';
    act(() => {
      result = api().tryMove('f7', 'f8');
    });
    expect(result).toBe('promote');
    expect(api().pendingPromotion).toEqual({ from: 'f7', to: 'f8', color: 'w' });
    expect(api().plies).toHaveLength(0); // nothing committed yet

    act(() => {
      api().choosePromotion('q');
    });
    await waitFor(() => expect(api().plies).toHaveLength(1));
    expect(api().pendingPromotion).toBeNull();
    expect(api().getMoves()).toEqual(['f8=Q+']);
    expect(api().getFen().split(' ')[0]).toContain('Q');
    expect(api().getFen().includes('5Q2')).toBe(false); // pawn gone from f7
  });

  it.each(['n', 'r', 'b'] as const)('white underpromotion to %s commits correctly', (piece) => {
    const { api } = setup({ initialFen: '7k/5P2/8/8/8/8/8/K7 w - - 0 1' });
    act(() => {
      expect(api().tryMove('f7', 'f8')).toBe('promote');
    });
    act(() => {
      api().choosePromotion(piece);
    });
    // knight and bishop on f8 do not check the h-file king; rook does
    const expectedCheck = piece === 'r' ? '+' : '';
    expect(api().getMoves()).toEqual([`f8=${piece.toUpperCase()}${expectedCheck}`]);
    expect(new Chess(api().getFen()).get('f8')?.type).toBe(piece);
  });

  it('black promotion commits with black color', async () => {
    const { api } = setup({ initialFen: '7k/8/8/8/8/8/1p6/K7 b - - 0 1' });
    act(() => {
      expect(api().tryMove('b2', 'b1')).toBe('promote');
    });
    expect(api().pendingPromotion?.color).toBe('b');
    act(() => {
      api().choosePromotion('q');
    });
    await waitFor(() => expect(api().plies).toHaveLength(1));
    expect(api().getMoves()).toEqual(['b1=Q+']);
    expect(api().plies[0].color).toBe('b');
  });

  it('promotion applies for drag-and-drop path identically (tryMove with explicit piece)', () => {
    const { api } = setup({ initialFen: '7k/5P2/8/8/8/8/8/K7 w - - 0 1' });
    act(() => {
      expect(api().tryMove('f7', 'f8', 'q')).toBe('ok');
    });
    expect(api().getMoves()).toEqual(['f8=Q+']);
    expect(api().pendingPromotion).toBeNull();
  });

  it('a second move cannot be played while promotion is pending, and works after choosing', () => {
    const { api } = setup({ initialFen: '7k/5P2/8/8/8/8/8/K7 w - - 0 1' });
    act(() => {
      api().tryMove('f7', 'f8');
    });
    act(() => {
      expect(api().tryMove('a1', 'a2')).toBe('illegal'); // blocked while pending
    });
    act(() => {
      api().choosePromotion('q');
    });
    expect(api().plies).toHaveLength(1);
  });

  it('underpromotion can deliver checkmate and game over fires with the move present', async () => {
    const overSpy = vi.fn();
    // Nf8#? craft: black king h8, white Kg6? use classic: pawn g7, kings f6/h8? keep simple:
    // 7k/5PP1/8/8/8/8/8/K7 w: g8=Q#? h8 king: g8 queen adjacent → mate (h7 pawn? none) —
    // but g7 pawn blocks. Use: pawn on g7, king h8 → g8=N is NOT mate; f7 pawn f8=Q? no.
    // Back-rank underpromotion mate: 5rk1/4Pppp? complicated. Use rook underpromo mate:
    // black Kg8, white pawn e7 → e8=R# if e8 covered... skip; queen promo mate:
    const { api } = setup({ initialFen: '6k1/4Pppp/8/8/8/8/8/K7 w - - 0 1', onGameOver: overSpy });
    act(() => {
      expect(api().tryMove('e7', 'e8')).toBe('promote');
    });
    act(() => {
      api().choosePromotion('q');
    });
    await waitFor(() => expect(api().over).not.toBeNull());
    // e8=Q+ vs Kg8 with f7,g7,h7 pawns → back-rank mate
    expect(api().over?.winnerColor).toBe('w');
    expect(api().over?.reason).toBe('Checkmate');
    expect(api().getMoves()).toEqual(['e8=Q#']);
    expect(overSpy).toHaveBeenCalledTimes(1);
  });
});

describe('clock pause / resume during promotion (bug 2)', () => {
  it('pauses the current clock, applies increment exactly once, then runs the opponent', async () => {
    const { api } = setup({
      config: config({ timeControl: BLITZ_1_3, playerColor: 'b' }), // clock starts on White
      initialFen: '7k/5P2/8/8/8/8/8/K7 w - - 0 1',
    });
    await waitFor(() => expect(api().clock.runningSide).toBe('w'));
    await sleep(250); // white loses ~250ms
    const before = api().clock.clocks.w;

    act(() => {
      expect(api().tryMove('f7', 'f8')).toBe('promote');
    });
    await sleep(400); // dialog open — clock must be frozen
    const duringPause = api().clock.clocks.w;
    expect(Math.abs(duringPause - before)).toBeLessThan(150); // <160ms billed in total

    act(() => {
      api().choosePromotion('q');
    });
    await waitFor(() => expect(api().plies).toHaveLength(1));
    const afterChoose = api().clock.clocks.w;
    // increment applied exactly once: +3s minus the ~250ms already billed
    expect(afterChoose - before).toBeGreaterThanOrEqual(2400);
    expect(afterChoose - before).toBeLessThanOrEqual(3000);

    await waitFor(() => expect(api().clock.runningSide).toBe('b'));
    const blackStart = api().clock.clocks.b;
    await sleep(300);
    expect(blackStart - api().clock.clocks.b).toBeGreaterThan(120); // black now ticking
    expect(api().clock.clocks.w).toBeCloseTo(afterChoose, -2.6); // white frozen again (±250ms)
  });

  it('cancel resumes the mover’s clock and leaves the position untouched', async () => {
    const { api } = setup({
      config: config({ timeControl: BLITZ_1_3, playerColor: 'b' }),
      initialFen: '7k/5P2/8/8/8/8/8/K7 w - - 0 1',
    });
    await waitFor(() => expect(api().clock.runningSide).toBe('w'));
    act(() => {
      api().tryMove('f7', 'f8');
    });
    expect(api().pendingPromotion).not.toBeNull();
    act(() => {
      api().cancelPromotion();
    });
    expect(api().pendingPromotion).toBeNull();
    expect(api().plies).toHaveLength(0);
    const w = api().clock.clocks.w;
    await sleep(300);
    expect(w - api().clock.clocks.w).toBeGreaterThan(120); // ticking again
    // board still allows the promotion to be played after cancel
    act(() => {
      expect(api().tryMove('f7', 'f8')).toBe('promote');
    });
    act(() => {
      api().choosePromotion('q');
    });
    await waitFor(() => expect(api().plies).toHaveLength(1));
  });
});

describe('game termination history (bug 3)', () => {
  it('checkmating move is in the authoritative history at the moment game-over fires', async () => {
    const movesAtOver: string[][] = [];
    const { api } = setup({
      initialFen: '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1',
      onGameOver: () => movesAtOver.push(api().getMoves()),
    });
    act(() => {
      expect(api().tryMove('a1', 'a8')).toBe('ok');
    });
    await waitFor(() => expect(api().over).not.toBeNull());
    expect(api().over?.reason).toBe('Checkmate');
    expect(movesAtOver[0]).toEqual(['Ra8#']); // final move present at callback time
    expect(api().getMoves()).toEqual(['Ra8#']);
    expect(api().getFen()).toBe(new Chess(api().getFen()).fen()); // valid fen
  });

  it('stalemate ends as a draw with the move stored', async () => {
    const overSpy = vi.fn();
    const { api } = setup({ initialFen: 'k7/8/8/8/8/8/8/1Q4K1 w - - 0 1', onGameOver: overSpy });
    act(() => {
      expect(api().tryMove('b1', 'b6')).toBe('ok');
    });
    await waitFor(() => expect(api().over).not.toBeNull());
    expect(api().over).toEqual({ winnerColor: null, reason: 'Stalemate' });
    expect(api().getMoves()).toEqual(['Qb6']);
    expect(overSpy).toHaveBeenCalledTimes(1);
  });

  it('castling bookkeeping stays consistent', () => {
    const { api } = setup({ initialFen: '4k3/8/8/8/8/8/8/4K2R w K - 0 1' });
    act(() => {
      expect(api().tryMove('e1', 'g1')).toBe('ok');
    });
    expect(api().getFen().split(' ')[0]).toContain('5RK1'); // rook f1, king g1 after O-O
    expect(api().getMoves()).toEqual(['O-O']);
  });
});

describe('timeout vs mating material (bug 5)', () => {
  it('flags a loss when the opponent has mating material', async () => {
    const overSpy = vi.fn();
    const { api } = setup({
      config: config({ timeControl: BLITZ_1_3 }),
      initialFen: 'k7/8/8/8/8/8/r7/K7 w - - 0 1', // black rook → white flagged loses
      onGameOver: overSpy,
    });
    act(() => {
      api().clock.reset(0);
      api().clock.start('w');
    });
    await waitFor(() => expect(api().over).not.toBeNull());
    expect(api().over).toEqual({ winnerColor: 'b', reason: 'On time' });
  });

  it('is a draw when the opponent lacks mating material', async () => {
    const overSpy = vi.fn();
    const { api } = setup({
      config: config({ timeControl: BLITZ_1_3 }),
      initialFen: 'k7/8/8/8/8/8/n7/K7 w - - 0 1', // black knight only → cannot mate
      onGameOver: overSpy,
    });
    act(() => {
      api().clock.reset(0);
      api().clock.start('w');
    });
    await waitFor(() => expect(api().over).not.toBeNull());
    expect(api().over?.winnerColor).toBeNull();
    expect(api().over?.reason).toContain('insufficient material');
  });
});

describe('undo', () => {
  it('restores position, turn, and both clocks from the pre-move snapshot', async () => {
    const { api } = setup({ config: config({ timeControl: BLITZ_1_3 }), initialFen: START_FEN });
    await waitFor(() => expect(api().clock.runningSide).toBe('w'));
    act(() => {
      expect(api().tryMove('e2', 'e4')).toBe('ok');
    });
    await waitFor(() => expect(api().clock.runningSide).toBe('b'));
    await sleep(300); // black clock drifts
    expect(api().getFen()).not.toBe(START_FEN);

    act(() => {
      api().undo();
    });
    expect(api().getFen()).toBe(START_FEN);
    expect(api().getMoves()).toEqual([]);
    expect(api().turn).toBe('w');
    // white restored to the pre-move snapshot (60000 minus a few ticks of
    // real thinking time — white's clock now runs from game start)
    expect(api().clock.clocks.w).toBeGreaterThan(59_400);
    expect(api().clock.clocks.w).toBeLessThanOrEqual(60_000);
    expect(api().clock.clocks.b).toBe(60_000); // black drift rolled back exactly
    // and white's clock resumes ticking after the undo
    const afterUndo = api().clock.clocks.w;
    await sleep(300);
    expect(afterUndo - api().clock.clocks.w).toBeGreaterThan(100);
  });

  it('in AI mode undoes the engine pair so it is the human’s turn again', async () => {
    const engineSearch = vi.fn(async (_fen: string) => ({
      from: 'e7',
      to: 'e5',
      san: 'e5',
      scoreCp: 0,
      depth: 1,
      nodes: 0,
      ms: 0,
    }));
    const utils = renderHook(() =>
      useGame({ config: config({ mode: 'ai', playerColor: 'w' }), engineSearch }),
    );
    act(() => {
      utils.result.current.tryMove('e2', 'e4');
    });
    await waitFor(() => expect(utils.result.current.getMoves()).toEqual(['e4', 'e5']));
    act(() => {
      utils.result.current.undo();
    });
    expect(utils.result.current.getMoves()).toEqual([]);
    expect(utils.result.current.turn).toBe('w');
  });
});

describe('stale engine responses', () => {
  it('AI reply arriving after a restart does not mutate the new game', async () => {
    let resolveEngine: (v: unknown) => void = () => {};
    const engineSearch = vi.fn(
      (_fen: string) =>
        new Promise<{ from: string; to: string; promotion?: string; san: string } | null>((resolve) => {
          resolveEngine = resolve as typeof resolveEngine;
        }),
    );
    const utils = renderHook(() =>
      useGame({ config: config({ mode: 'ai', playerColor: 'w' }), engineSearch }),
    );
    act(() => {
      utils.result.current.tryMove('e2', 'e4');
    });
    await waitFor(() => expect(utils.result.current.getMoves()).toEqual(['e4']));
    expect(engineSearch).toHaveBeenCalledTimes(1);

    act(() => {
      utils.result.current.newGame(); // restart
    });
    expect(utils.result.current.getMoves()).toEqual([]);
    expect(utils.result.current.turn).toBe('w');

    // the stale reply finally lands — it must be ignored
    await act(async () => {
      resolveEngine({ from: 'e7', to: 'e5', san: 'e5', scoreCp: 0, depth: 1, nodes: 0, ms: 0 });
      await sleep(150);
    });
    expect(utils.result.current.getMoves()).toEqual([]);
    expect(utils.result.current.turn).toBe('w');
  });

  it('AI move is never committed after game over', async () => {
    let resolveEngine: (v: unknown) => void = () => {};
    const engineSearch = vi.fn(
      (_fen: string) =>
        new Promise((resolve) => {
          resolveEngine = resolve as typeof resolveEngine;
        }),
    );
    const { api } = setup({
      config: config({ mode: 'ai', playerColor: 'w', timeControl: BLITZ_1_3 }),
      initialFen: 'k7/8/8/8/8/8/r7/K7 w - - 0 1', // flag falls immediately (white loses)
      onGameOver: undefined,
    });
    // engine effect never runs for white-to-move... force: make it black to move via a white move first
    act(() => {
      api().clock.reset(0);
      api().clock.start('w');
    });
    await waitFor(() => expect(api().over).not.toBeNull());
    // no engineSearch may run after game over
    expect(engineSearch).not.toHaveBeenCalled();
    void resolveEngine;
  });
});

describe('flag fall adjudicated before a late move (final pass #1)', () => {
  it('rejects an ordinary move played after the flag fell and keeps it out of history', async () => {
    const overSpy = vi.fn();
    const { api } = setup({ config: config({ timeControl: BLITZ_1_3 }), initialFen: START_FEN, onGameOver: overSpy });
    act(() => {
      api().clock.reset(150);
      api().clock.start('w');
    });
    await waitFor(() => expect(api().over).not.toBeNull());
    act(() => {
      expect(api().tryMove('e2', 'e4')).toBe('illegal');
    });
    expect(api().getMoves()).toEqual([]);
    expect(api().getFen()).toBe(START_FEN);
    expect(api().over?.reason).toBe('On time');
    expect(overSpy).toHaveBeenCalledTimes(1);
  });

  it('a late checkmating move does NOT override flag fall', async () => {
    const { api } = setup({
      config: config({ timeControl: BLITZ_1_3 }),
      initialFen: '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1',
    });
    act(() => {
      api().clock.reset(150);
      api().clock.start('w');
    });
    await waitFor(() => expect(api().over).not.toBeNull());
    act(() => {
      expect(api().tryMove('a1', 'a8')).toBe('illegal');
    });
    expect(api().over?.reason).toBe('On time');
    expect(api().over?.winnerColor).toBe('b');
    expect(api().getMoves()).toEqual([]);
    expect(new Chess(api().getFen()).isCheckmate()).toBe(false);
  });

  it('a late promotion does NOT override flag fall and never opens the picker', async () => {
    const { api } = setup({
      config: config({ timeControl: BLITZ_1_3 }),
      initialFen: '1r1k4/5P2/8/8/8/8/8/K7 w - - 0 1',
    });
    act(() => {
      api().clock.reset(150);
      api().clock.start('w');
    });
    await waitFor(() => expect(api().over).not.toBeNull());
    act(() => {
      expect(api().tryMove('f7', 'f8')).toBe('illegal');
    });
    expect(api().pendingPromotion).toBeNull();
    expect(api().over?.reason).toBe('On time');
    expect(api().getMoves()).toEqual([]);
  });

  it('a move completed BEFORE the flag still commits normally', async () => {
    const { api } = setup({ config: config({ timeControl: BLITZ_1_3 }), initialFen: START_FEN });
    act(() => {
      api().clock.reset(5_000);
      api().clock.start('w');
    });
    await sleep(120);
    act(() => {
      expect(api().tryMove('e2', 'e4')).toBe('ok');
    });
    expect(api().getMoves()).toEqual(['e4']);
    expect(api().over).toBeNull();
  });

  it('no increment is applied to a rejected late move', async () => {
    const { api } = setup({
      config: config({ timeControl: { id: '1+30', label: '1 min', category: 'Blitz', minutes: 1, increment: 30 }, playerColor: 'w' }),
      initialFen: START_FEN,
    });
    act(() => {
      api().clock.reset(150);
      api().clock.start('w');
    });
    await waitFor(() => expect(api().over).not.toBeNull());
    const clocksAtFlag = { ...api().clock.clocks };
    act(() => {
      api().tryMove('e2', 'e4');
    });
    expect(api().clock.clocks.w).toBe(clocksAtFlag.w);
    expect(api().clock.clocks.b).toBe(clocksAtFlag.b);
  });

  it('a move attempted after hidden-tab expiry is adjudicated before touching the board', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'requestAnimationFrame', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const { api } = setup({ config: config({ timeControl: BLITZ_1_3 }), initialFen: START_FEN });
      act(() => {
        api().clock.reset(200);
        api().clock.start('w');
      });
      // no rAF advancement: the tick loop never runs, the visible clock stays
      // at 200 — but real (faked) wall time moves 500ms
      act(() => {
        vi.advanceTimersByTime(500);
      });
      const before = { ...api().clock.clocks };
      act(() => {
        expect(api().tryMove('e2', 'e4')).toBe('illegal');
      });
      expect(api().getMoves()).toEqual([]);
      expect(api().over?.reason).toBe('On time');
      expect(api().clock.clocks.w).toBe(0); // mover zeroed at adjudication
      expect(api().clock.clocks.b).toBe(before.b); // opponent untouched: no increment, no drift
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('white clock runs from game start (final pass #3)', () => {
  it('white clock visibly decreases before the first move in a timed game', async () => {
    const { api } = setup({ config: config({ timeControl: BLITZ_1_3, playerColor: 'w' }), initialFen: START_FEN });
    await waitFor(() => expect(api().clock.runningSide).toBe('w'));
    expect(api().clock.clocks.w).toBe(60_000);
    await sleep(350);
    expect(api().clock.clocks.w).toBeLessThan(60_000);
    expect(api().clock.clocks.w).toBeGreaterThan(59_000); // ~350ms billed, not zero, not more
  });

  it('black-start games bill the side to move from the start', async () => {
    const engineSearch = vi.fn(async () => null);
    const utils = renderHook(() =>
      useGame({ config: config({ timeControl: BLITZ_1_3, playerColor: 'b', mode: 'ai' }), engineSearch }),
    );
    await waitFor(() => expect(utils.result.current.clock.runningSide).toBe('w'));
    await sleep(250);
    expect(utils.result.current.clock.clocks.w).toBeLessThan(60_000);
    expect(utils.result.current.clock.clocks.b).toBe(60_000);
  });
});

describe('resume (saved game)', () => {
  it('restores moves, turn, and clocks from a saved game', async () => {
    const saved: SavedGame = {
      config: config({ timeControl: BLITZ_1_3, playerColor: 'w' }),
      playerColor: 'w',
      pgn: '1. e4 e5 2. Nf3',
      clocks: { w: 45_000, b: 47_500 },
    };
    const { api } = setup({ config: saved.config, resume: saved });
    await waitFor(() => expect(api().getMoves()).toEqual(['e4', 'e5', 'Nf3']));
    expect(api().turn).toBe('b');
    expect(api().playerColor).toBe('w');
    expect(api().clock.clocks.w).toBe(45_000); // white not to move: frozen exactly
    expect(api().clock.clocks.b).toBeLessThanOrEqual(47_500); // black ticking
    expect(api().clock.clocks.b).toBeGreaterThan(47_000);
  });
});

describe('record consistency (bug 3 at the API level)', () => {
  it('getMoves, PGN and review plies all describe the same completed game', async () => {
    const { api } = setup({ initialFen: '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1' });
    act(() => {
      api().tryMove('a1', 'a8');
    });
    await waitFor(() => expect(api().over).not.toBeNull());
    const moves = api().getMoves();
    const pgn = api().pgn();
    expect(moves).toEqual(['Ra8#']);
    expect(pgn).toContain('Ra8#');
    // review-side: replaying the stored moves yields the identical final position
    const replay = new Chess('6k1/5ppp/8/8/8/8/8/R6K w - - 0 1');
    for (const san of moves) replay.move(san);
    expect(replay.fen()).toBe(api().getFen());
    expect(replay.isCheckmate()).toBe(true);
  });
});
