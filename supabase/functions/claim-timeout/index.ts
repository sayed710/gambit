/* claim-timeout — server-validated timeout adjudication. Any seated
   participant may claim; the function verifies the opponent's deadline
   against the SERVER clock before adjudicating. No background cron is
   required in this milestone. */
import { adminClient, fail, isParticipant, json, loadGame, project, requireUser, saveGame } from '../_shared/game.ts';

Deno.serve(async (req) => {
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
  if (game.status !== 'active') return fail('state', `game is ${game.status}, not active`, 409);

  const opponentSeat = seat === 'w' ? 'b' : 'w';
  if (game.turn === seat) {
    return fail('not-expired', 'it is your own turn — no timeout to claim', 409, {
      yourMsRemaining: seat === 'w' ? game.white_ms_remaining : game.black_ms_remaining,
    });
  }
  if (!game.turn_started_at) return fail('state', 'clock not started', 409);

  const opponentRemaining = opponentSeat === 'w' ? game.white_ms_remaining : game.black_ms_remaining;
  const elapsed = Math.max(0, Date.now() - new Date(game.turn_started_at).getTime());
  const opponentLeft = opponentRemaining - elapsed;
  if (opponentLeft > 0) {
    return fail('not-expired', `opponent still has ${opponentLeft}ms`, 409, { opponentMsLeft: opponentLeft });
  }

  const { data, error } = await saveGame(admin, game, {
    status: 'completed',
    result: seat === 'w' ? 'white' : 'black',
    result_reason: 'timeout',
    version: game.version + 1,
  }, game.version);
  if (error || !data) return json({ ok: false, versionConflict: true, game: project(game) }, 409);

  return json({ ok: true, game: project(data as typeof game) });
});
