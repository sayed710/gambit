import { useEffect, useMemo, useState } from 'react';
import { HashRouter } from 'react-router-dom';
import App from './App';
import CompatGate from './components/CompatGate';
import { detectCompat, type CompatFeature, type CompatReport } from './lib/compat';
import { initPwa } from './lib/pwa';
import { ProfileProvider } from './state/ProfileContext';
import { SettingsProvider } from './state/SettingsContext';
import { ToastProvider } from './components/Toast';

/* ============================================================
   AppGate — the compatibility decision happens HERE, before any
   storage-writing provider mounts, so the blocked screen's
   "nothing was saved or changed" is literally true — including
   the service worker: initPwa() registers and precaches ONLY on
   the boot path. The decision is ASYNC because module-worker
   support (the engine's worker type) is proven with a bounded,
   self-cleaning self-test before the app mounts. When the boot
   blockers are present, the real app mounts unchanged.
   ============================================================ */

export default function AppGate({ probe }: { probe?: Partial<Record<CompatFeature, boolean>> }) {
  const [report, setReport] = useState<CompatReport | null>(null);
  const options = useMemo(() => ({ probe }), [probe]);

  useEffect(() => {
    let dead = false;
    void detectCompat(options).then((r) => {
      if (!dead) setReport(r);
    });
    return () => {
      dead = true;
    };
  }, [options]);

  const booted = report?.ok === true;
  useEffect(() => {
    if (booted) initPwa(); // one-time registration, boot path only
  }, [booted]);

  if (!report) {
    // the (fast) self-test in flight — a quiet, honest placeholder
    return (
      <div className="page container" aria-busy="true">
        <div className="empty-state">
          <p>Starting Gambit…</p>
        </div>
      </div>
    );
  }
  if (!booted) return <CompatGate missing={report.missing} />;
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
