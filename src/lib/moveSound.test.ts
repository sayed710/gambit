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

import { planSoundEvents } from './moveSound';

describe('planSoundEvents — the exact event chain', () => {
  it('normal check: base move ONCE + subtle check cue ONCE (no base replay)', () => {
    expect(planSoundEvents(classifyMoveSound(mv('Bb5+')))).toEqual(['move', 'check']);
  });

  it('capture check: capture ONCE + cue ONCE', () => {
    expect(planSoundEvents(classifyMoveSound(mv('Qxf7+', true)))).toEqual(['capture', 'check']);
  });

  it('castle check: castle sequence ONCE + cue ONCE', () => {
    expect(planSoundEvents(classifyMoveSound(mv('O-O-O+', false, false)))).toEqual(['castle', 'check']);
  });

  it('plain moves never emit the check cue', () => {
    expect(planSoundEvents(classifyMoveSound(mv('e4')))).toEqual(['move']);
    expect(planSoundEvents(classifyMoveSound(mv('Nxe5', true)))).toEqual(['capture']);
  });

  it('checkmate emits base + end phrase, never the check cue', () => {
    expect(planSoundEvents(classifyMoveSound(mv('Qh4#')))).toEqual(['move']);
  });
});
