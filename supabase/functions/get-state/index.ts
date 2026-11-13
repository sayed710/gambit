/* get-state — participants read authoritative state through RLS.
   Realtime events are only bells: clients refetch here and reconcile
   by version. */
import { asUuid, corsPreflight, fail, json, userClient } from '../_shared/game.ts';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return corsPreflight();
if (req.method !== 'GET' && req.method !== 'POST') return fail('method', 'GET/POST only', 405);
  // gameId arrives as a query param (GET) or JSON body (POST)
  let gameId = asUuid(new URL(req.url).searchParams.get('gameId'));
  if (!gameId && req.method === 'POST') {
    try {
      const body = await req.json();
      gameId = asUuid((body as Record<string, unknown>)?.gameId);
    } catch {
      /* handled below */
    }
  }
  if (!gameId) return fail('payload', 'gameId must be a uuid');

  const uClient = userClient(req);
  const { data, error } = await uClient.from('online_games').select('*').eq('id', gameId).maybeSingle();
  if (error) return fail('server', 'read failed', 500);
  if (!data) return fail('not-found', 'game not found or not visible to you', 404);

  const { invite_code_hash: _invite, ...game } = data as Record<string, unknown> & { invite_code_hash?: unknown };
  return json({ ok: true, game });
});
