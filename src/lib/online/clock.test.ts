import { describe, expect, it } from 'vitest';
import { formatClock, formatTimeControl, projectClocks } from './clock';

const T0 = 1700000000000; // fixed epoch — deterministic

const snap = (over: Partial<Parameters<typeof projectClocks>[0]> = {}) => ({
  turn: 'w' as const,
  turn_started_at: new Date(T0).toISOString(),
  white_ms_remaining: 60000,
  black_ms_remaining: 60000,
  status: 'active',
  ...over,
});

describe('projectClocks', () => {
  it('white on the move: white counts down, black frozen', () => {
    const p = projectClocks(snap(), T0 + 5000);
    expect(p.white).toBe(55000);
    expect(p.black).toBe(60000);
    expect(p.flagged).toBeNull();
  });

  it('black on the move: black counts down, white frozen', () => {
    const p = projectClocks(snap({ turn: 'b' }), T0 + 7000);
    expect(p.white).toBe(60000);
    expect(p.black).toBe(53000);
  });

  it('never goes negative at/after the flag', () => {
    const p = projectClocks(snap(), T0 + 999999);
    expect(p.white).toBe(0);
    expect(p.flagged).toBe('w');
  });

  it('non-active games freeze both clocks', () => {
    const p = projectClocks(snap({ status: 'completed' }), T0 + 60000);
    expect(p.white).toBe(60000);
    expect(p.black).toBe(60000);
    expect(p.flagged).toBeNull();
  });

  it('missing turn_started_at (never started) freezes clocks', () => {
    const p = projectClocks(snap({ turn_started_at: null, status: 'waiting' }), T0 + 60000);
    expect(p.white).toBe(60000);
    expect(p.flagged).toBeNull();
  });
});

describe('formatClock', () => {
  it('m:ss above 20 seconds', () => {
    expect(formatClock(65400)).toBe('1:05');
    expect(formatClock(20000)).toBe('0:20');
  });
  it('tenths under 20 seconds', () => {
    expect(formatClock(19450)).toBe('0:19.4');
    expect(formatClock(0)).toBe('0:00.0');
  });
  it('negative clamps to zero', () => {
    expect(formatClock(-500)).toBe('0:00.0');
  });
});

describe('formatTimeControl', () => {
  it('labels by base time', () => {
    expect(formatTimeControl(60000, 0)).toBe('1 | 0 · Bullet');
    expect(formatTimeControl(180000, 2000)).toBe('3 | 2 · Blitz');
    expect(formatTimeControl(600000, 0)).toBe('10 | 0 · Rapid');
  });
});
