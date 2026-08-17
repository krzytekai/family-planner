-- Sprint 3: tenant-safe family calendar events with database-level audit.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.calendar_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (pg_catalog.char_length(title) between 1 and 200),
  description text,
  event_type text not null default 'family'
    constraint calendar_events_type_check
    check (event_type in ('family', 'appointment', 'school', 'work', 'birthday', 'other')),
  location text,
  all_day boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  start_date date,
  end_date date,
  created_by uuid not null default auth.uid()
    constraint calendar_events_created_by_fkey references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint calendar_events_date_shape_check check (
    (
      all_day = false
      and starts_at is not null
      and start_date is null
      and end_date is null
      and (ends_at is null or ends_at >= starts_at)
    )
    or
    (
      all_day = true
      and start_date is not null
      and starts_at is null
      and ends_at is null
      and (end_date is null or end_date >= start_date)
    )
  )
);

create index if not exists calendar_events_family_id_idx
  on public.calendar_events(family_id);
create index if not exists calendar_events_family_starts_at_idx
  on public.calendar_events(family_id, starts_at)
  where starts_at is not null;
create index if not exists calendar_events_family_start_date_idx
  on public.calendar_events(family_id, start_date)
  where start_date is not null;
create index if not exists calendar_events_created_by_idx
  on public.calendar_events(created_by);
create index if not exists calendar_events_event_type_idx
  on public.calendar_events(event_type);

create or replace function private.prepare_calendar_event_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.family_id <> old.family_id then
      raise exception 'calendar event family cannot be changed';
    end if;
    if new.created_by <> old.created_by then
      raise exception 'calendar event creator cannot be changed';
    end if;
  end if;

  new.title := pg_catalog.btrim(new.title);
  new.description := nullif(pg_catalog.btrim(new.description), '');
  new.location := nullif(pg_catalog.btrim(new.location), '');
  new.updated_at := pg_catalog.now();

  return new;
end;
$$;

revoke all on function private.prepare_calendar_event_write() from public, anon, authenticated;

drop trigger if exists prepare_calendar_event_write on public.calendar_events;
create trigger prepare_calendar_event_write
before insert or update on public.calendar_events
for each row execute function private.prepare_calendar_event_write();

create or replace function private.audit_calendar_event_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
  audit_family_id uuid;
  audit_event_id uuid;
  audit_actor_id uuid;
  audit_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    audit_action := 'calendar_event.created';
    audit_family_id := new.family_id;
    audit_event_id := new.id;
    audit_actor_id := (select auth.uid());
    audit_metadata := pg_catalog.jsonb_build_object(
      'event_type', new.event_type,
      'all_day', new.all_day,
      'starts_at', new.starts_at,
      'ends_at', new.ends_at,
      'start_date', new.start_date,
      'end_date', new.end_date,
      'location', new.location
    );
  elsif tg_op = 'UPDATE' then
    audit_action := 'calendar_event.updated';
    audit_family_id := new.family_id;
    audit_event_id := new.id;
    audit_actor_id := (select auth.uid());
    audit_metadata := pg_catalog.jsonb_build_object(
      'event_type', new.event_type,
      'all_day', new.all_day,
      'starts_at', new.starts_at,
      'ends_at', new.ends_at,
      'start_date', new.start_date,
      'end_date', new.end_date,
      'location', new.location
    );
  else
    audit_action := 'calendar_event.deleted';
    audit_family_id := old.family_id;
    audit_event_id := old.id;
    audit_actor_id := (select auth.uid());
    audit_metadata := pg_catalog.jsonb_build_object(
      'event_type', old.event_type,
      'all_day', old.all_day,
      'starts_at', old.starts_at,
      'ends_at', old.ends_at,
      'start_date', old.start_date,
      'end_date', old.end_date,
      'location', old.location
    );
  end if;

  insert into public.audit_logs (
    family_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    audit_family_id,
    audit_actor_id,
    audit_action,
    'calendar_event',
    audit_event_id::text,
    audit_metadata
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.audit_calendar_event_change() from public, anon, authenticated;

drop trigger if exists audit_calendar_event_change on public.calendar_events;
create trigger audit_calendar_event_change
after insert or update or delete on public.calendar_events
for each row execute function private.audit_calendar_event_change();

alter table public.calendar_events enable row level security;

revoke all on public.calendar_events from anon, authenticated;
grant select on public.calendar_events to authenticated;
grant insert (
  family_id,
  title,
  description,
  event_type,
  location,
  all_day,
  starts_at,
  ends_at,
  start_date,
  end_date
) on public.calendar_events to authenticated;
grant update (
  title,
  description,
  event_type,
  location,
  all_day,
  starts_at,
  ends_at,
  start_date,
  end_date
) on public.calendar_events to authenticated;
grant delete on public.calendar_events to authenticated;

drop policy if exists calendar_events_select_family_member on public.calendar_events;
create policy calendar_events_select_family_member
on public.calendar_events for select to authenticated
using ((select public.is_family_member(family_id)));

drop policy if exists calendar_events_insert_adult on public.calendar_events;
create policy calendar_events_insert_adult
on public.calendar_events for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select public.has_family_role(
    family_id,
    array['owner', 'admin', 'adult']::public.family_role[]
  ))
);

drop policy if exists calendar_events_update_authorized on public.calendar_events;
create policy calendar_events_update_authorized
on public.calendar_events for update to authenticated
using (
  (select public.is_family_member(family_id))
  and (
    (select public.has_family_role(
      family_id,
      array['owner', 'admin']::public.family_role[]
    ))
    or created_by = (select auth.uid())
  )
)
with check (
  (select public.is_family_member(family_id))
  and (
    (select public.has_family_role(
      family_id,
      array['owner', 'admin']::public.family_role[]
    ))
    or created_by = (select auth.uid())
  )
);

drop policy if exists calendar_events_delete_authorized on public.calendar_events;
create policy calendar_events_delete_authorized
on public.calendar_events for delete to authenticated
using (
  (select public.is_family_member(family_id))
  and (
    (select public.has_family_role(
      family_id,
      array['owner', 'admin']::public.family_role[]
    ))
    or created_by = (select auth.uid())
  )
);

notify pgrst, 'reload schema';
