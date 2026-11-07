import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Chess, type Square } from 'chess.js';
import { ArrowRight, CopyIcon } from '../components/Icons';
import GameBoard from '../components/GameBoard';
import MoveList from '../components/MoveList';
import { ToastProvider, useToast } from '../components/Toast';
import {
  api,
  currentGuestId,
  ensureGuestSession,
  makeInviteLink,
  OnlineError,
  type OnlineGame,
  supabase,
} from '../lib/online/supabase';
import { formatClock, formatTimeControl, projectClocks } from '../lib/online/clock';
import { useClickToMove } from '../hooks/useClickToMove';
import { playSound } from '../lib/sound';
import type { PendingPromotion } from '../hooks/useGame';

/* ============================================================
   Online Play — private, unrated, two-player real-time chess.
   The browser is NEVER authoritative: every move/clock/result decision
   lives in the Edge Functions; this page renders server state, sends
   commands, and reconciles by version. Realtime events are bells that
   trigger a refetch — never trusted data.
   ============================================================ */

const TIME_CONTROLS = [
  { base: 60000, inc: 0, label: '1 | 0 · Bullet' },
  { base: 180000, inc: 0, label: '3 | 0 · Blitz' },
  { base: 180000, inc: 2000, label: '3 | 2 · Blitz' },
  { base: 300000, inc: 0, label: '5 | 0 · Blitz' },
  { base: 600000, inc: 0, label: '10 | 0 · Rapid' },
];

type Phase =
  | { kind: 'create' }
  | { kind: 'waiting'; gameId: string; token: string; color: 'white' | 'black' }
  | { kind: 'joining'; gameId: string; token: string }
  | { kind: 'live'; game: OnlineGame }
  | { kind: 'failed'; code: string; message: string };

/* ------------------------------------------------ live game ---- */

