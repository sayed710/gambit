import { describe, expect, it } from 'vitest';
import { COMPAT_FEATURES, COMPAT_LABELS, detectCompat } from './compat';

describe('detectCompat', () => {
  it('every capability present -> ok with no missing entries', () => {
    const report = detectCompat({ 'local-storage': true, 'web-worker': true, webassembly: true });
    expect(report).toEqual({ ok: true, missing: [] });
  });

  it('each capability is REQUIRED — removing any one fails the gate', () => {
    for (const dropped of COMPAT_FEATURES) {
      const probe = Object.fromEntries(COMPAT_FEATURES.map((f) => [f, f !== dropped])) as Record<
        typeof dropped,
        boolean
      >;
      const report = detectCompat(probe);
      expect(report.ok, dropped).toBe(false);
      expect(report.missing, dropped).toEqual([dropped]);
    }
  });

  it('all capabilities missing -> every entry reported in the stable order', () => {
    const report = detectCompat({ 'local-storage': false, 'web-worker': false, webassembly: false });
    expect(report).toEqual({ ok: false, missing: [...COMPAT_FEATURES] });
  });

  it('keys left out of the probe fall through to the real runtime check', () => {
    // jsdom has no Worker implementation but does have localStorage and
    // (via the Node runtime) WebAssembly — only the worker can be missing
    const report = detectCompat({ webassembly: true });
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['web-worker']);
  });

  it('every feature carries a plain-language label and reason', () => {
    for (const feature of COMPAT_FEATURES) {
      expect(COMPAT_LABELS[feature].label.length).toBeGreaterThan(0);
      expect(COMPAT_LABELS[feature].why.length).toBeGreaterThan(0);
    }
  });
});
