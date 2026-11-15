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

-- Expiry adjudication with the DATABASE clock: the offer handler calls
-- this before inserting so the 10-minute window is measured by the same
-- clock as accept_rematch (never by a possibly-skewed Edge runtime).
create or replace function public.expire_stale_rematch(p_game_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.rematch_requests
  set status = 'expired', version = version + 1
  where game_id = p_game_id
    and status = 'pending'
    and created_at < now() - interval '10 minutes';
$$;

revoke all on function public.expire_stale_rematch(uuid) from public, anon, authenticated;
grant execute on function public.expire_stale_rematch(uuid) to service_role;

-- The acceptance transaction: ONE atomic unit that adjudicates the
-- pending request AND creates the swapped-color game. Row locks + the
-- per-creator advisory quota lock make concurrent acceptances resolve
-- to exactly one new game; the loser re-reads and gets the rematch id.
create or replace function public.accept_rematch(p_request_id uuid, p_acceptor uuid)
returns table (new_game_id uuid, new_token text)
language plpgsql
security definer
set search_path = public
as $$
declare
  req public.rematch_requests;
  old public.online_games;
  open_count integer;
  new_id uuid;
  raw_token text;
  new_token text;
  new_hash text;
begin
  -- lock the request row: concurrent acceptances serialize here
  select * into req from public.rematch_requests
    where id = p_request_id for update;
  if not found then
    raise exception 'NOT_FOUND';
  end if;
  if req.status <> 'pending' then
    raise exception 'NOT_PENDING';
  end if;
  if req.created_at < now() - interval '10 minutes' then
    -- adjudicate expired and return NULLs: a raise here would ROLL BACK
    -- the expiry update (the caller reads the request row to see it)
    update public.rematch_requests
      set status = 'expired', version = version + 1
      where id = req.id;
    return query select null::uuid, null::text;
    return;
  end if;

  -- lock the parent game: seats, colors and time control come from it
  select * into old from public.online_games
    where id = req.game_id for update;
  if old.status <> 'completed' then
    raise exception 'STATE';
  end if;
  -- only the NON-requester participant may accept
  if p_acceptor = req.requester_id
     or p_acceptor is distinct from old.white_id and p_acceptor is distinct from old.black_id then
    raise exception 'FORBIDDEN';
  end if;

  -- the acceptor becomes the creator of the new game: enforce their
  -- open-room quota atomically (same advisory lock as create-game),
  -- INCLUDING the 24h inactivity reclaim of stale rooms (same policy as
  -- create_online_game) — a guest with forgotten invitations can still
  -- accept a rematch
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
    old.black_id,          -- swapped seats
    old.white_id,
    old.black_name,        -- names swap with the seats
    old.white_name,
    new_hash,
    'ready',
    now(),
    old.base_ms,           -- original time control preserved
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
