/* claim-timeout — server-validated timeout adjudication. Any seated
   participant may claim; the function verifies the opponent's deadline
   against the SERVER clock before adjudicating. No background cron is
   required in this milestone. */
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
  if (game.status !== 'active') return fail('state', `game is ${game.status}, not active`, 409);

  if (game.turn === seat) {
    return fail('not-expired', 'it is your own turn — no timeout to claim', 409, {
      yourMsRemaining: seat === 'w' ? game.white_ms_remaining : game.black_ms_remaining,
    });
  }
  if (!game.turn_started_at) return fail('state', 'clock not started', 409);

  // the shared policy decides expiry AND the result (a win becomes a
  // draw when the claimer lacks any mating material — FIDE 6.9)
  const out = expiryOutcome(replay(game), game, Date.now()); // single reading — fine here
  if (!out || out.flagged === seat) {
    return fail('not-expired', 'the opponent\'s clock has not expired', 409);
  }

  const { data, error } = await saveGame(admin, game, {
    status: 'completed',
    result: out.result,
    result_reason: 'timeout',
    pgn: replay(game).pgn(),
    white_ms_remaining: out.flagged === 'w' ? 0 : game.white_ms_remaining,
    black_ms_remaining: out.flagged === 'b' ? 0 : game.black_ms_remaining,
    version: game.version + 1,
  }, game.version);
  if (error || !data) return json({ ok: false, versionConflict: true, game: project(game) }, 409);

  return json({ ok: true, game: project(data as typeof game) });
});
