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

/** join + BOTH readiness acknowledgments — the game becomes active with
    the server-stamped turn_started_at (F8). Returns the active game. */
async function seatUp(creatorToken, joinerToken, token, joinerName = 'Bob') {
  const j = await fn(joinerToken, 'join-game', { token, name: joinerName });
  if (j.status !== 200 || !j.payload.game) throw new Error(`join failed: ${j.status} ${JSON.stringify(j.payload).slice(0, 200)}`);
  const g = j.payload.game;
  if (g.status !== 'ready') throw new Error(`join did not reach ready: ${g.status}`);
  const r1 = await fn(creatorToken, 'ready', { gameId: g.id });
  if (r1.status !== 200) throw new Error(`creator ready failed: ${r1.status} ${JSON.stringify(r1.payload).slice(0, 200)}`);
  const r2 = await fn(joinerToken, 'ready', { gameId: g.id });
  if (r2.status !== 200) throw new Error(`joiner ready failed: ${r2.status} ${JSON.stringify(r2.payload).slice(0, 200)}`);
  const active = r2.payload.game.status === 'active' ? r2.payload.game : (r1.payload.game.status === 'active' ? r1.payload.game : null);
  if (!active) throw new Error(`readiness did not activate: ${JSON.stringify({ r1: r1.payload.game?.status, r2: r2.payload.game?.status })}`);
  return active;
}

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

/* 5 — B joins with the token -> READY (the clock does NOT start yet, F8) */
const join = await fn(B.token, 'join-game', { token, name: 'Bob' });
check('join-game seats B as black and reaches READY', join.status === 200 && join.payload.game?.black_id === B.id && join.payload.game?.status === 'ready');
check('F8: the clock has NOT started at join', join.payload.game?.turn_started_at === null && join.payload.game?.white_ms_remaining === 600000 && join.payload.game?.black_ms_remaining === 600000);

/* 5b — moves are refused while pregame; readiness activates the game */
const pregameMove = await fn(A.token, 'make-move', { gameId, moveId: crypto.randomUUID(), from: 'e2', to: 'e4' });
check('moves refused while the room is ready (pregame)', pregameMove.status === 409 && pregameMove.payload.error?.code === 'state');
const readyA = await fn(A.token, 'ready', { gameId });
check('creator readiness recorded, game still ready', readyA.status === 200 && readyA.payload.game?.white_ready === true && readyA.payload.game?.status === 'ready');
const readyB = await fn(B.token, 'ready', { gameId });
check('F8: second readiness ACTIVATES with a server-stamped clock',
  readyB.status === 200 && readyB.payload.activated === true && readyB.payload.game?.status === 'active'
  && typeof readyB.payload.game?.turn_started_at === 'string' && readyB.payload.game?.turn_started_at !== null);
const startedAt = new Date(readyB.payload.game.turn_started_at).getTime();
check('F8: turn_started_at is fresh (server clock, both present)', Math.abs(Date.now() - startedAt) < 30000, `delta=${Date.now() - startedAt}ms`);

/* 5c — duplicate readiness is idempotent; a ready command after
   activation reconciles instead of crashing */
const readyDup = await fn(A.token, 'ready', { gameId });
check('duplicate readiness after activation reconciles', readyDup.status === 200 && readyDup.payload.game?.status === 'active');

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
/* F1 — a finishing move whose response was LOST retries safely: the
   replayed moveId returns the authoritative completed game */
const safeRetry = await fn(A.token, 'make-move', { gameId, moveId: m1, from: 'e2', to: 'e4' });
check('F1: a replayed finishing move returns the authoritative completed game',
  safeRetry.status === 200 && safeRetry.payload.replay === true && safeRetry.payload.game?.status === 'completed',
  `status=${safeRetry.status} game=${safeRetry.payload.game?.status}`);
const resignAgain = await fn(B.token, 'resign', { gameId });
check('resign after completion rejected', resignAgain.status === 409);

/* 17 — the second game: draw AGREED end (offer by A, accepted by B) */
const create2 = await fn(A.token, 'create-game', { name: 'Alice', baseMs: 600000, incrementMs: 2000, color: 'random' });
const g2 = await seatUp(A.token, B.token, create2.payload.token);
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