function LiveGame({
  game: initial,
  me,
  onExit,
}: {
  game: OnlineGame;
  me: string;
  onExit: () => void;
}) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [game, setGame] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [conn, setConn] = useState<'connecting' | 'live' | 'offline'>('connecting');
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [busy, setBusy] = useState(false);
  const versionRef = useRef(initial.version);
  const moveIdRef = useRef<string | null>(null);
  versionRef.current = game.version;
  /* install an authoritative response only if it is not older than what
     is already on screen — a late reply must never rewind the board */
  const applyAuthoritative = useCallback((g: OnlineGame) => {
    if (g.version >= versionRef.current) {
      versionRef.current = g.version;
      setGame(g);
    }
  }, []);

  const mySeat: 'w' | 'b' | null = game.white_id === me ? 'w' : game.black_id === me ? 'b' : null;
  const orientation = mySeat === 'b' ? 'black' : 'white';
  const finished = game.status === 'completed';

  const chess = useMemo(() => {
    try {
      const c = new Chess(game.start_fen);
      for (const m of game.moves) c.move(m.san);
      return c;
    } catch {
      return new Chess();
    }
  }, [game.moves, game.start_fen]);

  const fen = game.moves.length ? game.moves[game.moves.length - 1].fenAfter : game.start_fen;
  const lastMove = game.moves.length
    ? { from: game.moves[game.moves.length - 1].from as Square, to: game.moves[game.moves.length - 1].to as Square }
    : null;

  /* completed games persist locally for the lobby history (never touches
     the offline profile or ratings) */
  useEffect(() => {
    // wait for the REAL identity: recording before  resolves would
    // mislabel color/opponent and the id guard would block correcting it
    if (game.status !== 'completed' || game.pgn == null || !me) return;
    try {
      const hist = JSON.parse(localStorage.getItem('gambit.onlineHistory') ?? '[]') as {
        id: string; pgn: string; result: string; reason: string | null; opponent: string; color: 'White' | 'Black'; at: number;
      }[];
      if (hist.some((h) => h.id === game.id)) return;
      hist.unshift({
        id: game.id,
        pgn: game.pgn,
        result: game.result ?? 'draw',
        reason: game.result_reason,
        opponent: game.white_id === me ? game.black_name : game.white_name,
        color: game.white_id === me ? 'White' : 'Black',
        at: Date.now(),
      });
      localStorage.setItem('gambit.onlineHistory', JSON.stringify(hist.slice(0, 20)));
    } catch {
      /* history is best-effort */
    }
  }, [game.status, game.pgn, game.id, me]);

  const checkSquare = useMemo(() => {
    if (!chess.inCheck()) return null;
    const king = chess.board().flat().find((sq) => sq?.type === 'k' && sq.color === chess.turn());
    return (king?.square ?? null) as Square | null;
  }, [chess]);

  /* authoritative fetch — the only accepted source of truth */
  const refetch = useCallback(async () => {
    try {
      const res = await api.getState(game.id);
      setGame((cur) => (res.game.version >= cur.version ? res.game : cur));
    } catch (e) {
      if (e instanceof OnlineError && e.code === 'not-found') setConn('offline');
    }
  }, [game.id]);

  /* Realtime = notification bell; payload is never trusted */
  useEffect(() => {
    const channel = supabase()
      .channel(`game-${game.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'online_games', filter: `id=eq.${game.id}` },
        () => {
          void refetch();
        },
      )
      .subscribe((status: 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT') => {
        setConn(status === 'SUBSCRIBED' ? 'live' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'offline' : 'connecting');
        if (status === 'SUBSCRIBED') void refetch();
      });
    return () => {
      void supabase().removeChannel(channel);
    };
  }, [game.id, refetch]);

  /* refresh when the tab becomes visible again (suspension recovery) */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetch]);

  /* reconcile safety net: Realtime events can be missed (slow startup,
     reconnect windows) — poll the authoritative state every 5s while a
     game is live; the version guard discards no-op fetches */
  useEffect(() => {
    if (finished) return;
    const t = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refetch();
    }, 5000);
    return () => window.clearInterval(t);
  }, [finished, refetch]);

  /* clock projection — 200ms visual tick of SERVER timestamps */
  useEffect(() => {
    if (finished) return;
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(t);
  }, [finished]);
  const clocks = projectClocks(
    {
      turn: game.turn,
      turn_started_at: game.turn_started_at,
      white_ms_remaining: game.white_ms_remaining,
      black_ms_remaining: game.black_ms_remaining,
      status: game.status,
    },
    now,
  );

  /* timeout claiming: when the OPPONENT's projected clock flags, claim.
     A refused claim (race with the opponent's own claim or a lagging
     projection) retries on a bounded backoff — the flag stays visible
     until the server resolves it. */
  const [claimAttempts, setClaimAttempts] = useState(0);
  useEffect(() => {
    if (!finished) setClaimAttempts(0);
  }, [finished, game.id]);
  useEffect(() => {
    if (finished || !mySeat || conn !== 'live') return;
    const flagged = clocks.flagged;
    if (!flagged || flagged === mySeat || claimAttempts >= 3) return;
    const t = window.setTimeout(() => {
      setClaimAttempts((n) => n + 1);
      void (async () => {
        try {
          const res = await api.claimTimeout(game.id);
          applyAuthoritative(res.game);
          toast('Won on time — the opponent\'s clock flagged.');
        } catch {
          void refetch(); // refused — the next attempt decides
        }
      })();
    }, claimAttempts === 0 ? 0 : 2000);
    return () => window.clearTimeout(t);
  }, [clocks.flagged, claimAttempts, finished, mySeat, conn]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- move submission ---- */

  const submitMove = useCallback(
    async (from: Square, to: Square, promotion?: string) => {
      if (!mySeat || busy || finished) return;
      const moveId = crypto.randomUUID();
      moveIdRef.current = moveId;
      setBusy(true);
      try {
        const res = await api.makeMove(game.id, moveId, from, to, promotion);
        applyAuthoritative(res.game); // authoritative regardless of applied/conflict/replay
        if (res.applied) {
          playSound('move');
          if (res.game.status === 'completed') toast(gameEndToast(res.game, mySeat));
        } else if (res.game.status === 'completed') {
          toast(gameEndToast(res.game, mySeat));
        }
      } catch (e) {
        if (e instanceof OnlineError && e.code === 'timeout') {
          toast('Your clock ran out — the opponent wins on time.');
          await refetch();
        } else if (e instanceof OnlineError && e.code === 'illegal') {
          playSound('illegal');
        } else {
          toast(e instanceof Error ? e.message : 'command failed');
          await refetch();
        }
      } finally {
        setBusy(false);
      }
    },
    [busy, finished, game.id, mySeat, refetch, toast],
  );

  const tryMove = useCallback(
    (from: Square, to: Square): 'ok' | 'illegal' | 'promote' => {
      if (!mySeat || finished || game.turn !== mySeat) return 'illegal';
      let probe;
      try {
        probe = new Chess(fen);
      } catch {
        return 'illegal';
      }
      let move;
      try {
        move = probe.move({ from, to, promotion: 'q' });
      } catch {
        return 'illegal';
      }
      if (!move) return 'illegal';
      if (move.promotion) {
        setPendingPromotion({ from, to, color: mySeat });
        return 'promote';
      }
      void submitMove(from, to);
      return 'ok';
    },
    [fen, finished, game.turn, mySeat, submitMove],
  );

  const click = useClickToMove({ fen, movableColor: mySeat && !finished && game.turn === mySeat ? mySeat : null, tryMove });

  const onDrop = useCallback(
    (from: Square, to: Square): boolean => {
      const result = tryMove(from, to);
      return result === 'ok';
    },
    [tryMove],
  );

  /* ---- actions ---- */

  const doResign = async () => {
    setBusy(true);
    try {
      const res = await api.resign(game.id);
      applyAuthoritative(res.game);
      setConfirmResign(false);
      toast('You resigned.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'resign failed');
    } finally {
      setBusy(false);
    }
  };

  const drawAction = async (action: 'offer' | 'accept' | 'decline') => {
    setBusy(true);
    try {
      const res = await api.draw(game.id, action);
      applyAuthoritative(res.game);
      if (action === 'offer') toast('Draw offered.');
      if (action === 'decline') toast('Draw declined.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'draw command failed');
    } finally {
      setBusy(false);
    }
  };

  const opponentName = mySeat === 'w' ? game.black_name : game.white_name;
  const myName = mySeat === 'w' ? game.white_name : game.black_name;
  const opponentSeat = mySeat === 'w' ? 'b' : 'w';
  const myClock = mySeat === 'w' ? clocks.white : clocks.black;
  const opponentClock = mySeat === 'w' ? clocks.black : clocks.white;
  const myTurn = mySeat === game.turn && !finished;
  const drawPending = game.draw_offer_by && game.draw_offer_by !== me;

  const downloadPgn = () => {
    if (!game.pgn) return;
    const blob = new Blob([game.pgn], { type: 'application/x-chess-pgn' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `gambit-online-${game.id.slice(0, 8)}.pgn`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="online-live">
      <div className="row between online-status">
        <span className={`conn-pill conn-${conn}`} role="status">
          {conn === 'live' ? '● connected' : conn === 'offline' ? '○ offline — reconnecting…' : '○ connecting…'}
        </span>
        <span className="small muted">{formatTimeControl(game.base_ms, game.increment_ms)} · unrated · private</span>
      </div>

      {drawPending && !finished && (
        <div className="status-banner" role="status">
          {opponentName} offers a draw.
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => drawAction('accept')}>
            Accept
          </button>
          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => drawAction('decline')}>
            Decline
          </button>
        </div>
      )}

      <div className="game-layout">
        <div>
          <div className="row between online-player-row">
            <span className="small">
              ● {opponentName} <span className="muted">({opponentSeat === 'w' ? 'White' : 'Black'})</span>
            </span>
            <span className={`clock mono ${game.turn === (mySeat === 'w' ? 'b' : 'w') && !finished ? 'running' : ''} ${opponentClock < 20000 && !finished ? 'low' : ''}`}>
              {formatClock(opponentClock)}
            </span>
          </div>
          <GameBoard
            boardId="online"
            fen={fen}
            orientation={orientation}
            movableColor={mySeat && !finished && game.turn === mySeat ? mySeat : null}
            lastMove={lastMove}
            checkSquare={checkSquare}
            selected={click.selected}
            legalTargets={click.legalTargets}
            onSquareClick={click.onSquareClick}
            onDrop={onDrop}
            pendingPromotion={pendingPromotion}
            onChoosePromotion={(piece) => {
              if (pendingPromotion) {
                void submitMove(pendingPromotion.from, pendingPromotion.to, piece);
                setPendingPromotion(null);
              }
            }}
            onCancelPromotion={() => setPendingPromotion(null)}
            onClearSelection={click.clear}
            turnAnnouncement={`${game.turn === 'w' ? 'White' : 'Black'} to move`}
          />
          <div className="row between online-player-row">
            <span className="small">
              ○ {myName} <span className="muted">({mySeat === 'w' ? 'White' : 'Black'})</span>
            </span>
            <span className={`clock mono ${myTurn ? 'running' : ''} ${myClock < 20000 && !finished ? 'low' : ''}`}>
              {formatClock(myClock)}
            </span>
          </div>
          <div className="board-under">
            <span className="board-hint mono">{finished ? 'Game over' : myTurn ? 'Your move' : `${opponentName} is thinking…`}</span>
            {!finished && mySeat && (
              <span className="row" style={{ gap: '0.4rem' }}>
                {game.draw_offer_by === me ? (
                  <span className="small muted">draw offer pending…</span>
                ) : (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => drawAction('offer')}>
                    Offer draw
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setConfirmResign(true)}>
                  Resign
                </button>
              </span>
            )}
          </div>
        </div>

        <aside className="panel panel-pad online-side">
          <div className="section-label">Moves</div>
          <MoveList
            plies={chess.history({ verbose: true }).map((m) => ({
              san: m.san,
              from: m.from,
              to: m.to,
              color: m.color,
              fenAfter: m.after,
              isCapture: Boolean(m.captured),
              isCheck: m.san.endsWith('+') || m.san.endsWith('#'),
            }))}
            currentPly={null}
          />
          {confirmResign && !finished && (
            <div className="status-banner check" role="alert">
              Resign this game?
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={doResign}>
                Resign
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirmResign(false)}>
                Keep playing
              </button>
            </div>
          )}
          <div className="small muted online-note">
            Guest session — clearing site data loses your seat. Games are private and unrated.
          </div>
        </aside>
      </div>

      {finished && (
        <div className="online-result-overlay" role="dialog" aria-label="Game over">
          <div className="panel panel-pad online-result-card">
            <p className="closing-eyebrow">Game over</p>
            <h2 className="online-result-title">{resultText(game, me)}</h2>
            <p className="small muted">{reasonText(game.result_reason)} · {game.moves.length} plies</p>
            <div className="row mt-2" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn btn-gold" onClick={() => navigate('/analysis', { state: { pgn: game.pgn ?? undefined } })}>
                Analyze in Review
                <ArrowRight />
              </button>
              <button className="btn btn-ghost" onClick={downloadPgn} disabled={!game.pgn}>
                Download PGN
              </button>
              <button className="btn btn-ghost" onClick={onExit}>
                Back to lobby
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------ lobby/join ---- */

function CreateForm({ onCreate }: { onCreate: (name: string, base: number, inc: number, color: 'white' | 'black' | 'random') => Promise<void> }) {
  const [name, setName] = useState(() => localStorage.getItem('gambit.onlineName') ?? '');
  const [tc, setTc] = useState(2); // index into TIME_CONTROLS
  const [color, setColor] = useState<'white' | 'black' | 'random'>('random');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="panel panel-pad cfg-stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        localStorage.setItem('gambit.onlineName', name.trim());
        void onCreate(name.trim() || 'Player', TIME_CONTROLS[tc].base, TIME_CONTROLS[tc].inc, color).finally(() => setBusy(false));
      }}
    >
      <label className="small muted" htmlFor="online-name">
        Display name (cosmetic — never used to authorize)
        <input
          id="online-name"
          className="input"
          value={name}
          maxLength={24}
          placeholder="Player"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <fieldset>
        <legend className="small muted">Time control</legend>
        <div className="mode-switch" role="radiogroup" aria-label="Time control">
          {TIME_CONTROLS.map((t, i) => (
            <button
              key={t.label}
              type="button"
              className={`mode-row ${tc === i ? 'on' : ''}`}
              role="radio"
              aria-checked={tc === i}
              onClick={() => setTc(i)}
            >
              <span className="nm mono">{t.label}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="small muted">Play as</legend>
        <div className="mode-switch" role="radiogroup" aria-label="Color choice">
          {(['white', 'random', 'black'] as const).map((c) => (
            <button
              key={c}
              type="button"
              className={`mode-row ${color === c ? 'on' : ''}`}
              role="radio"
              aria-checked={color === c}
              onClick={() => setColor(c)}
            >
              <span className="nm">{c === 'white' ? '○ White' : c === 'black' ? '● Black' : '◐ Random'}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <button className="btn btn-accent btn-lg" type="submit" disabled={busy}>
        {busy ? 'Creating…' : 'Create private game'}
      </button>
      <p className="small muted" style={{ margin: 0 }}>
        A private, unrated invitation link is created. Guest identity lives in this browser — clearing site data loses the seat.
      </p>
    </form>
  );
}

function Waiting({ gameId, token, color, onCancel, onSeated }: { gameId: string; token: string; color: 'white' | 'black'; onCancel: () => void; onSeated: (game: OnlineGame) => void }) {
  const [copied, setCopied] = useState(false);
  const link = makeInviteLink(gameId, token);
  /* poll authoritative state — the join flips waiting->active */
  useEffect(() => {
    const t = window.setInterval(async () => {
      try {
        const res = await api.getState(gameId);
        if (res.game.status === 'active') onSeated(res.game);
      } catch {
        /* transient — keep polling */
      }
    }, 2000);
    return () => window.clearInterval(t);
  }, [gameId, onSeated]);
  return (
    <div className="panel panel-pad online-waiting">
      <p className="closing-eyebrow">Waiting for opponent</p>
      <h2 className="online-result-title">Share your invitation</h2>
      <p className="small muted">
        You play {color === 'white' ? '○ White' : '● Black'}. Anyone with this link joins as your opponent — the token is
        unguessable and only its hash is stored.
      </p>
      <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
        <input className="input grow mono" readOnly value={link} aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
        <button
          className="btn btn-gold"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
            } catch {
              (document.querySelector('input[aria-label="Invitation link"]') as HTMLInputElement)?.select();
              document.execCommand('copy');
            }
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }}
        >
          <CopyIcon /> {copied ? 'Copied' : 'Copy link'}
        </button>
      </div>
      <div className="online-pulse" aria-hidden="true" />
      <button className="btn btn-ghost btn-sm" onClick={onCancel}>
        Cancel room
      </button>
    </div>
  );
}

function JoinGate({ gameId, token }: { gameId: string; token: string }) {
  const navigate = useNavigate();
  const [name, setName] = useState(() => localStorage.getItem('gambit.onlineName') ?? '');
  const [busy, setBusy] = useState(false);

  return (
    <div className="panel panel-pad online-waiting">
      <p className="closing-eyebrow">Invitation</p>
      <h2 className="online-result-title">Join this private game</h2>
      {(
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            localStorage.setItem('gambit.onlineName', name.trim());
            navigate(`/online/live?game=${encodeURIComponent(gameId)}`, { state: { joinedToken: token, gameId } });
            setBusy(false);
          }}
          className="cfg-stack"
        >
          <label className="small muted" htmlFor="join-name">
            Display name (cosmetic)
            <input id="join-name" className="input" value={name} maxLength={24} placeholder="Player" onChange={(e) => setName(e.target.value)} />
          </label>
          <button className="btn btn-accent btn-lg" type="submit" disabled={busy}>
            {busy ? 'Joining…' : 'Accept invitation'}
          </button>
          <p className="small muted" style={{ margin: 0 }}>
            A guest identity is created in this browser. Clearing site data loses access to the seat.
          </p>
        </form>
      )}
    </div>
  );
}

/* ------------------------------------------------ page shell ---- */

function OnlineInner() {
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: 'create' });
  const [guestError, setGuestError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [guestReady, setGuestReady] = useState(false);
  const bootedRef = useRef(false);

  /* join deep link: /online/join?game=…&token=… (HashRouter puts the
     query in location.search — location.hash is empty inside the router) */
  useEffect(() => {
    if (location.pathname.endsWith('/online/join')) {
      const q = new URLSearchParams(location.search);
      const game = q.get('game');
      const token = q.get('token');
      if (game && token) setPhase({ kind: 'joining', gameId: game, token });
    }
  }, [location.pathname, location.search]);

  /* guest session bootstraps once */
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    ensureGuestSession()
      .then(async () => {
        setMe(await currentGuestId());
        setGuestReady(true);
      })
      .catch((e: Error) => setGuestError(e.message));
  }, []);

  const create = async (name: string, base: number, inc: number, color: 'white' | 'black' | 'random') => {
    try {
      await ensureGuestSession();
      const res = await api.createGame(name, base, inc, color);
      localStorage.setItem('gambit.onlineGame', JSON.stringify({ id: res.gameId, token: res.token, color: res.color }));
      setPhase({ kind: 'waiting', gameId: res.gameId, token: res.token, color: res.color });
    } catch (e) {
      toast(e instanceof OnlineError ? e.message : `could not reach the local backend — run \`npx supabase start\` (${e instanceof Error ? e.message.slice(0, 80) : 'error'})`);
    }
  };

  const cancelWaiting = async () => {
    const p = phase;
    if (p.kind !== 'waiting') return;
    try {
      await api.resign(p.gameId); // creator abandoning a waiting room
    } catch {
      /* the room may already be seated — ignore */
    }
    localStorage.removeItem('gambit.onlineGame');
    setPhase({ kind: 'create' });
  };

  /* resume an open waiting room / live game from a previous visit */
  useEffect(() => {
    // the session must exist before any command — the bootstrap resolves
    // slightly after mount on a reload
    if (phase.kind !== 'create' || !guestReady) return;
    const saved = localStorage.getItem('gambit.onlineGame');
    if (!saved || location.pathname.endsWith('/online/join')) return;
    void (async () => {
      try {
        const parsedSaved = JSON.parse(saved) as { id: string; token: string; color?: 'white' | 'black' };
        const res = await api.getState(parsedSaved.id);
        // a room created while this fetch was in flight wins — the late
        // completed-game response must not replace it
        if (phase.kind !== 'create') return;
        const current = localStorage.getItem('gambit.onlineGame');
        if (current !== saved) return;
        if (res.game.status === 'waiting') {
          // the seat was chosen at creation — never derived from which id is filled
          setPhase({ kind: 'waiting', gameId: parsedSaved.id, token: parsedSaved.token, color: parsedSaved.color ?? 'white' });
        } else if (res.game.status === 'active' || res.game.status === 'completed') {
          const me = await currentGuestId();
          if (me && (res.game.white_id === me || res.game.black_id === me)) setPhase({ kind: 'live', game: res.game });
        }
      } catch {
        /* stale — ignore */
      }
    })();
  }, [phase.kind, guestReady, location.pathname, location.search]);

  /* the join flow: JoinGate navigates to /online/live — mount the game there */
  const liveFromJoin = location.pathname.endsWith('/online/live')
    ? ((location.state as { joinedToken?: string; gameId?: string } | null) ?? null)
    : null;

  useEffect(() => {
    if (liveFromJoin?.joinedToken && liveFromJoin.gameId) {
      void (async () => {
        try {
          await ensureGuestSession();
          const res = await api.joinGame(liveFromJoin.joinedToken!, localStorage.getItem('gambit.onlineName')?.trim() || 'Player');
          localStorage.setItem('gambit.onlineGame', JSON.stringify({ id: res.game.id, token: liveFromJoin.joinedToken }));
          setPhase({ kind: 'live', game: res.game });
        } catch (e) {
          if (e instanceof OnlineError) setPhase({ kind: 'failed', code: e.code, message: e.message });
          else setPhase({ kind: 'failed', code: 'backend', message: 'could not reach the local backend — run `npx supabase start`' });
        }
      })();
    }
  }, [liveFromJoin?.joinedToken, liveFromJoin?.gameId]); // eslint-disable-line react-hooks/exhaustive-deps

  const exitToLobby = () => {
    localStorage.removeItem('gambit.onlineGame');
    setPhase({ kind: 'create' });
    navigate('/online');
  };

  return (
    <div className="page container online-page" data-phase={phase.kind} data-guestready={String(guestReady)}>
      <div className="page-head">
        <h1>Online Play</h1>
        <p className="sub">
          Real chess against a real person — private, unrated, by invitation. Everything is validated on the server.
        </p>
        <nav className="page-tabs mt-2" aria-label="Play areas">
          <Link to="/play" className="">
            Local & engine
          </Link>
          <Link to="/online" className="on">
            Online
          </Link>
        </nav>
      </div>

      {guestError && (
        <div className="status-banner check" role="alert">
          Guest sign-in failed: {guestError}. The local backend must run with anonymous auth enabled ({'`npx supabase start`'}).
        </div>
      )}

      {phase.kind === 'create' && <CreateForm onCreate={create} />}
      {phase.kind === 'create' && <OnlineHistory />}
      {phase.kind === 'waiting' && (
        <Waiting
          gameId={phase.gameId}
          token={phase.token}
          color={phase.color}
          onCancel={cancelWaiting}
          onSeated={(g) => setPhase({ kind: 'live', game: g })}
        />
      )}
      {phase.kind === 'joining' && <JoinGate gameId={phase.gameId} token={phase.token} />}
      {phase.kind === 'failed' && (
        <div className="panel panel-pad online-waiting">
          <div className="status-banner check" role="alert">
            {phase.message} <span className="muted">({phase.code})</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setPhase({ kind: 'create' })}>
            Back to Online Play
          </button>
        </div>
      )}
      {phase.kind === 'live' && (
        <LiveGame key={phase.game.id} game={phase.game} me={me ?? ''} onExit={exitToLobby} />
      )}
    </div>
  );
}

