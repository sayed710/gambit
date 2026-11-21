import { useMemo } from 'react';
import { HashRouter } from 'react-router-dom';
import App from './App';
import CompatGate from './components/CompatGate';
import { detectCompat, type CompatFeature } from './lib/compat';
import { ProfileProvider } from './state/ProfileContext';
import { SettingsProvider } from './state/SettingsContext';
import { ToastProvider } from './components/Toast';

/* ============================================================
   AppGate — the compatibility decision happens HERE, before any
   storage-writing provider mounts, so the blocked screen's
   "nothing was saved or changed" is literally true. When the
   boot blockers are present, the real app mounts unchanged.
   ============================================================ */

export default function AppGate({ probe }: { probe?: Partial<Record<CompatFeature, boolean>> }) {
  const compat = useMemo(() => detectCompat(probe), [probe]);
  if (!compat.ok) return <CompatGate missing={compat.missing} />;
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
