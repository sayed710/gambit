/* Online multiplayer integration — REAL local Supabase backend.
   Two isolated anonymous identities exercise the full command surface:
   RLS isolation, invite join, third-participant rejection, server-side
   legality/turn/version/idempotency, resignation, draw agreement, and
   (with ONLINE_LONG=1) the 60-second timeout claim. */
import { createClient } from '@supabase/supabase-js';

const URL = 'http://127.0.0.1:54321';
const ANON =
  'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

async function guest() {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  return { sb, token: data.session.access_token, id: data.session.user.id };
}

async function fn(guestToken, name, body) {
  const res = await fetch(`${URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${guestToken}` },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  return { status: res.status, payload };
}

const A = await guest();
const B = await guest();
const C = await guest();
console.log('guests:', A.id.slice(0, 8), B.id.slice(0, 8), C.id.slice(0, 8));

/* 1 — create */
const create = await fn(A.token, 'create-game', { name: 'Alice', baseMs: 600000, incrementMs: 0, color: 'white' });
check('create-game returns token + id', create.status === 200 && create.payload.gameId && create.payload.token && create.payload.color === 'white');
const gameId = create.payload.gameId;
const token = create.payload.token;

/* 2 — RLS: B cannot read the game before joining */
const rlsRead = await B.sb.from('online_games').select('*').eq('id', gameId);
check('RLS: non-participant SELECT is empty', !rlsRead.error && (rlsRead.data?.length ?? 0) === 0);

/* 3 — RLS: direct UPDATE is rejected */
const rlsWrite = await B.sb.from('online_games').update({ status: 'completed', result: 'black' }).eq('id', gameId);
check('RLS: direct UPDATE rejected', rlsWrite.error !== null, rlsWrite.error?.message?.slice(0, 50));
const rlsInsert = await B.sb.from('online_games').insert({ creator_id: B.id, base_ms: 600000, increment_ms: 0 });
check('RLS: direct INSERT rejected', rlsInsert.error !== null);

/* 4 — B cannot make a move before joining */
const earlyMove = await fn(B.token, 'make-move', { gameId, moveId: crypto.randomUUID(), from: 'e7', to: 'e5' });
check('non-participant move rejected', earlyMove.status === 403 && earlyMove.payload.error?.code === 'forbidden');

/* 5 — B joins with the token */
const join = await fn(B.token, 'join-game', { token, name: 'Bob' });
check('join-game seats B as black + activates', join.status === 200 && join.payload.game?.black_id === B.id && join.payload.game?.status === 'active' && join.payload.game?.turn_started_at !== null);

/* 6 — B re-joining their own link is idempotent */
const rejoin = await fn(B.token, 'join-game', { token, name: 'Bob' });
check('seat owner rejoin is idempotent', rejoin.status === 200 && rejoin.payload.rejoined === true);

/* 7 — third participant rejected */
const third = await fn(C.token, 'join-game', { token, name: 'Eve' });
check('third participant rejected (room playing)', third.status === 409 && third.payload.error?.code === 'full');

/* 8 — A moves e4 */
const m1 = crypto.randomUUID();
const move1 = await fn(A.token, 'make-move', { gameId, moveId: m1, from: 'e2', to: 'e4' });
check('white e4 accepted', move1.status === 200 && move1.payload.applied === true && move1.payload.game?.moves?.length === 1);
check('clocks: white consumed time, turn = black', move1.payload.game?.turn === 'b' && move1.payload.game?.white_ms_remaining < 600000);

/* 9 — replay of the same command is a no-op */
const replay = await fn(A.token, 'make-move', { gameId, moveId: m1, from: 'e2', to: 'e4' });
check('replayed moveId is an idempotent no-op', replay.status === 200 && replay.payload.replay === true && replay.payload.game?.moves?.length === 1);

/* 10 — wrong-turn rejected */
const wrongTurn = await fn(A.token, 'make-move', { gameId, moveId: crypto.randomUUID(), from: 'd2', to: 'd4' });
check('wrong-turn move rejected', wrongTurn.status === 409 && wrongTurn.payload.error?.code === 'turn');

/* 11 — illegal move rejected (pawn capture from nothing) */
const illegal = await fn(B.token, 'make-move', { gameId, moveId: crypto.randomUUID(), from: 'e7', to: 'd6' });
check('illegal pawn move rejected', illegal.status === 409 && illegal.payload.error?.code === 'illegal');

/* 12 — black replies e5; history consistent */
const m2 = crypto.randomUUID();
const move2 = await fn(B.token, 'make-move', { gameId, moveId: m2, from: 'e7', to: 'e5' });
check('black e5 accepted', move2.status === 200 && move2.payload.applied === true);
check('history = 2 plies, position consistent', move2.payload.game?.moves?.length === 2 && move2.payload.game?.turn === 'w');

