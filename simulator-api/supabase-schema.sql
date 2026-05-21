create table if not exists public.sessions (
  id text primary key,
  scenario_id text not null,
  score integer not null default 0,
  snapshot_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.flights (
  id text primary key,
  carrier text not null,
  flight_no text not null,
  flight_date text not null,
  dep text not null,
  arr text not null,
  flight_time text not null,
  status text not null,
  aircraft text not null,
  controller text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.chat_messages (
  id text primary key,
  flight_label text not null,
  author text not null,
  text text not null,
  recipient text not null default 'Ramp',
  priority text not null default 'medium',
  status text not null default 'sent',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.flight_closures (
  id bigserial primary key,
  flight_label text not null,
  signature_data text not null,
  closed_by text,
  closed_device text,
  closed_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.flight_closures
  add column if not exists closed_device text;

create table if not exists public.user_roles (
  email text primary key,
  role text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);
alter table public.user_roles disable row level security;

create index if not exists sessions_updated_at_idx on public.sessions (updated_at desc);
create index if not exists flights_sort_idx on public.flights (flight_date desc, flight_time desc, created_at desc);
create index if not exists chat_messages_flight_created_idx on public.chat_messages (flight_label, created_at desc);
create unique index if not exists flight_closures_flight_label_uq on public.flight_closures (flight_label);
create index if not exists flight_closures_closed_at_idx on public.flight_closures (closed_at desc);
create index if not exists user_roles_role_idx on public.user_roles (role);
