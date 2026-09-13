import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProfile } from '../state/ProfileContext';
import { useToast } from '../components/Toast';
import { TrashIcon } from '../components/Icons';
import { copyText } from '../lib/pgn';
import {
  exportSelectedPgn,
  filterGames,
  loadLibraryMeta,
  saveLibraryMeta,
  toggleFavorite,
  type LibraryMeta,
} from '../lib/libraryStore';
import { identifyOpening } from '../lib/openings';
import type { GameRecord } from '../lib/types';

const TC_CATEGORIES = ['Bullet', 'Blitz', 'Rapid', 'Classical', 'Unlimited'];

export default function Library() {
  const { profile, deleteGame } = useProfile();
  const games = profile.games;
  const { toast } = useToast();
  const [meta, setMeta] = useState<LibraryMeta>(() => loadLibraryMeta());
  const [q, setQ] = useState('');
  const [result, setResult] = useState<'all' | 'win' | 'loss' | 'draw'>('all');
  const [mode, setMode] = useState<'all' | 'ai' | 'pass'>('all');
  const [tc, setTc] = useState('all');
  const [tag, setTag] = useState('all');
  const [favOnly, setFavOnly] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [noteFor, setNoteFor] = useState<string | null>(null);

  useEffect(() => {
    saveLibraryMeta(meta);
  }, [meta]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const list of Object.values(meta.tags)) for (const t of list) set.add(t);
    return [...set].sort();
  }, [meta.tags]);

  const filtered = useMemo(
    () =>
      filterGames(games, {
        q,
        result,
        mode,
        tc: tc === 'all' ? undefined : tc,
        tag: tag === 'all' ? undefined : tag,
        tags: meta.tags,
        favoritesOnly: favOnly,
        favorites: meta.favorites,
      }),
    [games, q, result, mode, tc, tag, favOnly, meta],
  );

  const selectedGames = useMemo(() => filtered.filter((g) => selected.includes(g.id)), [filtered, selected]);

  const toggleSelect = (id: string) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));

  const exportSelected = useCallback(async () => {
    const list = selectedGames.length > 0 ? selectedGames : filtered;
    if (list.length === 0) return;
    const pgn = exportSelectedPgn(list);
    const ok = await copyText(pgn);
    toast(ok ? `Copied ${list.length} games as PGN.` : `Couldn't copy, select the text instead.`);
  }, [selectedGames, filtered, toast]);

  const deleteSelected = () => {
    const ids = selectedGames.length > 0 ? selectedGames.map((g) => g.id) : [];
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} game${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    ids.forEach(deleteGame);
    setSelected([]);
    toast(`${ids.length} deleted.`);
  };

  const setTags = (id: string, tags: string[]) => setMeta((m) => ({ ...m, tags: { ...m.tags, [id]: tags } }));

  return (
    <div className="page container">
      <div className="page-head row between wrap" style={{ gap: '1rem' }}>
        <div>
          <h1>Library</h1>
          <p className="sub">
            Every game stored in this browser — searchable, taggable, exportable. {games.length} game
            {games.length === 1 ? '' : 's'} on record.
          </p>
        </div>
        <div className="row" style={{ gap: '0.45rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={exportSelected} disabled={games.length === 0}>
            {selectedGames.length > 0 ? `Export ${selectedGames.length} selected` : 'Export all (PGN)'}
          </button>
          <button className="btn btn-danger btn-sm" onClick={deleteSelected} disabled={selectedGames.length === 0}>
            <TrashIcon /> Delete selected
          </button>
        </div>
      </div>

      <div className="library-filters panel panel-pad mb-2">
        <input
          className="input"
          placeholder="Search moves, opponents, results…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search games"
        />
        <select className="input" value={result} onChange={(e) => setResult(e.target.value as typeof result)} aria-label="Result filter">
          <option value="all">Any result</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
          <option value="draw">Draws</option>
        </select>
        <select className="input" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label="Mode filter">
          <option value="all">Any mode</option>
          <option value="ai">vs engine</option>
          <option value="pass">pass &amp; play</option>
        </select>
        <select className="input" value={tc} onChange={(e) => setTc(e.target.value)} aria-label="Time control filter">
          <option value="all">Any pace</option>
          {TC_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select className="input" value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag filter">
          <option value="all">Any tag</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <label className="check-row" style={{ whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} />
          Favorites
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>{games.length === 0 ? 'No games yet — play one and it lands here automatically.' : 'Nothing matches those filters.'}</p>
        </div>
      ) : (
        <div className="library-list">
          {filtered.map((g) => (
            <LibraryRow
              key={g.id}
              game={g}
              meta={meta}
              selected={selected.includes(g.id)}
              onToggleSelect={() => toggleSelect(g.id)}
              onToggleFav={() => setMeta((m) => { const next = { ...m, favorites: [...m.favorites], tags: { ...m.tags }, notes: { ...m.notes } }; toggleFavorite(next, g.id); return next; })}
              onTags={(tags) => setTags(g.id, tags)}
              onNote={(note) => setMeta((m) => ({ ...m, notes: { ...m.notes, [g.id]: note } }))}
              noteOpen={noteFor === g.id}
              setNoteOpen={(open) => setNoteFor(open ? g.id : null)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryRow({
  game,
  meta,
  selected,
  onToggleSelect,
  onToggleFav,
  onTags,
  onNote,
  noteOpen,
  setNoteOpen,
}: {
  game: GameRecord;
  meta: LibraryMeta;
  selected: boolean;
  onToggleSelect: () => void;
  onToggleFav: () => void;
  onTags: (tags: string[]) => void;
  onNote: (note: string) => void;
  noteOpen: boolean;
  setNoteOpen: (open: boolean) => void;
}) {
  const opening = identifyOpening(game.moves);
  const tagList = meta.tags[game.id] ?? [];
  const note = meta.notes[game.id] ?? '';
  const fav = meta.favorites.includes(game.id);
  const delta = game.ratingAfter - game.ratingBefore;

  return (
    <div className={`library-row${selected ? ' on' : ''}`}>
      <input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Select game vs ${game.opponentName}`} />
      <button type="button" className={`fav-btn${fav ? ' on' : ''}`} onClick={onToggleFav} aria-label={fav ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={fav}>
        ★
      </button>
      <div className="library-main">
        <div className="row between wrap" style={{ gap: '0.3rem 1rem' }}>
          <span>
            <span className={`badge ${game.result}`}>{game.result === 'win' ? 'Win' : game.result === 'loss' ? 'Loss' : 'Draw'}</span>{' '}
            <strong>{game.opponentName}</strong>{' '}
            <span className="small muted">
              {game.mode === 'ai' ? 'engine' : 'pass & play'} · {game.timeControl.label}
            </span>
          </span>
          <span className="small muted mono">
            {new Date(game.date).toLocaleDateString()} · {delta >= 0 ? '+' : ''}
            {delta} · {game.moves.length} plies
          </span>
        </div>
        <div className="small muted">
          {game.reason}
          {opening && (
            <>
              {' '}
              · <span style={{ color: 'var(--ice)' }}>{opening.name}</span>
            </>
          )}
        </div>
        {(tagList.length > 0 || note) && (
          <div className="small" style={{ marginTop: '0.2rem' }}>
            {tagList.map((t) => (
              <span key={t} className="mp-chip" style={{ fontSize: '0.68rem', padding: '0.05rem 0.45rem', marginRight: '0.3rem' }}>
                {t}
              </span>
            ))}
            {note && <span className="muted" style={{ fontFamily: 'var(--serif)', fontStyle: 'italic' }}>“{note}”</span>}
          </div>
        )}
      </div>
      <div className="library-ops">
        <Link className="btn btn-ghost btn-sm" to={`/review/${game.id}`}>
          Review
        </Link>
        <button className="btn btn-ghost btn-sm" onClick={() => setNoteOpen(!noteOpen)}>
          {noteOpen ? 'Close' : 'Note & tags'}
        </button>
      </div>
      {noteOpen && (
        <div className="library-note col" style={{ gap: '0.4rem' }}>
          <input
            className="input"
            placeholder="Tags, comma separated…"
            defaultValue={tagList.join(', ')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onTags(
                  (e.target as HTMLInputElement).value
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                );
                setNoteOpen(false);
              }
            }}
          />
          <textarea
            className="input"
            rows={2}
            placeholder="Note on this game…"
            defaultValue={note}
            onBlur={(e) => onNote(e.target.value.trim())}
          />
        </div>
      )}
    </div>
  );
}
