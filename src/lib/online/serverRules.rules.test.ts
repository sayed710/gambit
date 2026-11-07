import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { expiryOutcome, insufficientMaterialForAnyMate, isExpired, timeoutResult } from '../../../supabase/functions/_shared/serverRules';

const T0 = 1_700_000_000_000;

describe('isExpired — the single boundary', () => {
  it('a move exactly at the deadline is expired (the flag has fallen)', () => {
    expect(isExpired(60_000, 60_000)).toBe(true);
  });
  it('elapsed past remaining is expired', () => {
    expect(isExpired(60_001, 60_000)).toBe(true);
  });
  it('a move inside the remaining time is not expired', () => {
    expect(isExpired(59_999, 60_000)).toBe(false);
    expect(isExpired(0, 60_000)).toBe(false);
  });
});

describe('insufficientMaterialForAnyMate (FIDE 6.9 draw-on-time)', () => {
  it('bare kings — no mate exists, timeout is a draw', () => {
    const c = new Chess('7k/8/8/8/8/8/8/K7 w - - 0 1');
    expect(insufficientMaterialForAnyMate(c, 'w')).toBe(true);
  });
  it('K+N vs K — no mate vs a bare king, draw', () => {
    const c = new Chess('7k/8/8/8/8/5N2/8/K7 w - - 0 1');
    expect(insufficientMaterialForAnyMate(c, 'w')).toBe(true);
  });
  it('K+B vs K — draw', () => {
    const c = new Chess('7k/8/8/8/8/8/2B5/K7 w - - 0 1');
    expect(insufficientMaterialForAnyMate(c, 'w')).toBe(true);
  });
  it('two bishops on the SAME color — draw', () => {
    // c4 and b3 are both light squares
    const c = new Chess('7k/8/8/8/2B5/1B6/8/K7 w - - 0 1');
    expect(insufficientMaterialForAnyMate(c, 'w')).toBe(true);
  });
  it('two bishops on OPPOSITE colors — mate exists, win on time', () => {
    // c4 (light) and b2 (dark)
    const c = new Chess('7k/8/8/8/2B5/8/1B6/K7 w - - 0 1');
    expect(insufficientMaterialForAnyMate(c, 'w')).toBe(false);
  });
  it('any pawn — mate is possible (promotion), win on time', () => {
    const c = new Chess('7k/8/8/8/8/8/P7/K7 w - - 0 1');
    expect(insufficientMaterialForAnyMate(c, 'w')).toBe(false);
  });
  it('any rook or queen — win on time', () => {
    expect(insufficientMaterialForAnyMate(new Chess('7k/8/8/8/8/8/6R1/K7 w - - 0 1'), 'w')).toBe(false);
    expect(insufficientMaterialForAnyMate(new Chess('7k/8/8/8/8/8/6Q1/K7 w - - 0 1'), 'w')).toBe(false);
  });
  it('the DEFENDER retaining a piece means a help-mate exists — win on time', () => {
    // K+N (claimer) vs K+P (flagged): the pawn can mate with help
    const c = new Chess('7k/8/8/8/8/5N2/p7/K7 w - - 0 1');
    expect(insufficientMaterialForAnyMate(c, 'w')).toBe(false);
  });
});

describe('timeoutResult', () => {
  it('flagged white loses to black when mating material exists', () => {
    const c2 = new Chess('k7/7R/8/8/8/8/8/K7 w - - 0 1'); // white has the rook
    expect(timeoutResult(c2, 'b').result).toBe('white');
  });
  it('insufficient material turns the timeout into a draw', () => {
    const c = new Chess('7k/8/8/8/8/5N2/8/K7 w - - 0 1');
    expect(timeoutResult(c, 'w').result).toBe('draw');
    expect(timeoutResult(c, 'w').reason).toBe('timeout');
  });
});

describe('expiryOutcome', () => {
  const game = {
    turn: 'w' as const,
    turn_started_at: new Date(T0).toISOString(),
    white_ms_remaining: 60_000,
    black_ms_remaining: 60_000,
    start_fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves: [],
  };
  it('null while time remains', () => {
    const c = new Chess(game.start_fen);
    expect(expiryOutcome(c, game, T0 + 59_999)).toBeNull();
  });
  it('flags the side to move at the boundary', () => {
    const c = new Chess(game.start_fen);
    const out = expiryOutcome(c, game, T0 + 60_000);
    expect(out?.expired).toBe(true);
    expect(out?.flagged).toBe('w');
    expect(out?.result).toBe('black');
  });
  it('draw when no mate can be delivered', () => {
    const c = new Chess(game.start_fen);
    c.move('e4');
    const out = expiryOutcome(c, { ...game, turn: 'b' }, T0 + 70_000);
    // after 1.e4 a pawn is on the board — a help-mate exists → WHITE wins,
    // not draw (black is the flagged side and loses on time)
    expect(out?.result).toBe('white');
    expect(out?.reason).toBe('timeout');
  });
});
