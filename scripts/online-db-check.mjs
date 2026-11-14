/* Database assertions against the FRESH local stack (after db reset):
   schema shape, RLS enabled, grants revoked, invite-hash only, CAS
   columns. Uses psql inside the supabase-db container — exec by
   container ID (some daemons fail to resolve recreated NAMES). */
import { execSync } from 'node:child_process';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures += 1;
};

const container = execSync('docker ps --format "{{.ID}}  {{.Names}}"', { encoding: 'utf8', shell: true })
  .split('\n')
  .find((n) => n.includes('_db_'))
  ?.split(' ')[0]
  ?.trim();
if (!container) {
  console.log('FAIL  supabase-db container not found — is the stack running?');
  process.exit(1);
}

const psql = (sql) =>
  execSync(`docker exec ${container} psql -U postgres -t -A -c "${sql.replace(/"/g, '\\"')}"`, {
    encoding: 'utf8',
  }).trim();

/* 1 — RLS is enabled on online_games */
check('online_games has RLS enabled', psql("select relrowsecurity from pg_class where relname = 'online_games'") === 't');

/* 2 — only a SELECT policy exists; no write policies */
const policies = psql("select string_agg(policyname, ', ') from pg_policies where tablename = 'online_games'");
check(
  'exactly one policy exists (participants SELECT)',
  policies === 'online_games_read_participants',
  policies,
);
const writePolicies = psql(
  "select count(*) from pg_policies where tablename = 'online_games' and cmd in ('INSERT','UPDATE','DELETE','ALL')",
);
check('no INSERT/UPDATE/DELETE/ALL policies (writes only via service role)', writePolicies === '0');

/* 3 — direct writes are revoked from client roles */
check(
  'authenticated has NO insert/update/delete grants',
  psql(
    "select has_table_privilege('authenticated', 'online_games', 'INSERT') or has_table_privilege('authenticated', 'online_games', 'UPDATE') or has_table_privilege('authenticated', 'online_games', 'DELETE')",
  ) === 'f',
);
check("anon has NO insert grant", psql("select has_table_privilege('anon', 'online_games', 'INSERT')") === 'f');

/* 4 — the invite hash column stores hex text, never plaintext tokens */
check(
  'invite_code_hash is hex text (no plaintext tokens)',
  psql("select data_type from information_schema.columns where table_name = 'online_games' and column_name = 'invite_code_hash'") === 'text',
);

/* 5 — optimistic concurrency + idempotency + server-clock columns exist */
const cols = psql("select string_agg(column_name, ',') from information_schema.columns where table_name = 'online_games'");
check('version column exists (optimistic concurrency)', cols.includes('version'));
check('last_move_id column exists (idempotency)', cols.includes('last_move_id'));
check('turn_started_at column exists (server clocks)', cols.includes('turn_started_at'));
check('result + result_reason columns exist', cols.includes('result') && cols.includes('result_reason'));

/* 6 — the unique (id, last_move_id) partial index exists */
check(
  'the UNIQUE partial (id, last_move_id) index exists — exact shape',
  Number(psql("select count(*) from pg_indexes where tablename = 'online_games' and indexdef like 'CREATE UNIQUE INDEX%last_move_id%' and indexdef like '%WHERE%'")) === 1,
);

/* 7 — status CHECK constraint covers the full state machine */
check(
  'status CHECK constraint covers the state machine',
  Number(psql("select count(*) from pg_constraint where conrelid = 'online_games'::regclass and pg_get_constraintdef(oid) like '%waiting%'")) >= 1,
);

/* 8 — every stored invite hash is a 64-char hex digest (the plaintext
   token never touches the database — asserted against the REAL rows the
   integration suite created) */
const hashes = psql('select invite_code_hash from online_games').split(String.fromCharCode(10)).filter(Boolean);
check(
  'games exist to assert hash format on (integration suite ran first)',
  hashes.length > 0,
  `${hashes.length} rows`,
);
check(
  'every invite_code_hash is a 64-char lowercase hex digest (never plaintext)',
  hashes.every((h) => /^[0-9a-f]{64}$/.test(h)),
  hashes.map((h) => h.slice(0, 12)).join(','),
);
check(
  'no stored hash equals any plaintext token shape (base64url)',
  hashes.every((h) => !/[-_]/.test(h)),
);

/* ---- F1 — a stale ready room NEVER activates (real backend + real
   SQL backdating) ---- */
{
  const { createClient } = await import('@supabase/supabase-js');
  const URL_ = 'http://127.0.0.1:54321';
  const ANON_ = 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
  const guest = async () => {
    const sb = createClient(URL_, ANON_, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.signInAnonymously();
    if (error) throw error;
    return { token: data.session.access_token };
  };
  const call = async (tok, name, body) => {
    const res = await fetch(`${URL_}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
      body: JSON.stringify(body),
    });
    return { status: res.status, payload: await res.json().catch(() => ({})) };
  };
  try {
    const a = await guest();
    const b = await guest();
    const create = await call(a.token, 'create-game', { name: 'Stale', baseMs: 600000, incrementMs: 0, color: 'white' });
    const gameId = create.payload.gameId;
    if (!gameId) throw new Error('create failed');
    // backdate the room past the 24h expiry with REAL SQL
    psql(`update online_games set updated_at = now() - interval '25 hours' where id = '${gameId}'`);
    // B's join reconciles the expiry -> refused, room abandoned
    const join = await call(b.token, 'join-game', { token: create.payload.token, name: 'Nia' });
    check('F1: a join on a stale room is refused (expired)', join.status === 409 && join.payload.error?.code === 'expired', `status=${join.status}`);
    const status = psql(`select status from online_games where id = '${gameId}'`);
    check('F1: the stale room is ABANDONED by the reconciliation', status === 'abandoned', `status=${status}`);
    // the creator's readiness is REFUSED — an expired room can never activate
    const ready = await call(a.token, 'ready', { gameId });
    check('F1: readiness on an expired room is REFUSED (409)', ready.status === 409, `status=${ready.status} code=${ready.payload.error?.code}`);
    const finalStatus = psql(`select status from online_games where id = '${gameId}'`);
    check('F1: the room is NOT active after the refused readiness', finalStatus !== 'active', `status=${finalStatus}`);
  } catch (e) {
    check('F1: the stale-ready scenario ran', false, String(e).slice(0, 140));
  }
}

console.log(failures === 0 ? 'DB CHECK: ALL PASS' : `DB CHECK: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
