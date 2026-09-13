import { describe, expect, it } from 'vitest';
import { volumeGain } from './sound';

describe('sound volume mapping', () => {
  it('clamps out-of-range slider values', () => {
    expect(volumeGain(-5)).toBe(0);
    expect(volumeGain(150)).toBe(1);
  });

  it('maps the 35% default to a quiet, audible gain', () => {
    const g = volumeGain(35);
    expect(g).toBeGreaterThan(0.15);
    expect(g).toBeLessThan(0.3);
  });

  it('is 0 at zero and 1 at full', () => {
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(100)).toBe(1);
  });

  it('is monotonic', () => {
    expect(volumeGain(20)).toBeLessThan(volumeGain(50));
    expect(volumeGain(50)).toBeLessThan(volumeGain(80));
  });
});
