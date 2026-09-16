import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ENDGAME_LESSONS } from '../data/endgames';
import { buildAdaptiveSession, type AdaptiveItem, type ReviewMistake } from '../lib/adaptiveEngine';
import { dueCount, trainingStats } from '../lib/repertoireTrain2';
import { loadRepertoires } from '../lib/repertoireStore';
import { loadTraining } from '../lib/trainingStore';
import { useProfile } from '../state/ProfileContext';

const KIND_LABEL: Record<AdaptiveItem['kind'], string> = {
  puzzle: 'Puzzle',
  mistake: 'Review',
  repertoire: 'Repertoire',
  endgame: 'Endgame',
  motif: 'Tactics',
  visualization: 'Visualization',
};

/** Route an adaptive item to its destination. */
function itemLink(item: AdaptiveItem): { to: string; cta: string } {
  switch (item.kind) {
    default:
    case 'puzzle':
      return { to: item.ref.theme ? `/puzzles?theme=${item.ref.theme}` : '/puzzles', cta: 'Solve' };
    case 'mistake':
      return { to: `/review/${item.ref.gameId}`, cta: 'Review' };
    case 'repertoire':
      return { to: `/repertoire/${item.ref.repertoireId}`, cta: 'Drill' };
    case 'endgame':
      return { to: `/endgames/${item.ref.lessonId}`, cta: 'Play out' };
    case 'motif':
      return { to: '/puzzles', cta: 'Practice' };
    case 'visualization':
      return { to: '/coordinates', cta: 'Warm up' };
  }
}

export default function Training() {
  const { profile } = useProfile();
  const training = useMemo(() => loadTraining(), []);
  const repertoires = useMemo(() => loadRepertoires(), []);

  const session = useMemo(() => {
    const now = Date.now();
    const reviewMistakes: ReviewMistake[] = profile.games
      .filter((g) => g.result !== 'draw' && g.moves.length > 0)
      .slice(0, 12)
      .map((g, i) => ({
        gameId: g.id,
        ply: Math.max(1, Math.floor(g.moves.length / 2)),
        san: g.moves[g.moves.length - 1] ?? '…',
        className: g.result === 'loss' ? 'blunder' : 'inaccuracy',
        when: g.date || now - i * DAY,
      }));
    return buildAdaptiveSession({
      now,
      puzzleThemes: profile.puzzle.byTheme,
      motifStats: training.motifs,
      endgame: training.endgame,
      repScheduling: training.repScheduling,
      repertoirePositions: repertoires.flatMap((r) =>
        r.lines.map((line) => ({
          repertoireId: r.id,
          lineId: line.id,
          nodeKey: '__root__',
          san: line.name,
        })),
      ),
      reviewMistakes,
    });
  }, [profile, training, repertoires]);

  const repStats = useMemo(() => trainingStats(training, Date.now()), [training]);
  const repDue = useMemo(() => {
    let n = 0;
    for (const r of repertoires) {
      void r;
    }
    return n + dueCount(training, Date.now());
  }, [training, repertoires]);

  const endgameRec = useMemo(() => {
    const entries = Object.entries(training.endgame);
    if (entries.length === 0) return null;
    const [id, p] = entries.sort((a, b) => a[1].mastery - b[1].mastery)[0];
    return { id, mastery: p.mastery };
  }, [training]);

  const trainDays = useMemo(() => {
    const days = new Set<string>();
    for (const g of profile.games) if (g.date) days.add(new Date(g.date).toDateString());
    for (const l of Object.values(training.endgame)) if (l.lastPracticed) days.add(new Date(l.lastPracticed).toDateString());
    return days.size;
  }, [profile.games, training]);

  return (
    <div className="page container">
      <div className="page-head">
        <h1>Train</h1>
        <p className="sub">Today’s session, built from your own misses, due reviews and weakest endings.</p>
        <nav className="page-tabs mt-2" aria-label="Training area">
          <Link to="/training" className="on">
            Today
          </Link>
          <Link to="/puzzles">Puzzles</Link>
          <Link to="/repertoire">Repertoire</Link>
          <Link to="/endgames">Endgames</Link>
          <Link to="/coordinates">Coordinates</Link>
          <Link to="/repertoire">Repertoire</Link>
          <Link to="/endgames">Endgames</Link>
          <Link to="/coordinates">Coordinates</Link>
        </nav>
      </div>

      <div className="rep-stats mb-2" style={{ maxWidth: 640 }}>
        <div>
          <div className="v">{repDue}</div>
          <div className="k">repertoire due</div>
        </div>
        <div>
          <div className="v">{repStats.mastered}</div>
          <div className="k">mastered</div>
        </div>
        <div>
          <div className="v">{session.length}</div>
          <div className="k">session items</div>
        </div>
        <div>
          <div className="v">{trainDays}</div>
          <div className="k">training days</div>
        </div>
      </div>

      <div className="section-label">Today’s training</div>
      <div className="study-list mb-2">
        {session.map((item) => {
          const link = itemLink(item);
          return (
            <div key={item.id} className="study-card">
              <Link to={link.to} className="study-main">
                <span className="study-title">{KIND_LABEL[item.kind]}</span>
                <span className="adaptive-reason">{item.reason}</span>
              </Link>
              <Link to={link.to} className="btn btn-ghost btn-sm">
                {link.cta}
              </Link>
            </div>
          );
        })}
      </div>

      <div className="row wrap" style={{ gap: '0.9rem' }}>
        <div className="panel panel-pad" style={{ minWidth: 260 }}>
          <div className="section-label">Endgame recommendation</div>
          {endgameRec ? (
            <>
              <p className="small" style={{ margin: 0 }}>
                {ENDGAME_LESSONS.find((l) => l.id === endgameRec.id)?.title} — mastery{' '}
                {Math.round(endgameRec.mastery * 100)}%.
              </p>
              <Link className="btn btn-ghost btn-sm mt-1" to={`/endgames/${endgameRec.id}`}>
                Practice it
              </Link>
            </>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              Finish one Endgame Academy drill and recommendations will use your record.
            </p>
          )}
        </div>
        <div className="panel panel-pad" style={{ minWidth: 260 }}>
          <div className="section-label">Review failed puzzles</div>
          <p className="small muted" style={{ margin: 0 }}>
            Missed {profile.puzzle.failed} puzzles so far. The Puzzles page keeps every miss in its record.
          </p>
          <Link className="btn btn-ghost btn-sm mt-1" to="/puzzles">
            Open puzzles
          </Link>
        </div>
      </div>
    </div>
  );
}

const DAY = 86_400_000;
