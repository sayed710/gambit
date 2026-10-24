/* ============================================================
   pwa — honest offline readiness, update flow, install prompt.

   "Ready offline" is claimed ONLY after verifying the service-worker
   precache actually contains the offline-critical assets (app shell,
   build assets, Stockfish WASM). Registration alone proves nothing.
   ============================================================ */

export type OfflineStatus = 'unsupported' | 'preparing' | 'ready';

export interface PwaState {
  status: OfflineStatus;
  updateAvailable: boolean;
  canInstall: boolean;
  installed: boolean;
}

type Listener = (s: PwaState) => void;

const listeners = new Set<Listener>();
let state: PwaState = { status: 'preparing', updateAvailable: false, canInstall: false, installed: false };
let deferredInstall: (Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> }) | null = null;
let applyingUpdate: (() => void) | null = null;

function set(patch: Partial<PwaState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l(state);
}

export function getPwaState(): PwaState {
  return state;
}

export function subscribePwa(l: Listener): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

/** True when the SW precache holds every offline-critical asset. */
async function verifyOfflineAssets(): Promise<boolean> {
  try {
    if (typeof caches === 'undefined') return false;
    const names = await caches.keys();
    const precache = names.find((n) => n.includes('precache'));
    if (!precache) return false;
    const cache = await caches.open(precache);
    const keys = await cache.keys();
    const urls = new Set(keys.map((r) => r.url));
    const has = (pred: (u: string) => boolean) => [...urls].some(pred);
    return (
      has((u) => u.endsWith('/')) || // navigations (index.html)
      has((u) => u.includes('index.html'))
    ) && has((u) => u.endsWith('.wasm') || u.includes('stockfish')) && has((u) => u.endsWith('.js'));
  } catch {
    return false;
  }
}

let started = false;

/** Register the SW and wire status/update/install events (prod only). */
export function initPwa(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  if (!('serviceWorker' in navigator)) {
    set({ status: 'unsupported' });
    return;
  }
  // dev server has no SW (devOptions disabled); don't fake readiness there
  if (!import.meta.env.PROD) {
    set({ status: 'unsupported' });
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e as Event & { prompt: () => Promise<void> };
    set({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    set({ canInstall: false, installed: true });
  });
  if (window.matchMedia('(display-mode: standalone)').matches) {
    set({ installed: true });
  }

  void navigator.serviceWorker
    .register('/sw.js')
    .then(async (reg) => {
      const check = async () => {
        const ok = reg.active !== null && (await verifyOfflineAssets());
        set({ status: ok ? 'ready' : 'preparing' });
      };
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            set({ updateAvailable: true });
            applyingUpdate = () => {
              sw.postMessage({ type: 'SKIP_WAITING' });
              sw.addEventListener('statechange', () => {
                if (sw.state === 'activated') window.location.reload();
              });
            };
          }
        });
      });
      await navigator.serviceWorker.ready;
      await check();
      // re-verify if assets finish caching after activation
      setTimeout(check, 3000);
      setInterval(check, 30_000);
    })
    .catch(() => set({ status: 'preparing' }));
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredInstall) return 'unavailable';
  await deferredInstall.prompt();
  deferredInstall = null;
  set({ canInstall: false });
  return 'accepted';
}

/** Reload into the waiting update (never automatic — user action only). */
export function applyUpdate(): void {
  applyingUpdate?.() ?? window.location.reload();
}
