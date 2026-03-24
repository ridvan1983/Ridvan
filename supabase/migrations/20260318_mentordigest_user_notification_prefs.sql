create table if not exists public.user_notification_prefs (
  user_id uuid primary key,
  email_digest_enabled boolean not null default true,
  last_digest_sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Basic referential intent (may require auth schema permissions in your Supabase project)
-- alter table public.user_notification_prefs
--   add constraint user_notification_prefs_user_id_fkey
--   foreign key (user_id) references auth.users(id) on delete cascade;

create index if not exists user_notification_prefs_digest_enabled_idx
  on public.user_notification_prefs (email_digest_enabled);

create or replace function public.set_updated_at_timestamp()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_user_notification_prefs_updated_at on public.user_notification_prefs;
create trigger set_user_notification_prefs_updated_at
before update on public.user_notification_prefs
for each row execute procedure public.set_updated_at_timestamp();
