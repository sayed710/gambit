import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';

/* ============================================================
   Guide — the user guide (stabilization PR-E).

   Plain, honest documentation of the things the product itself
   promises: where data lives and what it costs, how online rooms
   work, what offline means, and which browsers run the app.
   Every section is anchorable (#storage, #online, …) because the
   storage banner and the compat gate point straight at them.
   ============================================================ */

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="guide-section" id={id} aria-labelledby={`guide-${id}`}>
      <h2 id={`guide-${id}`}>{title}</h2>
      {children}
    </section>
  );
}

export default function Guide() {
  usePageTitle('Gambit — User Guide');
  return (
    <div className="guide">
      <div className="container">
        <header className="guide-head">
          <p className="section-label">User guide</p>
          <h1>A quiet place to play chess — how it works</h1>
          <p className="small muted">
            Everything below is a description of behavior that already exists, not a promise. When a claim here and the
            app ever disagree, trust the app and tell us.
          </p>
        </header>

        <div className="guide-body">
          <Section id="start" title="Getting started">
            <p>
              <strong>Play</strong> puts you against the engine at four strengths — all local, all free. <strong>Train</strong>{' '}
              gathers puzzles, spaced-repetition repertoires, endgame lessons, and blindfold visualization.{' '}
              <strong>Analysis</strong> opens a real engine board where you can import PGN, explore variations, and get a
              full move-by-move review with classifications and coach notes.
            </p>
            <p>
              You never need an account. Nothing you do here is sent anywhere — see <a href="#storage">where your data lives</a>.
            </p>
          </Section>

          <Section id="storage" title="Where your data lives">
            <p>
              Your profile, settings, games, studies, repertoires, and training progress are saved in{' '}
              <strong>this browser's local storage</strong> under the <code>gambit.</code> prefix. That means:
            </p>
            <ul>
              <li>Clearing site data <em>deletes everything</em> — export a backup first (Profile → Backup &amp; Restore).</li>
              <li>Browser storage has a real ceiling (a few megabytes). If a save fails, a{' '}
                <strong>storage banner</strong> appears on every page naming exactly what did not save, with recovery
                routes — it never silently drops data.
              </li>
              <li>
                A <strong>backup file</strong> is a complete, checksummed export you own. An{' '}
                <strong>emergency game file</strong> (offered when a finished game could not be saved) is a single-game
                rescue — explicitly not a complete backup.
              </li>
              <li>Two tabs of the app share one storage: the last write wins. Avoid playing in two tabs at once.</li>
            </ul>
          </Section>

          <Section id="online" title="Playing online">
            <p>
              <strong>Online</strong> creates a room and gives you an invite link — share it with one opponent. Seats are
              anonymous guest sessions tied to this browser: <em>clearing site data loses your seat</em>, and a room
              exists only while the game is live or waiting.
            </p>
            <ul>
              <li>The clock never starts until <strong>both players acknowledge readiness</strong> — hidden tabs are not penalized.</li>
              <li>Flag fall is adjudicated by the server with the FIDE 6.9 rule: a timeout is a draw when the opponent cannot possibly mate.</li>
              <li>After a game completes, either player can <strong>offer a rematch</strong> — colors swap, the time control is preserved. Offers expire after 10 minutes; a stale offer can be renewed from the result card without waiting for the opponent.</li>
              <li>Rooms you abandon linger for 24 hours before they are cleaned up, and open rooms are capped per player.</li>
            </ul>
          </Section>

          <Section id="offline" title="Offline play">
            <p>
              Gambit is an installed-capable offline app. Once installed, the engine, boards, and your training all work
              with no connection; the <strong>“Ready offline”</strong> chip only appears when the app has verified every
              critical asset is actually cached — it never claims readiness it cannot prove. Online play, naturally,
              needs a connection.
            </p>
          </Section>

          <Section id="ratings" title="Ratings and honesty">
            <p>
              Ratings, clocks, and engine evaluations are real math computed on your device — there are no dark patterns
              and no fake numbers. Elo is <strong>local and approximate</strong>, engine “strengths” are labels for
              configured search settings (not measured Elo), and games against custom starting positions or engine
              personalities are marked <strong>Unrated</strong> because a rating earned against a non-standard game
              would be a fake number.
            </p>
          </Section>

          <Section id="compat" title="Browsers that run Gambit">
            <p>
              Gambit needs three things from a browser: <strong>local storage</strong> (to save anything at all),{' '}
              <strong>Web Workers</strong> and <strong>WebAssembly</strong> (the engine is a WASM module that thinks in a
              background worker). Every current Chrome, Edge, Firefox, and Safari has them. If one is missing — hardened
              private modes can disable site data — the app shows a plain explanation instead of half-working, and
              nothing is saved or changed behind your back.
            </p>
          </Section>

          <Section id="keyboard" title="Accessibility">
            <p>
              Boards are clickable (click from-square, click to-square) and keyboard-operable where available; live
              regions announce moves and grading; dialogs trap focus and close on Escape; the interface respects your
              reduced-motion preference. If any of that fails for you, that is a bug — not a trade-off.
            </p>
          </Section>
        </div>

        <p className="guide-back">
          <Link className="btn btn-ghost" to="/">
            Back to the board
          </Link>
        </p>
      </div>
    </div>
  );
}
