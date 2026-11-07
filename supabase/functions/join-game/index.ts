/* join-game — a second guest reserves the empty seat via the invite
   token. Atomic: a single CAS UPDATE flips waiting->active and takes the
   empty seat, so a third participant or a double-join can never corrupt
   the game. Body: { token, name } */
import { createHash } from 'node:crypto';
import { adminClient, fail, json, loadGame, project, requireUser } from '../_shared/game.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail('method', 'POST only', 405);
  const user = await requireUser(req);
  if (!user) return fail('auth', 'authentication required', 401);

  let body: { token?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return fail('payload', 'invalid JSON body');
  }
  const token = (body.token ?? '').trim();
  const name = (body.name ?? '').trim().slice(0, 24) || 'Player';
  if (!token) return fail('token', 'invitation token required');

  const hash = createHash('sha256').update(token).digest('hex');
  const admin = adminClient();

  // invite lookup is by hash — sequential/guessed ids authorize nothing
  const { data: byHash, error } = await admin.from('online_games').select('id').eq('invite_code_hash', hash).maybeSingle();
  if (error || !byHash) return fail('invalid-invite', 'this invitation is not valid', 404);

  const game = await loadGame(admin, byHash.id);
  if (!game) return fail('invalid-invite', 'this invitation is not valid', 404);
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
  const patch =
    emptySeat === 'black'
      ? { black_id: user.id, black_name: name, status: 'active' }
      : { white_id: user.id, white_name: name, status: 'active' };

  // CAS: only one joiner can flip waiting->active and take the empty seat
  const { data, error: updateError } = await admin
    .from('online_games')
    .update({ ...patch, turn_started_at: now, updated_at: now, version: game.version + 1 })
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
