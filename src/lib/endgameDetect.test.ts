import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { ENDGAME_LESSONS } from '../data/endgames';
import { evaluateDrill } from './endgameDetect';

const kq = ENDGAME_LESSONS.find((l) => l.id === 'kq-mate')!;
const phil = ENDGAME_LESSONS.find((l) => l.id === 'philidor-hold')!;

describe('endgame drill detection', () => {
  it('learner delivering mate = success', () => {
    // KQ vs K mate in one from a constructed near-mate position
    const game = new Chess('7k/5K2/6Q1/8/8/8/8/8 b - - 0 1'); // black to move is mated? no — construct: white mates next
    const mateGame = new Chess('7k/6Q1/5K2/8/8/8/8/8 b - - 0 1'); // Qg7# already on board = game over by checkmate
    expect(mateGame.isCheckmate()).toBe(true);
    const out = evaluateDrill(mateGame, kq, 5, 9, false);
    expect(out.status).toBe('success');
    void game;
  });

  it('learner getting mated = failure', () => {
    // the learner's king is mated in the corner (white to move, no legal escape)
    const mated = new Chess('8/8/8/8/8/1k6/1q6/K7 w - - 0 1');
    expect(mated.isCheckmate()).toBe(true);
    const out = evaluateDrill(mated, kq, 2, 9, false);
    expect(out.status).toBe('failure');
    if (out.status === 'failure') expect(out.reason).toMatch(/mated/i);
  });

  it('survive lesson: rook loss fails immediately', () => {
    // same position but the defensive rook has fallen (only the pawn remains)
    const game = new Chess('1k6/8/1K6/1P6/8/8/8/8 b - - 0 1');
    const out = evaluateDrill(game, phil, 0, 5, false);
    expect(out.status).toBe('failure');
    if (out.status === 'failure') expect(out.reason).toMatch(/rook/i);
  });

  it('survive lesson: limit reached without loss = success', () => {
    const game = new Chess(phil.fen);
    const out = evaluateDrill(game, phil, phil.moveLimit, 5, false);
    expect(out.status).toBe('success');
  });

  it('mate lesson: move limit reached without mate = failure', () => {
    const game = new Chess(kq.fen);
    const out = evaluateDrill(game, kq, kq.moveLimit, 9, false);
    expect(out.status).toBe('failure');
  });

  it('mid-drill keeps playing', () => {
    const game = new Chess(kq.fen);
    const out = evaluateDrill(game, kq, 3, 9, false);
    expect(out.status).toBe('playing');
  });
});
