import { useMemo, useRef, useState } from 'react';
import { buildBackup } from '../lib/backup/exportBackup';
import { BackupError, parseBackupText, previewBackup, type ParsedBackup } from '../lib/backup/validate';
import { applyRecoverySnapshot, discardRecoverySnapshot, loadRecoverySnapshot, restoreMerge, restoreReplace, type RecoverySnapshot } from '../lib/backup/restore';
import { loadJSON } from '../lib/storage';
import type { BackupPreview } from '../lib/backup/validate';
import { useToast } from './Toast';

/* ============================================================
   BackupRestore — one-click export, validated preview, replace /
   merge restore. Lives under Profile. Arctic Editorial only:
   plain panels, no dashboard chrome.
   ============================================================ */

type Phase = 'idle' | 'preview' | 'done';

function kb(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

/** Honest inventory of the user's durable data (live read, no caching). */
function useDataInventory() {
  return useMemo(() => {
    const profile = loadJSON<{ games?: { id: string }[]; studies?: unknown[] } | null>('profile', null);
    let reviews = 0;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('gambit.review.')) reviews += 1;
    }
    return {
      games: profile?.games?.length ?? 0,
      reviews,
      studies: loadJSON<unknown[]>('studies.v1', []).length,
      repertoires: loadJSON<unknown[]>('repertoire.v1', []).length,
      practice: loadJSON<unknown[]>('practice.v1', []).length,
    };
  }, []);
}

