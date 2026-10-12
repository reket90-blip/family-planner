-- Family Planner: private per-user data model.
-- Run this only in the dedicated Family Planner Supabase project, never in My Garage.
-- The app uses Supabase Auth; no anonymous/public access is granted.

create extension if not exists pgcrypto;

create table if not exists public.planner_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 180),
  category text not null default 'task'
    check (category in ('task', 'family', 'clinic', 'payment', 'meter', 'reminder')),
  event_date date not null,
  event_time time,
  notes text not null default '' check (char_length(notes) <= 2000),
  done boolean not null default false,
  recurrence text not null default 'none'
    check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists planner_items_user_date_idx
  on public.planner_items (user_id, event_date, event_time);

create table if not exists public.planner_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pregnancy_start date,
  due_date date,
  timezone text not null default 'Asia/Novosibirsk',
  notifications_enabled boolean not null default false,
  telegram_chat_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planner_settings_dates_check
    check (pregnancy_start is null or due_date is null or due_date >= pregnancy_start)
);

create or replace function public.planner_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function public.planner_set_updated_at() from public, anon, authenticated;

drop trigger if exists planner_items_set_updated_at on public.planner_items;
create trigger planner_items_set_updated_at
before update on public.planner_items
for each row execute function public.planner_set_updated_at();

drop trigger if exists planner_settings_set_updated_at on public.planner_settings;
create trigger planner_settings_set_updated_at
before update on public.planner_settings
for each row execute function public.planner_set_updated_at();

alter table public.planner_items enable row level security;
alter table public.planner_settings enable row level security;

-- Explicit grants are required for Supabase projects created with the newer
-- "do not automatically expose new tables" default. RLS still restricts every row.
revoke all on table public.planner_items from anon, authenticated;
revoke all on table public.planner_settings from anon, authenticated;
grant select, insert, update, delete on table public.planner_items to authenticated;
grant select, insert, update, delete on table public.planner_settings to authenticated;

drop policy if exists "users read own planner items" on public.planner_items;
create policy "users read own planner items"
on public.planner_items for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "users insert own planner items" on public.planner_items;
create policy "users insert own planner items"
on public.planner_items for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "users update own planner items" on public.planner_items;
create policy "users update own planner items"
on public.planner_items for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "users delete own planner items" on public.planner_items;
create policy "users delete own planner items"
on public.planner_items for delete to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "users read own planner settings" on public.planner_settings;
create policy "users read own planner settings"
on public.planner_settings for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "users insert own planner settings" on public.planner_settings;
create policy "users insert own planner settings"
on public.planner_settings for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "users update own planner settings" on public.planner_settings;
create policy "users update own planner settings"
on public.planner_settings for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- No anonymous policies or grants. Keep sign-up disabled in Auth and create the
-- spouse's account explicitly in the Supabase dashboard before enabling cloud sync.
