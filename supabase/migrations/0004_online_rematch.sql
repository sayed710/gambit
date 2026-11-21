-- Online rematch — post-game re-invite between the same two players.
--
-- Lifecycle: after a game is COMPLETED, either participant may OFFER a
-- rematch (one pending request per game — a partial unique index
-- enforces that atomically). The opponent may ACCEPT (a single
-- SECURITY DEFINER transaction adjudicates the request AND creates the
-- swapped-color game — no duplicate games under races) or DECLINE.
-- Requests expire after 10 minutes; declined/expired requests free the
-- slot for a fresh offer.
--
-- Trust boundaries match online_games: participants get SELECT-only via
-- RLS; all writes happen inside Edge Functions via the service role.

-- the invite token is generated from two builtin gen_random_uuid()s
-- (256 bits of secure randomness, hex-encoded — URL-safe without any
-- extension dependency; Supabase installs pgcrypto into a separate
-- schema that a public search_path would hide)

create table public.rematch_requests (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.online_games (id),
  requester_id uuid not null references auth.users (id),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'expired')),
  rematch_game_id uuid references public.online_games (id),
  created_at timestamptz not null default now(),
  version integer not null default 1
);

-- one PENDING request per game, enforced atomically by the database
create unique index rematch_one_pending_per_game
  on public.rematch_requests (game_id) where status = 'pending';

-- exactly ONE ACCEPTED rematch per original game (blocker-2): a second
-- acceptance for the same parent — concurrent or sequential — violates
-- this index and cannot branch another game. Declined/cancelled/expired
-- requests are exempt: re-offering after them stays possible.
create unique index rematch_one_accepted_per_game
  on public.rematch_requests (game_id) where status = 'accepted';

create index rematch_requests_game on public.rematch_requests (game_id);

alter table public.rematch_requests enable row level security;

-- read: participants of the parent game only (also scopes Realtime
-- events if the table is added to the publication)
create policy rematch_read_participants on public.rematch_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.online_games g
      where g.id = rematch_requests.game_id
        and (g.white_id = auth.uid() or g.black_id = auth.uid())
    )
  );

-- write: nobody from the client. All mutations happen inside Edge
-- Functions via the service role (or the SECURITY DEFINER accept fn).
revoke insert, update, delete on public.rematch_requests from authenticated;
revoke insert, update, delete on public.rematch_requests from anon;

-- Realtime: participants should learn when their pending request is
-- accepted/declined without polling.
alter publication supabase_realtime add table public.rematch_requests;

-- The OFFER, made atomic against acceptance by locking the parent game
-- row: the existence check for an already-accepted rematch and the
-- pending insert share that lock with accept_rematch, so an offer that
-- overlaps an acceptance can never insert a stray pending row that
-- would hide the accepted destination from the offerer's polling.
create or replace function public.offer_rematch(p_game_id uuid, p_requester uuid)
returns table (request_id uuid, rematch_game_id uuid) -- rematch_game_id NOT NULL = parent already rematched
language plpgsql
security definer
set search_path = public
as $$
declare
  old public.online_games;
  existing_accepted uuid;
  existing_pending uuid;
  new_id uuid;
begin
  -- LOCK ORDER (deadlock-free): the PARENT game row is locked FIRST in
  -- both offer_rematch and accept_rematch; every rematch_requests row
  -- lock is taken only afterwards, while holding the parent lock. The
  -- request's game_id never changes, so accept can locate the parent
  -- without locking the request row first.
  select * into old from public.online_games
    where id = p_game_id for update;
  if old.status <> 'completed' then
    raise exception 'STATE';
  end if;
  if p_requester is distinct from old.white_id and p_requester is distinct from old.black_id then
    raise exception 'FORBIDDEN';
  end if;

  -- adjudicate an expired pending request in THIS transaction (database
  -- clock): a never-touched expired offer frees the slot immediately,
  -- without waiting for the opponent to attempt acceptance
  update public.rematch_requests
    set status = 'expired', version = version + 1
    where game_id = old.id
      and status = 'pending'
      and created_at < now() - interval '10 minutes';

  -- blocker-2: at most one ACCEPTED rematch per parent — return the
  -- existing destination so the caller navigates there instead of
  -- branching a second game
  select id into existing_accepted from public.rematch_requests
    where game_id = old.id and status = 'accepted' limit 1;
  if existing_accepted is not null then
    return query
      select null::uuid, r.rematch_game_id
      from public.rematch_requests r
      where r.id = existing_accepted;
    return;
  end if;

  -- a live (non-expired) pending request exists: return it idempotently
  select id into existing_pending from public.rematch_requests
    where game_id = old.id and status = 'pending' limit 1;
  if existing_pending is not null then
    return query select existing_pending, null::uuid;
    return;
  end if;

  insert into public.rematch_requests (game_id, requester_id)
    values (p_game_id, p_requester) returning id into new_id;
  return query select new_id, null::uuid;
