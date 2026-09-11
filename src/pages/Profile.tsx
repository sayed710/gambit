import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProfile } from '../state/ProfileContext';
import { useSettings } from '../state/SettingsContext';
import { useToast } from '../components/Toast';
import { FULL_DATE, SHORT_DATE, timeControlText } from '../lib/chessUtils';
import { KnightMark, TrashIcon } from '../components/Icons';

function Sparkline({ points }: { points: number[] }) {
  const path = useMemo(() => {
    if (points.length < 2) return null;
    const min = Math.min(...points);
    const max = Math.max(...points);
    const span = max - min || 1;
    const w = 100;
    const h = 26;
    const pad = 2;
    return points
      .map((p, i) => `${(i / (points.length - 1)) * w},${pad + (h - ((p - min) / span) * h)}`)
      .join(' ');
  }, [points]);

  if (!path) {
    return (
      <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
        <line className="base" x1="0" y1="15" x2="100" y2="15" />
      </svg>
    );
  }
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <line className="base" x1="0" y1="15" x2="100" y2="15" />
      <polyline points={path} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function Profile() {
  const { profile, resetAll } = useProfile();
  const settings = useSettings();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [confirmReset, setConfirmReset] = useState(false);

  const games = profile.games;
  const wins = games.filter((g) => g.result === 'win').length;
  const losses = games.filter((g) => g.result === 'loss').length;
  const draws = games.filter((g) => g.result === 'draw').length;
  const last = games[0];
  const lastDelta = last ? last.ratingAfter - last.ratingBefore : 0;

  return (
    <div className="page container">
      <div className="page-head">
        <h1>{settings.name || 'You'}</h1>
        <p className="sub">
          Everything here lives in this browser only — no account, no server. Ratings move with Elo math against the
          engine’s level and puzzle difficulty.
        </p>
      </div>

      <div className="score-sheet" style={{ marginBottom: '1.5rem' }}>
        <div className="score-anchor">
          <div>
            <div className="big">{profile.rating}</div>
            <div className="lbl" style={{ marginTop: '0.45rem' }}>Play rating</div>
          </div>
          {last && (
            <div className={`delta ${lastDelta >= 0 ? 'up' : 'down'}`}>
              {lastDelta >= 0 ? '+' : ''}
              {lastDelta} last game
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
              <div className="v">{games.length}</div>
              <div className="k">Games</div>
            </div>
            <div className="score-item">
              <div className="v">{games.length > 0 ? `${Math.round((wins / games.length) * 100)}%` : '—'}</div>
              <div className="k">Win rate</div>
              <div className="note">
                {wins}W {draws}D {losses}L
              </div>
            </div>
            <div className="score-item">
              <div className="v">{Math.round(profile.puzzle.rating)}</div>
              <div className="k">Puzzle rating</div>
              <div className="note">{profile.puzzle.solved} solved</div>
            </div>
          </div>
          <div className="score-spark">
            <Sparkline points={profile.ratingHistory.length > 1 ? profile.ratingHistory : [profile.rating, profile.rating]} />
            {profile.ratingHistory.length <= 2 && (
              <p className="small muted mt-1">Play a few rated engine games and your rating curve will draw itself here.</p>
            )}
          </div>
        </div>
      </div>

      <div className="panel panel-pad">
        <div className="section-label">
          Recent games
          {games.length > 0 && <span className="small muted">{games.length} kept · newest first</span>}
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
                  <th aria-label="Review link" />
                </tr>
              </thead>
              <tbody>
                {games.map((g) => {
                  const delta = g.ratingAfter - g.ratingBefore;
                  return (
                    <tr key={g.id} className="rowlink" onClick={() => navigate(`/review/${g.id}`)}>
                      <td>
                        <span className={`badge ${g.result}`}>{g.result === 'win' ? 'Win' : g.result === 'loss' ? 'Loss' : 'Draw'}</span>
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
                        {delta !== 0 && (
                          <span className={delta > 0 ? 'badge win' : 'badge loss'}>
                            {delta > 0 ? '+' : ''}
                            {delta}
                          </span>
                        )}
                        {delta === 0 && <span className="muted">—</span>}
                      </td>
                      <td className="small muted" title={FULL_DATE.format(g.date)}>
                        {SHORT_DATE.format(g.date)}
                      </td>
                      <td className="right">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/review/${g.id}`);
                          }}
                        >
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="row between mt-3" style={{ maxWidth: 420 }}>
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
  );
}
