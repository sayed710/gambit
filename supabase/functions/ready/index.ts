/* ready — the readiness acknowledgment (F8). Each seated participant
   confirms they are at the board; when BOTH flags are true the SAME
   CAS write flips ready->active and stamps turn_started_at from the
   SERVER clock — no client timestamp is ever trusted and White's clock
   cannot start before both players can see the game.
   Idempotent: an already-ready player re-acknowledging is a no-op.
   Concurrent acknowledgments: bounded CAS retry (re-read + retry 3×),
   so both flags converge even when both clients fire at once. */
import { adminClient, asUuid, corsPreflight, fail, isParticipant, json, loadGame, project, requireUser } from '../_shared/game.ts';

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
  const gameId = asUuid((body as Record<string, unknown>).gameId);
  if (!gameId) return fail('payload', 'gameId must be a uuid');

  const admin = adminClient();

  // bounded CAS retry: concurrent acknowledgments re-read and retry
  for (let attempt = 0; attempt < 3; attempt++) {
    const game = await loadGame(admin, gameId);
    if (!game) return fail('not-found', 'game not found', 404);
    const seat = isParticipant(game, user.id);
    if (!seat) return fail('forbidden', 'you are not a player in this game', 403);
    if (game.status === 'active') {
      // already started (the opponent acknowledged first) — reconcile
      return json({ ok: true, alreadyActive: true, game: project(game) });
    }
    if (game.status !== 'ready') return fail('state', `game is ${game.status}, not ready`, 409);

    const myFlag = seat === 'w' ? game.white_ready : game.black_ready;
    const opponentFlag = seat === 'w' ? game.black_ready : game.white_ready;
    if (myFlag) return json({ ok: true, alreadyReady: true, game: project(game) }); // idempotent

    const bothNow = opponentFlag; // setting my flag completes the pair
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      [seat === 'w' ? 'white_ready' : 'black_ready']: true,
      version: game.version + 1,
      updated_at: now,
    };
    if (bothNow) {
      // BOTH acknowledged — this same atomic write starts the clocks
      // from the server clock. Fair for either creator color.
      patch.status = 'active';
      patch.turn_started_at = now;
    }

    const { data, error } = await admin
      .from('online_games')
      .update(patch)
      .eq('id', game.id)
      .eq('version', game.version)
      .eq('status', 'ready')
      .select('*')
      .single();

    if (!error && data) {
      const updated = data as typeof game;
      return json({ ok: true, activated: updated.status === 'active', game: project(updated) });
    }
    // lost the CAS race (the opponent acknowledged concurrently) — re-read
  }

  return fail('server', 'readiness race lost — retry', 409);
});
