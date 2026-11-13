/* make-move — the authoritative chess command.
   Validates, in order: identity, membership, game active, turn
   ownership, clock deadline, legality (chess.js on the replayed
   authoritative position), promotion, then an optimistic-concurrency
   CAS write (version). Idempotent via (id, last_move_id). Rejected
   after-deadline moves adjudicate a timeout instead. */
import { adminClient, asEnum, asStr, asUuid, corsPreflight, detectEnd, fail, isParticipant, json, loadGame, project, replay, requireUser, saveGame } from '../_shared/game.ts';
import { expiryOutcome } from '../_shared/serverRules.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return corsPreflight();
if (req.method !== 'POST') return fail('method', 'POST only', 405);
  const user = await requireUser(req);
  if (!user) return fail('auth', 'authentication required', 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('payload', 'invalid JSON body');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return fail('payload', 'body must be a JSON object');
  }
  const b = body as Record<string, unknown>;
  const gameId = asUuid(b.gameId);
  const moveId = asUuid(b.moveId);
  const from = asStr(b.from, 4);
  const to = asStr(b.to, 4);
  const promotion = asStr(b.promotion, 1);
  if (!gameId) return fail('payload', 'gameId must be a uuid');
  if (!moveId) return fail('payload', 'moveId must be a uuid');
  if (!from || !to) return fail('payload', 'from and to are required');
  if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to)) return fail('payload', 'from/to must be squares');
  if (promotion !== null && promotion !== undefined && !/^[qrbn]$/.test(promotion.toLowerCase())) {
    return fail('payload', 'promotion must be q, r, b or n');
  }
  const promotionNorm = promotion ? promotion.toLowerCase() : undefined;

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

  // authoritative clock — the shared policy decides expiry, the result
  // (win vs insufficient-material draw) and persists it under CAS
  // ONE clock reading for the whole request: the expiry check and the
  // debit share it, so a deadline crossed mid-processing is still caught
  const now = Date.now();
  const out = expiryOutcome(replay(game), game, now);
  if (out) {
    const { data } = await saveGame(admin, game, {
      status: 'completed',
      result: out.result,
      result_reason: 'timeout',
      pgn: replay(game).pgn(),
      white_ms_remaining: out.flagged === 'w' ? 0 : game.white_ms_remaining,
      black_ms_remaining: out.flagged === 'b' ? 0 : game.black_ms_remaining,
      version: game.version + 1,
    }, game.version);
    return json({
      ok: false,
      applied: false,
      error: { code: 'timeout', message: out.result === 'draw' ? 'your clock ran out — insufficient material to mate: draw' : 'your clock ran out — the opponent wins on time' },
      game: data ? project(data) : project(game),
    }, 409);
  }

  // legality on the authoritative position (chess.js)
  const c = replay(game);
  let move;
  try {
    move = c.move({ from, to, promotion: promotionNorm ?? 'q' });
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

  // the mover's clock: remaining minus the server-measured elapsed time
  const moverRemaining = seat === 'w' ? game.white_ms_remaining : game.black_ms_remaining;
  const elapsed = game.turn_started_at ? Math.max(0, now - new Date(game.turn_started_at).getTime()) : 0;
  const remainingAfter = Math.max(0, moverRemaining - elapsed + (finished ? 0 : game.increment_ms));
  const patch: Record<string, unknown> = {
    moves,
    version: game.version + 1,
    turn: c.turn(),
    last_move_id: moveId,
    turn_started_at: finished ? game.turn_started_at : new Date().toISOString(),
  };
  // DRAW-OFFER POLICY (documented): an offer stands until the OPPONENT
  // (the intended recipient) accepts it, declines it explicitly, or
  // declines it implicitly BY MOVING. The OFFERER's own move does NOT
  // withdraw it — the recipient may still act on it. A move by anyone
  // other than the offerer therefore clears the standing offer.
  if (game.draw_offer_by && game.draw_offer_by !== user.id) patch.draw_offer_by = null;
  if (seat === 'w') patch.white_ms_remaining = remainingAfter;
  else patch.black_ms_remaining = remainingAfter;
  if (end.over) {
    patch.status = 'completed';
    // a rule-driven draw (stalemate / insufficient / repetition /
    // fifty-move) has winner=null — store the explicit 'draw' result so
    // both clients report the draw instead of a generic 'Game over'
    patch.result = end.winner ?? 'draw';
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
