import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Square } from 'chess.js';
import GameBoard from '../components/GameBoard';
import MoveList from '../components/MoveList';
import PlayerBar from '../components/PlayerBar';
import { useSettings } from '../state/SettingsContext';
import { useProfile } from '../state/ProfileContext';
import { useToast } from '../components/Toast';
import { useEngine } from '../lib/engine/useEngine';
import { useGame } from '../hooks/useGame';
import { useClickToMove } from '../hooks/useClickToMove';
import type { GameOverInfo } from '../hooks/useGame';
import { LEVEL_RATINGS } from '../lib/engine/engine';
import type { Level } from '../lib/engine/engine';
import { DEFAULT_TIME_CONTROL, TIME_CONTROLS, timeControlById } from '../data/timeControls';
import type { Color, GameConfig, GameRecord } from '../lib/types';
import { loadJSON, saveJSON, removeKey } from '../lib/storage';
import { playSound } from '../lib/sound';
import type { SavedGame } from '../hooks/useGame';
import { identifyOpening } from '../lib/openings';
import { FlagIcon, FlipIcon, LightbulbIcon, PlayIcon, PlusIcon, RobotIcon, UndoIcon, UsersIcon, XIcon } from '../components/Icons';

/** Storage key for a game in progress, so a reload never loses a played game. */
const ACTIVE_GAME_KEY = 'activeGame';

/* ------------------------------------------------------------------ */
/* Setup screen                                                        */
/* ------------------------------------------------------------------ */

