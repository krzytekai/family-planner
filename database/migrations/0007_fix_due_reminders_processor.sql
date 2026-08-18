-- Fix LEAST/GREATEST syntax in the backend reminder processor.

create or replace function private.process_due_reminders(batch_size integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  due public.reminders%rowtype;
  processed integer := 0;
  event_type text;
  source_title text;
begin
  for due in
    select *
    from public.reminders r
    where r.status = 'pending'
      and r.remind_at <= pg_catalog.now()
    order by r.remind_at
    for update skip locked
    limit greatest(1, least(batch_size, 1000))
  loop
    event_type := case
      when due.source_type = 'task' then 'task_reminder'
      else 'calendar_reminder'
    end;

    if not exists (
      select 1
      from public.family_members fm
      where fm.family_id = due.family_id
        and fm.user_id = due.recipient_user_id
        and fm.status = 'active'
    ) then
      update public.reminders
      set status = 'cancelled',
          fired_at = null,
          updated_at = pg_catalog.now()
      where id = due.id;

      processed := processed + 1;
      continue;
    end if;

    if due.source_type = 'task' then
      select t.title
      into source_title
      from public.tasks t
      where t.id = due.source_id
        and t.family_id = due.family_id;
    else
      select e.title
      into source_title
      from public.calendar_events e
      where e.id = due.source_id
        and e.family_id = due.family_id;
    end if;

    if source_title is not null
      and private.notification_type_enabled(
        due.family_id,
        due.recipient_user_id,
        event_type
      ) then
      insert into public.notifications(
        family_id,
        recipient_user_id,
        notification_type,
        title,
        body,
        source_type,
        source_id,
        payload,
        dedupe_key
      )
      values(
        due.family_id,
        due.recipient_user_id,
        event_type,
        coalesce(due.title, 'Przypomnienie'),
        source_title,
        due.source_type,
        due.source_id,
        pg_catalog.jsonb_build_object(
          'family_id', due.family_id,
          'source_type', due.source_type,
          'source_id', due.source_id,
          'notification_type', event_type
        ),
        'reminder:' || due.id::text
      )
      on conflict do nothing;

      update public.reminders
      set status = 'fired',
          fired_at = pg_catalog.now(),
          updated_at = pg_catalog.now()
      where id = due.id;
    else
      update public.reminders
      set status = 'cancelled',
          fired_at = null,
          updated_at = pg_catalog.now()
      where id = due.id;
    end if;

    processed := processed + 1;
  end loop;

  return processed;
end;
$$;

revoke all on function private.process_due_reminders(integer)
from public, anon, authenticated;