end $$;

revoke all on function public.offer_rematch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.offer_rematch(uuid, uuid) to service_role;

-- The acceptance transaction: ONE atomic unit that adjudicates the
-- pending request AND creates the swapped-color game. Row locks + the
-- per-creator advisory quota lock make concurrent acceptances resolve
-- to exactly one new game; the loser re-reads and gets the rematch id.
create or replace function public.accept_rematch(p_request_id uuid, p_acceptor uuid)
returns table (new_game_id uuid, new_token text) -- NULLs = the request was adjudicated expired
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
  old public.online_games;
  req public.rematch_requests;
  accepted_existing uuid;
  open_count integer;
  new_id uuid;
  -- new_token comes from RETURNS TABLE (an OUT parameter); the token
  -- hash needs its own local
  new_hash text;
begin
  -- LOCK ORDER (deadlock-free, identical to offer_rematch): the PARENT
  -- game row is locked FIRST (the request's game_id never changes, so
  -- locating it without a lock is safe), then the request row.
  select game_id into v_game_id from public.rematch_requests
    where id = p_request_id;
  if v_game_id is null then
    raise exception 'NOT_FOUND';
  end if;
  select * into old from public.online_games
    where id = v_game_id for update;
  select * into req from public.rematch_requests
    where id = p_request_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if old.status <> 'completed' then
    raise exception 'STATE';
  end if;
  -- only the NON-requester participant may accept
  if p_acceptor = req.requester_id
     or p_acceptor is distinct from old.white_id and p_acceptor is distinct from old.black_id then
    raise exception 'FORBIDDEN';
  end if;

  -- blocker-2: exactly one accepted rematch per parent. A concurrent or
  -- earlier acceptance returns its destination idempotently; a stale
  -- pending request (10-minute window) is adjudicated expired and the
  -- acceptance is refused — with NO game created either way.
  select id into accepted_existing from public.rematch_requests
    where game_id = old.id and status = 'accepted' and id <> req.id limit 1;
  if accepted_existing is not null then
    return query
      select r.rematch_game_id, null::text
      from public.rematch_requests r
      where r.id = accepted_existing;
    return;
  end if;
  if req.status <> 'pending' then
    raise exception 'NOT_PENDING';
  end if;
  if req.created_at < now() - interval '10 minutes' then
    update public.rematch_requests
      set status = 'expired', version = version + 1
      where id = req.id;
    return query select null::uuid, null::text;
    return;
  end if;

  -- the acceptor becomes the creator of the new game: enforce their
  -- open-room quota atomically (same advisory lock as create-game),
  -- including the 24h inactivity reclaim of stale rooms
  perform pg_advisory_xact_lock(hashtextextended(p_acceptor::text, 0));
  update public.online_games
  set status = 'abandoned', version = version + 1, updated_at = now()
  where creator_id = p_acceptor
    and status in ('waiting', 'ready')
    and updated_at < now() - interval '24 hours';
  select count(*) into open_count from public.online_games
    where creator_id = p_acceptor
      and status in ('waiting', 'ready', 'active');
  if open_count >= 8 then
    raise exception 'QUOTA_EXCEEDED';
  end if;

  -- colors swap: old black -> new white, old white -> new black
  new_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  new_hash := encode(sha256(convert_to(new_token, 'utf8')), 'hex');

  -- both seats are pre-filled, so the room starts READY: the clocks
  -- begin only after both players acknowledge via the ready function
  insert into public.online_games (
    creator_id, white_id, black_id, white_name, black_name,
    invite_code_hash, status, ready_started_at, base_ms, increment_ms,
    white_ms_remaining, black_ms_remaining, turn
  ) values (
    p_acceptor,
    old.black_id,
    old.white_id,
    old.black_name,
    old.white_name,
    new_hash,
    'ready',
    now(),
    old.base_ms,
    old.increment_ms,
    old.base_ms,
    old.base_ms,
    'w'
  ) returning id into new_id;

  update public.rematch_requests
    set status = 'accepted', rematch_game_id = new_id, version = version + 1
    where id = req.id;

  return query select new_id, new_token;
end $$;

revoke all on function public.accept_rematch(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_rematch(uuid, uuid) to service_role;
