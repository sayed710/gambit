import { useMemo } from 'react';
import { Chess } from 'chess.js';
import { Link } from 'react-router-dom';
import { useProfile } from '../state/ProfileContext';
import { bestWorstOpenings, openingInsights } from '../lib/openingInsights';
import { loadTraining } from '../lib/trainingStore';
import { phaseAccuracies } from '../lib/reviewInsights';
import { timingStats } from '../lib/timeAnalytics';
import type { GameRecord } from '../lib/types';
import type { GameReport } from '../lib/review';
import { loadJSON } from '../lib/storage';
const FULL_DATE = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' });

/* ============================================================
   Insights — personal chess statistics, real data only.
   Accessed from Profile / Training (not the primary nav).
   Every section shows an honest empty state when data is thin.
   ============================================================ */

const THEME_LABELS: Record<string, string> = {
  fork: 'Forks',
  'double-attack': 'Double attacks',
  'pin-absolute': 'Absolute pins',
  'pin-relative': 'Relative pins',
  skewer: 'Skewers',
  hanging: 'Hanging pieces',
  'discovered-attack': 'Discovered attacks',
  'discovered-check': 'Discovered checks',
  'back-rank': 'Back-rank patterns',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <div className="section-label">{title}</div>
      {children}
    </section>
  );
}

