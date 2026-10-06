create or replace function private.ensure_calendar_event_series_occurrences(target_series_id uuid,horizon_days integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  series_row public.calendar_event_recurrence_series%rowtype;
  v_occurrence_date date;
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
  v_occurrence_date:=coalesce(series_row.generated_through,series_row.anchor_date-1);
  last_processed_occurrence_date:=series_row.generated_through;
  loop
    if v_occurrence_date<series_row.anchor_date then v_occurrence_date:=series_row.anchor_date;
    else v_occurrence_date:=private.next_calendar_occurrence_date(v_occurrence_date,series_row.anchor_date,series_row.recurrence_rule); end if;
    exit when v_occurrence_date>target_date;
    last_processed_occurrence_date:=v_occurrence_date;
    if not exists(select 1 from public.calendar_event_recurrence_exclusions x where x.series_id=series_row.id and x.occurrence_date=v_occurrence_date) then
      if series_row.all_day then
        insert into public.calendar_events(
          family_id,title,description,event_type,location,all_day,start_date,end_date,created_by,
          recurrence_series_id,recurrence_occurrence_date
        ) values(
          series_row.family_id,series_row.title,series_row.description,series_row.event_type,series_row.location,true,
          v_occurrence_date,case when series_row.all_day_duration_days=0 then null else v_occurrence_date+series_row.all_day_duration_days end,
          series_row.created_by,series_row.id,v_occurrence_date
        ) on conflict(recurrence_series_id,recurrence_occurrence_date) where recurrence_series_id is not null do nothing;
      else
        occurrence_start:=(v_occurrence_date::timestamp+series_row.anchor_local_time) at time zone series_row.recurrence_timezone;
        insert into public.calendar_events(
          family_id,title,description,event_type,location,all_day,starts_at,ends_at,created_by,
          recurrence_series_id,recurrence_occurrence_date
        ) values(
          series_row.family_id,series_row.title,series_row.description,series_row.event_type,series_row.location,false,
          occurrence_start,case when series_row.timed_duration_minutes=0 then null else occurrence_start+pg_catalog.make_interval(mins=>series_row.timed_duration_minutes) end,
          series_row.created_by,series_row.id,v_occurrence_date
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
