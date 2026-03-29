import type { DirectoryNode } from '@webcontainer/api';

const DEFAULT_SUPABASE_SCHEMA_SQL = `create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text,
  email text unique
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  description text,
  is_done boolean not null default false
);`;

export function buildSupabaseSetupSql() {
  return DEFAULT_SUPABASE_SCHEMA_SQL;
}
