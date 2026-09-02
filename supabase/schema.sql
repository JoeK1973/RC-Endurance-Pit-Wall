create extension if not exists "pgcrypto";

create table if not exists races (
 id uuid primary key default gen_random_uuid(),
 name text not null default 'RC Endurance Race',
 duration_seconds integer not null default 14400,
 status text not null default 'idle' check (status in ('idle','running','paused','finished')),
 started_at timestamptz,
 paused_at timestamptz,
 accumulated_pause_seconds integer not null default 0,
 current_driver_id uuid,
 current_stint_started_at timestamptz,
 current_battery_started_at timestamptz,
 created_at timestamptz not null default now()
);

create table if not exists drivers (
 id uuid primary key default gen_random_uuid(),
 race_id uuid references races(id) on delete cascade not null,
 name text not null,
 active boolean not null default true,
 created_at timestamptz not null default now()
);

alter table races add constraint races_current_driver_fk foreign key (current_driver_id) references drivers(id) on delete set null;

create table if not exists driver_queue (
 id uuid primary key default gen_random_uuid(),
 race_id uuid references races(id) on delete cascade not null,
 driver_id uuid references drivers(id) on delete cascade not null,
 position integer not null,
 unique(race_id,driver_id),
 unique(race_id,position)
);

create table if not exists stints (
 id uuid primary key default gen_random_uuid(),
 race_id uuid references races(id) on delete cascade not null,
 driver_id uuid references drivers(id) on delete set null,
 kind text not null check (kind in ('driver','battery')),
 started_at timestamptz not null default now(),
 ended_at timestamptz,
 duration_seconds integer
);

create table if not exists race_events (
 id uuid primary key default gen_random_uuid(),
 race_id uuid references races(id) on delete cascade not null,
 event_type text not null,
 outgoing_driver_id uuid references drivers(id) on delete set null,
 incoming_driver_id uuid references drivers(id) on delete set null,
 created_at timestamptz not null default now(),
 metadata jsonb not null default '{}'::jsonb
);

alter table races enable row level security;
alter table drivers enable row level security;
alter table driver_queue enable row level security;
alter table stints enable row level security;
alter table race_events enable row level security;

-- Starter policies for a private prototype. Replace with authenticated team policies before public use.
create policy "prototype access races" on races for all using (true) with check (true);
create policy "prototype access drivers" on drivers for all using (true) with check (true);
create policy "prototype access queue" on driver_queue for all using (true) with check (true);
create policy "prototype access stints" on stints for all using (true) with check (true);
create policy "prototype access events" on race_events for all using (true) with check (true);

alter publication supabase_realtime add table races, drivers, driver_queue, stints, race_events;
