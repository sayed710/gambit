import { describe, expect, it } from 'vitest';
import { classifyMoveSound } from './moveSound';

const mv = (san: string, capture = false, promotion = false) => ({ san, capture, promotion });

describe('classifyMoveSound — one coherent chain per move', () => {
  it('normal move', () => {
    expect(classifyMoveSound(mv('Nf3'))).toEqual({ base: 'move', checkLayer: false, endSound: null });
  });

  it('capture', () => {
    expect(classifyMoveSound(mv('Nxe5', true))).toEqual({ base: 'capture', checkLayer: false, endSound: null });
  });

  it('check (no duplicate layer)', () => {
    expect(classifyMoveSound(mv('Bb5+'))).toEqual({ base: 'move', checkLayer: true, endSound: null });
  });

  it('capture with check — capture base, ONE check layer', () => {
    expect(classifyMoveSound(mv('Qxf7+', true))).toEqual({ base: 'capture', checkLayer: true, endSound: null });
  });

  it('castle', () => {
    expect(classifyMoveSound(mv('O-O'))).toEqual({ base: 'castle', checkLayer: false, endSound: null });
    expect(classifyMoveSound(mv('O-O-O'))).toEqual({ base: 'castle', checkLayer: false, endSound: null });
  });

  it('promotion', () => {
    expect(classifyMoveSound(mv('e8=Q', false, true))).toEqual({ base: 'promote', checkLayer: false, endSound: null });
  });

  it('promotion with capture and check', () => {
    expect(classifyMoveSound(mv('dxe8=N+', true, true))).toEqual({
      base: 'promote',
      checkLayer: true,
      endSound: null,
    });
  });

  it('checkmate: base sound only — the end phrase carries the moment', () => {
    expect(classifyMoveSound(mv('Qh4#'))).toEqual({ base: 'move', checkLayer: false, endSound: 'lose-or-win' });
    expect(classifyMoveSound(mv('Qxf7#', true))).toEqual({ base: 'capture', checkLayer: false, endSound: 'lose-or-win' });
  });

  it('castling into check still layers once', () => {
    expect(classifyMoveSound(mv('O-O-O+', false, false))).toEqual({
      base: 'castle',
      checkLayer: true,
      endSound: null,
    });
  });
});
