import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useClock } from './useClock';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('useClock.switchTo flag-before-increment invariant', () => {
  it('flags the mover instead of reviving them when elapsed exceeds remaining', async () => {
    const { result } = renderHook(() => useClock(1_000, 5_000));
    act(() => {
      result.current.start('w');
    });
    await sleep(3_000); // real elapsed (e.g. throttled background tab) ≫ remaining

    let flaggedMover = false;
    act(() => {
      flaggedMover = result.current.switchTo('b', 'w');
    });

    expect(flaggedMover).toBe(true); // increment must not revive the mover
    expect(result.current.flagged).toBe('w');
    expect(result.current.clocks.w).toBe(0);
    expect(result.current.clocks.b).toBe(1_000); // untouched: no increment leaked anywhere
    expect(result.current.runningSide === 'b').toBe(false); // opponent clock never started
  });

  it('charges throttled background elapsed time before deciding', async () => {
    const { result } = renderHook(() => useClock(1_000, 400));
    act(() => {
      result.current.start('w');
    });
    await sleep(1_500); // elapsed > remaining → flag, old math gave 1000-1500+400 = 0 too,
    // so use a case where old math revived: remaining 1000, elapsed ~1500, inc 400 → 0;
    // the revival case (remaining 1000, elapsed 3000, inc 5000) is covered above.

    const flagged = result.current.switchTo('b', 'w');
    expect(flagged).toBe(true);
    expect(result.current.clocks.w).toBe(0);
  });

  it('applies the increment exactly once on a legally completed move', async () => {
    const { result } = renderHook(() => useClock(60_000, 3_000));
    act(() => {
      result.current.start('w');
    });
    await sleep(250);

    let flaggedMover = false;
    act(() => {
      flaggedMover = result.current.switchTo('b', 'w');
    });

    expect(flaggedMover).toBe(false);
    expect(result.current.flagged).toBeNull();
    const w = result.current.clocks.w;
    expect(w).toBeGreaterThanOrEqual(60_000 - 400 + 3_000); // charged + one increment
    expect(w).toBeLessThanOrEqual(60_000 + 3_000); // and never more than one
    expect(result.current.runningSide).toBe('b');
  });

  it('does not start the opponent clock after the mover flags', async () => {
    const { result } = renderHook(() => useClock(200, 60_000));
    act(() => {
      result.current.start('w');
    });
    await sleep(500); // white certainly flagged

    let flaggedMover = false;
    act(() => {
      flaggedMover = result.current.switchTo('b', 'w');
    });

    expect(flaggedMover).toBe(true);
    expect(result.current.runningSide === 'b').toBe(false); // never handed over
    await sleep(250);
    expect(result.current.clocks.b).toBe(200); // and never ticks
  });

  it('keeps billing real elapsed time across the move boundary', async () => {
    const { result } = renderHook(() => useClock(60_000, 0));
    act(() => {
      result.current.start('w');
    });
    await sleep(300);
    act(() => {
      result.current.switchTo('b', 'w');
    });
    // with zero increment the mover's elapsed time is fully charged
    expect(result.current.clocks.w).toBeLessThan(60_000);
    expect(result.current.clocks.w).toBeGreaterThan(60_000 - 900);
  });

  it('pause during promotion bills nothing, resume resumes, no jump', async () => {
    const { result } = renderHook(() => useClock(60_000, 0));
    act(() => {
      result.current.start('w');
    });
    await sleep(250);
    act(() => {
      result.current.pause();
    });
    const atPause = result.current.clocks.w;
    await sleep(350);
    // frozen: at most one render-frame of display lag (~30ms), never the 350ms wait
    expect(atPause - result.current.clocks.w).toBeLessThan(60);
    act(() => {
      result.current.resume();
    });
    await sleep(250);
    const afterResume = result.current.clocks.w;
    expect(atPause - afterResume).toBeGreaterThan(100);
    expect(atPause - afterResume).toBeLessThan(400); // no hidden-time jump
  });

  it('reset and restore keep the synchronous clock source of truth in step', async () => {
    const { result } = renderHook(() => useClock(60_000, 0));
    act(() => {
      result.current.reset(25_000);
      result.current.start('w');
    });
    await sleep(200);
    act(() => {
      result.current.restore({ w: 50_000, b: 49_000 }, 'b');
    });
    expect(result.current.clocks.w).toBe(50_000);
    expect(result.current.clocks.b).toBe(49_000);
    expect(result.current.runningSide).toBe('b');
    // and switchTo reads the restored value, not a stale one
    await sleep(100);
    let flaggedMover = false;
    act(() => {
      flaggedMover = result.current.switchTo('w', 'b');
    });
    expect(flaggedMover).toBe(false);
    // restored value (49_000) was charged, not the previous 60_000
    expect(result.current.clocks.b).toBeGreaterThan(48_500);
    expect(result.current.clocks.b).toBeLessThan(49_000);
  });
});
