-- Recurring calendar events: finite rolling generation, occurrence exclusions,
-- tenant-safe lifecycle RPCs and backward-compatible backup/restore support.

create table public.calendar_event_recurrence_series (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (pg_catalog.char_length(title) between 1 and 200),
  description text,
  event_type text not null check (event_type in ('family','appointment','school','work','birthday','other')),
  location text,
  all_day boolean not null,
  anchor_date date not null,
  anchor_local_time time,
  timed_duration_minutes integer,
  all_day_duration_days integer,
  recurrence_rule jsonb not null,
  recurrence_timezone text not null,
  recurrence_enabled boolean not null default true,
  generated_through date,
  created_by uuid not null references public.profiles(id),
  stopped_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint calendar_event_recurrence_series_family_unique unique(id,family_id),
  constraint calendar_event_recurrence_series_rule_check check(private.valid_task_recurrence_rule(recurrence_rule)),
  constraint calendar_event_recurrence_series_timezone_check check(private.valid_timezone(recurrence_timezone)),
  constraint calendar_event_recurrence_series_shape_check check(
    (all_day and anchor_local_time is null and timed_duration_minutes is null and all_day_duration_days between 0 and 3660)
    or
    (not all_day and anchor_local_time is not null and timed_duration_minutes is not null and timed_duration_minutes between 0 and 5270400 and all_day_duration_days is null)
  )
);

create index calendar_event_recurrence_series_family_idx
  on public.calendar_event_recurrence_series(family_id,recurrence_enabled);

alter table public.calendar_events
  add column recurrence_series_id uuid,
  add column recurrence_occurrence_date date;

alter table public.calendar_events
  add constraint calendar_events_recurrence_series_fkey
  foreign key(recurrence_series_id,family_id)
  references public.calendar_event_recurrence_series(id,family_id)
  on delete cascade,
  add constraint calendar_events_recurrence_identity_check check(
    (recurrence_series_id is null and recurrence_occurrence_date is null)
    or (recurrence_series_id is not null and recurrence_occurrence_date is not null)
  );

create unique index calendar_events_recurrence_occurrence_unique
  on public.calendar_events(recurrence_series_id,recurrence_occurrence_date)
  where recurrence_series_id is not null;

create index calendar_events_recurrence_series_idx
  on public.calendar_events(recurrence_series_id)
  where recurrence_series_id is not null;

create table public.calendar_event_recurrence_exclusions (
  series_id uuid not null,
  family_id uuid not null,
  occurrence_date date not null,
  excluded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  primary key(series_id,occurrence_date),
  constraint calendar_event_recurrence_exclusions_series_fkey
    foreign key(series_id,family_id)
    references public.calendar_event_recurrence_series(id,family_id)
    on delete cascade
);

create index calendar_event_recurrence_exclusions_family_idx
  on public.calendar_event_recurrence_exclusions(family_id,series_id);

create or replace function private.next_calendar_occurrence_date(
  previous_date date,
  anchor_date date,
  recurrence_rule jsonb
)
returns date
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rule_type text := recurrence_rule->>'type';
  step integer := (recurrence_rule->>'interval')::integer;
  candidate date;
  target_month date;
  target_day integer;
  last_day integer;
  week_delta integer;
  attempts integer := 0;
begin
  if not private.valid_task_recurrence_rule(recurrence_rule) then
    raise exception 'invalid recurrence rule';
  end if;
  if rule_type='daily' then
    return previous_date+step;
  elsif rule_type='weekly' then
    candidate:=previous_date+1;
    loop
      week_delta:=((pg_catalog.date_trunc('week',candidate::timestamp)::date-pg_catalog.date_trunc('week',anchor_date::timestamp)::date)/7);
      exit when week_delta>=0 and mod(week_delta,step)=0 and exists(
        select 1 from pg_catalog.jsonb_array_elements_text(recurrence_rule->'weekdays') d(value)
        where d.value=extract(isodow from candidate)::integer::text
      );
      candidate:=candidate+1;
      attempts:=attempts+1;
      if attempts>7007 then raise exception 'unable to calculate weekly recurrence'; end if;
    end loop;
    return candidate;
  elsif rule_type='monthly' then
    target_month:=(pg_catalog.date_trunc('month',previous_date::timestamp)+pg_catalog.make_interval(months=>step))::date;
    target_day:=(recurrence_rule->>'day_of_month')::integer;
  else
    target_month:=pg_catalog.make_date(extract(year from previous_date)::integer+step,(recurrence_rule->>'month')::integer,1);
    target_day:=(recurrence_rule->>'day_of_month')::integer;
  end if;
  last_day:=extract(day from (target_month+interval '1 month - 1 day'))::integer;
  return target_month+(least(target_day,last_day)-1);
end;
$$;

revoke all on function private.next_calendar_occurrence_date(date,date,jsonb) from public,anon,authenticated;

