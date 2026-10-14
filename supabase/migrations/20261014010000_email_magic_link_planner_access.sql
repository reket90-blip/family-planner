-- Replace anonymous-only planner access with verified email-authenticated accounts.
-- Every table still enforces owner-only access through auth.uid() and RLS.
create or replace function public.is_planner_allowed_user()
returns boolean
language sql
stable
set search_path = ''
as $planner$
  select auth.uid() is not null
    and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
    and nullif(auth.jwt() ->> 'email', '') is not null
$planner$;
revoke all on function public.is_planner_allowed_user() from public, anon;
grant execute on function public.is_planner_allowed_user() to authenticated, service_role;