const openRoomsFromRaces = [];
/* ============ F1 — cancel-versus-join race (deterministic) ============
   The creator's cancel and the opponent's join are fired CONCURRENTLY.
   Exactly one wins; in NO outcome does the room end up completed by
   resignation: the creator is never forfeited by a stale cancel click. */
{
  for (let round = 0; round < 4; round++) {
    const c = await fn(A.token, 'create-game', { name: 'Alice', baseMs: 600000, incrementMs: 0, color: 'random' });
    if (c.status !== 200) { check(`cancel-vs-join round ${round}: create`, false, JSON.stringify(c.payload).slice(0, 120)); break; }
    openRoomsFromRaces.push(c.payload.gameId);
    const [cancelRes, joinRes] = await Promise.all([
      fn(A.token, 'cancel-game', { gameId: c.payload.gameId }),
      fn(B.token, 'join-game', { token: c.payload.token, name: 'Bob' }),
    ]);
    // read the AUTHORITATIVE outcome
    const final = await fn(A.token, 'get-state', { gameId: c.payload.gameId });
    const g = final.payload.game;
    const cancelWon = cancelRes.status === 200;
    const joinWon = joinRes.status === 200;
    check(`cancel-vs-join round ${round}: exactly one side won`, cancelWon !== joinWon, `cancel=${cancelRes.status} join=${joinRes.status}`);
    if (cancelWon) {
      check(`cancel-vs-join round ${round}: room abandoned, B's join refused`,
        g?.status === 'abandoned' && !joinWon && joinRes.status >= 400, `status=${g?.status} join=${joinRes.status}`);
    } else {
      check(`cancel-vs-join round ${round}: room is LIVE with both seats — never forfeited`,
        (g?.status === 'active' || g?.status === 'ready')
        && g?.white_id !== null && g?.black_id !== null
        && g?.result === null && g?.result_reason === null,
        `status=${g?.status} reason=${g?.result_reason}`);
      check(`cancel-vs-join round ${round}: cancel refused with the authoritative game`,
        cancelRes.status === 409 && cancelRes.payload.error?.code === 'already-seated' && Boolean(cancelRes.payload.game));
      // both players acknowledge and play on — the creator was not dropped
      if (g?.status === 'ready') {
        const rA = await fn(A.token, 'ready', { gameId: g.id });
        const rB = await fn(B.token, 'ready', { gameId: g.id });
        check(`cancel-vs-join round ${round}: game activates after the refusal`, rA.status === 200 && rB.status === 200 && (rA.payload.game?.status === 'active' || rB.payload.game?.status === 'active'));
      }
    }
  }
}

