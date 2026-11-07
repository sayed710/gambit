-- Realtime postgres_changes only streams tables in the supabase_realtime
-- publication — without this the game row's UPDATE events never reach
-- the subscribed clients.
alter publication supabase_realtime add table public.online_games;
