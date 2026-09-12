import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Color } from 'chess.js';

export interface ClockState {
  w: number;
  b: number;
}

/**
 * Chess clock with increment. Ticks only while a game is live and a side is to move.
 * `paused` is used while a promotion dialog is open.
 */
export function useClock(initialMs: number, incrementMs: number) {
  const [clocks, setClocks] = useState<ClockState>({ w: initialMs, b: initialMs });
  const runningRef = useRef(false);
  const [runningSide, setRunningSide] = useState<Color | null>(null);
  const lastTickRef = useRef<number>(0);
  const [flagged, setFlagged] = useState<Color | null>(null);
  const pausedRef = useRef(false);
  const incrementRef = useRef(incrementMs);
  incrementRef.current = incrementMs;

  const lowTimePlayed = useRef<Record<Color, boolean>>({ w: false, b: false });

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
        setClocks((c) => {
          const next = { ...c, [runningSide]: Math.max(0, c[runningSide] - dt) } as ClockState;
          return next;
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      runningRef.current = false;
      cancelAnimationFrame(raf);
    };
  }, [runningSide, flagged]);

  // flag detection
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
   * Called after a move by `side`: charge the mover's real elapsed wall time
   * (covers frames the browser throttled in a hidden tab), add the increment
   * exactly once, then hand the clock to the opponent.
   */
  const switchTo = useCallback((side: Color, withIncrementFor: Color | null) => {
    const now = performance.now();
    const elapsed = Math.max(0, now - lastTickRef.current);
    lastTickRef.current = now;
    setClocks((c) => {
      const next = { ...c };
      if (withIncrementFor) {
        next[withIncrementFor] = Math.max(0, next[withIncrementFor] - elapsed + incrementRef.current);
      }
      return next;
    });
    pausedRef.current = false;
    setRunningSide(side);
  }, []);

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

  const reset = useCallback((ms: number) => {
    setClocks({ w: ms, b: ms });
    setFlagged(null);
    setRunningSide(null);
    lowTimePlayed.current = { w: false, b: false };
  }, []);

  /** Restore both sides' clocks after an undo; resume for `resumeSide` if given. */
  const restore = useCallback((ms: { w: number; b: number }, resumeSide: Color | null) => {
    setFlagged(null);
    setClocks({ w: ms.w, b: ms.b });
    lowTimePlayed.current = { w: false, b: false };
    if (resumeSide) {
      lastTickRef.current = performance.now();
      pausedRef.current = false;
      setRunningSide(resumeSide);
    } else {
      setRunningSide(null);
    }
  }, []);

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
