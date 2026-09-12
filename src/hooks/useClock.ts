import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color } from 'chess.js';

export interface ClockState {
  w: number;
  b: number;
}

/**
 * Chess clock with increment. Ticks only while a game is live and a side is to move.
 * `paused` is used while a promotion dialog is open.
 *
 * `clocksRef` is the synchronous source of truth: `switchTo` must decide
 * flag-fall at call time (React state updates are async, and the UCI-style
 * decision "did the mover flag before the move completed?" cannot wait for a
 * render). Every mutation goes through `apply`, which keeps both in step.
 */
export function useClock(initialMs: number, incrementMs: number) {
  const clocksRef = useRef<ClockState>({ w: initialMs, b: initialMs });
  const [clocks, setClocks] = useState<ClockState>(clocksRef.current);
  const runningRef = useRef(false);
  const [runningSide, setRunningSide] = useState<Color | null>(null);
  const lastTickRef = useRef<number>(0);
  const [flagged, setFlagged] = useState<Color | null>(null);
  const pausedRef = useRef(false);
  const incrementRef = useRef(incrementMs);
  incrementRef.current = incrementMs;

  const lowTimePlayed = useRef<Record<Color, boolean>>({ w: false, b: false });

  const apply = useCallback((next: ClockState) => {
    clocksRef.current = next;
    setClocks(next);
  }, []);

  useEffect(() => {
    if (!runningSide || flagged) return;
    runningRef.current = true;
    lastTickRef.current = performance.now();
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      // A paused clock (promotion dialog open) keeps the loop alive but bills
      // nothing, and keeps lastTick fresh so resume never charges hidden time.
      if (dt > 0 && !pausedRef.current) {
        const c = clocksRef.current;
        apply({ ...c, [runningSide]: Math.max(0, c[runningSide] - dt) } as ClockState);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      runningRef.current = false;
      cancelAnimationFrame(raf);
    };
  }, [runningSide, flagged, apply]);

  // flag detection for time lost while ticking normally
  useEffect(() => {
    if (flagged) return;
    if (runningSide && clocks[runningSide] <= 0) {
      setFlagged(runningSide);
      setRunningSide(null);
    }
  }, [clocks, runningSide, flagged]);

  const start = useCallback((side: Color) => {
    pausedRef.current = false;
    lastTickRef.current = performance.now();
    setRunningSide(side);
  }, []);

  /**
   * Called after a move by `side`. Order of operations is the correctness
   * contract:
   *   1. charge the mover's real elapsed wall time (covers throttled
   *      background frames),
   *   2. if that exhausts the mover's clock, flag them — no increment, no
   *      opponent clock, the caller adjudicates (win vs. insufficient material),
   *   3. otherwise apply the increment exactly once and hand over.
   * Returns true when the mover flagged during this move.
   */
  const switchTo = useCallback(
    (side: Color, withIncrementFor: Color | null): boolean => {
      const now = performance.now();
      const elapsed = Math.max(0, now - lastTickRef.current);
      lastTickRef.current = now;
      pausedRef.current = false;

      if (!withIncrementFor) {
        setRunningSide(side);
        return false;
      }

      const remaining = clocksRef.current[withIncrementFor] - elapsed;
      if (remaining <= 0) {
        // Flag fall takes precedence over increment: a move completed after
        // the flag fell cannot revive the mover.
        apply({ ...clocksRef.current, [withIncrementFor]: 0 });
        setFlagged(withIncrementFor);
        return true;
      }

      apply({ ...clocksRef.current, [withIncrementFor]: remaining + incrementRef.current });
      setRunningSide(side);
      return false;
    },
    [apply],
  );

  const stop = useCallback(() => {
    setRunningSide(null);
  }, []);

  const pause = useCallback(() => {
    pausedRef.current = true;
  }, []);

  const resume = useCallback(() => {
    lastTickRef.current = performance.now();
    pausedRef.current = false;
  }, []);

  const reset = useCallback(
    (ms: number) => {
      apply({ w: ms, b: ms });
      // the game (re)starts now: baseline the charge clock so the first
      // switchTo bills only the time actually spent before that move
      lastTickRef.current = performance.now();
      setFlagged(null);
      setRunningSide(null);
      lowTimePlayed.current = { w: false, b: false };
    },
    [apply],
  );

  /** Restore both sides' clocks after an undo; resume for `resumeSide` if given. */
  const restore = useCallback(
    (ms: { w: number; b: number }, resumeSide: Color | null) => {
      setFlagged(null);
      apply({ w: ms.w, b: ms.b });
      lowTimePlayed.current = { w: false, b: false };
      if (resumeSide) {
        lastTickRef.current = performance.now();
        pausedRef.current = false;
        setRunningSide(resumeSide);
      } else {
        setRunningSide(null);
      }
    },
    [apply],
  );

  const shouldPlayLow = useCallback((side: Color, ms: number, threshold = 10_000) => {
    if (ms < threshold && ms > 0 && !lowTimePlayed.current[side]) {
      lowTimePlayed.current[side] = true;
      return true;
    }
    return false;
  }, []);

  // Stable API object: callers put this in effect deps, and the clock re-renders
  // every animation frame while running — without memoization that would tear
  // down in-flight work (e.g. engine searches) on every tick.
  return useMemo(
    () => ({ clocks, runningSide, flagged, start, switchTo, stop, pause, resume, reset, restore, shouldPlayLow }),
    [clocks, runningSide, flagged, start, switchTo, stop, pause, resume, reset, restore, shouldPlayLow],
  );
}
