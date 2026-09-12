import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import type { Color, Square } from 'chess.js';
import type { Move } from 'chess.js';
import type { GameConfig, Ply } from '../lib/types';
import { capturedFromFen, hasMatingMaterial, pliesFromGame } from '../lib/chessUtils';
import { playSound } from '../lib/sound';
import { useClock } from './useClock';

export interface GameOverInfo {
  winnerColor: Color | null;
  reason: string;
}

export interface PendingPromotion {
  from: Square;
  to: Square;
  color: Color;
}

/** A game in progress, saved so a reload or navigation away doesn't lose it. */
export interface SavedGame {
  config: GameConfig;
  playerColor: Color;
  pgn: string;
  /** remaining clock ms per side; null for unlimited games */
  clocks: { w: number; b: number } | null;
}

interface UseGameOptions {
  config: GameConfig;
  engineSearch: (fen: string, level: 1 | 2 | 3 | 4, recentFens: string[]) => Promise<{ from: string; to: string; promotion?: string; san: string } | null>;
  onGameOver?: (info: GameOverInfo) => void;
  /** restore a previously saved game instead of starting fresh */
  resume?: SavedGame | null;
  /** start from a specific position (tests and analysis); ignored when resume is given */
  initialFen?: string;
}

export function useGame({ config, engineSearch, onGameOver, resume, initialFen }: UseGameOptions) {
  const unlimited = config.timeControl.minutes === 0 && config.timeControl.increment === 0;
  const initialMs = config.timeControl.minutes * 60_000;
  const incrementMs = config.timeControl.increment * 1000;

  const startFenRef = useRef<string | null>(initialFen ?? null);
  const gameRef = useRef(new Chess(initialFen ?? undefined));
  const [fen, setFen] = useState(gameRef.current.fen());
  const [plies, setPlies] = useState<Ply[]>([]);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [turn, setTurn] = useState<Color>(() => new Chess(startFenRef.current ?? undefined).turn());
  const [pendingPromotion, setPendingPromotion] = useState<PendingPromotion | null>(null);
  const [thinking, setThinking] = useState(false);
  const [over, setOver] = useState<GameOverInfo | null>(null);
  const [drawDeclined, setDrawDeclined] = useState(false);

  const clock = useClock(initialMs, incrementMs);
  const clockSnapshots = useRef<{ w: number; b: number }[]>([]);

  const playerColorRef = useRef<Color>('w');
  const [playerColor, setPlayerColor] = useState<Color>('w');

  const overRef = useRef<GameOverInfo | null>(null);
  const onGameOverRef = useRef(onGameOver);
  onGameOverRef.current = onGameOver;

  const finish = useCallback(
    (info: GameOverInfo) => {
      if (overRef.current) return;
      overRef.current = info;
      setOver(info);
      clock.stop();
      setThinking(false);
      onGameOverRef.current?.(info);
    },
    [clock],
  );

  // ---- new game / restart ----
  const newGame = useCallback(
    (cfg?: Partial<GameConfig>) => {
      gameRef.current = new Chess(startFenRef.current ?? undefined);
      clockSnapshots.current = [];
      overRef.current = null;
      setOver(null);
      setPendingPromotion(null);
      setDrawDeclined(false);
      setThinking(false);
      setPlies([]);
      setLastMove(null);
      setTurn('w');
      setFen(gameRef.current.fen());
      const color: Color =
        (cfg?.playerColor ?? config.playerColor) === 'random'
          ? Math.random() < 0.5
            ? 'w'
            : 'b'
          : ((cfg?.playerColor ?? config.playerColor) as Color);
      playerColorRef.current = color;
      setPlayerColor(color);
      clock.reset(initialMs);
      if (!unlimited && color !== 'w') clock.start('w');

      // restore a saved game: replay the PGN, fast-forward clocks
      if (resume) {
        try {
          const restored = new Chess();
          restored.loadPgn(resume.pgn);
          gameRef.current = restored;
          const hist = restored.history({ verbose: true });
          const last = hist[hist.length - 1];
          setFen(restored.fen());
          setPlies(pliesFromGame(restored));
          setLastMove(last ? { from: last.from, to: last.to } : null);
          setTurn(restored.turn());
          playerColorRef.current = resume.playerColor;
          setPlayerColor(resume.playerColor);
          if (resume.clocks && !unlimited) {
            clock.restore(resume.clocks, restored.turn());
          }
        } catch {
          // corrupt save — fall through to a fresh game
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.playerColor, clock, initialMs, unlimited],
  );

  useEffect(() => {
    newGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // initialize once on mount; restarts remount the component via key

  const soundForMove = useCallback((m: Move) => {
    if (m.isPromotion()) playSound('promote');
    else if (m.san.startsWith('O-O')) playSound('castle');
    else if (m.isCapture()) playSound('capture');
    else playSound('move');
    if (m.san.includes('#')) return; // mate handled by end sound
    if (m.san.includes('+')) playSound('check');
  }, []);

  const checkTermination = useCallback(
    (game: Chess) => {
      if (game.isCheckmate()) {
        const winner: Color = game.turn() === 'w' ? 'b' : 'w';
        playSound(playerColorRef.current === winner ? 'win' : 'lose');
        finish({ winnerColor: winner, reason: 'Checkmate' });
        return true;
      }
      if (game.isStalemate()) {
        playSound('draw');
        finish({ winnerColor: null, reason: 'Stalemate' });
        return true;
      }
      if (game.isInsufficientMaterial()) {
        playSound('draw');
        finish({ winnerColor: null, reason: 'Insufficient material' });
        return true;
      }
      if (game.isThreefoldRepetition()) {
        playSound('draw');
        finish({ winnerColor: null, reason: 'Threefold repetition' });
        return true;
      }
      if (game.isDraw()) {
        playSound('draw');
        finish({ winnerColor: null, reason: 'Fifty-move rule' });
        return true;
      }
      return false;
    },
    [finish],
  );

  /** Apply a validated move object, update clocks, sounds, termination. */
  const commitMove = useCallback(
    (m: Move) => {
      const game = gameRef.current;
      clockSnapshots.current.push({ ...clock.clocks });
      const mover = m.color;
      const finished = checkTermination(game);
      if (!finished && !unlimited) clock.switchTo(game.turn(), mover);
      soundForMove(m);
      setFen(game.fen());
      setPlies(pliesFromGame(game));
      setLastMove({ from: m.from, to: m.to });
      setTurn(game.turn());
      if (game.isCheck() && !game.isGameOver()) playSound('check');    },
    [checkTermination, clock, soundForMove, unlimited],
  );

  // Promotion gate must be readable at call time — gating on the state value
  // races against React's commit, which broke choosePromotion entirely.
  const pendingPromotionRef = useRef<PendingPromotion | null>(null);

  const setPending = useCallback((p: PendingPromotion | null) => {
    pendingPromotionRef.current = p;
    setPendingPromotion(p);
  }, []);

  /** Apply a fully-specified legal move. Assumes no pending promotion. */
  const applyMove = useCallback(
    (from: Square, to: Square, promotion?: 'q' | 'r' | 'b' | 'n'): 'ok' | 'illegal' => {
      const game = gameRef.current;
      try {
        const m = game.move({ from, to, promotion: promotion ?? 'q' });
        commitMove(m);
        return 'ok';
      } catch {
        return 'illegal';
      }
    },
    [commitMove],
  );

  /** Try to play from→to. Returns 'ok' | 'promote' | 'illegal'. */
  const tryMove = useCallback(
    (from: Square, to: Square, promotion?: 'q' | 'r' | 'b' | 'n'): 'ok' | 'promote' | 'illegal' => {
      if (overRef.current || pendingPromotionRef.current) return 'illegal';
      const game = gameRef.current;
      const legal = game.moves({ verbose: true }).filter((mv) => mv.from === from && mv.to === to);
      if (legal.length === 0) return 'illegal';
      const needsPromotion = legal.some((mv) => mv.promotion);
      if (needsPromotion && !promotion) {
        clock.pause();
        setPending({ from, to, color: game.get(from)?.color ?? 'w' });
        return 'promote';
      }
      if (applyMove(from, to, promotion) === 'ok') return 'ok';
      return 'illegal';
    },
    [applyMove, clock, setPending],
  );

  const choosePromotion = useCallback(
    (piece: 'q' | 'r' | 'b' | 'n') => {
      const p = pendingPromotionRef.current;
      if (!p) return;
      setPending(null); // clear the gate before re-applying — no stale closure possible
      clock.resume();
      applyMove(p.from, p.to, piece);
    },
    [applyMove, clock, setPending],
  );

  const cancelPromotion = useCallback(() => {
    if (!pendingPromotionRef.current) return;
    setPending(null);
    clock.resume();
  }, [clock, setPending]);

  // Latest-ref so per-frame clock re-renders never restart the engine search.
  const commitMoveRef = useRef(commitMove);
  commitMoveRef.current = commitMove;

  // ---- engine opponent ----
  useEffect(() => {
    if (config.mode !== 'ai') return;
    if (over || pendingPromotion) return;
    if (turn === playerColor) return;
    let cancelled = false;
    const fenAtRequest = gameRef.current.fen();
    setThinking(true);
    const game = gameRef.current;
    const recentFens = game
      .history({ verbose: true })
      .slice(-8)
      .map((mv) => mv.after.split(' ').slice(0, 4).join(' '));
    engineSearch(fenAtRequest, config.aiLevel, recentFens)
      .then((result) => {
        // the position may have moved on (restart, undo) while the worker thought
        if (cancelled || overRef.current || gameRef.current.fen() !== fenAtRequest) return;
        setThinking(false);
        if (!result) return;
        try {
          const m = gameRef.current.move({ from: result.from, to: result.to, promotion: result.promotion ?? 'q' });
          commitMoveRef.current(m);
        } catch {
          // engine proposed something illegal (shouldn't happen) — fall back to first legal move
          const fallback = gameRef.current.moves({ verbose: true })[0];
          if (fallback) {
            const m = gameRef.current.move({ from: fallback.from, to: fallback.to, promotion: fallback.promotion ?? 'q' });
            commitMoveRef.current(m);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setThinking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config.mode, config.aiLevel, turn, playerColor, over, pendingPromotion, engineSearch]);

  // ---- flag ----
  useEffect(() => {
    if (!clock.flagged || overRef.current) return;
    const winner: Color = clock.flagged === 'w' ? 'b' : 'w';
    // FIDE 6.9: no loss on time if the opponent cannot possibly checkmate
    if (!hasMatingMaterial(gameRef.current.fen(), winner)) {
      playSound('draw');
      finish({ winnerColor: null, reason: 'Time out — insufficient material to mate' });
      return;
    }
    playSound(playerColorRef.current === winner ? 'win' : 'lose');
    finish({ winnerColor: winner, reason: 'On time' });
  }, [clock.flagged, finish]);

  // ---- undo ----
  const canUndo = plies.length > 0 && !over && !pendingPromotion && !thinking;
  const undo = useCallback(() => {
    if (overRef.current) return;
    const game = gameRef.current;
    if (game.history().length === 0) return;
    // In AI mode revert a full pair so it's the human's turn again.
    const steps = config.mode === 'ai' && turn === playerColor && game.history().length >= 2 ? 2 : 1;
    for (let i = 0; i < steps; i++) game.undo();
    const snap = clockSnapshots.current.splice(-steps)[0] ?? null;
    if (snap && !unlimited) {
      clock.restore(snap, game.turn());
    }
    const hist = game.history({ verbose: true });
    const last = hist[hist.length - 1];
    setFen(game.fen());
    setPlies(pliesFromGame(game));
    setLastMove(last ? { from: last.from, to: last.to } : null);
    setTurn(game.turn());
    playSound('click');
  }, [config.mode, turn, playerColor, unlimited, clock]);

  // ---- resign ----
  const resign = useCallback(
    (who: Color) => {
      if (overRef.current) return;
      const winner: Color = who === 'w' ? 'b' : 'w';
      playSound(playerColorRef.current === winner ? 'win' : 'lose');
      finish({ winnerColor: winner, reason: 'By resignation' });
    },
    [finish],
  );

  // ---- draw offer (engine accepts only if clearly worse) ----
  const offerDraw = useCallback(
    async (engineEval: (fen: string) => Promise<number | null>) => {
      if (overRef.current) return null;
      if (config.mode === 'pass') {
        finish({ winnerColor: null, reason: 'By agreement' });
        return true;
      }
      const cp = await engineEval(gameRef.current.fen());
      const aiIs = playerColorRef.current === 'w' ? 'b' : 'w';
      const aiPerspective = aiIs === 'w' ? cp : cp === null ? null : -cp;
      if (aiPerspective !== null && aiPerspective < -250) {
        playSound('draw');
        finish({ winnerColor: null, reason: 'By agreement' });
        return true;
      }
      setDrawDeclined(true);
      return false;
    },
    [config.mode, finish],
  );

  const captured = capturedFromFen(fen);
  const checkInfo = (() => {
    const game = gameRef.current;
    if (!game.isCheck()) return null;
    const board = game.board();
    for (const row of board)
      for (const sq of row) if (sq && sq.type === 'k' && sq.color === game.turn()) return { square: sq.square };
    return null;
  })();

  return {
    fen,
    plies,
    lastMove,
    turn,
    over,
    thinking,
    pendingPromotion,
    drawDeclined,
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
    newGame,
    pgn: () => gameRef.current.pgn(),
    /** authoritative SAN list for the played game (source for saved records) */
    getMoves: (): string[] => gameRef.current.history(),
    getFen: (): string => gameRef.current.fen(),
    moveCount: plies.length,
  };
}
