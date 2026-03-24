create table if not exists public.mentor_daily_priorities (
  id uuid default gen_random_uuid() primary key,
  project_id uuid not null,
  user_id uuid not null,
  priority_text text not null,
  date date not null,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id, date)
);

create index if not exists mentor_daily_priorities_lookup_idx
  on public.mentor_daily_priorities (project_id, user_id, date);

drop trigger if exists set_mentor_daily_priorities_updated_at on public.mentor_daily_priorities;
create trigger set_mentor_daily_priorities_updated_at
before update on public.mentor_daily_priorities
for each row execute procedure public.set_updated_at_timestamp();

create table if not exists public.mentor_health_metrics (
  id uuid default gen_random_uuid() primary key,
  project_id uuid not null,
  user_id uuid not null,
  metric text not null,
  status text not null check (status in ('green', 'yellow', 'red')),
  value text,
  notes text,
  recorded_at timestamptz default now()
);

create index if not exists mentor_health_metrics_lookup_idx
  on public.mentor_health_metrics (project_id, user_id, metric, recorded_at);
