import { useEffect, useState } from 'react';
import { applyUpdate, getPwaState, promptInstall, subscribePwa, type PwaState } from '../lib/pwa';

/* Offline readiness chip + polite update/install actions.
   Honest by construction: "Ready offline" comes from verified precache
   contents, not from SW registration alone. */

const LABELS: Record<PwaState['status'], string> = {
  unsupported: '',
  preparing: 'Preparing offline…',
  ready: 'Ready offline',
};

export default function PwaStatus() {
  const [state, setState] = useState(getPwaState());
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    const unsub = subscribePwa(setState);
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      unsub();
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (state.status === 'unsupported' && !state.updateAvailable) return null;

  return (
    <div className="pwa-status" role="status" aria-live="polite">
      {offline && (
        <span className="pwa-chip pwa-offline" title="No network — Gambit keeps working from local assets.">
          Offline
        </span>
      )}
      {!offline && state.status !== 'unsupported' && (
        <span className={`pwa-chip ${state.status === 'ready' ? 'pwa-ready' : 'pwa-preparing'}`} title={state.status === 'ready' ? 'App shell, assets and Stockfish are cached on this device.' : 'Caching offline assets.'}>
          {LABELS[state.status]}
        </span>
      )}
      {state.canInstall && !state.installed && (
        <button className="btn btn-ghost btn-sm" onClick={() => void promptInstall()}>
          Install Gambit
        </button>
      )}
      {state.updateAvailable && (
        <span className="row" style={{ gap: '0.35rem', alignItems: 'center' }}>
          <span className="small muted">Update available</span>
          <button className="btn btn-ghost btn-sm" onClick={applyUpdate}>
            Reload
          </button>
        </span>
      )}
    </div>
  );
}
