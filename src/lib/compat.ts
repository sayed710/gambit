/* ============================================================
   compat — the browser-compatibility gate (stabilization PR-E).

   Feature-DETECT, never user-agent sniffing: the three
   capabilities below are the app's true minimum (settings and
   games persist through localStorage; the engine runs in a Web
   Worker compiled to WebAssembly). Each check is a pure function
   of the runtime, and every check can be overridden through the
   `probe` argument so tests can simulate partial browsers.

   Missing ANY required capability renders CompatGate instead of
   the app — an honest, quiet explanation, never a silent crash.
   ============================================================ */

export type CompatFeature = 'local-storage' | 'web-worker' | 'webassembly';

export const COMPAT_FEATURES: readonly CompatFeature[] = ['local-storage', 'web-worker', 'webassembly'];

/** Plain-language label + why the capability matters (guide-linked). */
export const COMPAT_LABELS: Record<CompatFeature, { label: string; why: string }> = {
  'local-storage': {
    label: 'Local storage',
    why: 'Your settings, games, and training progress are saved in the browser.',
  },
  'web-worker': {
    label: 'Web Workers',
    why: 'The chess engine thinks in a background worker so the board never freezes.',
  },
  webassembly: {
    label: 'WebAssembly',
    why: 'The engine itself is a WebAssembly module — the same technology every modern chess site runs on.',
  },
};

function hasWritableLocalStorage(): boolean {
  try {
    const key = 'gambit.compat.probe';
    window.localStorage.setItem(key, '1');
    window.localStorage.removeItem(key);
    return true;
  } catch {
    // private-mode quotas, disabled storage, or a hardened profile —
    // all of them mean the app cannot save anything, ever
    return false;
  }
}

function hasWebWorker(): boolean {
  return typeof Worker !== 'undefined';
}

function hasWebAssembly(): boolean {
  return typeof WebAssembly === 'object' && typeof WebAssembly.instantiate === 'function';
}

const DETECTORS: Record<CompatFeature, () => boolean> = {
  'local-storage': hasWritableLocalStorage,
  'web-worker': hasWebWorker,
  webassembly: hasWebAssembly,
};

export interface CompatReport {
  /** true when every required capability is present */
  ok: boolean;
  /** the required capabilities that are missing (empty when ok) */
  missing: CompatFeature[];
}

/**
 * Detect the browser's capabilities. `probe` overrides individual
 * detector results (tests simulate partial browsers with it); keys
 * left out fall through to the real runtime check.
 */
export function detectCompat(probe?: Partial<Record<CompatFeature, boolean>>): CompatReport {
  const missing: CompatFeature[] = [];
  for (const feature of COMPAT_FEATURES) {
    const result = probe?.[feature] ?? DETECTORS[feature]();
    if (!result) missing.push(feature);
  }
  return { ok: missing.length === 0, missing };
}
