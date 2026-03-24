alter table public.projects
  add column if not exists preview_url text,
  add column if not exists preview_build_hash text,
  add column if not exists preview_published_at timestamptz;
