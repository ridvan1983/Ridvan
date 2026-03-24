alter table public.projects
  add column if not exists vercel_project_id text,
  add column if not exists custom_domain text;
