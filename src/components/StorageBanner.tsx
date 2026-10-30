import { clearAllUnsavedGames, clearPersistStatus, usePersistFailures, useUnsavedGames } from '../lib/persistStatus';
import { buildEmergencyGameFile, emergencyFilename } from '../lib/persist';
import { useToast } from './Toast';

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
  const unsaved = useUnsavedGames();
  const { toast } = useToast();

  const downloadOne = (g: { id: string; raw: unknown }) => {
    const file = buildEmergencyGameFile(g.raw, 'Storage write failed after game completion');
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = emergencyFilename();
    a.click();
    URL.revokeObjectURL(url);
    toast('Emergency game file downloaded. This is not a complete backup.');
  };

  if (failures.length === 0 && unsaved.length === 0) return null;

  const unsavedOnly = failures.length === 0;

  const domains = [...new Set(failures.map((f) => f.domain))].join(', ');
  const quota = failures.some((f) => f.kind === 'quota');
  // Active-game failure entries are RELIABILITY EVIDENCE about a stored
  // snapshot (stale or possibly finished), not warnings about unsaved data.
  // Acknowledging a warning must not upgrade an unverified snapshot to
  // trusted, so these entries survive Acknowledge until the snapshot is
  // explicitly resolved (Discard) or replaced by a verified save.
  const dismissibleFailures = failures.filter((f) => f.domain !== 'active-game');
  const canAcknowledge = dismissibleFailures.length > 0 || unsaved.length > 0;

  return (
    <div className="persist-banner" role="alert">
      {unsaved.length > 0 && (
        <div className="mb-2">
          <strong>
            {unsaved.length} finished game{unsaved.length === 1 ? '' : 's'} could not be saved and exist only on this screen session.
          </strong>
          <p className="small" style={{ margin: '0.25rem 0 0.4rem' }}>
            Download each one now (an EMERGENCY file with a single game — not a complete backup), then import it via Backup &amp; Restore after freeing space.
          </p>
          {unsaved.map((g) => (
            <div key={g.id} className="row between wrap" style={{ gap: '0.4rem', marginBottom: '0.3rem' }}>
              <span className="small">
                {g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : 'Draw'} vs {g.opponentName} · {g.moves.length} plies
              </span>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => downloadOne(g)}>
                Emergency export ({g.id})
              </button>
            </div>
          ))}
          {/* explicit informed decision: stops the app-level unload guard —
              after this the records are genuinely lost on reload */}
          <div className="row mt-1" style={{ gap: '0.4rem' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => clearAllUnsavedGames()}>
              Acknowledge (I understand these games will be lost on reload)
            </button>
          </div>
        </div>
      )}
      {unsavedOnly && (
        <p className="small" role="note" style={{ margin: '0.3rem 0 0' }}>
          Import recovered files via Backup &amp; Restore. Recovered games are records-only: your rating is not recalculated.
        </p>
      )}
      {failures.length > 0 && (
        <>
          <div>
            <strong>
              {KIND_TITLE[failures[0].kind] ?? 'Saving problem'} — recent changes in {domains} may NOT be saved.
            </strong>
            <p className="small" style={{ margin: '0.25rem 0 0' }}>
              {failures[0].detail}{' '}
              {quota
                ? 'Your games in progress stay on screen, but they will be lost on reload until space is freed.'
                : 'Changes stay on screen for now but will be lost on reload.'}{' '}
              Profile &amp; Library may show unsaved in-memory games — those disappear on reload unless saving succeeds.{' '}
              <strong>Backup export reads durable storage only</strong> — use the Emergency export above for flagged games.
            </p>
          </div>
          <ol className="small" style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem' }}>
            <li>Open Backup &amp; Restore → Export all Gambit data (saves everything that IS stored), or</li>
            <li>free space: remove old studies/repertoires via Backup &amp; Restore, then retry the failed action.</li>
          </ol>
          <p className="small" role="note" style={{ margin: '0.3rem 0 0', color: 'var(--bad)' }}>
            Reloading now loses unsaved data. This warning itself may fail to persist while storage is full — it is kept in memory for this session regardless.
            Unsaved records cannot be recovered automatically after a reload; use the Emergency export above while the game screen is open, or import an emergency file via Backup &amp; Restore.
          </p>
          {canAcknowledge && (
            <div className="row mt-1" style={{ gap: '0.4rem' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  dismissibleFailures.forEach((f) => clearPersistStatus(f.key));
                  clearAllUnsavedGames(); // one informed decision covers both markers
                }}
              >
                Acknowledge (I understand the data may be lost)
              </button>
            </div>
          )}
          {!canAcknowledge && failures.length > 0 && (
            <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
              This snapshot-reliability note cannot be acknowledged away — it clears when the snapshot is Discarded or
              replaced by a verified save.
            </p>
          )}
          <p className="small muted" style={{ margin: '0.3rem 0 0' }}>
            {failures.length} failed write{failures.length === 1 ? '' : 's'} · keys: {failures.map((f) => f.key.replace('gambit.', '')).join(', ')}
            {' · '}advisory: browser-reported usage is an estimate, not a localStorage capacity measurement.
          </p>
        </>
      )}
    </div>
  );
}
