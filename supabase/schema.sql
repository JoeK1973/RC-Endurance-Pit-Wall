create extension if not exists "pgcrypto";

create table if not exists race_sessions (
 id uuid primary key default gen_random_uuid(),
 session_code text unique not null,
 name text not null default 'RC Endurance Race',
 created_at timestamptz not null default now()
);
create table if not exists races (
 id uuid primary key default gen_random_uuid(),
 session_id uuid unique not null references race_sessions(id) on delete cascade,
 duration_seconds integer not null default 14400,
 status text not null default 'idle' check(status in ('idle','running','paused','finished')),
 started_at timestamptz, paused_at timestamptz,
 accumulated_pause_seconds integer not null default 0,
 current_driver_id uuid,
 current_stint_started_at timestamptz,
 created_at timestamptz not null default now()
);
create table if not exists drivers (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references race_sessions(id) on delete cascade,
 name text not null, active boolean not null default true, created_at timestamptz not null default now()
);
alter table races drop constraint if exists races_current_driver_fk;
alter table races add constraint races_current_driver_fk foreign key(current_driver_id) references drivers(id) on delete set null;
create table if not exists driver_queue (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references race_sessions(id) on delete cascade,
 driver_id uuid not null references drivers(id) on delete cascade,
 position integer not null,
 unique(session_id,driver_id)
);
create table if not exists race_events (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references race_sessions(id) on delete cascade,
 event_type text not null,
 outgoing_driver_id uuid references drivers(id) on delete set null,
 incoming_driver_id uuid references drivers(id) on delete set null,
 created_at timestamptz not null default now(),
 metadata jsonb not null default '{}'::jsonb
);

create or replace function create_race_session()
returns race_sessions
language plpgsql security definer
set search_path = public
as $$
declare c text; s race_sessions;
begin
 loop
   c := array_to_string(array[
     substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',floor(random()*32+1)::int,1),
     substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',floor(random()*32+1)::int,1),
     substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',floor(random()*32+1)::int,1),
     substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',floor(random()*32+1)::int,1),
     '-',
     substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',floor(random()*32+1)::int,1),
     substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',floor(random()*32+1)::int,1),
     substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',floor(random()*32+1)::int,1),
     substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',floor(random()*32+1)::int,1)
   ],'');
   begin
     insert into race_sessions(session_code) values(c) returning * into s;
     insert into races(session_id) values(s.id);
     return s;
   exception when unique_violation then
   end;
 end loop;
end $$;

alter table race_sessions enable row level security;
alter table races enable row level security;
alter table drivers enable row level security;
alter table driver_queue enable row level security;
alter table race_events enable row level security;

drop policy if exists "prototype sessions" on race_sessions;
drop policy if exists "prototype races" on races;
drop policy if exists "prototype drivers" on drivers;
drop policy if exists "prototype queue" on driver_queue;
drop policy if exists "prototype events" on race_events;
create policy "prototype sessions" on race_sessions for all using(true) with check(true);
create policy "prototype races" on races for all using(true) with check(true);
create policy "prototype drivers" on drivers for all using(true) with check(true);
create policy "prototype queue" on driver_queue for all using(true) with check(true);
create policy "prototype events" on race_events for all using(true) with check(true);

grant execute on function create_race_session() to anon, authenticated;
do $$ begin
 alter publication supabase_realtime add table races;
 alter publication supabase_realtime add table drivers;
 alter publication supabase_realtime add table driver_queue;
exception when duplicate_object then null; end $$;
