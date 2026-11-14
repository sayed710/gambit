/* join-game — a second guest reserves the empty seat via the invite
   token. Atomic: a single CAS UPDATE flips waiting->READY and takes the
   empty seat, so a third participant or a double-join can never corrupt
   the game. The clock does NOT start here (F8): it starts only when
   BOTH players have acknowledged readiness via the `ready` function.
   Body: { token, name } — untrusted, bounded. */
import { createHash } from 'node:crypto';
import { adminClient, asNonEmptyStr, corsPreflight, expireIfStale, fail, json, loadGame, project, requireUser } from '../_shared/game.ts';

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
  const token = asNonEmptyStr(b.token, 200);
  if (!token) return fail('token', 'invitation token required');
  const rawName = b.name === undefined ? null : asNonEmptyStr(b.name, 64);
  if (b.name !== undefined && typeof b.name !== 'string') return fail('payload', 'name must be a string');
  const name = rawName ? rawName.slice(0, 24) : 'Player';

  const hash = createHash('sha256').update(token).digest('hex');
  const admin = adminClient();

  // invite lookup is by hash — sequential/guessed ids authorize nothing
  const { data: byHash, error } = await admin.from('online_games').select('id').eq('invite_code_hash', hash).maybeSingle();
  if (error || !byHash) return fail('invalid-invite', 'this invitation is not valid', 404);

  const loaded = await loadGame(admin, byHash.id);
  if (!loaded) return fail('invalid-invite', 'this invitation is not valid', 404);
  const game = await expireIfStale(admin, loaded); // 24h expiry reconciliation (documented policy)
  if (game.status === 'abandoned' || game.status === 'completed') {
    return fail('expired', 'this game is already finished', 409);
  }

  // idempotent: the seated player reopening their own link rejoins their seat
  if (game.white_id === user.id || game.black_id === user.id) {
    return json({ ok: true, rejoined: true, game: project(game) });
  }

  if (game.status !== 'waiting') return fail('full', 'this room is already playing', 409);
  if (game.white_id && game.black_id) return fail('full', 'this room is full', 409);

  const emptySeat = game.white_id ? 'black' : 'white';
  const now = new Date().toISOString();
  // waiting -> READY. No clock starts; the `ready` function starts the
  // clocks from the SERVER clock once both players acknowledged.
  const patch =
    emptySeat === 'black'
      ? { black_id: user.id, black_name: name, status: 'ready', ready_started_at: now }
      : { white_id: user.id, white_name: name, status: 'ready', ready_started_at: now };

  // CAS: only one joiner can flip waiting->ready and take the empty seat
  const { data, error: updateError } = await admin
    .from('online_games')
    .update({ ...patch, updated_at: now, version: game.version + 1 })
    .eq('id', game.id)
    .eq('version', game.version)
    .eq('status', 'waiting')
    .select('*')
    .single();

  if (updateError || !data) {
    // re-read: distinguishes 'someone took it' from transient failures
    const current = await loadGame(admin, game.id);
    if (current && current.status !== 'waiting') return fail('full', 'this room is already playing', 409);
    return fail('server', 'join race lost — try again', 409);
  }

  return json({ ok: true, joined: emptySeat, game: project(data as typeof game) });
});
