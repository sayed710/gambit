/* The readiness acknowledgment scheduler (BLOCKER-1 fix).
   ONE gated submission path: a hidden/background tab NEVER acknowledges
   — the clock starts only when the player can actually see the board.
   - visibility is read through an injected predicate (testable with
     controlled transitions; the page passes document.visibilityState)
   - one submission at a time (in-flight dedupe — no duplicate requests)
   - a disposed scheduler drops stale responses (no acks after unmount
     or a game change)
   - retries stay bounded by the interval; the server command remains
     idempotent, so overlap across ticks is harmless anyway
   The server keeps full authority: the clock starts only from the
   ready->active transition it stamps itself. */

export interface ReadinessSchedulerOptions {
  /** current visibility — typically () => document.visibilityState === 'visible' */
  isVisible: () => boolean;
  /**
   * submit one acknowledgment. `isCurrent()` is false once the scheduler
   * is disposed (unmount / game change) — the submitter MUST check it
   * before applying any state, so a stale response never lands.
   */
  submit: (isCurrent: () => boolean) => Promise<void>;
  /** ms between retries (default 3000) */
  intervalMs?: number;
}

export interface ReadinessScheduler {
  /** start: submits promptly when visible, then retries on the interval */
  start: () => void;
  stop: () => void;
}

export function createReadinessScheduler(opts: ReadinessSchedulerOptions): ReadinessScheduler {
  const intervalMs = opts.intervalMs ?? 3000;
  let timer: ReturnType<typeof setInterval> | null = null;
  let disposed = false;
  let inFlight = false;

  const submit = () => {
    if (disposed || inFlight) return;
    if (!opts.isVisible()) return; // hidden/background: NEVER acknowledge
    inFlight = true;
    void Promise.resolve()
      .then(() => {
        // RECHECK before dispatching: start() followed by stop() (or a
        // visibility drop) before this microtask ran must not dispatch a
        // NEW request. A request ALREADY SENT while the player was
        // visible cannot be un-sent — the server command is idempotent
        // and its stale response is dropped via the isCurrent contract.
        // (inFlight is THIS submission's own flag — not a conflict)
        if (disposed || !opts.isVisible()) return;
        return opts.submit(() => !disposed);
      })
      .catch(() => {
        /* the retry interval resubmits; the server is idempotent */
      })
      .finally(() => {
        inFlight = false;
      });
  };

  return {
    start() {
      if (timer !== null || disposed) return;
      submit(); // prompt when visible
      timer = setInterval(submit, intervalMs); // visibility-gated retries
    },
    stop() {
      disposed = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
