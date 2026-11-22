import { COMPAT_LABELS, type CompatFeature } from '../lib/compat';
import { KnightMark } from './Icons';

/* ============================================================
   CompatGate — the honest "this browser cannot run Gambit"
   screen. Rendered INSTEAD of the whole app when a required
   capability is missing; it never tries to boot half-broken.
   The full browser guide lives at /guide#compat for able
   browsers — incompatibility is explained here in full because
   the app (and its routes) are deliberately not mounted.
   ============================================================ */

export default function CompatGate({ missing }: { missing: CompatFeature[] }) {
  return (
    <div className="compat-gate">
      <main className="container" role="alert" aria-label="This browser cannot run Gambit fully">
        <div className="panel panel-pad compat-panel">
          <span className="compat-mark" aria-hidden="true">
            <KnightMark />
          </span>
          <h1>This browser can’t run Gambit fully</h1>
          <p className="small muted">
            Gambit’s local play runs entirely in this browser — no account needed, and nothing was saved or changed
            here. (Online play — which this browser also cannot start — would additionally connect two players through
            a server using anonymous guest sessions.)
          </p>
          <ul className="compat-list">
            {missing.map((feature) => (
              <li key={feature}>
                <strong>{COMPAT_LABELS[feature].label}</strong> — {COMPAT_LABELS[feature].why}
              </li>
            ))}
          </ul>
          <p className="small muted">
            A current version of Chrome, Edge, Firefox, or Safari (desktop or mobile) runs Gambit. If you are in private
            or hardened browsing mode, allow site data for this page, then reload.
          </p>
          <p>
            <button type="button" className="btn btn-gold" onClick={() => window.location.reload()}>
              Reload after fixing
            </button>
          </p>
        </div>
      </main>
    </div>
  );
}
