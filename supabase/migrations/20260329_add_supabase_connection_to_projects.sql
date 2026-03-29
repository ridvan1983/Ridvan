alter table public.projects
  add column if not exists supabase_project_id text,
  add column if not exists supabase_project_url text,
  add column if not exists supabase_anon_key text,
  add column if not exists supabase_connected_at timestamptz;

create table if not exists public.user_supabase_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