/* ------------------------------------------------ helpers ---- */

/** finished online games kept locally (cap 20) — replayed via Analysis */
function OnlineHistory() {
  const navigate = useNavigate();
  const [hist] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('gambit.onlineHistory') ?? '[]') as {
        id: string; pgn: string; result: string; reason: string | null; opponent: string; color: 'White' | 'Black'; at: number;
      }[];
    } catch {
      return [];
    }
  });
  if (!hist.length) return null;
  return (
    <div className="panel panel-pad online-waiting">
      <div className="section-label">
        Finished games
        <span className="small muted">{hist.length} · stored on this device</span>
      </div>
      {hist.map((h) => (
        <div key={h.id} className="row between" style={{ gap: '0.6rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
          <span className="small">
            {h.result === 'draw' ? '½–½' : h.result === 'white' ? '1–0' : '0–1'} · as {h.color} vs {h.opponent}
            <span className="muted"> ({reasonText(h.reason)})</span>
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/analysis', { state: { pgn: h.pgn } })}>
            Replay in Analysis
            <ArrowRight />
          </button>
        </div>
      ))}
    </div>
  );
}

function gameEndToast(g: OnlineGame, me: string): string {
  if (g.result === 'draw') return 'Game drawn.';
  if (!g.result) return 'Game over.';
  const winner = g.result === 'white' ? g.white_id : g.black_id;
  return winner === me ? 'You won!' : 'You lost.';
}

function resultText(g: OnlineGame, me: string): string {
  if (g.result === 'draw') return 'Draw';
  if (!g.result) return 'Game over';
  const winner = g.result === 'white' ? g.white_id : g.black_id;
  return winner === me ? 'You won' : 'You lost';
}

function reasonText(reason: string | null): string {
  switch (reason) {
    case 'checkmate': return 'by checkmate';
    case 'stalemate': return 'by stalemate';
    case 'insufficient': return 'by insufficient material';
    case 'threefold': return 'by repetition';
    case 'fifty-move': return 'by the fifty-move rule';
    case 'timeout': return 'on time';
    case 'resignation': return 'by resignation';
    case 'draw-agreed': return 'by agreement';
    default: return '';
  }
}

export default function Online() {
  return (
    <ToastProvider>
      <OnlineInner />
    </ToastProvider>
  );
}
