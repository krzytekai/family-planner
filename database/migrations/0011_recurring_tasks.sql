-- Sprint 7: recurring family tasks and backend-owned assignee reminders.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.valid_task_recurrence_rule(rule jsonb)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  rule_type text;
  interval_value integer;
begin
  if rule is null or pg_catalog.jsonb_typeof(rule) is distinct from 'object' then return false; end if;
  rule_type := rule ->> 'type';
  if rule_type is null or rule_type not in ('daily', 'weekly', 'monthly', 'yearly') then return false; end if;
  if (rule ->> 'interval') is null or (rule ->> 'interval') !~ '^[1-9][0-9]*$' then return false; end if;
  interval_value := (rule ->> 'interval')::integer;
  if interval_value > 1000 then return false; end if;

  if rule_type = 'daily' then
    return not exists (select 1 from pg_catalog.jsonb_object_keys(rule) k(key) where key not in ('type', 'interval'));
  elsif rule_type = 'weekly' then
    return coalesce(pg_catalog.jsonb_typeof(rule -> 'weekdays') = 'array'
      and pg_catalog.jsonb_array_length(rule -> 'weekdays') between 1 and 7
      and not exists (
        select 1 from pg_catalog.jsonb_array_elements_text(rule -> 'weekdays') d(value)
        where value !~ '^[1-7]$'
      )
      and (select pg_catalog.count(distinct value) from pg_catalog.jsonb_array_elements_text(rule -> 'weekdays') d(value))
        = pg_catalog.jsonb_array_length(rule -> 'weekdays')
      and not exists (select 1 from pg_catalog.jsonb_object_keys(rule) k(key) where key not in ('type', 'interval', 'weekdays')), false);
  elsif rule_type = 'monthly' then
    return coalesce((rule ->> 'day_of_month') ~ '^[1-9][0-9]*$'
      and (rule ->> 'day_of_month')::integer between 1 and 31
      and not exists (select 1 from pg_catalog.jsonb_object_keys(rule) k(key) where key not in ('type', 'interval', 'day_of_month')), false);
  end if;

  return coalesce((rule ->> 'month') ~ '^[1-9][0-9]*$'
    and (rule ->> 'month')::integer between 1 and 12
    and (rule ->> 'day_of_month') ~ '^[1-9][0-9]*$'
    and (rule ->> 'day_of_month')::integer between 1 and 31
    and not exists (select 1 from pg_catalog.jsonb_object_keys(rule) k(key) where key not in ('type', 'interval', 'month', 'day_of_month')), false);
exception when others then
  return false;
end;
$$;
revoke all on function private.valid_task_recurrence_rule(jsonb) from public, anon, authenticated;

create table public.task_recurrence_series (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  recurrence_rule jsonb not null,
  recurrence_timezone text not null,
  anchor_due_at timestamptz not null,
  recurrence_enabled boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles(id),
  stopped_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint task_recurrence_series_rule_check check (private.valid_task_recurrence_rule(recurrence_rule)),
  constraint task_recurrence_series_state_check check (
    (recurrence_enabled and stopped_at is null) or (not recurrence_enabled and stopped_at is not null)
  ),
  constraint task_recurrence_series_id_family_unique unique (id, family_id)
);

create index task_recurrence_series_family_idx on public.task_recurrence_series(family_id);
create index task_recurrence_series_active_idx on public.task_recurrence_series(family_id, recurrence_enabled)
where recurrence_enabled;

alter table public.tasks
  add column recurrence_series_id uuid,
  add column occurrence_index integer not null default 0,
  add column generated_from_task_id uuid,
  add column assignee_reminder_offset_minutes integer;

alter table public.tasks
  add constraint tasks_occurrence_index_check check (occurrence_index >= 0),
  add constraint tasks_recurrence_shape_check check (
    (recurrence_series_id is null and occurrence_index = 0 and generated_from_task_id is null)
    or recurrence_series_id is not null
  ),
  add constraint tasks_assignee_reminder_offset_check check (
    assignee_reminder_offset_minutes is null
    or assignee_reminder_offset_minutes between 1 and 525600
  ),
  add constraint tasks_id_family_unique unique (id, family_id),
  add constraint tasks_recurrence_series_family_fkey
    foreign key (recurrence_series_id, family_id)
    references public.task_recurrence_series(id, family_id),
  add constraint tasks_generated_from_task_fkey
    foreign key (generated_from_task_id)
    references public.tasks(id) on delete set null;

