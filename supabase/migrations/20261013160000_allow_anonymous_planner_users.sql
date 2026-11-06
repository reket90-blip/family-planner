-- Allow private per-device planner sessions without requiring an email address.
-- Anonymous users still see only rows where user_id equals their authenticated user id.
create or replace function public.is_planner_allowed_user()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    or exists (
      select 1
      from private.planner_allowed_users as allowed
      where allowed.user_id = auth.uid()
    )
$$;
revoke all on function public.is_planner_allowed_user() from public, anon;
grant execute on function public.is_planner_allowed_user() to authenticated, service_role;