create or replace function private.ensure_calendar_event_series_occurrences(target_series_id uuid,horizon_days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  series_row public.calendar_event_recurrence_series%rowtype;
  occurrence_date date;
  last_processed_occurrence_date date;
  target_date date;
  occurrence_start timestamptz;
  inserted_count integer:=0;
  inserted_now integer;
begin
  if horizon_days not between 1 and 730 then raise exception 'invalid calendar recurrence horizon'; end if;
  select s.* into series_row
  from public.calendar_event_recurrence_series s
  where s.id=target_series_id and s.recurrence_enabled
  for update skip locked;
  if series_row.id is null then return 0; end if;

  target_date:=greatest(series_row.anchor_date,(pg_catalog.now() at time zone series_row.recurrence_timezone)::date+horizon_days);
  occurrence_date:=coalesce(series_row.generated_through,series_row.anchor_date-1);
  last_processed_occurrence_date:=series_row.generated_through;
  loop
    if occurrence_date<series_row.anchor_date then occurrence_date:=series_row.anchor_date;
    else occurrence_date:=private.next_calendar_occurrence_date(occurrence_date,series_row.anchor_date,series_row.recurrence_rule); end if;
    exit when occurrence_date>target_date;
    last_processed_occurrence_date:=occurrence_date;
    if not exists(select 1 from public.calendar_event_recurrence_exclusions x where x.series_id=series_row.id and x.occurrence_date=occurrence_date) then
      if series_row.all_day then
        insert into public.calendar_events(
          family_id,title,description,event_type,location,all_day,start_date,end_date,created_by,
          recurrence_series_id,recurrence_occurrence_date
        ) values(
          series_row.family_id,series_row.title,series_row.description,series_row.event_type,series_row.location,true,
          occurrence_date,case when series_row.all_day_duration_days=0 then null else occurrence_date+series_row.all_day_duration_days end,
          series_row.created_by,series_row.id,occurrence_date
        ) on conflict(recurrence_series_id,recurrence_occurrence_date) where recurrence_series_id is not null do nothing;
      else
        occurrence_start:=(occurrence_date::timestamp+series_row.anchor_local_time) at time zone series_row.recurrence_timezone;
        insert into public.calendar_events(
          family_id,title,description,event_type,location,all_day,starts_at,ends_at,created_by,
          recurrence_series_id,recurrence_occurrence_date
        ) values(
          series_row.family_id,series_row.title,series_row.description,series_row.event_type,series_row.location,false,
          occurrence_start,case when series_row.timed_duration_minutes=0 then null else occurrence_start+pg_catalog.make_interval(mins=>series_row.timed_duration_minutes) end,
          series_row.created_by,series_row.id,occurrence_date
        ) on conflict(recurrence_series_id,recurrence_occurrence_date) where recurrence_series_id is not null do nothing;
      end if;
      get diagnostics inserted_now=row_count;
      inserted_count:=inserted_count+inserted_now;
    end if;
  end loop;
  if last_processed_occurrence_date is distinct from series_row.generated_through then
    update public.calendar_event_recurrence_series
    set generated_through=last_processed_occurrence_date,updated_at=pg_catalog.now()
    where id=series_row.id;
  end if;
  return inserted_count;
end;
$$;

revoke all on function private.ensure_calendar_event_series_occurrences(uuid,integer) from public,anon,authenticated;

create or replace function private.ensure_calendar_event_occurrences(horizon_days integer default 400)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_series_id uuid;
  inserted_count integer:=0;
begin
  if horizon_days not between 1 and 730 then raise exception 'invalid calendar recurrence horizon'; end if;
  for target_series_id in
    select s.id from public.calendar_event_recurrence_series s
    where s.recurrence_enabled
    order by s.id
  loop
    inserted_count:=inserted_count+private.ensure_calendar_event_series_occurrences(target_series_id,horizon_days);
  end loop;
  return inserted_count;
end;
$$;

revoke all on function private.ensure_calendar_event_occurrences(integer) from public,anon,authenticated;

create or replace function private.validate_calendar_recurrence_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op='UPDATE' and old.recurrence_series_id is not null and (
    new.recurrence_series_id is distinct from old.recurrence_series_id
    or new.recurrence_occurrence_date is distinct from old.recurrence_occurrence_date
  ) then raise exception 'calendar recurrence identity cannot be changed'; end if;
  return new;
end;
$$;

revoke all on function private.validate_calendar_recurrence_identity() from public,anon,authenticated;
create trigger validate_calendar_recurrence_identity before update on public.calendar_events
for each row execute function private.validate_calendar_recurrence_identity();

create or replace function private.can_manage_calendar_event(target_event public.calendar_events)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_family_member(target_event.family_id) and (
    public.has_family_role(target_event.family_id,array['owner','admin']::public.family_role[])
    or target_event.created_by=(select auth.uid())
  );
$$;

revoke all on function private.can_manage_calendar_event(public.calendar_events) from public,anon,authenticated;

create or replace function public.create_recurring_calendar_event(
  target_family_id uuid,event_title text,event_description text,event_type_value text,event_location text,
  event_all_day boolean,event_starts_at timestamptz,event_ends_at timestamptz,event_start_date date,event_end_date date,
  recurrence_rule_value jsonb,recurrence_timezone_value text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid:=(select auth.uid());
  series_id uuid;
  first_event_id uuid;
  local_start timestamp;
  anchor date;
  duration_minutes integer;
  duration_days integer;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if not public.has_family_role(target_family_id,array['owner','admin','adult']::public.family_role[]) then raise exception 'calendar event creation requires an active adult'; end if;
  if not private.valid_task_recurrence_rule(recurrence_rule_value) then raise exception 'invalid recurrence rule'; end if;
  if not private.valid_timezone(recurrence_timezone_value) then raise exception 'invalid recurrence timezone'; end if;
  if pg_catalog.char_length(pg_catalog.btrim(event_title)) not between 1 and 200 then raise exception 'invalid event title'; end if;
  if event_all_day then
    if event_start_date is null or event_starts_at is not null or event_ends_at is not null or (event_end_date is not null and event_end_date<event_start_date) then raise exception 'invalid all-day event range'; end if;
    anchor:=event_start_date;
    duration_days:=coalesce(event_end_date-event_start_date,0);
  else
    if event_starts_at is null or event_start_date is not null or event_end_date is not null or (event_ends_at is not null and event_ends_at<event_starts_at) then raise exception 'invalid timed event range'; end if;
    local_start:=event_starts_at at time zone recurrence_timezone_value;
    anchor:=local_start::date;
    duration_minutes:=coalesce(extract(epoch from (event_ends_at-event_starts_at))/60,0)::integer;
  end if;
  insert into public.calendar_event_recurrence_series(
    family_id,title,description,event_type,location,all_day,anchor_date,anchor_local_time,
    timed_duration_minutes,all_day_duration_days,recurrence_rule,recurrence_timezone,created_by
  ) values(
    target_family_id,pg_catalog.btrim(event_title),nullif(pg_catalog.btrim(event_description),''),event_type_value,
    nullif(pg_catalog.btrim(event_location),''),event_all_day,anchor,case when event_all_day then null else local_start::time end,
    duration_minutes,duration_days,recurrence_rule_value,recurrence_timezone_value,actor
  ) returning id into series_id;
  perform private.ensure_calendar_event_series_occurrences(series_id,400);
  select e.id into first_event_id from public.calendar_events e
  where e.recurrence_series_id=series_id and e.recurrence_occurrence_date=anchor;
  return first_event_id;
end;
$$;

revoke all on function public.create_recurring_calendar_event(uuid,text,text,text,text,boolean,timestamptz,timestamptz,date,date,jsonb,text) from public,anon;
grant execute on function public.create_recurring_calendar_event(uuid,text,text,text,text,boolean,timestamptz,timestamptz,date,date,jsonb,text) to authenticated;

create or replace function public.delete_calendar_event_occurrence(target_family_id uuid,target_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare target_event public.calendar_events%rowtype;
begin
  select * into target_event from public.calendar_events where id=target_event_id and family_id=target_family_id for update;
  if target_event.id is null then return false; end if;
  if not private.can_manage_calendar_event(target_event) then raise exception 'calendar event deletion is not allowed'; end if;
  if target_event.recurrence_series_id is not null then
    insert into public.calendar_event_recurrence_exclusions(series_id,family_id,occurrence_date,excluded_by)
    values(target_event.recurrence_series_id,target_event.family_id,target_event.recurrence_occurrence_date,(select auth.uid()))
    on conflict(series_id,occurrence_date) do nothing;
  end if;
  delete from public.reminders where family_id=target_family_id and source_type='calendar_event' and source_id=target_event_id and status='pending';
  delete from public.calendar_events where id=target_event_id and family_id=target_family_id;
  return true;
end;
$$;

revoke all on function public.delete_calendar_event_occurrence(uuid,uuid) from public,anon;
grant execute on function public.delete_calendar_event_occurrence(uuid,uuid) to authenticated;

create or replace function public.stop_calendar_event_recurrence(target_family_id uuid,target_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare target_event public.calendar_events%rowtype; series_id uuid; affected_ids uuid[];
begin
  select * into target_event from public.calendar_events where id=target_event_id and family_id=target_family_id for update;
  if target_event.id is null or target_event.recurrence_series_id is null then return false; end if;
  if not private.can_manage_calendar_event(target_event) then raise exception 'calendar recurrence management is not allowed'; end if;
  series_id:=target_event.recurrence_series_id;
  update public.calendar_event_recurrence_series set recurrence_enabled=false,stopped_at=pg_catalog.now(),updated_at=pg_catalog.now()
  where id=series_id and family_id=target_family_id;
  select pg_catalog.array_agg(e.id) into affected_ids from public.calendar_events e
  where e.family_id=target_family_id and e.recurrence_series_id=series_id and (
    (not e.all_day and e.starts_at>pg_catalog.now()) or
    (e.all_day and e.start_date>(pg_catalog.now() at time zone (select recurrence_timezone from public.calendar_event_recurrence_series where id=series_id))::date)
  );
  if affected_ids is not null then
    delete from public.reminders where family_id=target_family_id and source_type='calendar_event' and source_id=any(affected_ids) and status='pending';
    delete from public.calendar_events where family_id=target_family_id and id=any(affected_ids);
  end if;
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target_family_id,(select auth.uid()),'calendar_event.series_stopped','calendar_event_recurrence_series',series_id::text,pg_catalog.jsonb_build_object('sourceEventId',target_event_id)) on conflict do nothing;
  return true;
end;
$$;

revoke all on function public.stop_calendar_event_recurrence(uuid,uuid) from public,anon;
grant execute on function public.stop_calendar_event_recurrence(uuid,uuid) to authenticated;

alter table public.calendar_event_recurrence_series enable row level security;
alter table public.calendar_event_recurrence_exclusions enable row level security;
revoke all on public.calendar_event_recurrence_series from anon,authenticated;
revoke all on public.calendar_event_recurrence_exclusions from anon,authenticated;
grant select on public.calendar_event_recurrence_series to authenticated;
grant select on public.calendar_event_recurrence_exclusions to authenticated;
create policy calendar_event_recurrence_series_read on public.calendar_event_recurrence_series for select to authenticated using((select public.is_family_member(family_id)));
create policy calendar_event_recurrence_exclusions_read on public.calendar_event_recurrence_exclusions for select to authenticated using((select public.is_family_member(family_id)));

revoke delete on public.calendar_events from authenticated;

do $$
declare job_id bigint;
begin
  for job_id in select jobid from cron.job where jobname='calendar-recurrence-every-hour' order by jobid loop
    perform cron.unschedule(job_id);
  end loop;
end;
$$;

select cron.schedule('calendar-recurrence-every-hour','0 * * * *',$job$select private.ensure_calendar_event_occurrences(400);$job$);

-- Preserve the v1 backup envelope and extend only the calendar collection.
alter function public.export_family_data(uuid,text[]) rename to export_family_data_before_calendar_recurrence;
revoke all on function public.export_family_data_before_calendar_recurrence(uuid,text[]) from public,anon,authenticated;

create or replace function public.export_family_data(target_family_id uuid,selected_modules text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  event_items jsonb;
  series_items jsonb;
  exclusion_items jsonb;
begin
  result:=public.export_family_data_before_calendar_recurrence(target_family_id,selected_modules);
  if 'calendar'=any(selected_modules) then
    select coalesce(pg_catalog.jsonb_agg(
      event_item.value||pg_catalog.jsonb_build_object(
        'recurrenceSeriesId',e.recurrence_series_id,
        'recurrenceOccurrenceDate',e.recurrence_occurrence_date
      ) order by event_item.value->>'createdAt',event_item.value->>'id'
    ),'[]'::jsonb) into event_items
    from pg_catalog.jsonb_array_elements(result#>'{modules,calendar,events}') event_item(value)
    join public.calendar_events e on e.id=(event_item.value->>'id')::uuid and e.family_id=target_family_id;

    select coalesce(pg_catalog.jsonb_agg(to_jsonb(x) order by x."createdAt",x.id),'[]'::jsonb) into series_items
    from (
      select s.id,s.title,s.description,s.event_type as "eventType",s.location,s.all_day as "allDay",
        s.anchor_date as "anchorDate",s.anchor_local_time as "anchorLocalTime",
        s.timed_duration_minutes as "timedDurationMinutes",s.all_day_duration_days as "allDayDurationDays",
        s.recurrence_rule as "recurrenceRule",s.recurrence_timezone as "recurrenceTimezone",
        s.recurrence_enabled as "recurrenceEnabled",s.generated_through as "generatedThrough",
        s.created_by as "createdBy",s.stopped_at as "stoppedAt",s.created_at as "createdAt",s.updated_at as "updatedAt"
      from public.calendar_event_recurrence_series s where s.family_id=target_family_id
    ) x;

    select coalesce(pg_catalog.jsonb_agg(to_jsonb(x) order by x."seriesId",x."occurrenceDate"),'[]'::jsonb) into exclusion_items
    from (
      select x.series_id as "seriesId",x.occurrence_date as "occurrenceDate",x.excluded_by as "excludedBy",x.created_at as "createdAt"
      from public.calendar_event_recurrence_exclusions x where x.family_id=target_family_id
    ) x;

    result:=pg_catalog.jsonb_set(result,'{modules,calendar,events}',event_items,true);
    result:=pg_catalog.jsonb_set(result,'{modules,calendar,recurrenceSeries}',series_items,true);
    result:=pg_catalog.jsonb_set(result,'{modules,calendar,exclusions}',exclusion_items,true);
    result:=pg_catalog.jsonb_set(result,'{recordCounts,calendar,recurrenceSeries}',to_jsonb(pg_catalog.jsonb_array_length(series_items)),true);
    result:=pg_catalog.jsonb_set(result,'{recordCounts,calendar,exclusions}',to_jsonb(pg_catalog.jsonb_array_length(exclusion_items)),true);
    if pg_catalog.octet_length(pg_catalog.convert_to(result::text,'UTF8'))>8388608 then raise exception 'family export exceeds the 8 MiB synchronous export limit'; end if;
  end if;
  return result;
end;
$$;

revoke all on function public.export_family_data(uuid,text[]) from public,anon,authenticated;
grant execute on function public.export_family_data(uuid,text[]) to authenticated;

alter function public.preflight_family_restore(uuid,jsonb,text[],jsonb) rename to preflight_family_restore_before_calendar_recurrence;
revoke all on function public.preflight_family_restore_before_calendar_recurrence(uuid,jsonb,text[],jsonb) from public,anon,authenticated;

create or replace function private.calendar_restore_base_backup(backup jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare clean jsonb:=backup; clean_events jsonb;
begin
  if backup#>'{modules,calendar,events}' is not null then
    select coalesce(pg_catalog.jsonb_agg(value-'recurrenceSeriesId'-'recurrenceOccurrenceDate'),'[]'::jsonb)
      into clean_events from pg_catalog.jsonb_array_elements(backup#>'{modules,calendar,events}');
    clean:=pg_catalog.jsonb_set(clean,'{modules,calendar,events}',clean_events,true);
    clean:=clean#-'{modules,calendar,recurrenceSeries}'#-'{modules,calendar,exclusions}';
    clean:=clean#-'{recordCounts,calendar,recurrenceSeries}'#-'{recordCounts,calendar,exclusions}';
  end if;
  return clean;
end;
$$;

revoke all on function private.calendar_restore_base_backup(jsonb) from public,anon,authenticated;

create or replace function private.restore_valid_time(value text,nullable boolean default false)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if value is null or value='' then return nullable; end if;
  perform value::time;
  return true;
exception when others then
  return false;
end;
$$;

revoke all on function private.restore_valid_time(text,boolean) from public,anon,authenticated;

create or replace function public.preflight_family_restore(target_family_id uuid,backup jsonb,selected_modules text[],user_mapping jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  errors jsonb;
  item jsonb;
  series_items jsonb:=coalesce(backup#>'{modules,calendar,recurrenceSeries}','[]'::jsonb);
  exclusion_items jsonb:=coalesce(backup#>'{modules,calendar,exclusions}','[]'::jsonb);
begin
  result:=public.preflight_family_restore_before_calendar_recurrence(target_family_id,private.calendar_restore_base_backup(backup),selected_modules,user_mapping);
  errors:=coalesce(result->'errors','[]'::jsonb);
  if 'calendar'=any(selected_modules) and (
    backup#>'{modules,calendar,recurrenceSeries}' is not null
    or backup#>'{modules,calendar,exclusions}' is not null
    or exists(
      select 1 from pg_catalog.jsonb_array_elements(coalesce(backup#>'{modules,calendar,events}','[]'::jsonb)) e
      where e ? 'recurrenceSeriesId' or e ? 'recurrenceOccurrenceDate'
    )
  ) then
    if pg_catalog.jsonb_typeof(series_items) is distinct from 'array' or pg_catalog.jsonb_typeof(exclusion_items) is distinct from 'array' then
      errors:=errors||pg_catalog.jsonb_build_array('invalid_calendar_recurrence_shape');
    else
      if not private.restore_ids_valid_unique(series_items) then errors:=errors||pg_catalog.jsonb_build_array('invalid_or_duplicate_calendar_recurrence_series_ids'); end if;
      for item in select value from pg_catalog.jsonb_array_elements(series_items) loop
        if not private.restore_valid_date(item->>'anchorDate')
          or not private.restore_valid_date(item->>'generatedThrough',true) then
          errors:=errors||pg_catalog.jsonb_build_array('invalid_calendar_recurrence_series');
        elsif item->>'generatedThrough' is not null
          and (item->>'generatedThrough')::date<(item->>'anchorDate')::date then
          errors:=errors||pg_catalog.jsonb_build_array('invalid_calendar_recurrence_series');
        elsif item->>'title' is null or pg_catalog.char_length(item->>'title') not between 1 and 200
          or item->>'eventType' not in ('family','appointment','school','work','birthday','other')
          or pg_catalog.jsonb_typeof(item->'allDay') is distinct from 'boolean'
          or item->'recurrenceRule' is null or not private.valid_task_recurrence_rule(item->'recurrenceRule')
          or item->>'recurrenceTimezone' is null or not private.valid_timezone(item->>'recurrenceTimezone')
          or pg_catalog.jsonb_typeof(item->'recurrenceEnabled') is distinct from 'boolean'
          or not private.restore_valid_timestamp(item->>'stoppedAt',true)
          or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt')
          or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false)
          or ((item->>'allDay')::boolean and (item->>'allDayDurationDays')::integer not between 0 and 3660)
          or (not (item->>'allDay')::boolean and (not private.restore_valid_time(item->>'anchorLocalTime') or (item->>'timedDurationMinutes')::integer not between 0 and 5270400)) then
          errors:=errors||pg_catalog.jsonb_build_array('invalid_calendar_recurrence_series');
        end if;
      end loop;
      for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,calendar,events}') loop
        if (item->>'recurrenceSeriesId' is null)<>(item->>'recurrenceOccurrenceDate' is null)
          or (item->>'recurrenceSeriesId' is not null and (
            not exists(select 1 from pg_catalog.jsonb_array_elements(series_items) s where s->>'id'=item->>'recurrenceSeriesId')
            or not private.restore_valid_date(item->>'recurrenceOccurrenceDate')
          )) then errors:=errors||pg_catalog.jsonb_build_array('invalid_calendar_recurrence_event_link'); end if;
      end loop;
      for item in select value from pg_catalog.jsonb_array_elements(exclusion_items) loop
        if not private.restore_valid_date(item->>'occurrenceDate')
          or not exists(select 1 from pg_catalog.jsonb_array_elements(series_items) s where s->>'id'=item->>'seriesId')
          or not private.valid_restore_mapping(user_mapping,item->>'excludedBy',target_family_id,false,false)
          or not private.restore_valid_timestamp(item->>'createdAt') then
          errors:=errors||pg_catalog.jsonb_build_array('invalid_calendar_recurrence_exclusion');
        end if;
      end loop;
      if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(exclusion_items))<>(select pg_catalog.count(distinct (x->>'seriesId',x->>'occurrenceDate')) from pg_catalog.jsonb_array_elements(exclusion_items) x) then errors:=errors||pg_catalog.jsonb_build_array('duplicate_calendar_recurrence_exclusion'); end if;
    end if;
    if backup#>>'{recordCounts,calendar,recurrenceSeries}' is distinct from pg_catalog.jsonb_array_length(series_items)::text
      or backup#>>'{recordCounts,calendar,exclusions}' is distinct from pg_catalog.jsonb_array_length(exclusion_items)::text then
      errors:=errors||pg_catalog.jsonb_build_array('record_count_mismatch:calendar_recurrence');
    end if;
  end if;
  result:=pg_catalog.jsonb_set(result,'{errors}',errors,true);
  result:=pg_catalog.jsonb_set(result,'{valid}',to_jsonb(pg_catalog.jsonb_array_length(errors)=0),true);
  if 'calendar'=any(selected_modules) then
    result:=pg_catalog.jsonb_set(result,'{moduleCounts,calendar,recurrenceSeries}',to_jsonb(pg_catalog.jsonb_array_length(series_items)),true);
    result:=pg_catalog.jsonb_set(result,'{moduleCounts,calendar,exclusions}',to_jsonb(pg_catalog.jsonb_array_length(exclusion_items)),true);
  end if;
  return result;
exception when others then
  return pg_catalog.jsonb_build_object('valid',false,'errors',pg_catalog.jsonb_build_array('invalid_calendar_recurrence_payload'),'warnings','[]'::jsonb);
end;
$$;

revoke all on function public.preflight_family_restore(uuid,jsonb,text[],jsonb) from public,anon,authenticated;
grant execute on function public.preflight_family_restore(uuid,jsonb,text[],jsonb) to authenticated;

create or replace function public.restore_family_data(
  target_family_id uuid,backup jsonb,selected_modules text[],user_mapping jsonb,restore_mode text,confirmation_family_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  report jsonb; normalized text[]; restore_operation_id uuid:=pg_catalog.gen_random_uuid(); destination_name text;
  item jsonb; mapped_id uuid; transaction_id uuid; ignored integer:=0; cleared integer:=0;
  series_map jsonb:='{}'::jsonb; task_map jsonb:='{}'::jsonb; event_map jsonb:='{}'::jsonb;
  calendar_series_map jsonb:='{}'::jsonb;
  list_map jsonb:='{}'::jsonb; item_map jsonb:='{}'::jsonb; transaction_map jsonb:='{}'::jsonb;
  settlement_map jsonb:='{}'::jsonb; plan_map jsonb:='{}'::jsonb; property_map jsonb:='{}'::jsonb;
  unit_map jsonb:='{}'::jsonb; definition_map jsonb:='{}'::jsonb; charge_map jsonb:='{}'::jsonb;
begin
  if restore_mode<>'replace_selected' then raise exception 'unsupported restore mode'; end if;
  if (select auth.uid()) is null or not public.has_family_role(target_family_id,array['owner']::public.family_role[]) then raise exception 'only an active family owner may restore a backup'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_family_id::text,0));
  select f.name into destination_name from public.families f where f.id=target_family_id for update;
  if destination_name is null or confirmation_family_name is distinct from destination_name then raise exception 'destination family confirmation does not match'; end if;
  report:=public.preflight_family_restore(target_family_id,backup,selected_modules,user_mapping);
  if not coalesce((report->>'valid')::boolean,false) then raise exception 'restore validation failed: %',report->'errors'; end if;
  normalized:=array(select pg_catalog.jsonb_array_elements_text(report->'normalizedModules'));
  perform pg_catalog.set_config('family_planner.restore_operation',restore_operation_id::text,true);
  insert into private.family_restore_context(operation_id,transaction_id,backend_pid,family_id,actor_user_id)
  values(restore_operation_id,pg_catalog.txid_current(),pg_catalog.pg_backend_pid(),target_family_id,(select auth.uid()));

  -- Generate every destination identifier before any relationship is written.
  if 'tasks'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,recurrenceSeries}') loop series_map:=series_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,items}') loop task_map:=task_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
  end if;
  if 'calendar'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(coalesce(backup#>'{modules,calendar,recurrenceSeries}','[]'::jsonb)) loop calendar_series_map:=calendar_series_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,calendar,events}') loop event_map:=event_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
  end if;
  if 'shopping'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,shopping,lists}') loop list_map:=list_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,shopping,items}') loop item_map:=item_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
  end if;
  if 'budget'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,transactions}') loop transaction_map:=transaction_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlements}') loop settlement_map:=settlement_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,plans}') loop plan_map:=plan_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
  end if;
  if 'fixedCharges'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,properties}') loop property_map:=property_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,units}') loop unit_map:=unit_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,definitions}') loop definition_map:=definition_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,charges}') loop charge_map:=charge_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
  end if;

  -- Delete selected modules while restore context suppresses technical triggers/audits.
  if 'tasks'=any(normalized) then delete from public.notifications where family_id=target_family_id and source_type='task'; delete from public.reminders where family_id=target_family_id and source_type='task'; delete from public.tasks where family_id=target_family_id; delete from public.task_recurrence_series where family_id=target_family_id; end if;
  if 'calendar'=any(normalized) then delete from public.notifications where family_id=target_family_id and source_type='calendar_event'; delete from public.reminders where family_id=target_family_id and source_type='calendar_event'; delete from public.calendar_events where family_id=target_family_id; delete from public.calendar_event_recurrence_series where family_id=target_family_id; end if;
  if 'shopping'=any(normalized) then delete from public.shopping_items where family_id=target_family_id; delete from public.shopping_lists where family_id=target_family_id; end if;
  if 'fixedCharges'=any(normalized) then delete from public.notifications where family_id=target_family_id and source_type='property_charge'; delete from public.reminders where family_id=target_family_id and source_type='property_charge'; delete from public.property_charges where family_id=target_family_id; delete from public.property_charge_reminder_rules where family_id=target_family_id; delete from public.property_charge_schedule_dates where family_id=target_family_id; delete from public.property_charge_definitions where family_id=target_family_id; delete from public.property_units where family_id=target_family_id; delete from public.properties where family_id=target_family_id; end if;
  if 'budget'=any(normalized) then delete from public.budget_expense_participants where family_id=target_family_id; delete from public.budget_settlements where family_id=target_family_id; delete from public.budget_plans where family_id=target_family_id; delete from public.budget_settlement_members where family_id=target_family_id; delete from public.budget_transactions where family_id=target_family_id; end if;
  if 'reminders'=any(normalized) then delete from public.reminders where family_id=target_family_id and recipient_user_id=(select auth.uid()) and reminder_kind='personal'; end if;

  -- Budget precedes fixed charges so restored charges can target mapped transactions.
  if 'budget'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlementMembers}') loop insert into public.budget_settlement_members(family_id,user_id,is_active,created_by,created_at,updated_at) values(target_family_id,private.restore_mapping_value(user_mapping,item->>'userId'),(item->>'isActive')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,transactions}') loop insert into public.budget_transactions(id,family_id,transaction_type,title,description,amount,currency,category,transaction_date,paid_by,is_shared,created_by,created_at,updated_at) values((transaction_map->>(item->>'id'))::uuid,target_family_id,item->>'transactionType',item->>'title',item->>'description',(item->>'amount')::numeric,item->>'currency',item->>'category',(item->>'transactionDate')::date,private.restore_mapping_value(user_mapping,item->>'paidBy',true),(item->>'isShared')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,expenseParticipants}') loop insert into public.budget_expense_participants(transaction_id,family_id,user_id,share_weight,created_at) values((transaction_map->>(item->>'transactionId'))::uuid,target_family_id,private.restore_mapping_value(user_mapping,item->>'userId'),(item->>'shareWeight')::numeric,(item->>'createdAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlements}') loop insert into public.budget_settlements(id,family_id,from_user_id,to_user_id,amount,currency,settlement_date,note,created_by,created_at,updated_at) values((settlement_map->>(item->>'id'))::uuid,target_family_id,private.restore_mapping_value(user_mapping,item->>'fromUserId'),private.restore_mapping_value(user_mapping,item->>'toUserId'),(item->>'amount')::numeric,item->>'currency',(item->>'settlementDate')::date,item->>'note',private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,plans}') loop insert into public.budget_plans(id,family_id,month,plan_type,category,amount,currency,created_by,created_at,updated_at) values((plan_map->>(item->>'id'))::uuid,target_family_id,(item->>'month')::date,item->>'planType',item->>'category',(item->>'amount')::numeric,item->>'currency',private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
  end if;

  if 'tasks'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,recurrenceSeries}') loop insert into public.task_recurrence_series(id,family_id,recurrence_rule,recurrence_timezone,anchor_due_at,recurrence_enabled,created_by,stopped_at,created_at,updated_at) values((series_map->>(item->>'id'))::uuid,target_family_id,item->'recurrenceRule',item->>'recurrenceTimezone',(item->>'anchorDueAt')::timestamptz,(item->>'recurrenceEnabled')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),nullif(item->>'stoppedAt','')::timestamptz,(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,items}') order by coalesce((value->>'occurrenceIndex')::integer,0) loop insert into public.tasks(id,family_id,title,description,status,priority,assigned_to,due_at,created_by,created_at,updated_at,completed_at,recurrence_series_id,occurrence_index,generated_from_task_id,assignee_reminder_offset_minutes) values((task_map->>(item->>'id'))::uuid,target_family_id,item->>'title',item->>'description',item->>'status',item->>'priority',private.restore_mapping_value(user_mapping,item->>'assignedTo',true),nullif(item->>'dueAt','')::timestamptz,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz,nullif(item->>'completedAt','')::timestamptz,nullif(series_map->>(item->>'recurrenceSeriesId'),'')::uuid,coalesce((item->>'occurrenceIndex')::integer,0),nullif(task_map->>(item->>'generatedFromTaskId'),'')::uuid,nullif(item->>'assigneeReminderOffsetMinutes','')::integer); end loop;
  end if;

  if 'calendar'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(coalesce(backup#>'{modules,calendar,recurrenceSeries}','[]'::jsonb)) loop
      insert into public.calendar_event_recurrence_series(
        id,family_id,title,description,event_type,location,all_day,anchor_date,anchor_local_time,timed_duration_minutes,
        all_day_duration_days,recurrence_rule,recurrence_timezone,recurrence_enabled,generated_through,created_by,stopped_at,created_at,updated_at
      ) values(
        (calendar_series_map->>(item->>'id'))::uuid,target_family_id,item->>'title',item->>'description',item->>'eventType',item->>'location',(item->>'allDay')::boolean,
        (item->>'anchorDate')::date,nullif(item->>'anchorLocalTime','')::time,nullif(item->>'timedDurationMinutes','')::integer,
        nullif(item->>'allDayDurationDays','')::integer,item->'recurrenceRule',item->>'recurrenceTimezone',(item->>'recurrenceEnabled')::boolean,
        nullif(item->>'generatedThrough','')::date,private.restore_mapping_value(user_mapping,item->>'createdBy'),nullif(item->>'stoppedAt','')::timestamptz,
        (item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz
      );
    end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,calendar,events}') loop
      insert into public.calendar_events(
        id,family_id,title,description,event_type,location,all_day,starts_at,ends_at,start_date,end_date,created_by,created_at,updated_at,
        recurrence_series_id,recurrence_occurrence_date
      ) values(
        (event_map->>(item->>'id'))::uuid,target_family_id,item->>'title',item->>'description',item->>'eventType',item->>'location',(item->>'allDay')::boolean,
        nullif(item->>'startsAt','')::timestamptz,nullif(item->>'endsAt','')::timestamptz,nullif(item->>'startDate','')::date,nullif(item->>'endDate','')::date,
        private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz,
        case when item->>'recurrenceSeriesId' is null then null else (calendar_series_map->>(item->>'recurrenceSeriesId'))::uuid end,
        nullif(item->>'recurrenceOccurrenceDate','')::date
      );
    end loop;
    for item in select value from pg_catalog.jsonb_array_elements(coalesce(backup#>'{modules,calendar,exclusions}','[]'::jsonb)) loop
      insert into public.calendar_event_recurrence_exclusions(series_id,family_id,occurrence_date,excluded_by,created_at)
      values((calendar_series_map->>(item->>'seriesId'))::uuid,target_family_id,(item->>'occurrenceDate')::date,
        private.restore_mapping_value(user_mapping,item->>'excludedBy'),(item->>'createdAt')::timestamptz);
    end loop;
  end if;

  if 'shopping'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,shopping,lists}') loop insert into public.shopping_lists(id,family_id,name,description,is_archived,created_by,created_at,updated_at) values((list_map->>(item->>'id'))::uuid,target_family_id,item->>'name',item->>'description',(item->>'isArchived')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,shopping,items}') loop insert into public.shopping_items(id,family_id,list_id,name,quantity,unit,category,note,is_purchased,created_by,purchased_by,purchased_at,created_at,updated_at) values((item_map->>(item->>'id'))::uuid,target_family_id,(list_map->>(item->>'listId'))::uuid,item->>'name',nullif(item->>'quantity','')::numeric,item->>'unit',item->>'category',item->>'note',(item->>'isPurchased')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),private.restore_mapping_value(user_mapping,item->>'purchasedBy',true),nullif(item->>'purchasedAt','')::timestamptz,(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
  end if;

  if 'fixedCharges'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,properties}') loop insert into public.properties(id,family_id,name,address,description,active,created_by,created_at,updated_at) values((property_map->>(item->>'id'))::uuid,target_family_id,item->>'name',item->>'address',item->>'description',(item->>'active')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,units}') loop insert into public.property_units(id,family_id,property_id,name,unit_type,active,created_by,created_at,updated_at) values((unit_map->>(item->>'id'))::uuid,target_family_id,(property_map->>(item->>'propertyId'))::uuid,item->>'name',item->>'unitType',(item->>'active')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,definitions}') loop insert into public.property_charge_definitions(id,family_id,property_id,property_unit_id,name,category,amount_mode,planned_amount,currency,recurrence_type,recurrence_timezone,start_date,generation_resume_date,due_day,interval_months,recurrence_month,active,auto_generate,budget_sync_mode,created_by,created_at,updated_at,suspended_by_property) values((definition_map->>(item->>'id'))::uuid,target_family_id,(property_map->>(item->>'propertyId'))::uuid,nullif(unit_map->>(item->>'propertyUnitId'),'')::uuid,item->>'name',item->>'category',item->>'amountMode',nullif(item->>'plannedAmount','')::numeric,item->>'currency',item->>'recurrenceType',item->>'recurrenceTimezone',(item->>'startDate')::date,greatest((item->>'generationResumeDate')::date,current_date),nullif(item->>'dueDay','')::integer,nullif(item->>'intervalMonths','')::integer,nullif(item->>'recurrenceMonth','')::integer,(item->>'active')::boolean,(item->>'autoGenerate')::boolean,item->>'budgetSyncMode',private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz,false); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,scheduleDates}') loop insert into public.property_charge_schedule_dates(definition_id,family_id,month,day) values((definition_map->>(item->>'definitionId'))::uuid,target_family_id,(item->>'month')::integer,(item->>'day')::integer); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,reminderRules}') loop insert into public.property_charge_reminder_rules(definition_id,family_id,recipient_user_id,offset_days,created_at) values((definition_map->>(item->>'definitionId'))::uuid,target_family_id,private.restore_mapping_value(user_mapping,item->>'recipientUserId'),(item->>'offsetDays')::integer,(item->>'createdAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,charges}') loop transaction_id:=null; if 'budget'=any(normalized) and item->>'budgetTransactionId' is not null then transaction_id:=(transaction_map->>(item->>'budgetTransactionId'))::uuid; elsif item->>'budgetTransactionId' is not null then cleared:=cleared+1; end if; insert into public.property_charges(id,family_id,property_id,property_unit_id,charge_definition_id,due_date,planned_amount,actual_amount,currency,status,paid_at,notes,budget_transaction_id,created_at,updated_at) values((charge_map->>(item->>'id'))::uuid,target_family_id,(property_map->>(item->>'propertyId'))::uuid,nullif(unit_map->>(item->>'propertyUnitId'),'')::uuid,(definition_map->>(item->>'chargeDefinitionId'))::uuid,(item->>'dueDate')::date,nullif(item->>'plannedAmount','')::numeric,nullif(item->>'actualAmount','')::numeric,item->>'currency',item->>'status',nullif(item->>'paidAt','')::timestamptz,item->>'notes',transaction_id,(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for mapped_id in select (value #>> '{}')::uuid from pg_catalog.jsonb_each(charge_map) loop perform private.resync_property_charge_reminders(mapped_id); end loop;
  end if;

  if 'tasks'=any(normalized) then
    insert into public.reminders(family_id,recipient_user_id,source_type,source_id,title,remind_at,timezone,status,created_by,reminder_kind,assignee_reminder_offset_minutes)
    select target_family_id,t.assigned_to,'task',t.id,'Przypomnienie: '||t.title,t.due_at-pg_catalog.make_interval(mins=>t.assignee_reminder_offset_minutes),coalesce(s.recurrence_timezone,'Europe/Warsaw'),'pending',t.created_by,'task_assignee',t.assignee_reminder_offset_minutes
    from public.tasks t left join public.task_recurrence_series s on s.id=t.recurrence_series_id and s.family_id=t.family_id
    where t.family_id=target_family_id and t.status<>'done' and t.assigned_to is not null and t.due_at is not null and t.assignee_reminder_offset_minutes is not null and t.due_at-pg_catalog.make_interval(mins=>t.assignee_reminder_offset_minutes)>pg_catalog.now() on conflict do nothing;
  end if;
  if 'reminders'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,reminders,items}') loop
      if item->>'reminderKind'='personal' and item->>'status'='pending' and (item->>'remindAt')::timestamptz>pg_catalog.now() and item->>'sourceType' in ('task','calendar_event') then
        mapped_id:=case when item->>'sourceType'='task' then (task_map->>(item->>'sourceId'))::uuid else (event_map->>(item->>'sourceId'))::uuid end;
        insert into public.reminders(id,family_id,recipient_user_id,source_type,source_id,title,remind_at,timezone,status,created_by,created_at,updated_at,reminder_kind)
        values(pg_catalog.gen_random_uuid(),target_family_id,(select auth.uid()),item->>'sourceType',mapped_id,item->>'title',(item->>'remindAt')::timestamptz,item->>'timezone','pending',(select auth.uid()),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz,'personal');
      else ignored:=ignored+1; end if;
    end loop;
  end if;

  -- Disable restore context only before the single controlled restore audit entry.
  delete from private.family_restore_context c where c.operation_id=restore_operation_id;
  perform pg_catalog.set_config('family_planner.restore_operation','',true);
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target_family_id,(select auth.uid()),'family.backup.restored','family',target_family_id::text,
    pg_catalog.jsonb_build_object('backupVersion',1,'schemaVersion',1,'sourceFamilyId',backup#>>'{family,id}','sourceCreatedAt',backup->>'createdAt','modules',to_jsonb(normalized),'restoreMode','replace_selected','importedCounts',report->'moduleCounts','removedCounts',report->'recordsToRemove','clearedBudgetLinkCount',cleared,'ignoredReminderCount',ignored,'restoreOperationId',restore_operation_id));
  return pg_catalog.jsonb_build_object(
    'success',true,'operationId',restore_operation_id,'modules',to_jsonb(normalized),'importedCounts',report->'moduleCounts',
    'removedCounts',report->'recordsToRemove','clearedBudgetLinks',cleared,'ignoredReminders',ignored,'warnings',report->'warnings',
    'calendarRecurrenceRestored',pg_catalog.jsonb_array_length(coalesce(backup#>'{modules,calendar,recurrenceSeries}','[]'::jsonb))
  );
end;
$$;

revoke all on function public.restore_family_data(uuid,jsonb,text[],jsonb,text,text) from public,anon,authenticated;
grant execute on function public.restore_family_data(uuid,jsonb,text[],jsonb,text,text) to authenticated;

notify pgrst,'reload schema';