create unique index tasks_series_occurrence_unique
  on public.tasks(recurrence_series_id, occurrence_index)
  where recurrence_series_id is not null;
create unique index tasks_generated_from_unique
  on public.tasks(generated_from_task_id)
  where generated_from_task_id is not null;
create index tasks_recurrence_series_idx on public.tasks(recurrence_series_id)
  where recurrence_series_id is not null;

create or replace function private.validate_recurring_task_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.recurrence_series_id is distinct from old.recurrence_series_id
    or new.occurrence_index is distinct from old.occurrence_index
    or new.generated_from_task_id is distinct from old.generated_from_task_id
  ) then raise exception 'task recurrence identity cannot be changed'; end if;
  if new.recurrence_series_id is not null and new.due_at is null then
    raise exception 'recurring task requires due_at';
  end if;
  if new.assignee_reminder_offset_minutes is not null and (new.assigned_to is null or new.due_at is null) then
    new.assignee_reminder_offset_minutes := null;
  elsif new.assignee_reminder_offset_minutes is not null and not exists (
      select 1 from public.family_members fm
      where fm.family_id = new.family_id and fm.user_id = new.assigned_to and fm.status = 'active'
    ) then raise exception 'assignee reminder requires an active family assignee and due_at'; end if;
  return new;
end;
$$;
revoke all on function private.validate_recurring_task_write() from public, anon, authenticated;
drop trigger if exists validate_recurring_task_write on public.tasks;
create trigger validate_recurring_task_write before insert or update on public.tasks
for each row execute function private.validate_recurring_task_write();

alter table public.reminders
  add column reminder_kind text not null default 'personal',
  add column assignee_reminder_offset_minutes integer;

alter table public.reminders
  add constraint reminders_kind_check check (
    reminder_kind in ('personal', 'task_assignee')
  ),
  add constraint reminders_assignee_offset_check check (
    (reminder_kind = 'personal' and assignee_reminder_offset_minutes is null)
    or (
      reminder_kind = 'task_assignee'
      and source_type = 'task'
      and assignee_reminder_offset_minutes is not null
      and assignee_reminder_offset_minutes between 1 and 525600
    )
  );

drop index if exists public.reminders_one_pending_source_unique;
create unique index reminders_one_pending_source_kind_unique
  on public.reminders(recipient_user_id, source_type, source_id, reminder_kind)
  where status = 'pending';

create or replace function private.valid_timezone(timezone_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = timezone_name);
$$;
revoke all on function private.valid_timezone(text) from public, anon, authenticated;

