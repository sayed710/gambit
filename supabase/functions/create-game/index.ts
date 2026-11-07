/* create-game — authenticated guest creates a private challenge.
   Body: { name, baseMs, incrementMs, color: 'white'|'black'|'random' }
   Returns: { gameId, token } — the token is in the response ONCE; the
   database stores only its SHA-256 hash. */
import { createHash } from 'node:crypto';
import { adminClient, corsPreflight, fail, json, requireUser } from '../_shared/game.ts';

const ABUSE_WINDOW_MS = 10 * 60 * 1000;
const ABUSE_MAX_OPEN = 5; // open (waiting/active) rooms per creator

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return corsPreflight();
if (req.method !== 'POST') return fail('method', 'POST only', 405);
  const user = await requireUser(req);
  if (!user) return fail('auth', 'authentication required', 401);

  let body: { name?: string; baseMs?: number; incrementMs?: number; color?: string };
  try {
    body = await req.json();
  } catch {
    return fail('payload', 'invalid JSON body');
  }

  const name = (body.name ?? '').trim().slice(0, 24) || 'Player';
  const baseMs = Number(body.baseMs);
  const incrementMs = Number(body.incrementMs);
  if (!Number.isInteger(baseMs) || baseMs < 60000 || baseMs > 3600000) {
    return fail('time-control', 'baseMs must be an integer between 60000 and 3600000');
  }
  if (!Number.isInteger(incrementMs) || incrementMs < 0 || incrementMs > 60000) {
    return fail('time-control', 'incrementMs must be an integer between 0 and 60000');
  }
  const colorPick = body.color === 'random' || body.color === undefined ? (Math.random() < 0.5 ? 'white' : 'black') : body.color;
  if (colorPick !== 'white' && colorPick !== 'black') return fail('color', "color must be 'white', 'black' or 'random'");

  const admin = adminClient();

  // abuse guard: bound the number of concurrently open rooms per creator
  const cutoff = new Date(Date.now() - ABUSE_WINDOW_MS).toISOString();
  const { count, error: countError } = await admin
    .from('online_games')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', user.id)
    .in('status', ['waiting', 'ready', 'active'])
    .gte('created_at', cutoff);
  if (countError) return fail('server', 'lookup failed', 500);
  if ((count ?? 0) >= ABUSE_MAX_OPEN) {
    return fail('rate-limit', 'too many open rooms — finish or let them expire first', 429);
  }

  // 32 random bytes, base64url (~192 bits) — stored as sha-256 only
  const raw = new Uint8Array(32);
  crypto.getRandomValues(raw);
  const token = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hash = createHash('sha256').update(token).digest('hex');

  const { data, error } = await admin
    .from('online_games')
    .insert({
      creator_id: user.id,
      white_id: colorPick === 'white' ? user.id : null,
      black_id: colorPick === 'black' ? user.id : null,
      white_name: colorPick === 'white' ? name : 'Black',
      black_name: colorPick === 'black' ? name : 'White',
      invite_code_hash: hash,
      status: 'waiting',
      base_ms: baseMs,
      increment_ms: incrementMs,
      white_ms_remaining: baseMs,
      black_ms_remaining: baseMs,
      turn: 'w',
    })
    .select('id')
    .single();
  if (error) return fail('server', 'insert failed', 500);

  return json({ ok: true, gameId: data!.id, token, color: colorPick });
});
