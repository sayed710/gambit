/* Direct Realtime probe: subscribe as a participant, make a move via
   the edge function, and time the postgres_changes delivery. */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const URL = 'http://127.0.0.1:54321';
const ANON = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

const guest = async () => {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  return { sb, token: data.session.access_token, id: data.session.user.id };
};
const fn = async (t, name, body) => {
  const res = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, payload: await res.json().catch(() => ({})) };
};

const A = await guest();
const B = await guest();
const create = await fn(A.token, 'create-game', { name: 'Alice', baseMs: 600000, incrementMs: 0, color: 'white' });
const gameId = create.payload.gameId;
const join = await fn(B.token, 'join-game', { token: create.payload.token, name: 'Bob' });
console.log('game', gameId, 'status', join.payload.game?.status);

// B subscribes WITH B's JWT (RLS-scoped realtime)
const received = [];
let subscribed = false;
const ch = B.sb
  .channel(`probe-${gameId}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'online_games', filter: `id=eq.${gameId}` }, (payload) => {
    received.push({ at: Date.now(), ver: payload.new?.version, moves: payload.new?.moves?.length });
  })
  .subscribe((status) => {
    console.log('channel status:', status);
    if (status === 'SUBSCRIBED') subscribed = true;
  });

for (let i = 0; i < 40 && !subscribed; i++) await new Promise((r) => setTimeout(r, 250));
console.log('subscribed:', subscribed);

const t0 = Date.now();
const mv = await fn(A.token, 'make-move', { gameId, moveId: crypto.randomUUID(), from: 'e2', to: 'e4' });
console.log('move:', mv.status, mv.payload.applied);
for (let i = 0; i < 20 && received.length === 0; i++) await new Promise((r) => setTimeout(r, 250));
console.log('events received:', JSON.stringify(received), 'latency:', received.length ? Date.now() - t0 + 'ms' : 'NONE');
await B.sb.removeChannel(ch);
process.exit(0);