/* 13 — get-state visible to participants only */
const stateA = await fn(A.token, 'get-state', { gameId });
const stateC = await fn(C.token, 'get-state', { gameId });
check('get-state works for A', stateA.status === 200 && stateA.payload.game?.version >= 3);
check('get-state hides the game from C', stateC.status === 404);

/* 14 — draw offer by A; decline by B; accept path */
const offer = await fn(A.token, 'draw', { gameId, action: 'offer' });
check('draw offer set', offer.status === 200 && offer.payload.game?.draw_offer_by === A.id);
const acceptBySelf = await fn(A.token, 'draw', { gameId, action: 'accept' });
check('self-accept rejected', acceptBySelf.status === 409);
const decline = await fn(B.token, 'draw', { gameId, action: 'decline' });
check('opponent declines the offer', decline.status === 200 && decline.payload.game?.draw_offer_by === null);

/* 15 — B resigns */
const resign = await fn(B.token, 'resign', { gameId });
check('resignation completes the game', resign.status === 200 && resign.payload.game?.status === 'completed' && resign.payload.game?.result === 'white' && resign.payload.game?.result_reason === 'resignation');
check('PGN persisted on completion', typeof resign.payload.game?.pgn === 'string' && resign.payload.game.pgn.includes('1. e4 e5'));

/* 16 — completed game rejects further commands */
const afterEnd = await fn(A.token, 'make-move', { gameId, moveId: crypto.randomUUID(), from: 'd2', to: 'd4' });
check('moves after completion rejected', afterEnd.status === 409 && afterEnd.payload.error?.code === 'state');
const resignAgain = await fn(B.token, 'resign', { gameId });
check('resign after completion rejected', resignAgain.status === 409);

/* 17 — the second game: draw AGREED end (offer by A, accepted by B) */
const create2 = await fn(A.token, 'create-game', { name: 'Alice', baseMs: 600000, incrementMs: 2000, color: 'random' });
const join2 = await fn(B.token, 'join-game', { token: create2.payload.token, name: 'Bob' });
const g2 = join2.payload.game;
const white = g2.white_id === A.id ? A : B;
const black = g2.white_id === A.id ? B : A;
const mv = async (who, from, to, moveId) => fn(who.token, 'make-move', { gameId: g2.id, moveId, from, to });
await mv(white, 'e2', 'e4', crypto.randomUUID());
await mv(black, 'e7', 'e5', crypto.randomUUID());
const offer2 = await fn(white.token, 'draw', { gameId: g2.id, action: 'offer' });
const accept2 = await fn(black.token, 'draw', { gameId: g2.id, action: 'accept' });
check('agreed draw completes the game', offer2.status === 200 && accept2.status === 200 && accept2.payload.game?.result === 'draw' && accept2.payload.game?.result_reason === 'draw-agreed');

/* 18 — invitation reuse after completion */
const lateJoin = await fn(C.token, 'join-game', { token: token, name: 'Eve' });
check('invitation reuse after completion rejected', lateJoin.status === 409);

/* 19 — bad tokens */
const badJoin = await fn(C.token, 'join-game', { token: 'nonsense-token', name: 'Eve' });
check('unknown token rejected', badJoin.status === 404);

/* 20 — timeout claim (60s real wait — the honest path) */
if (process.env.ONLINE_LONG === '1') {
  const create3 = await fn(A.token, 'create-game', { name: 'Alice', baseMs: 60000, incrementMs: 0, color: 'white' });
  const join3 = await fn(B.token, 'join-game', { token: create3.payload.token, name: 'Bob' });
  const g3 = join3.payload.game;
  const early = await fn(A.token, 'claim-timeout', { gameId: g3.id });
  check('timeout claim rejected while clock alive', early.status === 409 && early.payload.error?.code === 'not-expired');
  await fn(A.token, 'make-move', { gameId: g3.id, moveId: crypto.randomUUID(), from: 'e2', to: 'e4' });
  console.log('waiting 62s for black\'s clock to flag…');
  await new Promise((r) => setTimeout(r, 62000));
  const claim = await fn(A.token, 'claim-timeout', { gameId: g3.id });
  if (!(claim.status === 200 && claim.payload.game?.result === 'white')) {
    console.log('CLAIM DIAG:', claim.status, JSON.stringify(claim.payload).slice(0, 400));
  }
  check('timeout claim wins on the server clock', claim.status === 200 && claim.payload.game?.result === 'white' && claim.payload.game?.result_reason === 'timeout');
  const lateMove = await fn(B.token, 'make-move', { gameId: g3.id, moveId: crypto.randomUUID(), from: 'e7', to: 'e5' });
  check('moves after the flag are rejected (game already adjudicated)', lateMove.status === 409 && ['timeout', 'state'].includes(lateMove.payload.error?.code));
} else {
  console.log('NOTE  timeout claim test skipped (set ONLINE_LONG=1)');
}

console.log(failures === 0 ? 'ONLINE INTEGRATION: ALL PASS' : `ONLINE INTEGRATION: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
