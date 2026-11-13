/* create-game — authenticated guest creates a private challenge.
   Body: { name?, baseMs, incrementMs, color? } — decoded JSON is treated
   as UNTRUSTED and passes through bounded validators; wrong shapes get
   predictable 4xx responses.
   Returns: { gameId, token } — the token is in the response ONCE; the
   database stores only its SHA-256 hash.
   The open-room quota (max 8 waiting/ready/active rooms per creator,
   regardless of age) is enforced ATOMICALLY by the create_online_game()
   database function: a per-creator transaction advisory lock serializes
   concurrent creates and the count+insert share one transaction. Stale
   rooms are reclaimed by the 24-hour expiry reconciliation (see
   _shared/game.ts). */
import { createHash } from 'node:crypto';
import { ROOM_EXPIRY_MS, adminClient, asEnum, asIntIn, asOptionalEnum, asStr, corsPreflight, fail, json, requireUser } from '../_shared/game.ts';

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

  if (b.name !== undefined && typeof b.name !== 'string') return fail('payload', 'name must be a string');
  if (typeof b.name === 'string' && b.name.length > 64) return fail('payload', 'name too long (max 64 chars)');
  const rawName = asStr(b.name, 64);
  const name = rawName ? rawName.trim().slice(0, 24) || 'Player' : 'Player';
  const baseMs = asIntIn(b.baseMs, 60000, 3600000);
  if (baseMs === null) return fail('time-control', 'baseMs must be an integer between 60000 and 3600000');
  const incrementMs = asIntIn(b.incrementMs, 0, 60000);
  if (incrementMs === null) return fail('time-control', 'incrementMs must be an integer between 0 and 60000');
  const picked = asOptionalEnum(b.color, ['white', 'black', 'random']);
  if (picked === null) return fail('color', "color must be 'white', 'black' or 'random'");
  const colorPick = (picked ?? 'random') === 'random' ? (Math.random() < 0.5 ? 'white' : 'black') : (picked as 'white' | 'black');

  const admin = adminClient();

  // reclaim the creator's OWN stale rooms first (the 24h expiry policy —
  // the documented sweep point includes the creator's create attempt),
  // so forgotten invitations cannot lock the guest out of the quota
  // forever. The expiry CAS-races cleanly with a concurrent join.
  const staleCutoff = new Date(Date.now() - ROOM_EXPIRY_MS).toISOString();
  await admin
    .from('online_games')
    .update({ status: 'abandoned', updated_at: new Date().toISOString() })
    .eq('creator_id', user.id)
    .in('status', ['waiting', 'ready'])
    .lt('created_at', staleCutoff);

  // 32 random bytes, base64url (~192 bits) — stored as sha-256 only
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = createHash('sha256').update(token).digest('hex');

  // atomic quota + insert (advisory-lock transaction inside the database)
  const { data: newId, error } = await admin.rpc('create_online_game', {
    p_creator: user.id,
    p_white_id: colorPick === 'white' ? user.id : null,
    p_black_id: colorPick === 'black' ? user.id : null,
    p_white_name: colorPick === 'white' ? name : 'Black',
    p_black_name: colorPick === 'black' ? name : 'White',
    p_invite_hash: hash,
    p_base_ms: baseMs,
    p_increment_ms: incrementMs,
  });
  if (error) {
    if (String(error.message).includes('QUOTA_EXCEEDED')) {
      return fail('rate-limit', 'too many open rooms — finish or cancel them first', 429);
    }
    return fail('server', 'insert failed', 500);
  }

  return json({ ok: true, gameId: newId as string, token, color: colorPick });
});
