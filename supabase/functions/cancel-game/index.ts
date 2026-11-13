/* cancel-game — the CREATOR cancels a room that never seated an
   opponent (status WAITING only). Semantically separate from resign:
   the cancellation is authorized ONLY against the authoritative status
   and is enforced atomically (CAS on version AND status), so a room
   whose opponent already joined can NEVER be cancelled — and can
   therefore never be forfeited by a stale cancel click. On refusal the
   authoritative game is returned so the client can transition to the
   actual state (the live view). */
import { adminClient, asUuid, corsPreflight, expireIfStale, fail, json, loadGame, project, requireUser } from '../_shared/game.ts';

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
  const loaded = await loadGame(admin, gameId);
  if (!loaded) return fail('not-found', 'game not found', 404);
  if (loaded.creator_id !== user.id) return fail('forbidden', 'only the creator can cancel this room', 403);
  const game = await expireIfStale(admin, loaded);

  // WAITING only: the moment the opponent seats (ready), the room can
  // no longer be cancelled — the 60s readiness-stall claim or the 24h
  // expiry reclaims an unacknowledged ready room instead
  if (game.status !== 'waiting') {
    // the opponent already joined — never a resignation; the client
    // receives the authoritative state to transition to the live game
    return json(
      {
        ok: false,
        error: { code: 'already-seated', message: 'the opponent already joined — the room can no longer be cancelled' },
        game: project(game),
      },
      409,
    );
  }

  // CAS on version AND status: a concurrent join flipping the room to
  // ready makes this write lose, and the refusal path returns the truth
  const { data, error } = await admin
    .from('online_games')
    .update({ status: 'abandoned', version: game.version + 1, updated_at: new Date().toISOString() })
    .eq('id', game.id)
    .eq('version', game.version)
    .eq('status', 'waiting')
    .select('*')
    .single();

  if (error || !data) {
    // the join won the race — re-read and hand back the authoritative game
    const current = await loadGame(admin, game.id);
    return json(
      {
        ok: false,
        error: { code: 'already-seated', message: 'the opponent already joined — the room can no longer be cancelled' },
        game: current ? project(current) : project(game),
      },
      409,
    );
  }

  return json({ ok: true, cancelled: true, game: project(data as typeof game) });
});