export default function BackupRestore() {
  const { toast } = useToast();
  const inventory = useDataInventory();
  const [includeReviews, setIncludeReviews] = useState(true);
  const [exportInfo, setExportInfo] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBackup | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [mode, setMode] = useState<'replace' | 'merge'>('merge');
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<string | null>(null);
  const [interruptedRestore, setInterruptedRestore] = useState<RecoverySnapshot | null>(() => loadRecoverySnapshot());
  const fileRef = useRef<HTMLInputElement>(null);

  function handleExport() {
    try {
      const b = buildBackup({ includeReviews });
      const blob = new Blob([b.text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = b.filename;
      a.click();
      URL.revokeObjectURL(url);
      setExportInfo(`${b.filename} · ${kb(b.envelope.integrity.bytes + 200)} · ${b.envelope.integrity.sectionCounts.games} games${includeReviews ? ` · ${Object.keys(b.envelope.sections.reviews ?? {}).length} reviews` : ''}`);
      toast('Backup file downloaded.');
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`);
    }
  }

  async function handleFile(file: File) {
    setPhase('idle');
    setResult(null);
    setParseError(null);
    setParsed(null);
    setPreview(null);
    try {
      const text = await file.text();
      const p = parseBackupText(text);
      setParsed(p);
      setPreview(previewBackup(p));
    } catch (e) {
      const msg = e instanceof BackupError ? `${e.code === 'UNSUPPORTED_VERSION' ? '' : 'Rejected — '}${e.message}` : `Could not read the file: ${(e as Error).message}`;
      setParseError(msg);
    }
  }

  function confirmRestore() {
    if (!parsed) return;
    try {
      const res = mode === 'replace' ? restoreReplace(parsed) : restoreMerge(parsed);
      const added = res.applied.length;
      setResult(
        `${mode === 'replace' ? 'Replaced' : 'Merged'} ${added} section${added === 1 ? '' : 's'} · ${res.gamesAfter} games · ${res.reviewsAfter} reviewed — verified.`,
      );
      setPhase('done');
      setParsed(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      toast('Restore complete — reloading so every page sees the restored data.');
      // every in-memory context must re-read the restored storage
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      // the error's own message states whether the rollback fully succeeded;
      // we never claim the data is unchanged unless it actually is
      setResult(`Restore failed. ${(e as Error).message}`);
      setInterruptedRestore(loadRecoverySnapshot());
      setPhase('done');
    }
  }

  return (
    <div className="panel panel-pad">
      <div className="section-label">Backup &amp; restore</div>

      {interruptedRestore && (
        <div className="status-banner mb-2" role="alert" style={{ borderColor: 'var(--sea)' }}>
          <strong>Interrupted restore detected.</strong> A restore started at{' '}
          {new Date(interruptedRestore.savedAt).toLocaleString()} did not finish — your data may be mixed.
          <div className="row mt-1" style={{ gap: '0.4rem' }}>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => {
                applyRecoverySnapshot(interruptedRestore);
                discardRecoverySnapshot();
                setInterruptedRestore(null);
                toast('Pre-restore data recovered — reloading.');
                setTimeout(() => window.location.reload(), 800);
              }}
            >
              Recover pre-restore data
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                discardRecoverySnapshot();
                setInterruptedRestore(null);
                toast('Recovery snapshot discarded — keeping current data.');
              }}
            >
              Keep current data
            </button>
          </div>
        </div>
      )}

      {/* YOUR DATA */}
      <div className="rep-stats" style={{ maxWidth: 'none', flexWrap: 'wrap', marginTop: '0.6rem' }}>
        <div>
          <div className="v">{inventory.games}</div>
          <div className="k">saved games</div>
        </div>
        <div>
          <div className="v">{inventory.reviews}</div>
          <div className="k">reviewed games</div>
        </div>
        <div>
          <div className="v">{inventory.studies}</div>
          <div className="k">studies</div>
        </div>
        <div>
          <div className="v">{inventory.repertoires}</div>
          <div className="k">repertoires</div>
        </div>
        <div>
          <div className="v">{inventory.practice}</div>
          <div className="k">practice positions</div>
        </div>
      </div>
      <p className="small muted mt-1">
        Training progress, settings and any game in progress are included in every backup. Nothing leaves this device.
      </p>

      {/* BACKUP */}
      <div className="section-label mt-2">Backup</div>
      <div className="row wrap" style={{ gap: '0.5rem', alignItems: 'center' }}>
        <label className="small row" style={{ gap: '0.35rem' }}>
          <input type="checkbox" checked={includeReviews} onChange={(e) => setIncludeReviews(e.target.checked)} />
          include cached Game Reviews
        </label>
        <button className="btn btn-primary btn-sm" onClick={handleExport}>
          Export all Gambit data
        </button>
      </div>
      {exportInfo && <p className="small muted mt-1" style={{ marginBottom: 0 }}>Last export: {exportInfo}</p>}

      {/* RESTORE */}
      <div className="section-label mt-2">Restore</div>
      <input
        ref={fileRef}
        className="input"
        type="file"
        accept="application/json,.json"
        aria-label="Choose backup file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {parseError && (
        <div className="status-banner mt-2" role="alert" style={{ borderColor: 'var(--bad)' }}>
          {parseError}
        </div>
      )}

      {preview && parsed && (
        <div className="mt-2">
          <p className="small" style={{ marginBottom: '0.4rem' }}>
            Backup from {new Date(preview.exportedAt).toLocaleString()} (Gambit {preview.sourceVersion}) · {kb(preview.bytes)}
          </p>
          <div className="rep-stats" style={{ maxWidth: 'none', flexWrap: 'wrap' }}>
            <div>
              <div className="v">{preview.games}</div>
              <div className="k">games</div>
            </div>
            <div>
              <div className="v">{preview.reviewedGames}</div>
              <div className="k">reviewed</div>
            </div>
            <div>
              <div className="v">{preview.studies}</div>
              <div className="k">studies</div>
            </div>
            <div>
              <div className="v">{preview.repertoireLines}</div>
              <div className="k">repertoire lines</div>
            </div>
            <div>
              <div className="v">{preview.practiceItems}</div>
              <div className="k">practice items</div>
            </div>
          </div>

          <div className="seg mt-2" role="radiogroup" aria-label="Restore mode">
            <button role="radio" aria-checked={mode === 'merge'} className={mode === 'merge' ? 'on' : ''} onClick={() => setMode('merge')}>
              Merge with existing data
            </button>
            <button role="radio" aria-checked={mode === 'replace'} className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')}>
              Replace current data
            </button>
          </div>
          <p className="small muted mt-1">
            {mode === 'merge'
              ? 'Adds only records this device does not have (by id). Existing games, studies, repertoires and training progress always win; nothing is ever double-counted. Importing the same file twice changes nothing.'
              : 'The backup becomes the complete dataset — current data not in the backup is discarded. A recovery snapshot of your current data is stored on this device first: failures the app can catch are rolled back automatically, and if the browser dies mid-restore the snapshot is offered for recovery on the next load.'}
          </p>
          <button className="btn btn-danger btn-sm mt-1" onClick={confirmRestore}>
            {mode === 'replace' ? 'Replace everything with this backup' : 'Merge this backup'}
          </button>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="status-banner mt-2" role="status">
          {result}
        </div>
      )}
    </div>
  );
}
