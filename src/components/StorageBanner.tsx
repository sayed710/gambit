import { usePersistFailures } from '../lib/persistStatus';

/* ============================================================
   StorageBanner — the persistent, accessible truth about saves.

   Appears whenever any verified write failed and stays until that
   write succeeds. Copy states exactly what is and is not saved, and
   points at the two recovery routes (free space / export).
   ============================================================ */

const KIND_TITLE: Record<string, string> = {
  quota: 'Storage is full',
  unavailable: 'Browser storage unavailable',
  mismatch: 'Storage is unreliable',
  serialize: 'Could not encode data',
};

export default function StorageBanner() {
  const failures = usePersistFailures();
  if (failures.length === 0) return null;

  const domains = [...new Set(failures.map((f) => f.domain))].join(', ');
  const quota = failures.some((f) => f.kind === 'quota');

  return (
    <div className="persist-banner" role="alert">
      <div>
        <strong>
          {KIND_TITLE[failures[0].kind] ?? 'Saving problem'} — recent changes in {domains} may NOT be saved.
        </strong>
        <p className="small" style={{ margin: '0.25rem 0 0' }}>
          {failures[0].detail}{' '}
          {quota
            ? 'Your games in progress stay on screen, but they will be lost on reload until space is freed.'
            : 'Changes stay on screen for now but will be lost on reload.'}{' '}
          Profile &amp; Library only list what was actually saved.{' '}
          <strong>Backup export reads saved data only</strong> — use Emergency export for a game flagged below.
        </p>
      </div>
      <ol className="small" style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
        <li>Open Backup &amp; Restore → Export all Gambit data (saves everything that IS stored), or</li>
        <li>free space: remove old studies/repertoires via Backup &amp; Restore, then retry the failed action.</li>
      </ol>
      <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
        {failures.length} failed write{failures.length === 1 ? '' : 's'} · keys: {failures.map((f) => f.key.replace('gambit.', '')).join(', ')}
        {' · '}advisory: browser-reported usage is an estimate, not a localStorage capacity measurement.
      </p>
    </div>
  );
}
