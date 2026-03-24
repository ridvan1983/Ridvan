create table if not exists public.mentor_messages (
  id uuid default gen_random_uuid() primary key,
  project_id uuid not null,
  user_id uuid not null,
  role text not null check (role in ('user', 'mentor')),
  content text not null,
  created_at timestamptz default now()
);

create index if not exists mentor_messages_lookup_idx
  on public.mentor_messages (project_id, user_id, created_at);

create table if not exists public.mentor_unread (
  user_id uuid not null,
  project_id uuid not null,
  has_unread boolean default false,
  updated_at timestamptz default now(),
  primary key (user_id, project_id)
);

drop trigger if exists set_mentor_unread_updated_at on public.mentor_unread;
create trigger set_mentor_unread_updated_at
before update on public.mentor_unread
for each row execute procedure public.set_updated_at_timestamp();
