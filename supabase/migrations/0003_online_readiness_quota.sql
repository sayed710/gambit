-- Readiness protocol (F8) + atomic open-room quota (F4).
--
-- F8: join-game flips waiting -> READY (not active). The clock starts
-- ONLY when both players have acknowledged readiness on the server —
-- white_ready/black_ready — via the `ready` Edge Function, which
-- stamps turn_started_at from the SERVER clock in one CAS write. No
-- client-supplied timestamps ever enter the clock.
--
-- F4: the open-room quota is enforced by create_online_game(), a
-- SECURITY DEFINER function that takes a per-creator transaction
-- advisory lock (pg_advisory_xact_lock), counts ALL open rooms
-- (waiting/ready/active, regardless of age) and inserts in the SAME
-- transaction — concurrent creates by one identity serialize; the
-- quota can never be exceeded. Policy: a creator may hold at most 8
-- open rooms; stale unused rooms are reclaimed by the 24-hour expiry
-- reconciliation (a room left waiting/ready for over 24h is abandoned
-- on the next join attempt) and by the creator's own cancel-game.

alter table public.online_games
  add column white_ready boolean not null default false,
  add column black_ready boolean not null default false,
  add column ready_started_at timestamptz;

-- F4 — atomic quota + insert in one transaction
create or replace function public.create_online_game(
  p_creator uuid,
  p_white_id uuid,
  p_black_id uuid,
  p_white_name text,
  p_black_name text,
  p_invite_hash text,
  p_base_ms integer,
  p_increment_ms integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  open_count integer;
  new_id uuid;
begin
  -- serialize concurrent creates by the SAME creator (cross-instance safe)
  perform pg_advisory_xact_lock(hashtextextended(p_creator::text, 0));

  -- reclaim the creator's OWN stale rooms first (24h expiry policy — the
  -- documented sweep point includes the creator's create attempt), so
  -- forgotten invitations cannot lock the guest out of the quota forever.
  -- version is bumped so any seated client reconciles the abandonment.
  update public.online_games
  set status = 'abandoned', version = version + 1, updated_at = now()
  where creator_id = p_creator
    and status in ('waiting', 'ready')
    and created_at < now() - interval '24 hours';

  select count(*) into open_count
  from public.online_games
  where creator_id = p_creator
    and status in ('waiting', 'ready', 'active'); -- no age cutoff: old open rooms count

  if open_count >= 8 then
    raise exception 'QUOTA_EXCEEDED';
  end if;

  insert into public.online_games (
    creator_id, white_id, black_id, white_name, black_name,
    invite_code_hash, status, base_ms, increment_ms,
    white_ms_remaining, black_ms_remaining, turn
  ) values (
    p_creator, p_white_id, p_black_id, p_white_name, p_black_name,
    p_invite_hash, 'waiting', p_base_ms, p_increment_ms,
    p_base_ms, p_base_ms, 'w'
  ) returning id into new_id;

  return new_id;
end $$;

revoke all on function public.create_online_game from public, anon, authenticated;
-- the Edge Functions call this through the service role: keep EXECUTE
-- explicit after the PUBLIC revoke (a plain revoke-from-public would
-- otherwise strip the only grant the functions rely on)
grant execute on function public.create_online_game(uuid, uuid, uuid, text, text, text, integer, integer) to service_role;
