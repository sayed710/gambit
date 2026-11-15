/* rematch — post-game rematch flow for COMPLETED games.
   Actions:
   - offer   (participant): create the one pending request for the game
             (the partial unique index makes concurrent offers resolve to
             exactly one pending request)
   - accept  (the NON-requester participant): runs accept_rematch() — ONE
             atomic transaction that locks the request, verifies the 10
             minute window, creates the swapped-color game under the
             acceptor's quota, and marks the request accepted. Returns
             the new game id + the raw invitation token (shown to the
             acceptor only; both players are seated anyway).
   - decline (the NON-requester participant): pending -> declined
   - cancel  (the REQUESTER only): withdraw the pending offer (row deleted)

   Expiry: requests older than 10 minutes are adjudicated 'expired' on
   the next accept attempt; declined/expired free the slot for a fresh
   offer. Either participant may re-offer afterwards. */
import { adminClient, asEnum, asUuid, corsPreflight, fail, isParticipant, json, loadGame, project, requireUser } from '../_shared/game.ts';

const REMATCH_WINDOW_MINUTES = 10;

interface RematchRow {
  id: string;
  game_id: string;
  requester_id: string;
  status: string;
  rematch_game_id: string | null;
  created_at: string;
  version: number;
}

async function loadRequest(admin: ReturnType<typeof adminClient>, requestId: string): Promise<RematchRow | null> {
  const { data } = await admin.from('rematch_requests').select('*').eq('id', requestId).maybeSingle();
  return (data as RematchRow) ?? null;
}

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
  const action = asEnum(b.action, ['offer', 'accept', 'decline', 'cancel']);
  const gameId = asUuid(b.gameId);
  if (!gameId) return fail('payload', 'gameId must be a uuid');
  if (!action) return fail('action', 'action must be offer, accept, decline or cancel');

  const admin = adminClient();
  const oldGame = await loadGame(admin, gameId);
  if (!oldGame) return fail('not-found', 'game not found', 404);
  const seat = isParticipant(oldGame, user.id);
  if (!seat) return fail('forbidden', 'you are not a player in this game', 403);

  if (oldGame.status !== 'completed') {
    return fail('state', `rematch requires a completed game (this one is ${oldGame.status})`, 409);
  }

  const opponentId = seat === 'w' ? oldGame.black_id : oldGame.white_id;

  /* ---------- offer ---------- */
  if (action === 'offer') {
    // adjudicate an EXPIRED pending request first — measured by the
    // DATABASE clock (same source as accept_rematch); a failed expiry
    // MUST abort the offer (never report already-pending for a live
    // request whose expiry check could not run)
    const { error: expiryError } = await admin.rpc('expire_stale_rematch', { p_game_id: gameId });
    if (expiryError) return fail('server', 'expiry adjudication failed', 500);
    // one pending request per game — the partial unique index is the
    // concurrency guard; a racing duplicate surfaces as 23505
    const { error } = await admin.from('rematch_requests').insert({ game_id: gameId, requester_id: user.id });
    if (error) {
      if (String(error.code) === '23505' || String(error.message).includes('rematch_one_pending_per_game')) {
        return fail('already-pending', 'a rematch is already pending for this game', 409);
      }
      return fail('server', 'offer failed', 500);
    }
    const { data: created } = await admin
      .from('rematch_requests')
      .select('*')
      .eq('game_id', gameId)
      .eq('status', 'pending')
      .maybeSingle();
    return json({ ok: true, offered: true, request: created });
  }

  // the remaining actions need the pending request id
  const requestId = asUuid(b.requestId);
  if (!requestId) return fail('payload', 'requestId must be a uuid');
  const request = await loadRequest(admin, requestId);
  if (!request || request.game_id !== gameId) return fail('not-found', 'rematch request not found', 404);

  /* ---------- accept ---------- */
  if (action === 'accept') {
    // only the NON-requester participant may accept the offer
    if (request.requester_id === user.id) {
      return fail('forbidden', 'the offerer cannot accept their own rematch offer', 403);
    }
    if (request.status !== 'pending') {
      // an ACCEPTED request replays idempotently (a concurrent/retried
      // acceptance returns the same rematch id so both callers land on
      // the same game); declined/expired are refused with 409
      if (request.status !== 'accepted') {
        return fail('state', `the rematch request is ${request.status}`, 409);
      }
      const fresh = await loadRequest(admin, requestId);
      return json({
        ok: true,
        accepted: true,
        rematchGameId: request.rematch_game_id ?? fresh?.rematch_game_id ?? null,
        request: fresh ?? request,
      });
    }
    const { data, error } = await admin.rpc('accept_rematch', { p_request_id: requestId, p_acceptor: user.id });
    if (error) {
      const msg = String(error.message);
      if (msg.includes('NOT_PENDING')) {
        // a concurrent acceptance committed between our read and the
        // row lock — replay the rematch id instead of failing
        const fresh = await loadRequest(admin, requestId);
        if (fresh?.status === 'accepted' && fresh.rematch_game_id) {
          return json({ ok: true, accepted: true, rematchGameId: fresh.rematch_game_id, request: { ...fresh } });
        }
        return fail('state', 'the rematch request is no longer pending', 409, { request: fresh ? { ...fresh } : undefined });
      }
      if (msg.includes('QUOTA_EXCEEDED')) {
        return fail('rate-limit', 'too many open rooms — finish or cancel them first', 429);
      }
      if (msg.includes('FORBIDDEN')) return fail('forbidden', 'only the offered player may accept', 403);
      return fail('server', 'accept failed', 500);
    }
    const rows = (data ?? []) as { new_game_id: string; new_token: string }[];
    if (!rows[0]?.new_game_id) {
      // NULLs = the request was adjudicated EXPIRED (its 10-minute
      // window passed) — report it with the persisted row
      const fresh = await loadRequest(admin, requestId);
      return fail('expired', 'the rematch offer expired', 409, { request: fresh ?? undefined });
    }
    const newGameId = rows[0].new_game_id;
    const newToken = rows[0].new_token;
    const newGame = await loadGame(admin, newGameId);
    return json({ ok: true, accepted: true, rematchGameId: newGameId, token: newToken, game: newGame ? project(newGame) : null });
  }

  /* ---------- decline (opponent) ---------- */
  if (action === 'decline') {
    if (request.requester_id === user.id) {
      return fail('forbidden', 'the offerer cannot decline their own offer', 403);
    }
    if (request.status !== 'pending') {
      return fail('state', 'the rematch request is no longer pending', 409);
    }
    // .select() returns the mutated row from the SAME statement — no
    // second read, so a database read failure cannot fake a conflict
    const { data: declinedRow, error } = await admin
      .from('rematch_requests')
      .update({ status: 'declined', version: request.version + 1 })
      .eq('id', requestId)
      .eq('version', request.version)
      .eq('status', 'pending')
      .select('*')
      .maybeSingle();
    if (error || !declinedRow) {
      // zero rows mutated: the request changed under us — conflict
      const fresh = await loadRequest(admin, requestId);
      return json({ ok: false, versionConflict: true, error: { code: 'version-conflict', message: 'another command landed first' }, request: fresh ?? undefined }, 409);
    }
    return json({ ok: true, declined: true, request: { ...(declinedRow as RematchRow) } });
  }

  /* ---------- cancel (requester withdraws the offer) ---------- */
  if (request.requester_id !== user.id) {
    return fail('forbidden', 'only the offerer can cancel the pending rematch', 403);
  }
  if (request.status !== 'pending') {
    return fail('state', 'the rematch request is no longer pending', 409);
  }
  const { data: deletedRows, error } = await admin
    .from('rematch_requests')
    .delete()
    .eq('id', requestId)
    .eq('version', request.version)
    .eq('status', 'pending')
    .select('*');
  // an empty result = zero rows deleted = the request changed under us
  if (error || !deletedRows?.length) {
    const fresh = await loadRequest(admin, requestId);
    return json({ ok: false, versionConflict: true, error: { code: 'version-conflict', message: 'another command landed first' }, request: fresh ?? undefined }, 409);
  }
  return json({ ok: true, cancelled: true });
});
