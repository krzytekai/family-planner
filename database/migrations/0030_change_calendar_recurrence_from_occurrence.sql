create table private.calendar_recurrence_split_context (
  transaction_id bigint not null,
  backend_pid integer not null,
  family_id uuid not null,
  actor_user_id uuid not null,
  old_event_id uuid not null,
  new_event_id uuid not null,
  primary key (
    transaction_id,
    backend_pid,
    family_id,
    actor_user_id,
    old_event_id,
    new_event_id
  )
);

revoke all on table private.calendar_recurrence_split_context
from public, anon, authenticated;

create or replace function private.prepare_reminder_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_remap_allowed boolean := false;
begin
  if tg_op = 'INSERT' then
    if new.reminder_kind = 'personal'
       and (new.created_by <> (select auth.uid()) or new.recipient_user_id <> (select auth.uid())) then
      raise exception 'reminders are personal';
    end if;
    if new.reminder_kind = 'task_assignee'
       and (
         new.source_type <> 'task'
         or not exists (
           select 1
           from public.tasks t
           join public.family_members fm
             on fm.family_id = t.family_id
            and fm.user_id = t.assigned_to
            and fm.status = 'active'
           where t.id = new.source_id
             and t.family_id = new.family_id
             and t.assigned_to = new.recipient_user_id
         )
       ) then
      raise exception 'invalid task assignee reminder recipient';
    end if;
    if new.reminder_kind = 'property_charge'
       and (
         new.source_type <> 'property_charge'
         or not exists (
           select 1
           from public.property_charges c
           join public.property_charge_reminder_rules rr
             on rr.definition_id = c.charge_definition_id
            and rr.family_id = c.family_id
           where c.id = new.source_id
             and c.family_id = new.family_id
             and rr.recipient_user_id = new.recipient_user_id
             and rr.offset_days = new.property_charge_reminder_offset_days
         )
       ) then
      raise exception 'invalid property charge reminder recipient';
    end if;
    if new.source_type = 'property_charge' and new.reminder_kind <> 'property_charge' then
      raise exception 'property charge reminders are backend-managed';
    end if;
    if new.status <> 'pending' or new.fired_at is not null then
      raise exception 'invalid initial reminder status';
    end if;
  else
    if new.source_id <> old.source_id then
      source_remap_allowed :=
        old.reminder_kind = 'personal'
        and new.reminder_kind = 'personal'
        and old.source_type = 'calendar_event'
        and new.source_type = 'calendar_event'
        and new.family_id = old.family_id
        and new.created_by = old.created_by
        and new.recipient_user_id = old.recipient_user_id
        and exists (
          select 1
          from private.calendar_recurrence_split_context context
          where context.transaction_id = pg_catalog.txid_current()
            and context.backend_pid = pg_catalog.pg_backend_pid()
            and context.family_id = old.family_id
            and context.actor_user_id = (select auth.uid())
            and context.old_event_id = old.source_id
            and context.new_event_id = new.source_id
        )
        and exists (
          select 1
          from public.calendar_events old_event
          where old_event.id = old.source_id
            and old_event.family_id = old.family_id
        )
        and exists (
          select 1
          from public.calendar_events new_event
          where new_event.id = new.source_id
            and new_event.family_id = old.family_id
        );
    end if;

    if new.family_id <> old.family_id
       or new.created_by <> old.created_by
       or new.source_type <> old.source_type
       or new.reminder_kind <> old.reminder_kind
       or (new.source_id <> old.source_id and not source_remap_allowed) then
      raise exception 'reminder ownership and source cannot be changed';
    end if;
    if old.reminder_kind = 'personal' and new.recipient_user_id <> old.recipient_user_id then
      raise exception 'personal reminder recipient cannot be changed';
    end if;
  end if;

  if new.status = 'pending' and new.remind_at <= pg_catalog.now() then
    raise exception 'reminder must be in the future';
  end if;
  if new.source_type = 'task'
     and not exists (
       select 1 from public.tasks t
       where t.id = new.source_id and t.family_id = new.family_id
     ) then
    raise exception 'task does not belong to reminder family';
  elsif new.source_type = 'calendar_event'
        and not exists (
          select 1 from public.calendar_events e
          where e.id = new.source_id and e.family_id = new.family_id
        ) then
    raise exception 'calendar event does not belong to reminder family';
  elsif new.source_type = 'property_charge'
        and not exists (
          select 1 from public.property_charges c
          where c.id = new.source_id and c.family_id = new.family_id
        ) then
    raise exception 'property charge does not belong to reminder family';
  end if;

  new.title := nullif(pg_catalog.btrim(new.title), '');
  new.timezone := nullif(pg_catalog.btrim(new.timezone), '');
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.prepare_reminder_write()
from public, anon, authenticated;

