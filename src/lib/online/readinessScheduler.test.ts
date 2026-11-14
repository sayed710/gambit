import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReadinessScheduler } from './readinessScheduler';

/* Deterministic tests for the client readiness scheduler: a hidden tab
   must NEVER acknowledge; visibility transitions resume promptly; stale
   submissions are dropped after disposal. */

const flush = () => vi.advanceTimersByTimeAsync(5); // fake timers own setTimeout

describe('createReadinessScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('submits promptly when visible', async () => {
    let visible = true;
    let submissions = 0;
    const s = createReadinessScheduler({ isVisible: () => visible, submit: async () => { submissions += 1; } });
    s.start();
    await flush();
    expect(submissions).toBe(1);
    s.stop();
  });

  it('a HIDDEN tab sends NO acknowledgment at start', () => {
    let visible = false;
    let submissions = 0;
    const s = createReadinessScheduler({ isVisible: () => visible, submit: async () => { submissions += 1; } });
    s.start();
    vi.advanceTimersByTime(10_000); // several retry ticks
    expect(submissions).toBe(0); // never acknowledged while hidden
    s.stop();
  });

  it('visibility returning resumes acknowledgments promptly', async () => {
    let visible = false;
    let submissions = 0;
    const s = createReadinessScheduler({ isVisible: () => visible, submit: async () => { submissions += 1; } });
    s.start();
    vi.advanceTimersByTime(10_000);
    expect(submissions).toBe(0);
    visible = true; // the player returns to the tab
    vi.advanceTimersByTime(3_100); // the next retry tick fires
    await flush(); // the deferred submission lands
    expect(submissions).toBeGreaterThanOrEqual(1);
    s.stop();
  });

  it('a visibility drop mid-session stops further submissions', async () => {
    let visible = true;
    let submissions = 0;
    const s = createReadinessScheduler({ isVisible: () => visible, submit: async () => { submissions += 1; } });
    s.start();
    await flush();
    expect(submissions).toBe(1);
    visible = false;
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(submissions).toBe(1); // no more submissions while hidden
    s.stop();
  });

  it('no duplicate in-flight submissions (a slow submit is not double-fired)', async () => {
    let resolveFirst: () => void = () => {};
    let submissions = 0;
    const s = createReadinessScheduler({
      isVisible: () => true,
      submit: () => new Promise<void>((res) => { submissions += 1; resolveFirst = res; }),
      intervalMs: 10,
    });
    s.start();
    await flush();
    expect(submissions).toBe(1); // the prompt submission
    vi.advanceTimersByTime(50); // several ticks while the first is in flight
    await flush();
    expect(submissions).toBe(1); // dedupe: no overlapping request
    resolveFirst();
    await flush();
    vi.advanceTimersByTime(10);
    await flush();
    expect(submissions).toBe(2); // resumes after the in-flight completes
    s.stop();
  });

  it('a stale response after disposal is dropped (no late state application)', async () => {
    let applied = 0;
    let resolveSubmit: () => void = () => {};
    const s = createReadinessScheduler({
      isVisible: () => true,
      submit: async (isCurrent) => {
        await new Promise<void>((res) => { resolveSubmit = res; });
        if (isCurrent()) applied += 1; // the contract: apply ONLY while current
      },
    });
    s.start();
    s.stop(); // unmount / game change BEFORE the response lands
    resolveSubmit();
    await flush();
    expect(applied).toBe(0); // isCurrent() is false — the stale response never applied
  });

  it('start -> stop BEFORE the deferred dispatch sends NOTHING (no post-disposal request)', async () => {
    let submissions = 0;
    const s = createReadinessScheduler({ isVisible: () => true, submit: async () => { submissions += 1; } });
    s.start();
    s.stop(); // disposal BEFORE the microtask executes
    await flush(); // the deferred callback runs now — must recheck and bail
    vi.advanceTimersByTime(10_000); // and no retry may dispatch either
    expect(submissions).toBe(0); // the callback was never invoked
  });

  it('visibility dropping BEFORE the deferred dispatch prevents the submission', async () => {
    let visible = true;
    let submissions = 0;
    const s = createReadinessScheduler({ isVisible: () => visible, submit: async () => { submissions += 1; } });
    s.start();
    visible = false; // the tab hid before the microtask ran
    await flush();
    vi.advanceTimersByTime(10_000);
    await flush();
    expect(submissions).toBe(0);
    visible = true; // visibility returns — the scheduler resumes
    vi.advanceTimersByTime(3_100);
    await flush();
    expect(submissions).toBeGreaterThanOrEqual(1);
    s.stop();
  });

  it('a rejected submit does not break the retry loop', async () => {
    let visible = true;
    let attempts = 0;
    const s = createReadinessScheduler({
      isVisible: () => visible,
      submit: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transport lost');
      },
      intervalMs: 10,
    });
    s.start();
    await flush();
    vi.advanceTimersByTime(30);
    await flush();
    expect(attempts).toBeGreaterThanOrEqual(2); // the failure did not stop the loop
    s.stop();
  });
});
