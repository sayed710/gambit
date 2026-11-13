/* Minimal draw-offer probe. */
import { createClient } from '@supabase/supabase-js';
const URL_BASE = 'http://127.0.0.1:54321';
const ANON = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const mk = async () => {
  const sb = createClient(URL_BASE, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  return { token: data.session.access_token, id: data.session.user.id };
};
const fn = async (t, name, body) => {
  const res = await fetch(`${URL_BASE}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, payload: await res.json().catch(() => ({})) };
};
const A = await mk();
const B = await mk();
const create = await fn(A.token, 'create-game', { name: 'Alice', baseMs: 600000, incrementMs: 0, color: 'white' });
console.log('create:', create.status, JSON.stringify(create.payload).slice(0, 120));
const join = await fn(B.token, 'join-game', { token: create.payload.token, name: 'Bob' });
console.log('join:', join.status, join.payload.game?.status, 'v' + join.payload.game?.version);
// the readiness protocol: both players acknowledge before the game activates
const rA = await fn(A.token, 'ready', { gameId: (rB.payload.game ?? rA.payload.game ?? join.payload.game).id });
const rB = await fn(B.token, 'ready', { gameId: (rB.payload.game ?? rA.payload.game ?? join.payload.game).id });
console.log('ready:', rA.status, rA.payload.game?.status, '->', rB.status, rB.payload.game?.status);
const offer = await fn(A.token, 'draw', { gameId: (rB.payload.game ?? rA.payload.game ?? join.payload.game).id, action: 'offer' });
console.log('offer:', offer.status, JSON.stringify(offer.payload).slice(0, 300));