/* ============ F2 — draw-offer lifecycle (documented policy) ============
   An offer stands until the OPPONENT accepts, declines, or declines
   implicitly BY MOVING. The offerer's own move does NOT withdraw it. */
{
  // game 1: A (white) offers on their turn; BLACK's move declines it
  const c1 = await fn(A.token, 'create-game', { name: 'Alice', baseMs: 600000, incrementMs: 0, color: 'white' });
  const g1 = await seatUp(A.token, B.token, c1.payload.token);
  const offer1 = await fn(A.token, 'draw', { gameId: g1.id, action: 'offer' });
  check('F2: white offers on their turn', offer1.status === 200 && offer1.payload.game?.draw_offer_by === A.id);
  // the OFFERER moves — per the documented policy the offer STANDS
  const offererMove = await fn(A.token, 'make-move', { gameId: g1.id, moveId: crypto.randomUUID(), from: 'e2', to: 'e4' });
  check('F2: the offerer\'s own move does NOT withdraw the offer',
    offererMove.status === 200 && offererMove.payload.game?.draw_offer_by === A.id, `offer=${offererMove.payload.game?.draw_offer_by}`);
  const oppMove = await fn(B.token, 'make-move', { gameId: g1.id, moveId: crypto.randomUUID(), from: 'e7', to: 'e5' });
  check('F2: the recipient\'s move DECLINES the standing offer',
    oppMove.status === 200 && oppMove.payload.game?.draw_offer_by === null, `offer=${oppMove.payload.game?.draw_offer_by}`);
  await fn(A.token, 'cancel-game', { gameId: g1.id }).catch(() => {}); // not cancellable (active) — B resigns instead
  await fn(B.token, 'resign', { gameId: g1.id });

  // game 2: full accept path BOTH colors (offer by black, accepted by white)
  const c3 = await fn(B.token, 'create-game', { name: 'Bob', baseMs: 600000, incrementMs: 0, color: 'black' });
  const g3b = await seatUp(B.token, A.token, c3.payload.token, 'Alice');
  const blackG = g3b.black_id === B.id ? B : A;
  const whiteGuest2 = g3b.white_id === A.id ? A : B;
  await fn(whiteGuest2.token, 'make-move', { gameId: g3b.id, moveId: crypto.randomUUID(), from: 'e2', to: 'e4' });
  const offer3 = await fn(B.token, 'draw', { gameId: g3b.id, action: 'offer' });
  check('F2: black offers — the offer stands for white', offer3.status === 200 && offer3.payload.game?.draw_offer_by === B.id);
  const accept3 = await fn(A.token, 'draw', { gameId: g3b.id, action: 'accept' });
  check('F2: white accepts black\'s offer — draw-agreed both colors',
    accept3.status === 200 && accept3.payload.game?.status === 'completed' && accept3.payload.game?.result === 'draw' && accept3.payload.game?.result_reason === 'draw-agreed');

  // race: offer and accept fired concurrently by opposite sides
  const c4 = await fn(A.token, 'create-game', { name: 'Alice', baseMs: 600000, incrementMs: 0, color: 'white' });
  const g4 = await seatUp(A.token, B.token, c4.payload.token);
  await fn(A.token, 'make-move', { gameId: g4.id, moveId: crypto.randomUUID(), from: 'e2', to: 'e4' });
  const [offer4, accept4] = await Promise.all([
    fn(A.token, 'draw', { gameId: g4.id, action: 'offer' }),
    fn(B.token, 'draw', { gameId: g4.id, action: 'accept' }),
  ]);
  const final4 = await fn(A.token, 'get-state', { gameId: g4.id });
  const g4f = final4.payload.game;
  check('F2 race: coherent outcome (draw-agreed OR a standing offer)',
    (g4f?.status === 'completed' && g4f?.result === 'draw' && g4f?.result_reason === 'draw-agreed')
    || (g4f?.status === 'active' && (g4f?.draw_offer_by === A.id || g4f?.draw_offer_by === null)),
    `status=${g4f?.status} offer=${g4f?.draw_offer_by ? 'set' : 'none'}`);
  if (g4f?.status !== 'completed') {
    await fn(B.token, 'resign', { gameId: g4.id });
  }
}