create or replace function private.next_task_occurrence(
  previous_due_at timestamptz,
  anchor_due_at timestamptz,
  recurrence_rule jsonb,
  recurrence_timezone text
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rule_type text := recurrence_rule ->> 'type';
  step integer := (recurrence_rule ->> 'interval')::integer;
  local_previous timestamp := previous_due_at at time zone recurrence_timezone;
  local_anchor timestamp := anchor_due_at at time zone recurrence_timezone;
  candidate_date date;
  target_month date;
  target_day integer;
  last_day integer;
  week_delta integer;
  attempts integer := 0;
begin
  if not private.valid_task_recurrence_rule(recurrence_rule)
    or not private.valid_timezone(recurrence_timezone) then
    raise exception 'invalid recurrence definition';
  end if;

  if rule_type = 'daily' then
    candidate_date := local_previous::date + step;
  elsif rule_type = 'weekly' then
    candidate_date := local_previous::date + 1;
    loop
      week_delta := ((pg_catalog.date_trunc('week', candidate_date::timestamp)::date
        - pg_catalog.date_trunc('week', local_anchor)::date) / 7);
      exit when week_delta >= 0
        and week_delta % step = 0
        and exists (
          select 1
          from pg_catalog.jsonb_array_elements_text(recurrence_rule -> 'weekdays') day_value(value)
          where day_value.value = extract(isodow from candidate_date)::integer::text
        );
      candidate_date := candidate_date + 1;
      attempts := attempts + 1;
      if attempts > 7007 then raise exception 'unable to calculate weekly recurrence'; end if;
    end loop;
  elsif rule_type = 'monthly' then
    target_month := (pg_catalog.date_trunc('month', local_previous)
      + pg_catalog.make_interval(months => step))::date;
    target_day := (recurrence_rule ->> 'day_of_month')::integer;
    last_day := extract(day from (target_month + interval '1 month - 1 day'))::integer;
    candidate_date := target_month + (least(target_day, last_day) - 1);
  else
    target_month := pg_catalog.make_date(
      extract(year from local_previous)::integer + step,
      (recurrence_rule ->> 'month')::integer,
      1
    );
    target_day := (recurrence_rule ->> 'day_of_month')::integer;
    last_day := extract(day from (target_month + interval '1 month - 1 day'))::integer;
    candidate_date := target_month + (least(target_day, last_day) - 1);
  end if;

  return (candidate_date::timestamp + local_anchor::time) at time zone recurrence_timezone;
end;
$$;
revoke all on function private.next_task_occurrence(timestamptz,timestamptz,jsonb,text) from public, anon, authenticated;

create or replace function private.can_manage_task_recurrence(target_task public.tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_family_member(target_task.family_id)
    and (
      public.has_family_role(target_task.family_id, array['owner','admin']::public.family_role[])
      or target_task.created_by = (select auth.uid())
    );
$$;
revoke all on function private.can_manage_task_recurrence(public.tasks) from public, anon, authenticated;

create or replace function private.audit_recurrence(
  target_family uuid,
  target_action text,
  target_series uuid,
  target_task uuid,
  metadata_value jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs(family_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    target_family,
    (select auth.uid()),
    target_action,
    'task_recurrence',
    target_series::text,
    pg_catalog.jsonb_build_object('task_id', target_task) || metadata_value
  );
$$;
revoke all on function private.audit_recurrence(uuid,text,uuid,uuid,jsonb) from public, anon, authenticated;

create or replace function public.create_recurring_task(
  task_family_id uuid,
  task_title text,
  task_description text,
  task_priority text,
  task_assigned_to uuid,
  task_due_at timestamptz,
  task_recurrence_rule jsonb,
  task_recurrence_timezone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  series_id uuid;
  task_id uuid;
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if not public.has_family_role(task_family_id, array['owner','admin','adult']::public.family_role[]) then
    raise exception 'not authorized to create recurring tasks';
  end if;
  if task_due_at is null then raise exception 'recurring task requires due_at'; end if;
  if not private.valid_task_recurrence_rule(task_recurrence_rule) then raise exception 'invalid recurrence rule'; end if;
  if not private.valid_timezone(task_recurrence_timezone) then raise exception 'invalid recurrence timezone'; end if;
  if task_assigned_to is not null and not exists (
    select 1 from public.family_members fm
    where fm.family_id = task_family_id and fm.user_id = task_assigned_to and fm.status = 'active'
  ) then raise exception 'invalid task assignee'; end if;

  insert into public.task_recurrence_series(
    family_id, recurrence_rule, recurrence_timezone, anchor_due_at, created_by
  ) values (
    task_family_id, task_recurrence_rule, task_recurrence_timezone, task_due_at, current_user_id
  ) returning id into series_id;

  insert into public.tasks(
    family_id, title, description, priority, assigned_to, due_at, created_by,
    recurrence_series_id, occurrence_index
  ) values (
    task_family_id, task_title, task_description, task_priority, task_assigned_to, task_due_at,
    current_user_id, series_id, 0
  ) returning id into task_id;

  perform private.audit_recurrence(
    task_family_id, 'task.recurrence_started', series_id, task_id,
    pg_catalog.jsonb_build_object('type', task_recurrence_rule ->> 'type', 'interval', task_recurrence_rule ->> 'interval')
  );
  return task_id;
end;
$$;
revoke all on function public.create_recurring_task(uuid,text,text,text,uuid,timestamptz,jsonb,text) from public, anon;
grant execute on function public.create_recurring_task(uuid,text,text,text,uuid,timestamptz,jsonb,text) to authenticated;

create or replace function public.update_task_recurrence(
  target_task_id uuid,
  next_rule jsonb,
  next_timezone text,
  enabled boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_task public.tasks%rowtype;
  target_series public.task_recurrence_series%rowtype;
begin
  select * into target_task from public.tasks where id = target_task_id for update;
  if not found or target_task.recurrence_series_id is null then raise exception 'recurring task not found'; end if;
  if not private.can_manage_task_recurrence(target_task) then raise exception 'not authorized to update recurrence'; end if;
  select * into target_series from public.task_recurrence_series
    where id = target_task.recurrence_series_id and family_id = target_task.family_id for update;

  if not enabled then
    if target_series.recurrence_enabled then
      update public.task_recurrence_series
      set recurrence_enabled = false, stopped_at = pg_catalog.now(), updated_at = pg_catalog.now()
      where id = target_series.id;
      perform private.audit_recurrence(target_task.family_id, 'task.recurrence_stopped', target_series.id, target_task.id);
    end if;
    return;
  end if;

  if not private.valid_task_recurrence_rule(next_rule) then raise exception 'invalid recurrence rule'; end if;
  if not private.valid_timezone(next_timezone) then raise exception 'invalid recurrence timezone'; end if;
  if target_task.due_at is null then raise exception 'recurring task requires due_at'; end if;
  update public.task_recurrence_series
  set recurrence_rule = next_rule,
      recurrence_timezone = next_timezone,
      anchor_due_at = target_task.due_at,
      recurrence_enabled = true,
      stopped_at = null,
      updated_at = pg_catalog.now()
  where id = target_series.id;
  perform private.audit_recurrence(
    target_task.family_id, 'task.recurrence_updated', target_series.id, target_task.id,
    pg_catalog.jsonb_build_object('type', next_rule ->> 'type', 'interval', next_rule ->> 'interval')
  );
end;
$$;
revoke all on function public.update_task_recurrence(uuid,jsonb,text,boolean) from public, anon;
grant execute on function public.update_task_recurrence(uuid,jsonb,text,boolean) to authenticated;

create or replace function private.audit_assignee_reminder(
  target_family uuid,
  target_action text,
  target_task uuid,
  target_reminder uuid,
  target_recipient uuid,
  target_offset integer
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs(family_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    target_family, (select auth.uid()), target_action, 'task', target_task::text,
    pg_catalog.jsonb_build_object(
      'reminder_id', target_reminder,
      'recipient_user_id', target_recipient,
      'offset_minutes', target_offset
    )
  );
$$;
revoke all on function private.audit_assignee_reminder(uuid,text,uuid,uuid,uuid,integer) from public, anon, authenticated;

create or replace function private.can_manage_task_assignee_reminder(target_task public.tasks)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_family_member(target_task.family_id)
    and (
      public.has_family_role(target_task.family_id, array['owner','admin']::public.family_role[])
      or target_task.created_by = (select auth.uid())
    );
$$;
revoke all on function private.can_manage_task_assignee_reminder(public.tasks) from public, anon, authenticated;

create or replace function public.set_task_assignee_reminder(target_task_id uuid, offset_minutes integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_task public.tasks%rowtype;
  existing_reminder public.reminders%rowtype;
  reminder_id uuid;
  reminder_time timestamptz;
begin
  select * into target_task from public.tasks where id = target_task_id for update;
  if not found or not private.can_manage_task_assignee_reminder(target_task) then raise exception 'not authorized to update task reminder'; end if;
  if target_task.assigned_to is null then raise exception 'task must have an assignee'; end if;
  if target_task.due_at is null then raise exception 'task must have due_at'; end if;
  if offset_minutes not between 1 and 525600 then raise exception 'invalid reminder offset'; end if;
  if not exists (
    select 1 from public.family_members fm
    where fm.family_id = target_task.family_id and fm.user_id = target_task.assigned_to and fm.status = 'active'
  ) then raise exception 'invalid task assignee'; end if;
  reminder_time := target_task.due_at - pg_catalog.make_interval(mins => offset_minutes);
  if reminder_time <= pg_catalog.now() then raise exception 'reminder must be in the future'; end if;

  select * into existing_reminder from public.reminders r
  where r.family_id = target_task.family_id and r.source_type = 'task'
    and r.source_id = target_task.id and r.reminder_kind = 'task_assignee'
    and r.status = 'pending'
  order by r.created_at desc limit 1 for update;

  if found then
    update public.reminders
    set recipient_user_id = target_task.assigned_to,
        remind_at = reminder_time,
        assignee_reminder_offset_minutes = offset_minutes,
        title = 'Przypomnienie: ' || target_task.title,
        timezone = coalesce((select s.recurrence_timezone from public.task_recurrence_series s where s.id = target_task.recurrence_series_id), timezone),
        updated_at = pg_catalog.now()
    where id = existing_reminder.id
    returning id into reminder_id;
    update public.tasks set assignee_reminder_offset_minutes = offset_minutes where id = target_task.id;
    perform private.audit_assignee_reminder(target_task.family_id, 'task.assignee_reminder_updated', target_task.id, reminder_id, target_task.assigned_to, offset_minutes);
  else
    insert into public.reminders(
      family_id, recipient_user_id, source_type, source_id, title, remind_at, timezone,
      status, created_by, reminder_kind, assignee_reminder_offset_minutes
    ) values (
      target_task.family_id, target_task.assigned_to, 'task', target_task.id,
      'Przypomnienie: ' || target_task.title, reminder_time,
      coalesce((select s.recurrence_timezone from public.task_recurrence_series s where s.id = target_task.recurrence_series_id), 'UTC'),
      'pending', (select auth.uid()), 'task_assignee', offset_minutes
    ) returning id into reminder_id;
    update public.tasks set assignee_reminder_offset_minutes = offset_minutes where id = target_task.id;
    perform private.audit_assignee_reminder(target_task.family_id, 'task.assignee_reminder_created', target_task.id, reminder_id, target_task.assigned_to, offset_minutes);
  end if;
  return reminder_id;
end;
$$;
revoke all on function public.set_task_assignee_reminder(uuid,integer) from public, anon;
grant execute on function public.set_task_assignee_reminder(uuid,integer) to authenticated;

create or replace function public.cancel_task_assignee_reminder(target_task_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_task public.tasks%rowtype;
  cancelled record;
begin
  select * into target_task from public.tasks where id = target_task_id;
  if not found or not private.can_manage_task_assignee_reminder(target_task) then raise exception 'not authorized to update task reminder'; end if;
  for cancelled in
    update public.reminders set status = 'cancelled', fired_at = null, updated_at = pg_catalog.now()
    where family_id = target_task.family_id and source_type = 'task' and source_id = target_task.id
      and reminder_kind = 'task_assignee' and status = 'pending'
    returning id, recipient_user_id, assignee_reminder_offset_minutes
  loop
    perform private.audit_assignee_reminder(target_task.family_id, 'task.assignee_reminder_cancelled', target_task.id, cancelled.id, cancelled.recipient_user_id, cancelled.assignee_reminder_offset_minutes);
  end loop;
  update public.tasks set assignee_reminder_offset_minutes = null where id = target_task.id;
end;
$$;
revoke all on function public.cancel_task_assignee_reminder(uuid) from public, anon;
grant execute on function public.cancel_task_assignee_reminder(uuid) to authenticated;

-- Backend-created assignee reminders are marked by a non-null offset. Direct clients
-- cannot write that column, so personal reminder RLS remains unchanged.
create or replace function private.prepare_reminder_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.reminder_kind = 'personal'
      and (new.created_by <> (select auth.uid()) or new.recipient_user_id <> (select auth.uid())) then
      raise exception 'reminders are personal';
    end if;
    if new.reminder_kind = 'task_assignee' and (
      new.source_type <> 'task' or not exists (
        select 1 from public.tasks t
        join public.family_members fm on fm.family_id = t.family_id and fm.user_id = t.assigned_to and fm.status = 'active'
        where t.id = new.source_id and t.family_id = new.family_id
          and t.assigned_to = new.recipient_user_id
      )
    ) then raise exception 'invalid task assignee reminder recipient'; end if;
    if new.status <> 'pending' or new.fired_at is not null then raise exception 'invalid initial reminder status'; end if;
  else
    if new.family_id <> old.family_id or new.created_by <> old.created_by
      or new.source_type <> old.source_type or new.source_id <> old.source_id
      or new.reminder_kind <> old.reminder_kind then
      raise exception 'reminder ownership and source cannot be changed';
    end if;
    if old.reminder_kind = 'personal'
      and new.recipient_user_id <> old.recipient_user_id then
      raise exception 'personal reminder recipient cannot be changed';
    end if;
  end if;
  if new.status = 'pending' and new.remind_at <= pg_catalog.now() then raise exception 'reminder must be in the future'; end if;
  if new.source_type = 'task' and not exists (
    select 1 from public.tasks t where t.id = new.source_id and t.family_id = new.family_id
  ) then raise exception 'task does not belong to reminder family';
  elsif new.source_type = 'calendar_event' and not exists (
    select 1 from public.calendar_events e where e.id = new.source_id and e.family_id = new.family_id
  ) then raise exception 'calendar event does not belong to reminder family';
  end if;
  new.title := nullif(pg_catalog.btrim(new.title), '');
  new.timezone := nullif(pg_catalog.btrim(new.timezone), '');
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function private.prepare_reminder_write() from public, anon, authenticated;

create or replace function private.sync_task_assignee_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_reminder public.reminders%rowtype;
  next_time timestamptz;
begin
  select * into current_reminder from public.reminders r
  where r.family_id = new.family_id and r.source_type = 'task' and r.source_id = new.id
    and r.reminder_kind = 'task_assignee' and r.status = 'pending'
  order by r.created_at desc limit 1 for update;
  if not found then return new; end if;

  if new.assigned_to is null then
    update public.reminders set status = 'cancelled', fired_at = null, updated_at = pg_catalog.now()
    where id = current_reminder.id;
    perform private.audit_assignee_reminder(new.family_id, 'task.assignee_reminder_cancelled', new.id, current_reminder.id, current_reminder.recipient_user_id, current_reminder.assignee_reminder_offset_minutes);
    if new.assigned_to is null then
      update public.tasks set assignee_reminder_offset_minutes = null where id = new.id;
    end if;
  elsif new.assigned_to is distinct from old.assigned_to
    or new.due_at is distinct from old.due_at
    or new.title is distinct from old.title then
    if new.due_at is null or new.assignee_reminder_offset_minutes is null or not exists (
      select 1 from public.family_members fm
      where fm.family_id = new.family_id and fm.user_id = new.assigned_to and fm.status = 'active'
    ) then
      update public.reminders set status = 'cancelled', fired_at = null, updated_at = pg_catalog.now()
      where id = current_reminder.id;
      perform private.audit_assignee_reminder(new.family_id, 'task.assignee_reminder_cancelled', new.id, current_reminder.id, current_reminder.recipient_user_id, current_reminder.assignee_reminder_offset_minutes);
      update public.tasks set assignee_reminder_offset_minutes = null where id = new.id;
    else
      next_time := new.due_at - pg_catalog.make_interval(mins => new.assignee_reminder_offset_minutes);
      if next_time > pg_catalog.now() then
        update public.reminders
        set recipient_user_id = new.assigned_to, remind_at = next_time,
            title = 'Przypomnienie: ' || new.title,
            assignee_reminder_offset_minutes = new.assignee_reminder_offset_minutes,
            updated_at = pg_catalog.now()
        where id = current_reminder.id;
        perform private.audit_assignee_reminder(new.family_id, 'task.assignee_reminder_updated', new.id, current_reminder.id, new.assigned_to, current_reminder.assignee_reminder_offset_minutes);
      else
        update public.reminders set status = 'cancelled', fired_at = null, updated_at = pg_catalog.now()
        where id = current_reminder.id;
        perform private.audit_assignee_reminder(new.family_id, 'task.assignee_reminder_cancelled', new.id, current_reminder.id, current_reminder.recipient_user_id, current_reminder.assignee_reminder_offset_minutes);
      end if;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_task_assignee_reminder() from public, anon, authenticated;
drop trigger if exists sync_task_assignee_reminder on public.tasks;
create trigger sync_task_assignee_reminder
after update of assigned_to, due_at, title on public.tasks
for each row execute function private.sync_task_assignee_reminder();

-- A generated occurrence is a new assignment even when the assignee completed the
-- previous occurrence themselves. One-time self-assignment keeps the old no-self-notice rule.
create or replace function private.notify_task_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment_changed boolean;
begin
  if tg_op = 'INSERT' then assignment_changed := true;
  else assignment_changed := new.assigned_to is distinct from old.assigned_to;
  end if;

  if assignment_changed and new.assigned_to is not null
    and (new.assigned_to <> (select auth.uid()) or new.generated_from_task_id is not null)
    and exists (
      select 1 from public.family_members fm
      where fm.family_id = new.family_id and fm.user_id = new.assigned_to and fm.status = 'active'
    )
    and private.notification_type_enabled(new.family_id, new.assigned_to, 'task_assigned') then
    insert into public.notifications(
      family_id, recipient_user_id, notification_type, title, body,
      source_type, source_id, payload, dedupe_key
    ) values (
      new.family_id, new.assigned_to, 'task_assigned', 'Przypisano Ci zadanie', new.title,
      'task', new.id,
      pg_catalog.jsonb_build_object(
        'family_id', new.family_id, 'source_type', 'task',
        'source_id', new.id, 'notification_type', 'task_assigned'
      ),
      'task-assigned:' || new.id::text || ':' || new.assigned_to::text || ':' || new.updated_at::text
    ) on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.notify_task_assignment() from public, anon, authenticated;

create or replace function private.generate_next_recurring_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  series public.task_recurrence_series%rowtype;
  next_due timestamptz;
  next_task_id uuid;
  next_reminder_id uuid;
  next_remind_at timestamptz;
begin
  if old.status = 'done' or new.status <> 'done' then return new; end if;

  if new.recurrence_series_id is not null then
    select * into series from public.task_recurrence_series s
    where s.id = new.recurrence_series_id and s.family_id = new.family_id for update;

    if found and series.recurrence_enabled
      and not exists (select 1 from public.tasks t where t.generated_from_task_id = new.id) then
      next_due := private.next_task_occurrence(new.due_at, series.anchor_due_at, series.recurrence_rule, series.recurrence_timezone);
      while next_due <= pg_catalog.now() loop
        next_due := private.next_task_occurrence(next_due, series.anchor_due_at, series.recurrence_rule, series.recurrence_timezone);
      end loop;

      insert into public.tasks(
        family_id, title, description, status, priority, assigned_to, due_at, created_by,
        recurrence_series_id, occurrence_index, generated_from_task_id, assignee_reminder_offset_minutes
      ) values (
        new.family_id, new.title, new.description, 'todo', new.priority, new.assigned_to, next_due,
        new.created_by, series.id, new.occurrence_index + 1, new.id, new.assignee_reminder_offset_minutes
      ) on conflict (generated_from_task_id) where generated_from_task_id is not null do nothing
      returning id into next_task_id;

      if next_task_id is not null then
        perform private.audit_recurrence(
          new.family_id, 'task.recurrence_occurrence_created', series.id, next_task_id,
          pg_catalog.jsonb_build_object('previous_task_id', new.id, 'occurrence_index', new.occurrence_index + 1)
        );

        if new.assignee_reminder_offset_minutes is not null and new.assigned_to is not null then
          next_remind_at := next_due - pg_catalog.make_interval(mins => new.assignee_reminder_offset_minutes);
          if next_remind_at > pg_catalog.now() then
            insert into public.reminders(
              family_id, recipient_user_id, source_type, source_id, title, remind_at, timezone,
              status, created_by, reminder_kind, assignee_reminder_offset_minutes
            ) values (
              new.family_id, new.assigned_to, 'task', next_task_id, 'Przypomnienie: ' || new.title,
              next_remind_at, series.recurrence_timezone, 'pending', new.created_by, 'task_assignee',
              new.assignee_reminder_offset_minutes
            ) returning id into next_reminder_id;
            perform private.audit_assignee_reminder(
              new.family_id, 'task.assignee_reminder_created', next_task_id,
              next_reminder_id, new.assigned_to, new.assignee_reminder_offset_minutes
            );
          end if;
        end if;
      end if;
    end if;
  end if;

  for next_reminder_id in
    update public.reminders
    set status = 'cancelled', fired_at = null, updated_at = pg_catalog.now()
    where family_id = new.family_id and source_type = 'task' and source_id = new.id
      and reminder_kind = 'task_assignee' and status = 'pending'
    returning id
  loop
    perform private.audit_assignee_reminder(
      new.family_id, 'task.assignee_reminder_cancelled', new.id,
      next_reminder_id, new.assigned_to, new.assignee_reminder_offset_minutes
    );
  end loop;
  return new;
end;
$$;
revoke all on function private.generate_next_recurring_task() from public, anon, authenticated;
drop trigger if exists generate_next_recurring_task on public.tasks;
create trigger generate_next_recurring_task
after update of status on public.tasks
for each row execute function private.generate_next_recurring_task();

alter table public.task_recurrence_series enable row level security;
revoke all on public.task_recurrence_series from anon, authenticated;
grant select on public.task_recurrence_series to authenticated;

create policy task_recurrence_series_select_family_member
on public.task_recurrence_series for select to authenticated
using ((select public.is_family_member(family_id)));

-- Recurrence and assignee-reminder columns are intentionally absent from direct client grants.
-- All writes use the narrow RPCs above or database triggers.
revoke insert(recurrence_series_id, occurrence_index, generated_from_task_id, assignee_reminder_offset_minutes) on public.tasks from authenticated;
revoke update(assignee_reminder_offset_minutes) on public.tasks from authenticated;
revoke insert(assignee_reminder_offset_minutes) on public.reminders from authenticated;
revoke insert(reminder_kind) on public.reminders from authenticated;
revoke update(reminder_kind, assignee_reminder_offset_minutes, recipient_user_id) on public.reminders from authenticated;

drop policy if exists reminders_insert_own on public.reminders;
create policy reminders_insert_own on public.reminders for insert to authenticated
with check (
  reminder_kind = 'personal'
  and recipient_user_id = (select auth.uid())
  and created_by = (select auth.uid())
  and (select public.is_family_member(family_id))
);

drop policy if exists reminders_update_own on public.reminders;
create policy reminders_update_own on public.reminders for update to authenticated
using (
  (select public.is_family_member(family_id))
  and (
    (reminder_kind = 'personal' and recipient_user_id = (select auth.uid()))
    or (
      reminder_kind = 'task_assignee'
      and exists (
        select 1 from public.tasks t
        where t.id = reminders.source_id and t.family_id = reminders.family_id
          and (
            public.has_family_role(t.family_id, array['owner','admin']::public.family_role[])
            or t.created_by = (select auth.uid())
          )
      )
    )
  )
)
with check (
  (select public.is_family_member(family_id))
  and (
    (reminder_kind = 'personal' and recipient_user_id = (select auth.uid()))
    or (
      reminder_kind = 'task_assignee'
      and exists (
        select 1 from public.tasks t
        where t.id = reminders.source_id and t.family_id = reminders.family_id
          and (
            public.has_family_role(t.family_id, array['owner','admin']::public.family_role[])
            or t.created_by = (select auth.uid())
          )
      )
    )
  )
);

drop policy if exists reminders_delete_own on public.reminders;
create policy reminders_delete_own on public.reminders for delete to authenticated
using (
  (select public.is_family_member(family_id))
  and (
    (reminder_kind = 'personal' and recipient_user_id = (select auth.uid()))
    or (
      reminder_kind = 'task_assignee'
      and exists (
        select 1 from public.tasks t
        where t.id = reminders.source_id and t.family_id = reminders.family_id
          and (
            public.has_family_role(t.family_id, array['owner','admin']::public.family_role[])
            or t.created_by = (select auth.uid())
          )
      )
    )
  )
);

notify pgrst, 'reload schema';
