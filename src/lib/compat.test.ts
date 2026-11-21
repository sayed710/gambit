import { afterEach, describe, expect, it, vi } from 'vitest';
import { BOOT_BLOCKERS, COMPAT_LABELS, DEGRADATIONS, detectCompat, probeModuleWorker } from './compat';

afterEach(() => {
  vi.restoreAllMocks();
  // remove any fake Worker installed by a test
  delete (globalThis as { Worker?: unknown }).Worker;
});

describe('detectCompat (async, three tiers)', () => {
  it('healthy browser -> boots; missing WASM only degrades', async () => {
    const report = await detectCompat({
      probe: { 'web-worker': true, 'module-worker': true, webassembly: false },
    });
    expect(report).toEqual({ ok: true, missing: [], degraded: ['webassembly'] });
  });

  it('REGRESSION: a browser that exposes Worker but cannot run MODULE workers is NOT compatible', async () => {
    const report = await detectCompat({
      probe: { 'web-worker': true, 'module-worker': false, webassembly: true },
    });
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['module-worker']);
    expect(report.degraded).toEqual([]);
  });

  it('no Worker at all -> blocked without running the module probe (pointless there)', async () => {
    const moduleWorkerProbe = vi.fn(async () => true);
    const report = await detectCompat({ probe: { 'web-worker': false }, moduleWorkerProbe });
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['web-worker']);
    expect(moduleWorkerProbe).not.toHaveBeenCalled();
  });

  it('a rejecting module probe counts as missing (never hangs, never throws)', async () => {
    const report = await detectCompat({
      probe: { 'web-worker': true, webassembly: true },
      moduleWorkerProbe: () => Promise.reject(new Error('probe blew up')),
    });
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['module-worker']);
  });

  it('the real module probe runs when no override is given (jsdom: no Worker -> blocked)', async () => {
    const report = await detectCompat();
    // jsdom defines no Worker: the static blocker fires and the probe is moot
    expect(report.ok).toBe(false);
    expect(report.missing).toContain('web-worker');
  });

  it('local storage is deliberately NOT a boot requirement (quota-full stores must keep their export path)', () => {
    expect(BOOT_BLOCKERS.every((f) => f !== ('local-storage' as never))).toBe(true);
    expect(DEGRADATIONS.every((f) => f !== ('local-storage' as never))).toBe(true);
    expect(Object.keys(COMPAT_LABELS)).not.toContain('local-storage');
  });

  it('every feature carries a plain-language label and reason', () => {
    for (const feature of [...BOOT_BLOCKERS, ...DEGRADATIONS]) {
      expect(COMPAT_LABELS[feature].label.length).toBeGreaterThan(0);
      expect(COMPAT_LABELS[feature].why.length).toBeGreaterThan(0);
    }
  });
});

/* ---- probeModuleWorker against fake Worker implementations ---- */

type FakeWorkerEvents = { onmessage?: (e: { data: string }) => void; onerror?: () => void };

function installFakeWorker(behavior: (events: FakeWorkerEvents, url: string, type: string) => void) {
  const terminated: boolean[] = [];
  const created: { url: string; type: string }[] = [];
  class FakeWorker {
    onmessage: FakeWorkerEvents['onmessage'];
    onerror: FakeWorkerEvents['onerror'];
    constructor(url: string, opts?: { type?: string }) {
      created.push({ url, type: opts?.type ?? 'classic' });
      behavior(this, url, opts?.type ?? 'classic');
    }
    postMessage(): void {}
    terminate(): void {
      terminated.push(true);
    }
    addEventListener(type: string, handler: (e?: unknown) => void): void {
      if (type === 'message') this.onmessage = handler as FakeWorkerEvents['onmessage'];
      if (type === 'error') this.onerror = handler as FakeWorkerEvents['onerror'];
    }
  }
  (globalThis as { Worker?: unknown }).Worker = FakeWorker;
  return { terminated, created };
}

describe('probeModuleWorker (with fake workers)', () => {
  it('a module worker that starts and answers -> true, and the worker is cleaned up', async () => {
    const { terminated, created } = installFakeWorker((events) => {
      window.setTimeout(() => events.onmessage?.({ data: 'module-ok' }), 5);
    });
    const ok = await probeModuleWorker(1000);
    expect(ok).toBe(true);
    expect(created[0]?.type).toBe('module');
    expect(terminated.length).toBe(1);
  });

  it('a classic-only browser (module source fails to load) -> false', async () => {
    const { terminated } = installFakeWorker((events) => {
      window.setTimeout(() => events.onerror?.(), 5);
    });
    const ok = await probeModuleWorker(1000);
    expect(ok).toBe(false);
    expect(terminated.length).toBe(1);
  });

  it('a silent worker (timeout) -> false, still cleaned up', async () => {
    const { terminated } = installFakeWorker(() => {
      /* never answers */
    });
    const ok = await probeModuleWorker(40);
    expect(ok).toBe(false);
    expect(terminated.length).toBe(1);
  });

  it('a constructor that throws -> false', async () => {
    (globalThis as { Worker?: unknown }).Worker = class {
      constructor() {
        throw new Error('blocked by policy');
      }
    };
    const ok = await probeModuleWorker(1000);
    expect(ok).toBe(false);
  });
});
