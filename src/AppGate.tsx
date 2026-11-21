import { useEffect, useMemo } from 'react';
import { HashRouter } from 'react-router-dom';
import App from './App';
import CompatGate from './components/CompatGate';
import { detectCompat, type CompatFeature } from './lib/compat';
import { initPwa } from './lib/pwa';
import { ProfileProvider } from './state/ProfileContext';
import { SettingsProvider } from './state/SettingsContext';
import { ToastProvider } from './components/Toast';

/* ============================================================
   AppGate — the compatibility decision happens HERE, before any
   storage-writing provider mounts, so the blocked screen's
   "nothing was saved or changed" is literally true — including
   the service worker: initPwa() registers and precaches ONLY on
   the boot path. When the boot blockers are present, the real
   app mounts unchanged.
   ============================================================ */

export default function AppGate({ probe }: { probe?: Partial<Record<CompatFeature, boolean>> }) {
  const compat = useMemo(() => detectCompat(probe), [probe]);
  const booted = compat.ok;

  useEffect(() => {
    if (booted) initPwa(); // one-time registration, boot path only
  }, [booted]);

  if (!booted) return <CompatGate missing={compat.missing} />;
  return (
    <HashRouter>
      <SettingsProvider>
        <ProfileProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </ProfileProvider>
      </SettingsProvider>
    </HashRouter>
  );
}