create or replace function public.change_calendar_event_recurrence_from_occurrence(
  target_family_id uuid,
  target_event_id uuid,
  recurrence_rule_value jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_event public.calendar_events%rowtype;
  old_series public.calendar_event_recurrence_series%rowtype;
  boundary_occurrence_date date;
  local_start timestamp;
  new_anchor_date date;
  new_anchor_local_time time;
  new_timed_duration_minutes integer;
  new_all_day_duration_days integer;
  new_series_id uuid;
  first_event_id uuid;
  affected_event_ids uuid[];
begin
  if actor is null then
    raise exception 'authentication required';
  end if;
  if not private.valid_task_recurrence_rule(recurrence_rule_value) then
    raise exception 'invalid recurrence rule';
  end if;

  select e.* into target_event
  from public.calendar_events e
  where e.id = target_event_id
    and e.family_id = target_family_id
  for update;

  if target_event.id is null then
    raise exception 'calendar event not found';
  end if;
  if target_event.recurrence_series_id is null
     or target_event.recurrence_occurrence_date is null then
    raise exception 'calendar event is not recurring';
  end if;
  if not private.can_manage_calendar_event(target_event) then
    raise exception 'calendar recurrence management is not allowed';
  end if;

  select s.* into old_series
  from public.calendar_event_recurrence_series s
  where s.id = target_event.recurrence_series_id
    and s.family_id = target_family_id
  for update;

  if old_series.id is null then
    raise exception 'calendar recurrence series not found';
  end if;
  if not old_series.recurrence_enabled then
    raise exception 'calendar recurrence series is inactive';
  end if;

  boundary_occurrence_date := target_event.recurrence_occurrence_date;
  if boundary_occurrence_date < (pg_catalog.now() at time zone old_series.recurrence_timezone)::date then
    raise exception 'calendar recurrence can only change from today or a future occurrence';
  end if;

  if recurrence_rule_value = old_series.recurrence_rule then
    return target_event_id;
  end if;

  if target_event.all_day then
    if target_event.start_date is null then
      raise exception 'invalid all-day calendar occurrence';
    end if;
    new_anchor_date := target_event.start_date;
    new_anchor_local_time := null;
    new_timed_duration_minutes := null;
    new_all_day_duration_days := coalesce(target_event.end_date - target_event.start_date, 0);
  else
    if target_event.starts_at is null then
      raise exception 'invalid timed calendar occurrence';
    end if;
    local_start := target_event.starts_at at time zone old_series.recurrence_timezone;
    new_anchor_date := local_start::date;
    new_anchor_local_time := local_start::time;
    new_timed_duration_minutes := coalesce(
      (extract(epoch from (target_event.ends_at - target_event.starts_at)) / 60)::integer,
      0
    );
    new_all_day_duration_days := null;
  end if;

  select pg_catalog.array_agg(e.id order by e.id) into affected_event_ids
  from public.calendar_events e
  where e.family_id = target_family_id
    and e.recurrence_series_id = old_series.id
    and e.recurrence_occurrence_date >= boundary_occurrence_date;

  insert into public.calendar_event_recurrence_series(
    family_id,
    title,
    description,
    event_type,
    location,
    all_day,
    anchor_date,
    anchor_local_time,
    timed_duration_minutes,
    all_day_duration_days,
    recurrence_rule,
    recurrence_timezone,
    recurrence_enabled,
    generated_through,
    created_by
  ) values (
    old_series.family_id,
    target_event.title,
    target_event.description,
    target_event.event_type,
    target_event.location,
    target_event.all_day,
    new_anchor_date,
    new_anchor_local_time,
    new_timed_duration_minutes,
    new_all_day_duration_days,
    recurrence_rule_value,
    old_series.recurrence_timezone,
    true,
    null,
    old_series.created_by
  ) returning id into new_series_id;

  perform private.ensure_calendar_event_series_occurrences(new_series_id, 400);

  select e.id into first_event_id
  from public.calendar_events e
  where e.family_id = target_family_id
    and e.recurrence_series_id = new_series_id
    and e.recurrence_occurrence_date = new_anchor_date;

  if first_event_id is null then
    raise exception 'new calendar recurrence did not generate its first occurrence';
  end if;

  insert into private.calendar_recurrence_split_context(
    transaction_id,
    backend_pid,
    family_id,
    actor_user_id,
    old_event_id,
    new_event_id
  ) values (
    pg_catalog.txid_current(),
    pg_catalog.pg_backend_pid(),
    target_family_id,
    actor,
    target_event_id,
    first_event_id
  );

  update public.reminders r
  set source_id = first_event_id
  where r.family_id = target_family_id
    and r.source_type = 'calendar_event'
    and r.source_id = target_event_id
    and r.reminder_kind = 'personal'
    and r.status = 'pending'
    and r.remind_at > pg_catalog.now();

  delete from private.calendar_recurrence_split_context context
  where context.transaction_id = pg_catalog.txid_current()
    and context.backend_pid = pg_catalog.pg_backend_pid()
    and context.family_id = target_family_id
    and context.actor_user_id = actor
    and context.old_event_id = target_event_id
    and context.new_event_id = first_event_id;

  update public.calendar_event_recurrence_series
  set recurrence_enabled = false,
      stopped_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = old_series.id
    and family_id = target_family_id;

  if affected_event_ids is not null then
    delete from public.reminders r
    where r.family_id = target_family_id
      and r.source_type = 'calendar_event'
      and r.source_id = any(affected_event_ids)
      and r.status = 'pending';

    delete from public.calendar_events e
    where e.family_id = target_family_id
      and e.recurrence_series_id = old_series.id
      and e.recurrence_occurrence_date >= boundary_occurrence_date;
  end if;

  insert into public.audit_logs(
    family_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_family_id,
    actor,
    'calendar_event.recurrence_changed_from_occurrence',
    'calendar_event_recurrence_series',
    new_series_id::text,
    pg_catalog.jsonb_build_object(
      'oldSeriesId', old_series.id,
      'newSeriesId', new_series_id,
      'sourceEventId', target_event_id,
      'boundaryOccurrenceDate', boundary_occurrence_date,
      'oldRecurrenceRule', old_series.recurrence_rule,
      'newRecurrenceRule', recurrence_rule_value,
      'recurrenceTimezone', old_series.recurrence_timezone
    )
  );

  return first_event_id;
end;
$$;

revoke all on function public.change_calendar_event_recurrence_from_occurrence(uuid,uuid,jsonb)
from public, anon, authenticated;

grant execute on function public.change_calendar_event_recurrence_from_occurrence(uuid,uuid,jsonb)
to authenticated;

notify pgrst, 'reload schema';
