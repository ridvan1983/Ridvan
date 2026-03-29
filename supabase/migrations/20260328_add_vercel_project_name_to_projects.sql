alter table public.projects
  add column if not exists vercel_project_name text;
