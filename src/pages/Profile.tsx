import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '../state/ProfileContext';
import { useSettings } from '../state/SettingsContext';
import { useToast } from '../components/Toast';
import { FULL_DATE, SHORT_DATE, timeControlText } from '../lib/chessUtils';
import { CopyIcon, KnightMark, PinIcon, TrashIcon } from '../components/Icons';
import { exportPgn, copyText } from '../lib/pgn';
import { LEVEL_RATINGS } from '../lib/engine/engine';

type FilterKey = 'all' | 'win' | 'loss' | 'draw' | 'ai' | 'pass';

export default function Profile() {
  const { profile, deleteGame, togglePin, resetAll } = useProfile();
  const settings = useSettings();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>('all');
  const [query, setQuery] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  const games = profile.games;

  const filtered = useMemo(() => {
    let list = [...games];
    if (filter === 'win' || filter === 'loss' || filter === 'draw') list = list.filter((g) => g.result === filter);
    if (filter === 'ai') list = list.filter((g) => g.mode === 'ai');
    if (filter === 'pass') list = list.filter((g) => g.mode === 'pass');
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (g) => g.opponentName.toLowerCase().includes(q) || g.moves.join(' ').toLowerCase().includes(q) || g.reason.toLowerCase().includes(q),
      );
    }
    // pinned first, then newest
    return list.sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.date - a.date);
  }, [games, filter, query]);

  const stats = useMemo(() => {
    const wins = games.filter((g) => g.result === 'win').length;
    const losses = games.filter((g) => g.result === 'loss').length;
    const draws = games.filter((g) => g.result === 'draw').length;
    const byColor = {
      w: { w: 0, l: 0, d: 0 },
      b: { w: 0, l: 0, d: 0 },
    };
    for (const g of games) byColor[g.playerColor][g.result === 'win' ? 'w' : g.result === 'loss' ? 'l' : 'd']++;
    const byTc = new Map<string, { n: number; score: number }>();
    for (const g of games) {
      const key = g.timeControl.minutes > 0 ? `${g.timeControl.minutes}+${g.timeControl.increment}` : 'No clock';
      const e = byTc.get(key) ?? { n: 0, score: 0 };
      e.n++;
      e.score += g.result === 'win' ? 1 : g.result === 'draw' ? 0.5 : 0;
      byTc.set(key, e);
    }
    const byLevel = new Map<number, { n: number; score: number }>();
    for (const g of games) {
      if (g.mode !== 'ai') continue;
      const levelMatch = g.opponentName.match(/Engine · (\w+)/);
      if (!levelMatch) continue;
      const level = ['Gentle', 'Casual', 'Club', 'Sharp'].indexOf(levelMatch[1]) + 1;
      const e = byLevel.get(level) ?? { n: 0, score: 0 };
      e.n++;
      e.score += g.result === 'win' ? 1 : g.result === 'draw' ? 0.5 : 0;
      byLevel.set(level, e);
    }
    // current + best streaks over the chronological game list
    const chrono = [...games].reverse();
    let streak = 0;
    let best = 0;
    let worst = 0;
    for (const g of chrono) {
      if (g.result === 'win') streak = streak > 0 ? streak + 1 : 1;
      else if (g.result === 'loss') streak = streak < 0 ? streak - 1 : -1;
      else streak = 0;
      best = Math.max(best, streak);
      worst = Math.min(worst, streak);
    }
    const last = games[0];
    const form = chrono.slice(-5).map((g) => g.result);
    return {
      wins,
      losses,
      draws,
      byColor,
      byTc: [...byTc.entries()].sort((a, b) => b[1].n - a[1].n),
      byLevel: [...byLevel.entries()].sort((a, b) => a[0] - b[0]),
      streak,
      best,
      worst,
      form,
      last,
      lastDelta: last ? last.ratingAfter - last.ratingBefore : 0,
    };
  }, [games]);

  const onTogglePin = useCallback(
    (id: string) => {
      togglePin(id);
      toast('Updated.');
    },
    [togglePin, toast],
  );

  const onDeleteGame = useCallback(
    (id: string) => {
      deleteGame(id);
      toast('Game deleted.');
    },
    [deleteGame, toast],
  );

  const exportGame = useCallback(
    async (id: string) => {
      const g = games.find((x) => x.id === id);
      if (!g) return;
      const pgn = exportPgn(g.moves, {
        white: g.playerColor === 'w' ? settings.name || 'You' : g.opponentName,
        black: g.playerColor === 'w' ? g.opponentName : settings.name || 'You',
        result: g.result === 'win' ? (g.playerColor === 'w' ? '1-0' : '0-1') : g.result === 'loss' ? (g.playerColor === 'w' ? '0-1' : '1-0') : '1/2-1/2',
      });
      const ok = await copyText(pgn);
      toast(ok ? 'PGN copied.' : 'Copy failed.');
    },
    [games, settings.name, toast],
  );

  return (
    <div className="page container">
      <div className="profile-hero mb-2">
        <div className="avatar-ring">
          <div className="inner">{(settings.name || 'You')[0]}</div>
        </div>
        <div>
          <div className="pname">{settings.name || 'You'}</div>
          <div className="ptag">Every game stored locally, no account, no server.</div>
        </div>
      </div>
      <p className="sub mb-2">
        Ratings move with Elo math against the engine’s level and puzzle difficulty.
      </p>

      <div className="score-sheet" style={{ marginBottom: '1.5rem' }}>
        <div className="score-anchor">
          <div>
            <div className="big">{profile.rating}</div>
            <div className="lbl" style={{ marginTop: '0.45rem' }}>Play rating</div>
          </div>
          {stats.last && (
            <div className={`delta ${stats.lastDelta >= 0 ? 'up' : 'down'}`}>
              {stats.lastDelta >= 0 ? '+' : ''}
              {stats.lastDelta} last game
            </div>
          )}
        </div>
        <div className="score-rest">
          <div className="score-line">
            <div className="score-item">
              <div className="v">{profile.peakRating}</div>
              <div className="k">Peak</div>
            </div>
            <div className="score-item">
              <div className="v">
                <span className="form-chips">
                  {stats.form.map((f, i) => (
                    <span key={i} className={`form-chip form-${f}`}>{f === 'win' ? 'W' : f === 'loss' ? 'L' : 'D'}</span>
                  ))}
                  {stats.form.length === 0 && '—'}
                </span>
              </div>
              <div className="k">Recent form</div>
              <div className="note">
                best +{stats.best} · worst {stats.worst}
              </div>
            </div>
            <div className="score-item">
              <div className="v">{games.length}</div>
              <div className="k">Games</div>
            </div>
            <div className="score-item">
              <div className="v">{games.length > 0 ? `${Math.round((stats.wins / games.length) * 100)}%` : '—'}</div>
              <div className="k">Win rate</div>
              <div className="note">
                {stats.wins}W {stats.draws}D {stats.losses}L
              </div>
            </div>
            <div className="score-item">
              <div className="v">{Math.round(profile.puzzle.rating)}</div>
              <div className="k">Puzzle rating</div>
              <div className="note">{profile.puzzle.solved} solved</div>
            </div>
            <div className="score-item">
              <div className="v">
                {stats.streak !== 0
                  ? `${Math.abs(stats.streak)} ${stats.streak > 0 ? 'W' : 'L'}`
                  : stats.last
                    ? stats.last.result === 'draw'
                      ? 'D'
                      : '—'
                    : '—'}
              </div>
              <div className="k">Streak</div>
              <div className="note">
                best +{stats.best} · worst {stats.worst}
              </div>
            </div>
          </div>
          <div className="score-spark">
            <RatingGraph points={profile.ratingHistory} />
            {profile.ratingHistory.length <= 2 && (
              <p className="small muted mt-1">Play a few rated engine games and your rating curve will draw itself here.</p>
            )}
          </div>
        </div>
      </div>

      <div className="col" style={{ gap: '0.9rem' }}>
        <div className="panel panel-pad">
          <div className="section-label">Breakdowns</div>
          <div className="row wrap" style={{ gap: '1.5rem' }}>
            <div>
              <div className="lbl small muted mb-1">By color</div>
              <table className="table" style={{ width: 'auto' }}>
                <tbody>
                  <tr>
                    <td className="mono">White</td>
                    <td className="num">{stats.byColor.w.w}W</td>
                    <td className="num">{stats.byColor.w.d}D</td>
                    <td className="num">{stats.byColor.w.l}L</td>
                  </tr>
                  <tr>
                    <td className="mono">Black</td>
                    <td className="num">{stats.byColor.b.w}W</td>
                    <td className="num">{stats.byColor.b.d}D</td>
                    <td className="num">{stats.byColor.b.l}L</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div>
              <div className="lbl small muted mb-1">By time control</div>
              {stats.byTc.length === 0 ? (
                <p className="small muted">No games yet.</p>
              ) : (
                <table className="table" style={{ width: 'auto' }}>
                  <tbody>
                    {stats.byTc.map(([tc, e]) => (
                      <tr key={tc}>
                        <td className="mono">{tc}</td>
                        <td className="num">{e.n} games</td>
                        <td className="num">{Math.round((e.score / e.n) * 100)}% score</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <div className="lbl small muted mb-1">By engine level</div>
              {stats.byLevel.length === 0 ? (
                <p className="small muted">No engine games yet.</p>
              ) : (
                <table className="table" style={{ width: 'auto' }}>
                  <tbody>
                    {stats.byLevel.map(([level, e]) => (
                      <tr key={level}>
                        <td className="mono">{['Gentle', 'Casual', 'Club', 'Sharp'][level - 1]}</td>
                        <td className="num small muted">~{LEVEL_RATINGS[level as 1 | 2 | 3 | 4]}</td>
                        <td className="num">{e.n} games</td>
                        <td className="num">{Math.round((e.score / e.n) * 100)}% score</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        <div className="panel panel-pad">
          <div className="section-label">
            Game history
            {games.length > 0 && <span className="small muted">{filtered.length} shown</span>}
          </div>
          <div className="row wrap mb-1" style={{ gap: '0.4rem' }}>
            <input
              className="input"
              style={{ maxWidth: 240 }}
              placeholder="Search moves, opponent…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search games"
            />
            <div className="seg" role="radiogroup" aria-label="Filter games">
              {(['all', 'win', 'loss', 'draw', 'ai', 'pass'] as FilterKey[]).map((f) => (
                <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          {games.length === 0 ? (
            <div className="empty-state">
              <div className="glyph">
                <KnightMark />
              </div>
              <p>No games yet. Your finished games land here with their moves, so you can replay them later.</p>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/play')}>
                Play your first game
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <p>Nothing matches this filter.</p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Result</th>
                    <th>Opponent</th>
                    <th>Time</th>
                    <th>Moves</th>
                    <th>Rating</th>
                    <th>Date</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((g) => {
                    const delta = g.ratingAfter - g.ratingBefore;
                    return (
                      <tr key={g.id} className="rowlink" onClick={() => navigate(`/review/${g.id}`)}>
                        <td>
                          <span className={`badge ${g.result}`}>{g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : 'Draw'}</span>
                          {g.pinned && <PinIcon size={12} />}
                        </td>
                        <td>
                          {g.opponentName}
                          <span className="small muted" style={{ marginLeft: '0.4rem' }}>
                            as {g.playerColor === 'w' ? 'White' : 'Black'}
                          </span>
                        </td>
                        <td className="small muted">{timeControlText(g.timeControl)}</td>
                        <td className="num">{Math.ceil(g.moves.length / 2)}</td>
                        <td className="num">
                          {delta !== 0 ? (
                            <span className={delta > 0 ? 'badge win' : 'badge loss'}>
                              {delta > 0 ? '+' : ''}
                              {delta}
                            </span>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="small muted" title={FULL_DATE.format(g.date)}>
                          {SHORT_DATE.format(g.date)}
                        </td>
                        <td className="right">
                          <span className="row" style={{ gap: '0.25rem', justifyContent: 'flex-end' }}>
                            <button
                              className="icon-btn"
                              title={g.pinned ? 'Unpin' : 'Pin'}
                              aria-label={g.pinned ? 'Unpin game' : 'Pin game'}
                              onClick={(e) => {
                                e.stopPropagation();
                                onTogglePin(g.id);
                              }}
                            >
                              <PinIcon />
                            </button>
                            <button
                              className="icon-btn"
                              title="Copy PGN"
                              aria-label="Copy PGN"
                              onClick={(e) => {
                                e.stopPropagation();
                                exportGame(g.id);
                              }}
                            >
                              <CopyIcon />
                            </button>
                            <button
                              className="icon-btn"
                              title="Delete game"
                              aria-label="Delete game"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteGame(g.id);
                              }}
                            >
                              <TrashIcon />
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="row between" style={{ maxWidth: 460 }}>
          <span className="small muted">Joined {FULL_DATE.format(profile.joined)} · stored locally</span>
          {confirmReset ? (
            <span className="row" style={{ gap: '0.4rem' }}>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  resetAll();
                  setConfirmReset(false);
                  toast('Profile cleared.');
                }}
              >
                Yes, erase everything
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirmReset(true)}>
              <TrashIcon /> Reset profile
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RatingGraph({ points }: { points: number[] }) {
  const series = points.length > 1 ? points : [points[0] ?? 1200, points[0] ?? 1200];
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const w = 600;
  const h = 120;
  const pad = 10;
  const step = w / (series.length - 1);
  const coords = series.map((p, i) => ({ x: i * step, y: pad + (h - pad * 2 - ((p - min) / span) * (h - pad * 2)) }));
  const line = coords.map((c) => `${c.x},${c.y}`).join(' L');
  const area = `M0,${h} L${line.replace(/ L/g, ' L')} L${w},${h} Z`;
  const last = coords[coords.length - 1];

  return (
    <svg className="rating-graph" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Rating history graph">
      <defs>
        <linearGradient id="rg-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.28} />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <line x1="0" y1={h - pad} x2={w} y2={h - pad} stroke="var(--border-strong)" strokeWidth="1" />
      <path d={area} fill="url(#rg-fill)" />
      <path d={`M${line}`} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      {series.length > 1 && <circle cx={last.x} cy={last.y} r="4" fill="var(--accent)" stroke="var(--surface)" strokeWidth="1.5" />}
    </svg>
  );
}
