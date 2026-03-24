alter table public.mentor_messages
add column if not exists session_id uuid;

update public.mentor_messages
set session_id = coalesce(session_id, gen_random_uuid())
where session_id is null;

alter table public.mentor_messages
alter column session_id set not null;

create index if not exists mentor_messages_user_session_created_idx
  on public.mentor_messages (user_id, session_id, created_at);

create index if not exists mentor_messages_project_session_created_idx
  on public.mentor_messages (project_id, session_id, created_at);
