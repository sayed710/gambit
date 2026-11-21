/* ============================================================
   compat — the browser-compatibility gate (stabilization PR-E).

   Feature-DETECT, never user-agent sniffing. Three tiers:

   - BOOT BLOCKERS (static): a browser without Workers cannot run
     any chess engine — both paths live in workers.
   - BOOT BLOCKERS (probed): a browser may EXPOSE Worker while
     only running classic workers — the bundled engine constructs
     a MODULE worker, so mere existence is not proof. Before the
     app mounts, a tiny self-test worker built from a blob (its
     source uses `export {}` — valid ONLY as a module) proves the
     browser can actually start the worker type the engine needs.
     The probe is bounded by a timeout and its worker is always
     terminated and its blob revoked afterwards.
   - DEGRADATIONS: missing WebAssembly still boots — the app
     automatically falls back to the built-in lightweight
     JavaScript engine (and says so). Never a blocker.
   - Local storage is deliberately NOT gated: a quota-full or
     read-only store can still READ and EXPORT existing data, and
     the storage-failure banner (PR-A) owns that truth with
     recovery routes. Hard-gating on it would lock users out of
     their own backups.

   Every check is overridable so tests can simulate partial
   browsers without real workers.
   ============================================================ */

export type CompatFeature = 'web-worker' | 'module-worker' | 'webassembly';

/** capabilities without which the app cannot boot at all */
export const BOOT_BLOCKERS: readonly CompatFeature[] = ['web-worker', 'module-worker'];

/** capabilities whose absence merely degrades the experience */
export const DEGRADATIONS: readonly CompatFeature[] = ['webassembly'];

/** Plain-language label + what changes when it is missing. */
export const COMPAT_LABELS: Record<CompatFeature, { label: string; why: string }> = {
  'web-worker': {
    label: 'Web Workers',
    why: 'Both chess engines think in a background worker so the board never freezes — without one no engine can run.',
  },
  'module-worker': {
    label: 'Module workers',
    why: 'The engine runs its worker as a JavaScript module — this browser exposes workers but cannot start that kind. Gambit verifies this with a short self-test before starting.',
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
  'module-worker': hasWebWorker, // real proof comes from the async probe below
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

export interface DetectOptions {
  /** static per-feature overrides (tests simulate partial browsers) */
  probe?: Partial<Record<CompatFeature, boolean>>;
  /** override for the async module-worker probe (tests inject fake outcomes) */
  moduleWorkerProbe?: () => Promise<boolean>;
  /** the module-worker probe's timeout in ms (default 3000) */
  timeoutMs?: number;
}

export async function detectCompat(opts: DetectOptions = {}): Promise<CompatReport> {
  const { probe, moduleWorkerProbe, timeoutMs } = opts;
  const missing: CompatFeature[] = [];
  const degraded: CompatFeature[] = [];

  // static blockers first — a browser with no Worker at all cannot run
  // any engine, so the module probe would be pointless
  for (const feature of BOOT_BLOCKERS) {
    if (feature === 'module-worker') continue; // proven asynchronously below
    if (!(probe?.[feature] ?? DETECTORS[feature]())) missing.push(feature);
  }
  if (missing.length > 0) {
    for (const feature of DEGRADATIONS) {
      if (!(probe?.[feature] ?? DETECTORS[feature]())) degraded.push(feature);
    }
    return { ok: false, missing, degraded };
  }

  // the module-worker proof: existence is not support
  const moduleOk =
    probe?.['module-worker'] ?? (await (moduleWorkerProbe ?? (() => probeModuleWorker(timeoutMs)))().catch(() => false));
  if (!moduleOk) missing.push('module-worker');

  for (const feature of DEGRADATIONS) {
    if (!(probe?.[feature] ?? DETECTORS[feature]())) degraded.push(feature);
  }
  return { ok: missing.length === 0, missing, degraded };
}

/**
 * Prove this browser can START a module worker — the worker type the
 * engine needs — with a bounded, self-cleaning self-test. A tiny
 * throwaway module worker is built from a blob whose source uses
 * `export {}`: valid module syntax that a classic-only browser (one
 * that silently treats the type option as classic) cannot parse, so
 * such browsers fail the probe instead of passing it falsely.
 *
 * Resolves true only when the worker starts and answers; every other
 * outcome (construction throw, load error, silence) resolves false
 * after `timeoutMs`. The worker is terminated and the blob revoked in
 * all cases.
 */
export function probeModuleWorker(timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker | null = null;
    let url = '';
    let timer = 0;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        worker?.terminate();
      } catch {
        /* already gone */
      }
      if (url) URL.revokeObjectURL(url);
      resolve(ok);
    };

    timer = window.setTimeout(() => finish(false), timeoutMs);
    try {
      // `export {}` is valid module syntax and a syntax error as a classic
      // script — a classic-only browser cannot pass this source
      const source = "export {};\nself.postMessage('module-ok');";
      url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      worker = new Worker(url, { type: 'module' });
      worker.addEventListener('message', (e: MessageEvent<string>) => {
        if (e.data === 'module-ok') finish(true);
      });
      worker.addEventListener('error', () => finish(false));
    } catch {
      finish(false);
    }
  });
}
