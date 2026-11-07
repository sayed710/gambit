/* make-move — the authoritative chess command.
   Validates, in order: identity, membership, game active, turn
   ownership, clock deadline, legality (chess.js on the replayed
   authoritative position), promotion, then an optimistic-concurrency
   CAS write (version). Idempotent via (id, last_move_id). Rejected
   after-deadline moves adjudicate a timeout instead. */
import { adminClient, corsPreflight, detectEnd, elapsedMs, fail, isParticipant, json, loadGame, project, replay, requireUser, saveGame } from '../_shared/game.ts';

interface MoveBody {
  gameId?: string;
  moveId?: string;
  from?: string;
  to?: string;
  promotion?: string;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return corsPreflight();
if (req.method !== 'POST') return fail('method', 'POST only', 405);
  const user = await requireUser(req);
  if (!user) return fail('auth', 'authentication required', 401);

  let body: MoveBody;
  try {
    body = await req.json();
  } catch {
    return fail('payload', 'invalid JSON body');
  }
  const gameId = body.gameId ?? '';
  const moveId = body.moveId ?? '';
  const from = body.from ?? '';
  const to = body.to ?? '';
  const promotion = body.promotion;
  if (!gameId || !moveId || !from || !to) return fail('payload', 'gameId, moveId, from and to are required');
  if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) return fail('payload', 'from/to must be squares');
  if (promotion !== undefined && !/^[qrbn]$/.test(promotion.toLowerCase())) return fail('payload', 'promotion must be q, r, b or n');

  const admin = adminClient();
  const game = await loadGame(admin, gameId);
  if (!game) return fail('not-found', 'game not found', 404);
  const seat = isParticipant(game, user.id);
  if (!seat) return fail('forbidden', 'you are not a player in this game', 403);
  if (game.status !== 'active') return fail('state', `game is ${game.status}, not active`, 409);

  // idempotency: a moveId already present ANYWHERE in the history is a
  // no-op (a retried stale command must never apply twice, even if the
  // position later repeats and the same move becomes legal again)
  if (game.last_move_id === moveId || game.moves.some((m) => m.moveId === moveId)) {
    return json({ ok: true, applied: false, replay: true, game: project(game) });
  }

  if (game.turn !== seat) return fail('turn', 'not your turn', 409, { turn: game.turn });

  // authoritative clock — the move dies if the mover's deadline passed
  const now = Date.now();
  const remaining = seat === 'w' ? game.white_ms_remaining : game.black_ms_remaining;
  const elapsed = elapsedMs(game, now);
  if (game.turn_started_at && elapsed > remaining) {
    const winner = seat === 'w' ? 'black' : 'white';
    const { data } = await saveGame(admin, game, {
      status: 'completed',
      result: winner,
      result_reason: 'timeout',
      pgn: replay(game).pgn(),
      version: game.version + 1,
    }, game.version);
    return json({
      ok: false,
      applied: false,
      error: { code: 'timeout', message: 'your clock ran out — the opponent wins on time' },
      game: data ? project(data) : project(game),
    }, 409);
  }

  // legality on the authoritative position (chess.js)
  const c = replay(game);
  let move;
  try {
    move = c.move({ from, to, promotion: (promotion ?? 'q').toLowerCase() });
  } catch {
    return fail('illegal', 'illegal move', 409);
  }
  if (!move) return fail('illegal', 'illegal move', 409);
  if (move.color !== seat) return fail('turn', 'not your turn', 409);

  const moves = [...game.moves, { san: move.san, from: move.from, to: move.to, fenAfter: c.fen(), moveId }];
  const end = detectEnd(c);
  // ONLY rule-driven ends finish here. A pending draw offer is not a
  // finished game: the clock keeps running (increment + turn handoff
  // apply normally) until the offer is accepted or declined.
  const finished = end.over;

  const remainingAfter = Math.max(0, remaining - elapsed + (finished ? 0 : game.increment_ms));
  const patch: Record<string, unknown> = {
    moves,
    version: game.version + 1,
    turn: c.turn(),
    last_move_id: moveId,
    turn_started_at: finished ? game.turn_started_at : new Date().toISOString(),
  };
  // a standing draw offer dies when its offerer moves (standard chess behavior)
  if (game.draw_offer_by === user.id) patch.draw_offer_by = null;
  if (seat === 'w') patch.white_ms_remaining = remainingAfter;
  else patch.black_ms_remaining = remainingAfter;
  if (end.over) {
    patch.status = 'completed';
    patch.result = end.winner;
    patch.result_reason = end.reason;
    patch.pgn = c.pgn();
  }

  const { data, error } = await saveGame(admin, game, patch, game.version);
  if (error || !data) {
    // lost the CAS race (opponent moved / adjudication raced) — the
    // client reconciles from authoritative state; the move is NOT applied
    const current = await loadGame(admin, game.id);
    return json({ ok: false, applied: false, versionConflict: true, game: current ? project(current) : null }, 409);
  }

  return json({ ok: true, applied: true, san: move.san, game: project(data as typeof game) });
});