function SetupScreen({ onStart, last }: { onStart: (c: GameConfig) => void; last: GameConfig }) {
  const [mode, setMode] = useState<'ai' | 'pass'>(last.mode);
  const [tcId, setTcId] = useState(last.timeControl.id);
  const [color, setColor] = useState<'w' | 'b' | 'random'>(last.playerColor);
  const [level, setLevel] = useState<Level>(last.aiLevel);

  const timeControl = timeControlById(tcId);

  return (
    <div className="page container">
      <div className="page-head">
        <h1>Set the board</h1>
        <p className="sub">Choose an opponent and a rhythm. You can change everything between games, never during one.</p>
      </div>

      <form
        className="launch-grid"
        onSubmit={(e) => {
          e.preventDefault();
          onStart({ mode, timeControl, playerColor: mode === 'pass' ? 'w' : color, aiLevel: level });
        }}
      >
        <div className="col" style={{ gap: '0.9rem' }}>
          <div className="section-label">Opponent</div>
          <div className="col" style={{ gap: '0.7rem' }}>
            <button type="button" className={`mode-card${mode === 'ai' ? ' on' : ''}`} onClick={() => setMode('ai')} aria-pressed={mode === 'ai'}>
              <span className="t">
                <RobotIcon /> Play the engine
              </span>
              <span className="d">Stockfish, rated. Four strengths from gentle to sharp.</span>
            </button>
            <button type="button" className={`mode-card${mode === 'pass' ? ' on' : ''}`} onClick={() => setMode('pass')} aria-pressed={mode === 'pass'}>
              <span className="t">
                <UsersIcon /> Pass &amp; play
              </span>
              <span className="d">Two humans, one device. The board flips to whoever is thinking.</span>
            </button>
          </div>
        </div>

        <div className="col" style={{ gap: '0.9rem' }}>
          <div className="panel panel-pad">
            <div className="section-label">Time control</div>
            {(['Bullet', 'Blitz', 'Rapid', 'Classical'] as const).map((cat) => {
              const group = TIME_CONTROLS.filter((t) => t.category === cat);
              if (group.length === 0) return null;
              return (
                <div className="tempo-group" key={cat}>
                  <div className="tempo-name">{cat}</div>
                  <div className="time-grid">
                    {group.map((t) => (
                      <button
                        type="button"
                        key={t.id}
                        className={`time-opt${tcId === t.id ? ' on' : ''}`}
                        onClick={() => setTcId(t.id)}
                        aria-pressed={tcId === t.id}
                      >
                        <span className="big">{t.label}</span>
                        <span className="tag">{t.increment > 0 ? `+${t.increment}s` : 'no inc'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="tempo-group">
              <div className="tempo-name">Untimed</div>
              <div className="time-grid">
                <button
                  type="button"
                  className={`time-opt${tcId === 'unlimited' ? ' on' : ''}`}
                  onClick={() => setTcId('unlimited')}
                  aria-pressed={tcId === 'unlimited'}
                >
                  <span className="big">No clock</span>
                  <span className="tag">think freely</span>
                </button>
              </div>
            </div>
          </div>
          <button type="submit" className="btn btn-accent btn-lg" style={{ width: '100%' }}>
            Start game
          </button>
        </div>

        <div className="col launch-side" style={{ gap: '0.9rem' }}>
          {mode === 'ai' ? (
            <div className="panel panel-pad">
              <div className="section-label">Your side</div>
              <div className="seg" role="radiogroup" aria-label="Your color">
                {([['w', 'White'], ['random', 'Random'], ['b', 'Black']] as const).map(([v, label]) => (
                  <button type="button" key={v} role="radio" aria-checked={color === v} className={color === v ? 'on' : ''} onClick={() => setColor(v)}>
                    {label}
                  </button>
                ))}
              </div>

              <div className="section-label" style={{ marginTop: '1.1rem' }}>
                Engine strength
              </div>
              <div className="col" style={{ gap: '0.45rem' }}>
                {([1, 2, 3, 4] as Level[]).map((l) => (
                  <button
                    type="button"
                    key={l}
                    className={`mode-card${level === l ? ' on' : ''}`}
                    style={{ padding: '0.65rem 0.9rem', flexDirection: 'row', alignItems: 'center', gap: '0.7rem' }}
                    onClick={() => setLevel(l)}
                    aria-pressed={level === l}
                  >
                    <span className="row" style={{ gap: 3, flex: 'none' }} aria-hidden>
                      {[1, 2, 3, 4].map((d) => (
                        <span key={d} className={`level-dot${level >= d ? ' on' : ''}`} />
                      ))}
                    </span>
                    <span className="t">{['Gentle', 'Casual', 'Club', 'Sharp'][l - 1]}</span>
                    <span className="d mono" style={{ marginLeft: 'auto' }}>
                      ~{LEVEL_RATINGS[l]}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="panel panel-pad">
              <div className="section-label">Pass &amp; play</div>
              <p className="small muted" style={{ margin: 0 }}>
                White moves first. The board turns to face whoever is thinking, so pass the device after every move.
              </p>
            </div>
          )}
          <div className="panel panel-pad quiet">
            <div className="section-label">Game summary</div>
            <p className="small" style={{ margin: 0, lineHeight: 1.7 }}>
              <strong>{mode === 'ai' ? 'You' : 'White'}</strong> vs{' '}
              <strong>{mode === 'ai' ? `Stockfish · ${['Gentle', 'Casual', 'Club', 'Sharp'][level - 1]}` : 'Black'}</strong>
              <br />
              <span className="muted">
                {timeControl.minutes > 0 ? `${timeControl.minutes} min${timeControl.increment ? ` + ${timeControl.increment}s` : ''}` : 'No clock'}
                {' · '}{color === 'random' ? 'random side' : color === 'w' ? 'you play White' : 'you play Black'}
              </span>
            </p>
          </div>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  danger,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Cancel">
            <XIcon />
          </button>
        </div>
        <div className="modal-body">
          <p className="muted">{body}</p>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onCancel} ref={cancelRef}>
            Keep playing
          </button>
          <button className={danger ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Game screen                                                         */
/* ------------------------------------------------------------------ */

function verdictText(over: GameOverInfo | null, playerColor: Color, mode: 'ai' | 'pass'): { verdict: string; why: string } {
  if (!over) return { verdict: '', why: '' };
  const winnerIsYou = over.winnerColor === playerColor;
  const draw = over.winnerColor === null;
  if (mode === 'pass') {
    if (draw) return { verdict: 'Draw', why: over.reason };
    return { verdict: `${over.winnerColor === 'w' ? 'White' : 'Black'} wins`, why: over.reason };
  }
  if (draw) return { verdict: 'Draw', why: over.reason };
  return { verdict: winnerIsYou ? 'You win' : 'You lose', why: over.reason };
}

function GameScreen({
  config,
  resume,
  onExit,
  onRematch,
}: {
  config: GameConfig;
  resume?: SavedGame | null;
  onExit: () => void;
  onRematch: (swapColor: boolean) => void;
}) {
  const settings = useSettings();
  const { profile, recordGame } = useProfile();
  const { toast } = useToast();
  const navigate = useNavigate();
  const engine = useEngine();

  const savedRef = useRef(false);
  const handleOverRef = useRef<(info: GameOverInfo) => void>(() => {});

  const game = useGame({
    config,
    engineSearch: engine.search,
    onGameOver: (info) => handleOverRef.current(info),
    resume,
  });
  const {
    fen,
    plies,
    lastMove,
    turn,
    over,
    thinking,
    pendingPromotion,
    captured,
    checkInfo,
    playerColor,
    clock,
    unlimited,
    tryMove,
    choosePromotion,
    cancelPromotion,
    undo,
    canUndo,
    resign,
    offerDraw,
    getMoves,
  } = game;

  const [recordId, setRecordId] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<'white' | 'black'>(playerColor === 'b' ? 'black' : 'white');
  const [zen, setZen] = useState(false);
  const boardFrameRef = useRef<HTMLDivElement>(null);
  const [hintArrow, setHintArrow] = useState<{ startSquare: string; endSquare: string; color: string }[]>([]);
  const [confirm, setConfirm] = useState<null | 'resign' | 'draw' | 'exit'>(null);

  // Build the saved record when the game ends. Reads the live gameRef (complete
  // move list incl. the final move) via game.pgn()/moves, not stale state.
  handleOverRef.current = (info: GameOverInfo) => {
    if (savedRef.current) return;
    savedRef.current = true;
    const score = info.winnerColor === null ? 0.5 : info.winnerColor === playerColor ? 1 : 0;
    const result: 'win' | 'loss' | 'draw' = score === 1 ? 'win' : score === 0.5 ? 'draw' : 'loss';
    const opponentRating = config.mode === 'ai' ? LEVEL_RATINGS[config.aiLevel] : 1200;
    let delta = 0;
    if (config.mode === 'ai') {
      const expected = 1 / (1 + 10 ** ((opponentRating - profile.rating) / 400));
      delta = Math.round(24 * (score - expected));
    }
    const record: GameRecord = {
      id: `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      date: Date.now(),
      mode: config.mode,
      timeControl: config.timeControl,
      playerColor,
      opponentName: config.mode === 'ai' ? `Engine · ${['Gentle', 'Casual', 'Club', 'Sharp'][config.aiLevel - 1]}` : 'Pass & play',
      opponentRating,
      result,
      reason: info.reason,
      // authoritative: gameRef already contains the final move when the
      // game-over callback fires (state may lag one move behind)
      moves: getMoves(),
      pgn: game.pgn(),
      ratingBefore: profile.rating,
      ratingAfter: profile.rating + delta,
    };
    recordGame(record);
    setRecordId(record.id);
  };

  useEffect(() => {
    setOrientation(playerColor === 'b' ? 'black' : 'white');
  }, [playerColor]);

  // Pass & play: the board always faces whoever is thinking (as the copy promises).
  useEffect(() => {
    if (config.mode === 'pass') setOrientation(turn === 'w' ? 'white' : 'black');
  }, [config.mode, turn]);

  // Keep the active game recoverable: persisted after every move, cleared when it ends.
  useEffect(() => {
    if (over) {
      removeKey(ACTIVE_GAME_KEY);
      return;
    }
    if (plies.length === 0) {
      removeKey(ACTIVE_GAME_KEY);
      return;
    }
    saveJSON(ACTIVE_GAME_KEY, {
      config,
      playerColor,
      pgn: game.pgn(),
      clocks: unlimited ? null : { w: Math.round(clock.clocks.w), b: Math.round(clock.clocks.b) },
      savedAt: Date.now(),
    } satisfies SavedGame & { savedAt: number });
    // clock.clocks intentionally excluded from deps: persisting on move boundaries
    // is enough for an honest resume, and per-frame writes would churn storage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plies, over]);

  // Warn before losing a live game to a reload/tab close.
  useEffect(() => {
    if (over || plies.length < 2) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [over, plies.length]);

  const humanTurn =
    over === null &&
    !thinking &&
    (config.mode === 'pass' || turn === playerColor) &&
    !pendingPromotion;
  const movableColor: 'w' | 'b' | null = humanTurn ? turn : null;

  const click = useClickToMove({
    fen,
    movableColor,
    tryMove,
    onMoveCommitted: () => setHintArrow([]),
  });

  const opening = useMemo(() => identifyOpening(getMoves()), [getMoves, fen, plies.length]);

  const handleDrop = useCallback(
    (from: Square, to: Square) => {
      if (!humanTurn) return false;
      setHintArrow([]);
      const result = tryMove(from, to);
      if (result === 'promote') return true; // keep piece near target while dialog is open
      if (result === 'illegal') {
        playSound('illegal');
        return false;
      }
      click.clear();
      return true;
    },
    [humanTurn, tryMove, click],
  );

  // single "time is short" chime per side
  const lowRef = useRef({ w: false, b: false });
  useEffect(() => {
    if (unlimited) return;
    for (const side of ['w', 'b'] as Color[]) {
      if (!lowRef.current[side] && clock.clocks[side] < 10_000 && clock.clocks[side] > 0 && clock.runningSide === side) {
        lowRef.current[side] = true;
        playSound('low');
      }
    }
  }, [clock.clocks, clock.runningSide, unlimited]);

  const requestHint = useCallback(async () => {
    if (over || !humanTurn) return;
    const result = await engine.search(fen, 3, []);
    if (result) {
      setHintArrow([{ startSquare: result.from, endSquare: result.to, color: settings.resolvedTheme === 'dark' ? 'rgba(211, 165, 92, 0.8)' : 'rgba(138, 98, 36, 0.75)' }]);
      toast(`Engine suggests ${result.san}`);
    }
  }, [engine, fen, over, humanTurn, toast, settings.resolvedTheme]);

  const toggleFullscreen = useCallback(() => {
    const el = boardFrameRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen().catch(() => {});
  }, []);

  // keyboard shortcuts: f flip · z zen · h hint
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'f' || e.key === 'F') setOrientation((o) => (o === 'white' ? 'black' : 'white'));
      if (e.key === 'z' || e.key === 'Z') setZen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const doResign = useCallback(() => {
    setConfirm(null);
    resign(config.mode === 'ai' ? playerColor : turn);
  }, [config.mode, playerColor, resign, turn]);

  const doOfferDraw = useCallback(async () => {
    setConfirm(null);
    const accepted = await offerDraw((fen) => engine.evaluate(fen).then((r) => r?.cp ?? null));
    if (accepted === false) toast('The engine declines, it likes its position.');
  }, [offerDraw, engine, toast]);

  const { verdict, why } = verdictText(over, playerColor, config.mode);

  // pull the just-saved record for the result card's rating delta
  const savedRecord = recordId ? profile.games.find((g) => g.id === recordId) : null;
  const ratingBefore = savedRecord?.ratingBefore ?? profile.rating;
  const ratingDelta = savedRecord ? savedRecord.ratingAfter - savedRecord.ratingBefore : 0;

  // bring the verdict into view when the game ends (it sits below the fold on phones)
  const resultCardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (over) resultCardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [over]);

  // names & bars: top = opponent-of-orientation, bottom = orientation's side
  const topColor: Color = orientation === 'white' ? 'b' : 'w';
  const bottomColor: Color = orientation === 'white' ? 'w' : 'b';
  const youName = settings.name || 'You';
  const nameFor = (c: Color) => {
    if (config.mode === 'pass') return c === 'w' ? 'White' : 'Black';
    return c === playerColor ? youName : `Engine · ${['Gentle', 'Casual', 'Club', 'Sharp'][config.aiLevel - 1]}`;
  };
  const ratingFor = (c: Color) => {
    if (config.mode === 'pass') return null;
    return c === playerColor ? profile.rating : LEVEL_RATINGS[config.aiLevel];
  };

  const topCaptured = topColor === 'w' ? captured.byWhite : captured.byBlack;
  const bottomCaptured = bottomColor === 'w' ? captured.byWhite : captured.byBlack;
  const topDiff = topColor === 'w' ? captured.diff : -captured.diff;
  const bottomDiff = bottomColor === 'w' ? captured.diff : -captured.diff;

  const statusText = over
    ? `${verdict} · ${why}`
    : pendingPromotion
      ? 'Choose a piece'
      : thinking
        ? 'Engine is thinking…'
        : checkInfo
          ? `Check: ${turn === 'w' ? 'White' : 'Black'} must respond`
          : config.mode === 'pass'
            ? `${turn === 'w' ? 'White' : 'Black'} to move`
            : turn === playerColor
              ? 'Your move'
              : 'Engine to move';

  return (
    <div className={`page container${zen ? ' zen-on' : ''}`}>
      <div className="game-layout">
        <div>
          <PlayerBar
            name={nameFor(topColor)}
            rating={ratingFor(topColor)}
            avatar={nameFor(topColor)[0]}
            captured={topCaptured}
            capturedColor={topColor === 'w' ? 'b' : 'w'}
            materialDiff={Math.max(0, topDiff)}
            clockMs={unlimited ? undefined : clock.clocks[topColor]}
            clockActive={clock.runningSide === topColor}
            clockRunning={clock.runningSide === topColor}
            flagged={clock.flagged === topColor}
            isTurn={turn === topColor && !over}
            thinking={thinking && config.mode === 'ai' && topColor !== playerColor}
            clockHidden={unlimited}
          />

          {opening && !zen && (
            <div className="opening-tag mono" style={{ marginBottom: '0.4rem' }} title={`ECO ${opening.eco}`}>
              {opening.eco} · {opening.name}
            </div>
          )}

          <div ref={boardFrameRef} style={{ marginTop: '0.2rem', marginBottom: '0.4rem' }}>
            <GameBoard
              boardId={`game-${config.timeControl.id.replace(/[^a-zA-Z0-9-]/g, '')}`}
              fen={fen}
              orientation={orientation}
              lastMove={lastMove}
              checkSquare={checkInfo?.square ?? null}
              selected={click.selected}
              legalTargets={click.legalTargets}
              movableColor={movableColor}
              onSquareClick={click.onSquareClick}
              onClearSelection={click.clear}
              turnAnnouncement={statusText}
              onDrop={handleDrop}
              pendingPromotion={pendingPromotion}
              onChoosePromotion={choosePromotion}
              onCancelPromotion={cancelPromotion}
              arrows={hintArrow}
            />
          </div>

          <PlayerBar
            name={nameFor(bottomColor)}
            rating={ratingFor(bottomColor)}
            avatar={nameFor(bottomColor)[0]}
            captured={bottomCaptured}
            capturedColor={bottomColor === 'w' ? 'b' : 'w'}
            materialDiff={Math.max(0, bottomDiff)}
            clockMs={unlimited ? undefined : clock.clocks[bottomColor]}
            clockActive={clock.runningSide === bottomColor}
            clockRunning={clock.runningSide === bottomColor}
            flagged={clock.flagged === bottomColor}
            isTurn={turn === bottomColor && !over}
            clockHidden={unlimited}
          />

          <div className="board-under" style={{ marginTop: '0.5rem' }}>
            <span className="board-hint">Drag or tap to move · F flip · Z zen</span>
            <span className="row" style={{ gap: '0.4rem' }}>
              <button className="icon-btn" onClick={() => setZen((v) => !v)} aria-pressed={zen} title="Zen mode (Z)">
                <XIcon />
              </button>
              <button className="icon-btn" onClick={toggleFullscreen} title="Fullscreen board">
                <PlayIcon />
              </button>
            </span>
          </div>

          <div className={`status-banner mt-2${checkInfo && !over ? ' check' : ''}`} role="status">
            {statusText}
            {config.mode === 'ai' && !over && !thinking && turn === playerColor && (
              <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={requestHint} disabled={!humanTurn}>
                <LightbulbIcon /> Hint
              </button>
            )}
          </div>
        </div>

        <aside className="col" style={{ gap: '0.9rem' }}>
          <div className="panel panel-pad col" style={{ gap: '0.55rem' }}>
            <div className="section-label">
              Game
              <span className="small muted">
                {config.mode === 'ai' ? 'vs Engine' : 'Pass & play'} ·{' '}
                {unlimited ? 'No clock' : `${config.timeControl.minutes}+${config.timeControl.increment}`}
              </span>
            </div>
            <MoveList plies={plies} resultLabel={over ? `${verdict} (${why})` : null} />
            <div className="row wrap" style={{ gap: '0.45rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={undo} disabled={!canUndo} title="Take back your last move">
                <UndoIcon /> Undo
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setOrientation((o) => (o === 'white' ? 'black' : 'white'));
                  playSound('click');
                }}
                title="Flip board"
              >
                <FlipIcon /> Flip
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirm('draw')} disabled={!!over} title="Offer a draw">
                Draw
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => (settings.confirmResign ? setConfirm('resign') : doResign())} disabled={!!over}>
                <FlagIcon /> Resign
              </button>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setConfirm('exit')} style={{ alignSelf: 'flex-start' }}>
              <PlusIcon /> New game
            </button>
          </div>

          {over && (
            <div className="panel result-card" ref={resultCardRef}>
              <div className={`verdict ${over.winnerColor === null ? '' : over.winnerColor === playerColor ? 'win' : 'loss'}`}>{verdict}</div>
              <div className="why">{why}</div>
              <div className="rule" aria-hidden />
              {recordId && config.mode === 'ai' && ratingDelta !== 0 && (
                <div className="rating-note">
                  Rating {ratingBefore} → <span className="mono">{profile.rating}</span>{' '}
                  <span className={ratingDelta > 0 ? 'badge win' : 'badge loss'}>
                    {ratingDelta > 0 ? '+' : ''}
                    {ratingDelta}
                  </span>
                </div>
              )}
              <div className="row">
                <button className="btn btn-primary btn-sm" onClick={() => onRematch(config.mode === 'ai')}>
                  Rematch
                </button>
                {recordId && (
                  <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/review/${recordId}`)}>
                    Review game
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={onExit}>
                  New game
                </button>
              </div>
            </div>
          )}

          <p className="board-hint">Drag or tap to move · right-drag on the board to draw arrows · tap a piece to see its legal squares.</p>
        </aside>
      </div>

      {confirm === 'resign' && (
        <ConfirmDialog
          title="Resign the game?"
          body={
            config.mode === 'pass'
              ? `${turn === 'w' ? 'White' : 'Black'} resigns. The game will count as a loss for them.`
              : 'This will count as a loss. Sometimes the position is worth fighting for, sometimes it isn’t.'
          }
          confirmLabel="Resign"
          danger
          onConfirm={doResign}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'draw' && (
        <ConfirmDialog
          title="Offer a draw?"
          body={
            config.mode === 'pass'
              ? 'Both players at the board must agree to end the game as a draw.'
              : 'The engine accepts only when it believes it is worse. Otherwise, play on.'
          }
          confirmLabel="Offer draw"
          onConfirm={doOfferDraw}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'exit' && !over && (
        <ConfirmDialog
          title="Leave this game?"
          body="The unfinished game will be abandoned. In rated engine games this counts as a loss."
          confirmLabel="Abandon game"
          danger
          onConfirm={() => {
            if (config.mode === 'ai') resign(playerColor);
            onExit();
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
const LAST_CONFIG_KEY = 'lastConfig';

export default function Play() {
  const [config, setConfig] = useState<GameConfig | null>(() => loadJSON<GameConfig | null>(LAST_CONFIG_KEY, null));
  const [resume, setResume] = useState<SavedGame | null>(null);
  const [gameKey, setGameKey] = useState(0);
  const saved = loadJSON<(SavedGame & { savedAt: number }) | null>(ACTIVE_GAME_KEY, null);

  const start = useCallback((c: GameConfig) => {
    saveJSON(LAST_CONFIG_KEY, c);
    setResume(null);
    setConfig(c);
    setGameKey((k) => k + 1);
  }, []);

  if (!config) {
    return (
      <div className="page container">
        {saved && saved.config && (
          <div className="panel panel-pad row between wrap mb-2" style={{ borderColor: 'var(--accent)' }}>
            <div>
              <strong>Game in progress</strong>
              <div className="small muted">
                {saved.config.mode === 'ai' ? `vs Engine · ${['Gentle', 'Casual', 'Club', 'Sharp'][saved.config.aiLevel - 1]}` : 'Pass & play'} ·{' '}
                {saved.config.timeControl.minutes > 0 ? `${saved.config.timeControl.minutes}+${saved.config.timeControl.increment}` : 'no clock'} ·{' '}
                {Math.ceil((saved.pgn.match(/\./g)?.length ?? 0))} moves played
              </div>
            </div>
            <span className="row" style={{ gap: '0.45rem' }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  saveJSON(LAST_CONFIG_KEY, saved.config);
                  setResume(saved);
                  setConfig(saved.config);
                  setGameKey((k) => k + 1);
                }}
              >
                Resume
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  removeKey(ACTIVE_GAME_KEY);
                  setResume(null);
                }}
              >
                Discard
              </button>
            </span>
          </div>
        )}
        <SetupScreen
          onStart={start}
          last={{
            mode: 'ai',
            timeControl: DEFAULT_TIME_CONTROL,
            playerColor: 'random',
            aiLevel: 2,
          }}
        />
      </div>
    );
  }

  return (
    <GameScreen
      key={gameKey}
      config={config}
      resume={resume}
      onExit={() => {
        setConfig(null);
        setResume(null);
      }}
      onRematch={(swapColor) => {
        setResume(null);
        setConfig((c) =>
          c
            ? {
                ...c,
                playerColor: swapColor ? (c.playerColor === 'w' ? 'b' : c.playerColor === 'b' ? 'w' : 'random') : c.playerColor,
              }
            : c,
        );
        setGameKey((k) => k + 1);
      }}
    />
  );
}
