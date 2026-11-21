import { describe, expect, it } from 'vitest';
import { BOOT_BLOCKERS, COMPAT_LABELS, DEGRADATIONS, detectCompat } from './compat';

describe('detectCompat (two tiers)', () => {
  it('workers present -> the app boots; missing WASM only degrades', () => {
    const report = detectCompat({ 'web-worker': true, webassembly: false });
    expect(report.ok).toBe(true);
    expect(report.missing).toEqual([]);
    expect(report.degraded).toEqual(['webassembly']);
  });

  it('a missing Worker is a BOOT BLOCKER (no engine can run at all)', () => {
    const report = detectCompat({ 'web-worker': false, webassembly: true });
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['web-worker']);
    expect(report.degraded).toEqual([]);
  });

  it('both missing -> blocked with the blocker reported (wasm stays a degradation)', () => {
    const report = detectCompat({ 'web-worker': false, webassembly: false });
    expect(report).toEqual({ ok: false, missing: ['web-worker'], degraded: ['webassembly'] });
  });

  it('keys left out of the probe fall through to the real runtime check', () => {
    // jsdom has no Worker implementation but does have (via the Node
    // runtime) WebAssembly — the default runtime must NOT boot here
    const report = detectCompat({ webassembly: true });
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual(['web-worker']);
  });

  it('local storage is deliberately NOT a boot requirement (quota-full stores must keep their export path)', () => {
    expect(BOOT_BLOCKERS).not.toContain('local-storage');
    expect(DEGRADATIONS).not.toContain('local-storage');
    expect(Object.keys(COMPAT_LABELS)).not.toContain('local-storage');
  });

  it('every feature carries a plain-language label and reason', () => {
    for (const feature of [...BOOT_BLOCKERS, ...DEGRADATIONS]) {
      expect(COMPAT_LABELS[feature].label.length).toBeGreaterThan(0);
      expect(COMPAT_LABELS[feature].why.length).toBeGreaterThan(0);
    }
  });
});
