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

drop policy if exists "users delete own planner settings" on public.planner_settings;
create policy "users delete own planner settings"
on public.planner_settings for delete to authenticated
using ((select auth.uid()) = user_id);


-- Server-scheduled Web Push reminders.
create extension if not exists pg_cron;
create extension if not exists pg_net;

alter table public.planner_items
  add column if not exists remind_before integer not null default 0
  check (remind_before in (0,10,30,60,1440,10080));

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on table public.push_subscriptions to authenticated;
drop policy if exists "users read own push subscriptions" on public.push_subscriptions;
create policy "users read own push subscriptions" on public.push_subscriptions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "users insert own push subscriptions" on public.push_subscriptions;
create policy "users insert own push subscriptions" on public.push_subscriptions for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "users update own push subscriptions" on public.push_subscriptions;
create policy "users update own push subscriptions" on public.push_subscriptions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "users delete own push subscriptions" on public.push_subscriptions;
create policy "users delete own push subscriptions" on public.push_subscriptions for delete to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.push_delivery_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid not null references public.planner_items(id) on delete cascade,
  scheduled_for timestamptz not null,
  delivered_at timestamptz,
  status text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  error text not null default '',
  created_at timestamptz not null default now(),
  unique (item_id, scheduled_for)
);
create index if not exists push_delivery_log_user_idx on public.push_delivery_log(user_id);
alter table public.push_delivery_log enable row level security;
revoke all on table public.push_delivery_log from anon, authenticated;
grant select on table public.push_delivery_log to authenticated;
drop policy if exists "users read own push delivery status" on public.push_delivery_log;
create policy "users read own push delivery status" on public.push_delivery_log for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.get_due_planner_reminders()
returns table (item_id uuid, user_id uuid, title text, category text, event_date date, event_time time, due_at timestamptz)
language sql stable set search_path = ''
as $$
  select i.id, i.user_id, i.title, i.category, i.event_date, i.event_time,
    ((i.event_date::timestamp + coalesce(i.event_time, time '09:00')) at time zone coalesce(s.timezone, 'Asia/Novosibirsk')) - make_interval(mins => i.remind_before)
  from public.planner_items as i
  left join public.planner_settings as s on s.user_id = i.user_id
  where i.done = false and i.remind_before > 0
    and (((i.event_date::timestamp + coalesce(i.event_time, time '09:00')) at time zone coalesce(s.timezone, 'Asia/Novosibirsk')) - make_interval(mins => i.remind_before)) <= pg_catalog.now()
    and (((i.event_date::timestamp + coalesce(i.event_time, time '09:00')) at time zone coalesce(s.timezone, 'Asia/Novosibirsk')) - make_interval(mins => i.remind_before)) > pg_catalog.now() - interval '90 seconds'
$$;
revoke all on function public.get_due_planner_reminders() from public, anon, authenticated;
grant execute on function public.get_due_planner_reminders() to service_role;

-- The three values are created in Supabase Vault, never committed to source control.
-- Names: family-planner-vapid-public, family-planner-vapid-private, family-planner-cron-secret.
create or replace function public.get_push_runtime_config()
returns table (public_key text, private_key text, cron_secret text)
language sql security definer set search_path = ''
as $$
  select
    max(s.decrypted_secret) filter (where s.name = 'family-planner-vapid-public'),
    max(s.decrypted_secret) filter (where s.name = 'family-planner-vapid-private'),
    max(s.decrypted_secret) filter (where s.name = 'family-planner-cron-secret')
  from vault.decrypted_secrets as s
  where s.name in ('family-planner-vapid-public','family-planner-vapid-private','family-planner-cron-secret')
$$;
revoke all on function public.get_push_runtime_config() from public, anon, authenticated;
grant execute on function public.get_push_runtime_config() to service_role;
