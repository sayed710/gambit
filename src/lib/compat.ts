/* ============================================================
   compat — the browser-compatibility gate (stabilization PR-E).

   Feature-DETECT, never user-agent sniffing. Two tiers, so the
   gate never blocks a browser the app can actually serve:

   - BOOT BLOCKERS: a browser without Workers cannot run ANY
     chess engine (both the Stockfish path and the built-in
     fallback live in a module worker), and an exception at
     Play mount would crash the app — these gate the boot.
   - DEGRADATIONS: missing WebAssembly still boots — the app
     automatically falls back to the built-in lightweight
     JavaScript engine (and says so). Never a blocker.
   - Local storage is deliberately NOT gated: a quota-full or
     read-only store can still READ and EXPORT existing data,
     and the storage-failure banner (PR-A) owns that truth with
     recovery routes. Hard-gating on it would lock users out of
     their own backups.

   Every check is overridable through the `probe` argument so
   tests can simulate partial browsers.
   ============================================================ */

export type CompatFeature = 'web-worker' | 'webassembly';

/** capabilities without which the app cannot boot at all */
export const BOOT_BLOCKERS: readonly CompatFeature[] = ['web-worker'];

/** capabilities whose absence merely degrades the experience */
export const DEGRADATIONS: readonly CompatFeature[] = ['webassembly'];

/** Plain-language label + what changes when it is missing. */
export const COMPAT_LABELS: Record<CompatFeature, { label: string; why: string }> = {
  'web-worker': {
    label: 'Web Workers',
    why: 'Both chess engines think in a background worker so the board never freezes — without one no engine can run.',
  },
  webassembly: {
    label: 'WebAssembly',
    why: 'The strong Stockfish engine is a WebAssembly module. Without it the app still runs and falls back to the built-in lightweight engine.',
  },
};

function hasWebWorker(): boolean {
  return typeof Worker !== 'undefined';
}

function hasWebAssembly(): boolean {
  return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

const DETECTORS: Record<CompatFeature, () => boolean> = {
  'web-worker': hasWebWorker,
  webassembly: hasWebAssembly,
};

export interface CompatReport {
  /** true when every boot blocker is present — the app may mount */
  ok: boolean;
  /** boot blockers that are missing (empty when ok) */
  missing: CompatFeature[];
  /** present-tier degradations: missing but non-blocking */
  degraded: CompatFeature[];
}

/**
 * Detect the browser's capabilities. `probe` overrides individual
 * detector results (tests simulate partial browsers with it); keys
 * left out fall through to the real runtime check.
 */
export function detectCompat(probe?: Partial<Record<CompatFeature, boolean>>): CompatReport {
  const missing: CompatFeature[] = [];
  const degraded: CompatFeature[] = [];
  for (const feature of BOOT_BLOCKERS) {
    if (!(probe?.[feature] ?? DETECTORS[feature]())) missing.push(feature);
  }
  for (const feature of DEGRADATIONS) {
    if (!(probe?.[feature] ?? DETECTORS[feature]())) degraded.push(feature);
  }
  return { ok: missing.length === 0, missing, degraded };
}
