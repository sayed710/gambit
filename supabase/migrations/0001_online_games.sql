-- Online multiplayer — durable, server-authoritative game state.
-- Clients get SELECT-only (RLS: participants); every mutation happens
-- inside Edge Functions via the service role. See docs/online-multiplayer.md.

create table public.online_games (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- seats (auth.users ids; uuid null until the black seat is reserved)
  creator_id uuid not null references auth.users (id),
  white_id uuid references auth.users (id),
  black_id uuid references auth.users (id),
  white_name text not null default 'White',
  black_name text not null default 'Black',

  -- invitation: only the sha-256 HEX of the link token is stored
  invite_code_hash text not null,

  status text not null default 'waiting'
    check (status in ('waiting', 'ready', 'active', 'completed', 'abandoned')),

  -- selected time control (Fischer)
  base_ms integer not null check (base_ms between 60000 and 3600000),
  increment_ms integer not null check (increment_ms between 0 and 60000),

  -- authoritative game state
  start_fen text not null default 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  moves jsonb not null default '[]'::jsonb, -- [{san, from, to, fenAfter, moveId}]
  version integer not null default 1,       -- optimistic concurrency
  turn text not null default 'w' check (turn in ('w', 'b')),

  -- clocks (server-authoritative; clients only project these)
  white_ms_remaining integer not null,
  black_ms_remaining integer not null,
  increment_ms_applied boolean not null default true, -- reserved
  turn_started_at timestamptz,

  -- result
  result text check (result in ('white', 'black', 'draw')),
  result_reason text check (result_reason in
    ('checkmate', 'stalemate', 'insufficient', 'threefold', 'fifty-move', 'timeout', 'resignation', 'draw-agreed')),
  draw_offer_by uuid references auth.users (id),
  pgn text,

  last_move_id uuid -- idempotency: the id of the last accepted move command
);

-- invitation tokens are looked up only by hash (via edge functions)
create index online_games_invite_hash on public.online_games (invite_code_hash);
-- the last accepted move id per game: unique -> replayed commands collide
create unique index online_games_last_move on public.online_games (id, last_move_id)
  where last_move_id is not null;

alter table public.online_games enable row level security;

-- read: participants only (Realtime postgres_changes respects RLS, so
-- notification payloads are participant-scoped too)
create policy online_games_read_participants on public.online_games
  for select to authenticated
  using (auth.uid() = white_id or auth.uid() = black_id);

-- write: nobody. All mutations happen inside Edge Functions with the
-- service role, after their own authorization checks.
revoke insert, update, delete on public.online_games from authenticated;
revoke insert, update, delete on public.online_games from anon;
