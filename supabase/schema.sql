-- RC Pit Wall shared sessions
-- Run this in Supabase SQL Editor.

create table if not exists public.pitwall_sessions (
  session_id text primary key check (session_id ~ '^[A-Z0-9]{6}$'),
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.pitwall_sessions enable row level security;

-- The six-character code is a session identifier, not a password.
-- These policies make the starter project easy to deploy for a club LAN/event.
-- For a public production deployment, replace these with authenticated membership RLS.
drop policy if exists "pitwall public read" on public.pitwall_sessions;
drop policy if exists "pitwall public insert" on public.pitwall_sessions;
drop policy if exists "pitwall public update" on public.pitwall_sessions;

create policy "pitwall public read"
on public.pitwall_sessions for select
using (true);

create policy "pitwall public insert"
on public.pitwall_sessions for insert
to anon
with check (true);

create policy "pitwall public update"
on public.pitwall_sessions for update
to anon
using (true)
with check (true);

alter table public.pitwall_sessions replica identity full;

-- Realtime database changes are used for the persistent session snapshot.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pitwall_sessions'
  ) then
    alter publication supabase_realtime add table public.pitwall_sessions;
  end if;
end $$;
