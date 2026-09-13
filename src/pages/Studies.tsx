import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import TreeWorkspace from '../components/TreeWorkspace';
import { useToast } from '../components/Toast';
import { TrashIcon } from '../components/Icons';
import { fromPgn, type GameTreeData } from '../lib/gameTree';
import {
  createChapter,
  createStudy,
  duplicateChapter,
  loadStudies,
  saveStudies,
  type Study,
} from '../lib/studyStore';

export function Studies() {
  const { toast } = useToast();
  const [studies, setStudies] = useState<Study[]>(() => loadStudies());
  const [title, setTitle] = useState('');

  useEffect(() => {
    saveStudies(studies);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studies]);

  const create = () => {
    const study = createStudy(title || 'Untitled study');
    setStudies((list) => [study, ...list]);
    setTitle('');
    toast('Study created.');
  };

  const remove = (id: string) => {
    setStudies((list) => list.filter((s) => s.id !== id));
    toast('Study deleted.');
  };

  return (
    <div className="page container">
      <div className="page-head">
        <h1>Studies</h1>
        <p className="sub">
          Local notebooks for openings and positions — chapters of annotated variation trees, saved in this browser as
          you work.
        </p>
      </div>

      <form
        className="row mb-2"
        style={{ gap: '0.5rem', maxWidth: 480 }}
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <input
          className="input"
          placeholder="New study title…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="New study title"
        />
        <button className="btn btn-accent" type="submit">
          Create study
        </button>
      </form>

      {studies.length === 0 ? (
        <div className="empty-state">
          <p>No studies yet. A study is a set of chapters; each chapter is its own annotated game or position.</p>
        </div>
      ) : (
        <div className="study-list">
          {studies.map((s) => (
            <div key={s.id} className="study-card">
              <Link to={`/studies/${s.id}`} className="study-main">
                <span className="study-title">{s.title}</span>
                <span className="study-meta">
                  {s.chapters.length} {s.chapters.length === 1 ? 'chapter' : 'chapters'} · updated{' '}
                  {new Date(s.updatedAt || Date.now()).toLocaleDateString()}
                </span>
              </Link>
              <button
                className="icon-btn"
                aria-label={`Delete study ${s.title}`}
                onClick={() => remove(s.id)}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function StudyDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [studies, setStudies] = useState<Study[]>(() => loadStudies());
  const study = studies.find((s) => s.id === id) ?? null;
  const [chapterId, setChapterId] = useState<string | null>(study?.chapters[0]?.id ?? null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [pgnDraft, setPgnDraft] = useState('');

  const chapter = study?.chapters.find((c) => c.id === chapterId) ?? study?.chapters[0] ?? null;

  // autosave, debounced
  useEffect(() => {
    if (!study) return;
    const timer = window.setTimeout(() => {
      study.updatedAt = Date.now();
      saveStudies(studies);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [study, studies]);

  if (!study || !chapter) {
    return (
      <div className="page container">
        <div className="empty-state">
          <p>That study no longer exists.</p>
          <Link className="btn btn-primary" to="/studies">
            Back to studies
          </Link>
        </div>
      </div>
    );
  }

  const mutate = (fn: (s: Study) => void) => {
    setStudies((list) => {
      const copy = list.map((s) => (s.id === study.id ? { ...s } : s));
      const target = copy.find((s) => s.id === study.id)!;
      fn(target);
      return copy;
    });
  };

  const setTree = (tree: GameTreeData) => {
    mutate((s) => {
      const c = s.chapters.find((x) => x.id === chapter.id);
      if (c) c.tree = tree;
    });
  };

  const importChapterPgn = () => {
    const trimmed = pgnDraft.trim();
    if (!trimmed) return;
    const { tree } = fromPgn(trimmed);
    let n = 0;
    const stack = [...tree.moves];
    while (stack.length) {
      const x = stack.pop()!;
      n += 1;
      stack.push(...x.children);
    }
    if (n === 0) {
      toast('No moves found in that PGN.');
      return;
    }
    setTree(tree);
    setCurrentId(null);
    setPgnDraft('');
    toast(`Imported ${n} moves into “${chapter.name}”.`);
  };

  const exportChapter = async () => {
    const { toPgn } = await import('../lib/gameTree');
    const pgn = toPgn(chapter.tree, { Event: study.title, White: chapter.name });
    const ok = await navigator.clipboard.writeText(pgn).then(() => true).catch(() => false);
    toast(ok ? 'Chapter PGN copied.' : `Couldn't copy, select the text instead.`);
  };

  return (
    <div className="page container">
      <div className="page-head row between wrap" style={{ gap: '1rem' }}>
        <div className="col" style={{ gap: '0.35rem' }}>
          <Link to="/studies" className="small muted" style={{ textDecoration: 'none' }}>
            ← Studies
          </Link>
          <input
            className="study-title-input"
            value={study.title}
            aria-label="Study title"
            onChange={(e) => mutate((s) => void (s.title = e.target.value))}
          />
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            if (!confirm(`Delete study “${study.title}”? This cannot be undone.`)) return;
            setStudies((list) => list.filter((s) => s.id !== study.id));
            navigate('/studies');
            toast('Study deleted.');
          }}
        >
          <TrashIcon /> Delete study
        </button>
      </div>

      <div className="study-layout">
        <aside className="panel panel-pad" aria-label="Chapters">
          <div className="section-label">
            Chapters
            <span className="small muted">{study.chapters.length}</span>
          </div>
          <div className="chapter-list" role="list">
            {study.chapters.map((c, i) => (
              <div key={c.id} className={`chapter-row${c.id === chapter.id ? ' on' : ''}`} role="listitem">
                <button type="button" className="chapter-name" onClick={() => { setChapterId(c.id); setCurrentId(null); }}>
                  {c.name}
                </button>
                <span className="chapter-ops">
                  <button className="icon-btn" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => mutate((s) => {
                    if (i === 0) return;
                    [s.chapters[i - 1], s.chapters[i]] = [s.chapters[i], s.chapters[i - 1]];
                  })}>
                    ↑
                  </button>
                  <button className="icon-btn" aria-label={`Move ${c.name} down`} disabled={i === study.chapters.length - 1} onClick={() => mutate((s) => {
                    if (i === s.chapters.length - 1) return;
                    [s.chapters[i + 1], s.chapters[i]] = [s.chapters[i], s.chapters[i + 1]];
                  })}>
                    ↓
                  </button>
                  <button className="icon-btn" aria-label={`Duplicate ${c.name}`} onClick={() => {
                    mutate((s) => duplicateChapter(s, c.id));
                    toast('Chapter duplicated.');
                  }}>
                    ⧉
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Delete ${c.name}`}
                    disabled={study.chapters.length <= 1}
                    onClick={() => {
                      mutate((s) => void (s.chapters = s.chapters.filter((x) => x.id !== c.id)));
                      if (chapterId === c.id) setChapterId(study.chapters.find((x) => x.id !== c.id)?.id ?? null);
                      toast('Chapter deleted.');
                    }}
                  >
                    <TrashIcon />
                  </button>
                </span>
              </div>
            ))}
          </div>
          <button
            className="btn btn-ghost btn-sm mt-1"
            onClick={() => {
              mutate((s) => void createChapter(s));
              setChapterId(study.chapters[study.chapters.length - 1]?.id ?? null);
            }}
          >
            Add chapter
          </button>
          <div className="field mt-2">
            <label htmlFor={`ren-${chapter.id}`}>Chapter name</label>
            <input
              id={`ren-${chapter.id}`}
              className="input"
              value={chapter.name}
              onChange={(e) => mutate((s) => {
                const c = s.chapters.find((x) => x.id === chapter.id);
                if (c) c.name = e.target.value;
              })}
            />
          </div>
        </aside>

        <div className="grow">
          <TreeWorkspace
            key={chapter.id}
            tree={chapter.tree}
            currentId={currentId}
            boardId={`study-${chapter.id}`}
            onTreeChange={setTree}
            onNavigate={setCurrentId}
            footer={
              <div className="col" style={{ gap: '0.45rem' }}>
                <div className="row" style={{ gap: '0.4rem' }}>
                  <button className="btn btn-ghost btn-sm" onClick={exportChapter} disabled={chapter.tree.moves.length === 0}>
                    Copy chapter PGN
                  </button>
                </div>
                <div className="field">
                  <label htmlFor="study-pgn">Import PGN into this chapter</label>
                  <textarea
                    id="study-pgn"
                    className="input"
                    rows={3}
                    value={pgnDraft}
                    onChange={(e) => setPgnDraft(e.target.value)}
                    placeholder="Replaces the chapter's moves…"
                  />
                  <button className="btn btn-ghost btn-sm" onClick={importChapterPgn} disabled={!pgnDraft.trim()}>
                    Import
                  </button>
                </div>
                <p className="small muted" style={{ margin: 0 }}>
                  Everything autosaves to this browser.
                </p>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
