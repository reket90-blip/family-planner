create or replace function public.get_due_planner_reminders()
returns table (item_id uuid, user_id uuid, title text, category text, event_date date, event_time time, due_at timestamptz)
language sql stable set search_path = ''
as $$
  with candidates as (
    select
      i.id as item_id,
      i.user_id,
      i.title,
      i.category,
      i.event_date,
      i.event_time,
      case
        when i.reminder_date is not null then
          ((i.reminder_date::timestamp + coalesce(i.reminder_time, time '09:00'))
            at time zone coalesce(s.timezone, 'Asia/Novosibirsk'))
        else
          (((i.event_date::timestamp + coalesce(i.event_time, time '09:00'))
            at time zone coalesce(s.timezone, 'Asia/Novosibirsk'))
            - make_interval(mins => i.remind_before))
      end as due_at
    from public.planner_items as i
    left join public.planner_settings as s on s.user_id = i.user_id
    where i.done = false
      and (i.reminder_date is not null or i.remind_before > 0)
  )
  select c.item_id, c.user_id, c.title, c.category, c.event_date, c.event_time, c.due_at
  from candidates as c
  where c.due_at <= pg_catalog.now()
    and c.due_at > pg_catalog.now() - interval '15 minutes'
$$;

revoke all on function public.get_due_planner_reminders() from public, anon, authenticated;
grant execute on function public.get_due_planner_reminders() to service_role;