export default function Insights() {
  const { profile } = useProfile();
  const training = useMemo(() => loadTraining(), []);

  const insights = useMemo(
    () =>
      openingInsights(profile.games, (id) =>
        loadJSON<GameReport | null>(`review.${id}`, null),
      ),
    [profile.games],
  );
  const extremes = useMemo(() => bestWorstOpenings(insights.openings), [insights.openings]);

  // game-phase accuracies over games with real cached reviews
  const phases = useMemo(() => {
    let opening = 0;
    let openingN = 0;
    let middle = 0;
    let middleN = 0;
    let endgame = 0;
    let endgameN = 0;
    for (const g of profile.games) {
      const report = loadJSON<GameReport | null>(`review.${g.id}`, null);
      if (!report) continue;
      const fens: string[] = [];
      // reconstruct fens from the game's SAN list — from the game's ACTUAL
      // starting position (custom starts replay correctly)
      const replay = new Chess(g.initialFen ?? undefined);
      fens.push(replay.fen());
      for (const san of g.moves) {
        try {
          replay.move(san);
          fens.push(replay.fen());
        } catch {
          break;
        }
      }
      const p = phaseAccuracies(report, fens);
      if (p.opening !== null) { opening += p.opening; openingN += 1; }
      if (p.middlegame !== null) { middle += p.middlegame; middleN += 1; }
      if (p.endgame !== null) { endgame += p.endgame; endgameN += 1; }
    }
    return {
      opening: openingN ? Math.round(opening / openingN) : null,
      middlegame: middleN ? Math.round(middle / middleN) : null,
      endgame: endgameN ? Math.round(endgame / endgameN) : null,
      reviewedGames: openingN,
    };
  }, [profile.games]);

  const motifEntries = useMemo(
    () =>
      Object.entries(training.motifs)
        .filter(([, s]) => s.opportunities > 0)
        .sort((a, b) => b[1].missed - a[1].missed),
    [training.motifs],
  );

  // overview totals — all derived from stored games and cached reviews
  const overview = useMemo(() => {
    const games = profile.games;
    const wins = games.filter((g) => g.result === 'win').length;
    const draws = games.filter((g) => g.result === 'draw').length;
    const losses = games.filter((g) => g.result === 'loss').length;
    let accSum = 0;
    let accN = 0;
    for (const g of games) {
      const report = loadJSON<GameReport | null>(`review.${g.id}`, null);
      if (!report?.accuracy) continue;
      accSum += g.playerColor === 'w' ? report.accuracy.w : report.accuracy.b;
      accN += 1;
    }
    const avgMoves = games.length
      ? Math.round(games.reduce((n, g) => n + Math.ceil(g.moves.length / 2), 0) / games.length)
      : 0;
    return {
      games: games.length,
      wins,
      draws,
      losses,
      scorePct: games.length ? Math.round(((wins + draws / 2) / games.length) * 100) : 0,
      avgAccuracy: accN ? Math.round(accSum / accN) : null,
      avgMoves,
    };
  }, [profile.games]);

  // time management — aggregated from real per-move timings of timed games
  const timeMgmt = useMemo(() => {
    let timedGames = 0;
    let withTimings = 0;
    let thinkSum = 0;
    let thinkN = 0;
    let pressured = 0;
    let pressureGames = 0;
    for (const g of profile.games) {
      if (g.timeControl.minutes <= 0) continue;
      timedGames += 1;
      const stats = timingStats(g as GameRecord);
      if (!stats || stats.playerTimings.length === 0) continue;
      withTimings += 1;
      for (const t of stats.playerTimings) {
        thinkSum += t.thinkMs;
        thinkN += 1;
        if (t.clockBeforeMs !== null && t.clockBeforeMs <= stats.pressureThresholdMs) pressured += 1;
      }
      if (stats.underPressure > 0) pressureGames += 1;
    }
    return {
      timedGames,
      withTimings,
      avgThinkMs: thinkN ? Math.round(thinkSum / thinkN) : null,
      pressuredPct: thinkN ? Math.round((pressured / thinkN) * 100) : null,
      pressureGames,
    };
  }, [profile.games]);

  return (
    <div className="page container">
      <div className="page-head row between wrap" style={{ gap: '1rem' }}>
        <div>
          <h1>Insights</h1>
          <p className="sub">
            Everything here is computed from your own saved games and training record — nothing global, nothing
            invented.
          </p>
        </div>
        <Link to="/profile" className="btn btn-ghost btn-sm">
          ← Profile
        </Link>
      </div>

      <Section title="Overview">
        {overview.games === 0 ? (
          <p className="small muted">No games yet — play a few and your record will be summarized here.</p>
        ) : (
          <>
            <div className="rep-stats" style={{ maxWidth: 'none', flexWrap: 'wrap' }}>
              <div>
                <div className="v">{overview.games}</div>
                <div className="k">games</div>
              </div>
              <div>
                <div className="v">
                  {overview.wins}/{overview.draws}/{overview.losses}
                </div>
                <div className="k">w/d/l</div>
              </div>
              <div>
                <div className="v">{overview.scorePct}%</div>
                <div className="k">score</div>
              </div>
              <div>
                <div className="v">{overview.avgAccuracy !== null ? `${overview.avgAccuracy}%` : '—'}</div>
                <div className="k">avg accuracy</div>
              </div>
              <div>
                <div className="v">{overview.avgMoves}</div>
                <div className="k">avg moves</div>
              </div>
            </div>
            <p className="small muted mt-1">
              Accuracy appears only when a game has a completed review.
            </p>
          </>
        )}
      </Section>

      <Section title="Openings">
        {insights.openings.length === 0 && !insights.unidentified ? (
          <p className="small muted">No games yet — play a few and your openings will be tabulated here.</p>
        ) : (
          <>
            <p className="small muted mt-1" style={{ marginBottom: '0.6rem' }}>
              Based on your saved games. Accuracy appears only for games with a completed review.
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Opening</th>
                    <th>ECO</th>
                    <th className="num">Games</th>
                    <th className="num">W/D/L</th>
                    <th className="num">Score</th>
                    <th className="num">Accuracy</th>
                    <th>Last played</th>
                  </tr>
                </thead>
                <tbody>
                  {insights.openings.slice(0, 12).map((o) => (
                    <tr key={`${o.eco}${o.name}`}>
                      <td>{o.name}</td>
                      <td className="mono">{o.eco}</td>
                      <td className="num">{o.games}</td>
                      <td className="num">
                        {o.wins}/{o.draws}/{o.losses}
                      </td>
                      <td className="num">{o.scorePct}%</td>
                      <td className="num">{o.avgAccuracy !== null ? `${o.avgAccuracy}%` : '—'}</td>
                      <td className="small muted">{FULL_DATE.format(o.lastPlayed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {insights.unidentified && (
              <p className="small muted">
                {insights.unidentified.games} game{insights.unidentified.games === 1 ? '' : 's'} didn’t match a known
                opening line.
              </p>
            )}
            <div className="row mt-2" style={{ gap: '2rem' }}>
              {extremes.best && (
                <p className="small">
                  <strong>{extremes.best.name}</strong> is your strongest opening ({extremes.best.scorePct}% over{' '}
                  {extremes.best.games} games).
                </p>
              )}
              {extremes.worst && extremes.worst !== extremes.best && (
                <p className="small">
                  <strong>{extremes.worst.name}</strong> is your weakest ({extremes.worst.scorePct}% over{' '}
                  {extremes.worst.games} games).
                </p>
              )}
            </div>
          </>
        )}
      </Section>

      <Section title="Tactics">
        {motifEntries.length === 0 ? (
          <p className="small muted">
            No confirmed tactical motifs recorded yet — complete a Game Review and missed tactics are tallied here.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Motif</th>
                  <th className="num">Opportunities</th>
                  <th className="num">Found</th>
                  <th className="num">Missed</th>
                  <th>Rate</th>
                </tr>
              </thead>
              <tbody>
                {motifEntries.map(([type, s]) => {
                  const rate = s.opportunities > 0 ? Math.round((s.found / s.opportunities) * 100) : 0;
                  return (
                    <tr key={type}>
                      <td>{THEME_LABELS[type] ?? type}</td>
                      <td className="num">{s.opportunities}</td>
                      <td className="num">{s.found}</td>
                      <td className="num">{s.missed}</td>
                      <td>
                        <span className="mono small">{rate}%</span>
                        <span className="motif-bar" aria-hidden="true">
                          <i style={{ width: `${rate}%` }} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Visualization">
        {(() => {
          const levels = [1, 2, 3, 4].map((l) => ({ l, ...(training.blindfold.levels[`l${l}`] ?? { attempted: 0, solved: 0, lastPracticed: null }) }));
          const total = levels.reduce((n, x) => n + x.attempted, 0);
          if (total === 0) {
            return <p className="small muted">No blindfold exercises yet — start at Train → Blindfold and your accuracy per level appears here.</p>;
          }
          return (
            <>
              <div className="rep-stats" style={{ maxWidth: 'none', flexWrap: 'wrap' }}>
                {levels.map(({ l, attempted, solved }) => (
                  <div key={l}>
                    <div className="v">{attempted ? `${Math.round((solved / attempted) * 100)}%` : '—'}</div>
                    <div className="k">level {l} · {attempted} ex</div>
                  </div>
                ))}
              </div>
              <p className="small muted mt-1">
                Across {total} exercise{total === 1 ? '' : 's'}. Exercises revisit on a spaced schedule; weak levels are recommended in Today.
              </p>
            </>
          );
        })()}
      </Section>

      <Section title="Time management">
        {timeMgmt.timedGames === 0 ? (
          <p className="small muted">Play a timed game and your clock usage will be summarized here.</p>
        ) : timeMgmt.withTimings === 0 ? (
          <p className="small muted">
            Move timing data isn’t available for these games — it is recorded for new games from this version on.
          </p>
        ) : (
          <div className="rep-stats" style={{ maxWidth: 'none', flexWrap: 'wrap' }}>
            <div>
              <div className="v">{((timeMgmt.avgThinkMs ?? 0) / 1000).toFixed(1)}s</div>
              <div className="k">avg think</div>
            </div>
            <div>
              <div className="v">{timeMgmt.pressuredPct}%</div>
              <div className="k">moves in pressure</div>
            </div>
            <div>
              <div className="v">{timeMgmt.withTimings}</div>
              <div className="k">timed games</div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Game phases">
        {phases.reviewedGames === 0 ? (
          <p className="small muted">Accuracy by phase appears once you complete a Game Review.</p>
        ) : (
          <>
            <div className="rep-stats" style={{ maxWidth: 480 }}>
              <div>
                <div className="v">{phases.opening !== null ? `${phases.opening}%` : '—'}</div>
                <div className="k">opening</div>
              </div>
              <div>
                <div className="v">{phases.middlegame !== null ? `${phases.middlegame}%` : '—'}</div>
                <div className="k">middlegame</div>
              </div>
              <div>
                <div className="v">{phases.endgame !== null ? `${phases.endgame}%` : '—'}</div>
                <div className="k">endgame</div>
              </div>
            </div>
            <p className="small muted mt-1">
              Across {phases.reviewedGames} reviewed game{phases.reviewedGames === 1 ? '' : 's'}. Phase heuristic:
              opening is moves 1–10; endgame when material ≤ 14 points or after move 40.
            </p>
          </>
        )}
      </Section>
    </div>
  );
}
