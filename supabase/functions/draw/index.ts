/* draw — offer / accept / decline. The offer lives on the row
   (draw_offer_by). Only the OPPONENT (the intended recipient) can
   accept or decline; the offer STANDS until they act on it or decline
   it implicitly by moving (the offerer cannot withdraw it). Accepting
   ends the game as an agreed draw. */
import { adminClient, asEnum, asUuid, corsPreflight, fail, isParticipant, json, loadGame, project, replay, requireUser, saveGame } from '../_shared/game.ts';
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
  const action = asEnum(b.action, ['offer', 'accept', 'decline']);
  if (!gameId) return fail('payload', 'gameId must be a uuid');
  if (!action) return fail('action', "action must be offer, accept or decline");

  const admin = adminClient();
  const game = await loadGame(admin, gameId);
  if (!game) return fail('not-found', 'game not found', 404);
  const seat = isParticipant(game, user.id);
  if (!seat) return fail('forbidden', 'you are not a player in this game', 403);
  if (game.status !== 'active') return fail('state', `game is ${game.status}, not active`, 409);

  // expiry reconciles BEFORE any draw action: if the side to move has
  // already flagged, the timeout result stands — a draw cannot overwrite
  // an adjudicated flag fall
  const out = expiryOutcome(replay(game), game, Date.now());
  if (out) {
    const { data, error } = await saveGame(admin, game, {
      status: 'completed',
      result: out.result,
      result_reason: 'timeout',
      pgn: replay(game).pgn(),
      version: game.version + 1,
      white_ms_remaining: out.flagged === 'w' ? 0 : game.white_ms_remaining,
      black_ms_remaining: out.flagged === 'b' ? 0 : game.black_ms_remaining,
    }, game.version);
    if (error || !data) return json({ ok: false, versionConflict: true, game: project(game) }, 409);
    return json({ ok: true, adjudicated: true, game: project(data as typeof game) });
  }

  const opponentId = seat === 'w' ? game.black_id : game.white_id;

  if (action === 'offer') {
    if (game.draw_offer_by === user.id) return json({ ok: true, game: project(game) }); // idempotent
    if (game.draw_offer_by) return fail('state', 'the opponent already has an offer pending', 409);
    const { data, error } = await saveGame(admin, game, { draw_offer_by: user.id, version: game.version + 1 }, game.version);
    if (error || !data) return json({ ok: false, versionConflict: true, game: project(game) }, 409);
    return json({ ok: true, offered: true, game: project(data as typeof game) });
  }

  if (action === 'decline') {
    if (game.draw_offer_by !== opponentId) return fail('state', 'no pending offer from the opponent', 409);
    const { data, error } = await saveGame(admin, game, { draw_offer_by: null, version: game.version + 1 }, game.version);
    if (error || !data) return json({ ok: false, versionConflict: true, game: project(game) }, 409);
    return json({ ok: true, declined: true, game: project(data as typeof game) });
  }

  // accept: only the opponent of the offerer may accept
  if (game.draw_offer_by !== opponentId) return fail('state', 'no pending offer from the opponent to accept', 409);
  const c = replay(game);
  const { data, error } = await saveGame(admin, game, {
    status: 'completed',
    result: 'draw',
    result_reason: 'draw-agreed',
    draw_offer_by: null,
    pgn: c.pgn(),
    version: game.version + 1,
  }, game.version);
  if (error || !data) return json({ ok: false, versionConflict: true, game: project(game) }, 409);

  return json({ ok: true, accepted: true, game: project(data as typeof game) });
});
