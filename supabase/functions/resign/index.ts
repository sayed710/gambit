/* resign — the seated participant resigns an active game. */
import { adminClient, corsPreflight, fail, isParticipant, json, loadGame, project, replay, requireUser, saveGame } from '../_shared/game.ts';
import { expiryOutcome } from '../_shared/serverRules.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return corsPreflight();
if (req.method !== 'POST') return fail('method', 'POST only', 405);
  const user = await requireUser(req);
  if (!user) return fail('auth', 'authentication required', 401);

  let body: { gameId?: string };
  try {
    body = await req.json();
  } catch {
    return fail('payload', 'invalid JSON body');
  }
  const gameId = body.gameId ?? '';
  if (!gameId) return fail('payload', 'gameId required');

  const admin = adminClient();
  const game = await loadGame(admin, gameId);
  if (!game) return fail('not-found', 'game not found', 404);
  const seat = isParticipant(game, user.id);
  if (!seat) return fail('forbidden', 'you are not a player in this game', 403);

  // the creator may abandon a room that never seated an opponent
  if (game.status === 'waiting') {
    if (game.creator_id !== user.id) return fail('forbidden', 'only the creator can cancel a waiting room', 403);
    const { data, error } = await saveGame(admin, game, {
      status: 'abandoned',
      version: game.version + 1,
    }, game.version);
    if (error || !data) return json({ ok: false, versionConflict: true, game: project(game) }, 409);
    return json({ ok: true, abandoned: true, game: project(data as typeof game) });
  }

  if (game.status !== 'active') return fail('state', `game is ${game.status}, not active`, 409);

  // expiry reconciles BEFORE the resignation: if the resigning side's
  // clock has already expired, the honest result is a timeout loss —
  // a resignation cannot overwrite an adjudicated flag fall
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

  const c = replay(game);
  const { data, error } = await saveGame(admin, game, {
    status: 'completed',
    result: seat === 'w' ? 'black' : 'white',
    result_reason: 'resignation',
    pgn: c.pgn(),
    version: game.version + 1,
  }, game.version);
  if (error || !data) return json({ ok: false, versionConflict: true, game: project(game) }, 409);

  return json({ ok: true, game: project(data as typeof game) });
});