/* ============ F3 — malformed payloads get 4xx, never 5xx ============ */
{
  const mk = await fn(A.token, 'create-game', { name: 'Alice', baseMs: 600000, incrementMs: 0, color: 'white' });
  const gid = mk.payload.gameId;
  const bad = async (name, body, token = A.token) => {
    const res = await fetch(`${URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    return { status: res.status, payload };
  };
  const cases = [
    ['create-game: name is a number', 'create-game', { name: 5, baseMs: 600000, incrementMs: 0 }],
    ['create-game: name is an array', 'create-game', { name: ['x'], baseMs: 600000, incrementMs: 0 }],
    ['create-game: baseMs is a string', 'create-game', { baseMs: '600000', incrementMs: 0 }],
    ['create-game: baseMs is null', 'create-game', { baseMs: null, incrementMs: 0 }],
    ['create-game: color is a number', 'create-game', { baseMs: 600000, incrementMs: 0, color: 7 }],
    ['create-game: body is an array', 'create-game', [1, 2, 3]],
    ['create-game: body is null', 'create-game', 'null'],
    ['create-game: name 10000 chars', 'create-game', { name: 'x'.repeat(10000), baseMs: 600000, incrementMs: 0 }],
    ['join-game: token is a number', 'join-game', { token: 5, name: 'Bob' }],
    ['join-game: token is an object', 'join-game', { token: { a: 1 }, name: 'Bob' }],
    ['join-game: token 10000 chars', 'join-game', { token: 'x'.repeat(10000), name: 'Bob' }],
    ['join-game: name is a number', 'join-game', { token: 'anything-here', name: 9 }],
    ['make-move: gameId is not a uuid', 'make-move', { gameId: 'not-a-uuid', moveId: crypto.randomUUID(), from: 'e2', to: 'e4' }],
    ['make-move: moveId is a number', 'make-move', { gameId: gid, moveId: 5, from: 'e2', to: 'e4' }],
    ['make-move: from is a number', 'make-move', { gameId: gid, moveId: crypto.randomUUID(), from: 7, to: 'e4' }],
    ['make-move: promotion invalid', 'make-move', { gameId: gid, moveId: crypto.randomUUID(), from: 'e2', to: 'e4', promotion: 'x' }],
    ['make-move: promotion is a number (never defaults to queen)', 'make-move', { gameId: gid, moveId: crypto.randomUUID(), from: 'e2', to: 'e4', promotion: 123 }],
    ['make-move: promotion multi-char', 'make-move', { gameId: gid, moveId: crypto.randomUUID(), from: 'e2', to: 'e4', promotion: 'qroxn' }],
    ['resign: gameId is not a uuid', 'resign', { gameId: 'abc' }],
    ['resign: gameId is a number', 'resign', { gameId: 12 }],
    ['cancel-game: gameId is not a uuid', 'cancel-game', { gameId: 'xyz' }],
    ['draw: action is a number', 'draw', { gameId: gid, action: 5 }],
    ['draw: action is unknown', 'draw', { gameId: gid, action: 'resign' }],
    ['claim-timeout: gameId missing', 'claim-timeout', {}],
    ['get-state: gameId is not a uuid', 'get-state', { gameId: 'zzz' }],
    ['ready: gameId is not a uuid', 'ready', { gameId: 'qqq' }],
  ];
  let badFailures = 0;
  for (const [name, fnName, body] of cases) {
    const r = await bad(fnName, body);
    const ok = r.status >= 400 && r.status < 500;
    if (!ok) badFailures++;
    check(`F3: ${name} -> 4xx`, ok, `status=${r.status} code=${r.payload?.error?.code}`);
  }
  check('F3: every malformed payload rejected as a client error', badFailures === 0, `${badFailures} wrong`);
  const stillOk = await fn(A.token, 'get-state', { gameId: gid });
  check('F3: valid commands unaffected by the battery', stillOk.status === 200);
  await fn(A.token, 'cancel-game', { gameId: gid });
}

/* ============ F4 — the open-room quota is atomic ============ */
{
  // close every room the earlier suites left open (F1 rounds that the
  // join won are ACTIVE — the creator resigns their seat) so the flood
  // starts from a clean quota
  for (const gid of openRoomsFromRaces) {
    const st = await fn(A.token, 'get-state', { gameId: gid });
    const g = st.payload.game;
    if (!g) continue;
    if (g.status === 'waiting' || g.status === 'ready') {
      if (g.creator_id === A.id) await fn(A.token, 'cancel-game', { gameId: gid }).catch(() => {});
    } else if (g.status === 'active') {
      const seat = g.white_id === A.id ? A : B;
      await fn(seat.token, 'resign', { gameId: gid }).catch(() => {});
    }
  }
  // fire 10 concurrent creates with ONE identity — at most 8 may succeed
  const results = await Promise.all(
    Array.from({ length: 10 }, () => fn(A.token, 'create-game', { name: 'Flood', baseMs: 600000, incrementMs: 0, color: 'white' })),
  );
  const okCount = results.filter((r) => r.status === 200).length;
  const refused = results.filter((r) => r.status === 429);
  check('F4: concurrent flood admits at most 8', okCount <= 8, `admitted=${okCount}`);
  check('F4: the overflow is refused with rate-limit', refused.length === 10 - okCount && refused.every((r) => r.payload.error?.code === 'rate-limit'));
  let cancelled = 0;
  for (const r of results) {
    if (r.status === 200) {
      const c = await fn(A.token, 'cancel-game', { gameId: r.payload.gameId });
      if (c.status === 200) cancelled++;
    }
  }
  check('F4: the creator can cancel every admitted room afterwards', cancelled === okCount, `cancelled=${cancelled}/${okCount}`);
}


/* ============ F1r — rule-driven draws store an explicit result ============ */
{
  const c = await fn(A.token, 'create-game', { name: 'Alice', baseMs: 600000, incrementMs: 0, color: 'white' });
  const g = await seatUp(A.token, B.token, c.payload.token);
  // knight shuffle: the starting position occurs a third time -> threefold
  const squares = [
    ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
    ['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8'],
  ];
  for (let i = 0; i < squares.length; i++) {
    const who = i % 2 === 0 ? A : B;
    await fn(who.token, 'make-move', { gameId: g.id, moveId: crypto.randomUUID(), from: squares[i][0], to: squares[i][1] });
  }
  const final = await fn(A.token, 'get-state', { gameId: g.id });
  const gf = final.payload.game;
  check('F1r: threefold repetition completes the game as a DRAW',
    gf?.status === 'completed' && gf?.result === 'draw' && gf?.result_reason === 'threefold',
    `result=${gf?.result}/${gf?.result_reason}`);
}

/* 20 — expiry adjudication policy (63s real wait — the honest path).
   All expiry scenarios share ONE wait: five games start, the clocks run
   down together, and every command shape is then asserted against the
   shared policy (serverRules). */
const LONG = process.env.ONLINE_LONG === '1'; // multiplayer job: includes the 62s timeout waits
// the database job sets ONLINE_SKIP_TIMEOUT=1: it runs the RLS/authorization
// portion only (the timeout adjudication lives in the multiplayer job)
if (LONG) {
  // seven games: B (black) will flag in all of them
  const ids = [];
  for (let i = 0; i < 7; i++) {
    // B creates (A's open-room quota is spent by the earlier checks);
    // B takes Black, A joins into the White seat, both acknowledge ready
    const c = await fn(B.token, 'create-game', { name: 'Bob', baseMs: 60000, incrementMs: 0, color: 'black' });
    if (c.status !== 200 || !c.payload.gameId) { console.log('CREATE FAIL:', c.status, JSON.stringify(c.payload).slice(0, 160)); break; }
    let g;
    try {
      g = await seatUp(B.token, A.token, c.payload.token, 'Alice');
    } catch (e) {
      console.log('SEATUP FAIL:', String(e).slice(0, 200));
      break;
    }
    ids.push(g.id);
    // white's first move starts black's clock
    const whiteGuest = g.white_id === A.id ? A : B;
    await fn(whiteGuest.token, 'make-move', { gameId: g.id, moveId: crypto.randomUUID(), from: 'e2', to: 'e4' });
  }
  // T3's draw offer is placed NOW (pre-expiry) and stays pending into
  // the expiry window — the acceptance must not override the flag fall
  const preExpiryOffer = await fn(A.token, 'draw', { gameId: ids[3], action: 'offer' });
  check('pre-expiry draw offer accepted while clock alive', preExpiryOffer.status === 200 && preExpiryOffer.payload.game?.draw_offer_by === A.id);
  // a legal black move BEFORE expiry is accepted normally (g0 — white
  // becomes the flagged side there; used only for this positive check)
  const earlyMove = await fn(B.token, 'make-move', { gameId: ids[0], moveId: crypto.randomUUID(), from: 'e7', to: 'e5' });
  check('move inside the remaining time accepted', earlyMove.status === 200 && earlyMove.payload.applied === true);
  console.log('waiting 63s for the five clocks to flag…');
  await new Promise((r) => setTimeout(r, 63000));

  // T1 — expired player attempts a move (B is flagged on g1)
  const expiredMove = await fn(B.token, 'make-move', { gameId: ids[1], moveId: crypto.randomUUID(), from: 'e7', to: 'e5' });
  check('expired player\'s move adjudicated (white wins, not applied)',
    expiredMove.status === 409 && expiredMove.payload.error?.code === 'timeout' && expiredMove.payload.game?.status === 'completed' && expiredMove.payload.game?.result === 'white');

  // T2 — expired player offers a draw
  const expiredOffer = await fn(B.token, 'draw', { gameId: ids[2], action: 'offer' });
  check('expired player\'s draw offer → timeout adjudication (white wins)',
    expiredOffer.status === 200 && expiredOffer.payload.adjudicated === true && expiredOffer.payload.game?.result === 'white' && expiredOffer.payload.game?.result_reason === 'timeout');

  // T3 — accepting a draw offer that was pending BEFORE the deadline:
  // the expiry reconciliation must win over the stale acceptance
  // (the pending offer was placed pre-expiry in the setup loop below)
  const lateAccept = await fn(B.token, 'draw', { gameId: ids[3], action: 'accept' });
  check('draw acceptance after deadline → timeout adjudication (white wins)',
    lateAccept.status === 200 && lateAccept.payload.adjudicated === true && lateAccept.payload.game?.result === 'white' && lateAccept.payload.game?.result_reason === 'timeout');
  // and a fresh post-expiry offer cannot resurrect a completed game
  const lateOffer = await fn(A.token, 'draw', { gameId: ids[3], action: 'offer' });
  check('draw offer on the adjudicated game is rejected (state)',
    lateOffer.status === 409 && lateOffer.payload.error?.code === 'state');

  // T4 — flagged player resigns after the deadline
  const lateResign = await fn(B.token, 'resign', { gameId: ids[4] });
  check('flagged player\'s resignation → timeout adjudication (white wins)',
    lateResign.status === 200 && lateResign.payload.adjudicated === true && lateResign.payload.game?.result === 'white' && lateResign.payload.game?.result_reason === 'timeout');

  // T5 — concurrent claim (A) + resignation (B): the outcome is read
  // from the AUTHORITATIVE state, never from a racing response body
  const [claimX, resignX] = await Promise.all([
    fn(A.token, 'claim-timeout', { gameId: ids[5] }),
    fn(B.token, 'resign', { gameId: ids[5] }),
  ]);
  const t5 = await fn(A.token, 'get-state', { gameId: ids[5] });
  const t5g = t5.payload.game;
  check('F5/T5 claim+resign: ONE committed outcome — timeout, white wins',
    t5g?.status === 'completed' && t5g?.result === 'white' && t5g?.result_reason === 'timeout',
    `status=${t5g?.status} result=${t5g?.result}/${t5g?.result_reason}`);
  check('F5/T5: the losing resignation did NOT overwrite the adjudication',
    t5g?.result_reason !== 'resignation');
  const preT5Ply = 1; // white's e4 from the setup
  check('F5/T5: the flagged side\'s resignation added no moves',
    (t5g?.moves?.length ?? 0) === preT5Ply, `plies=${t5g?.moves?.length}`);

  // T6 — concurrent claim (A) + move (B): same authoritative read
  const [claim2, moveB] = await Promise.all([
    fn(A.token, 'claim-timeout', { gameId: ids[6] }),
    fn(B.token, 'make-move', { gameId: ids[6], moveId: crypto.randomUUID(), from: 'e7', to: 'e5' }),
  ]);
  const t6 = await fn(A.token, 'get-state', { gameId: ids[6] });
  const t6g = t6.payload.game;
  check('F5/T6 claim+move: ONE committed outcome — timeout, white wins',
    t6g?.status === 'completed' && t6g?.result === 'white' && t6g?.result_reason === 'timeout',
    `status=${t6g?.status} result=${t6g?.result}/${t6g?.result_reason}`);
  check('F5/T6: the flagged side\'s late move never applied',
    (t6g?.moves?.length ?? 0) === preT5Ply, `plies=${t6g?.moves?.length}`);


  /* 20b — timeout claim end-to-end (fresh game, honest 63s path) */
  const create3 = await fn(A.token, 'create-game', { name: 'Alice', baseMs: 60000, incrementMs: 0, color: 'white' });
  const g3 = await seatUp(A.token, B.token, create3.payload.token);
  const early = await fn(A.token, 'claim-timeout', { gameId: g3.id });
  check('timeout claim rejected while clock alive', early.status === 409 && early.payload.error?.code === 'not-expired');
  await fn(A.token, 'make-move', { gameId: g3.id, moveId: crypto.randomUUID(), from: 'e2', to: 'e4' });
  console.log('waiting 63s for black\'s clock to flag…');
  await new Promise((r) => setTimeout(r, 63000));
  const claim = await fn(A.token, 'claim-timeout', { gameId: g3.id });
  if (!(claim.status === 200 && claim.payload.game?.result === 'white')) {
    console.log('CLAIM DIAG:', claim.status, JSON.stringify(claim.payload).slice(0, 400));
  }
  check('timeout claim wins on the server clock', claim.status === 200 && claim.payload.game?.result === 'white' && claim.payload.game?.result_reason === 'timeout');
  const lateMove = await fn(B.token, 'make-move', { gameId: g3.id, moveId: crypto.randomUUID(), from: 'e7', to: 'e5' });
  check('moves after the flag are rejected (game already adjudicated)', lateMove.status === 409 && ['timeout', 'state'].includes(lateMove.payload.error?.code));
} else {
  console.log('NOTE  expiry adjudication suite skipped (set ONLINE_LONG=1)');
}

console.log(failures === 0 ? 'ONLINE INTEGRATION: ALL PASS' : `ONLINE INTEGRATION: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
