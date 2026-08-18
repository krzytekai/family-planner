-- Sprint 5: backend-owned notifications, personal reminders and Android-ready devices.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.notifications (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null check (notification_type in ('task_assigned','task_reminder','calendar_reminder','system')),
  title text not null check (pg_catalog.char_length(title) between 1 and 200),
  body text,
  source_type text check (source_type is null or source_type in ('task','calendar_event','system')),
  source_id uuid,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  constraint notifications_source_shape_check check (
    (source_type in ('task','calendar_event') and source_id is not null)
    or (source_type is null and source_id is null)
    or (source_type = 'system')
  )
);

create table if not exists public.reminders (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  recipient_user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  source_type text not null check (source_type in ('task','calendar_event')),
  source_id uuid not null,
  title text,
  remind_at timestamptz not null,
  timezone text,
  status text not null default 'pending' check (status in ('pending','fired','cancelled')),
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  fired_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint reminders_fired_shape_check check (
    (status = 'fired' and fired_at is not null)
    or (status <> 'fired' and fired_at is null)
  )
);

create table if not exists public.notification_devices (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('android','web')),
  provider text not null check (provider in ('fcm','webpush')),
  push_token text not null,
  device_label text,
  app_version text,
  last_seen_at timestamptz not null default pg_catalog.now(),
  disabled_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint notification_devices_provider_token_unique unique (provider, push_token)
);

create table if not exists public.notification_preferences (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  in_app_enabled boolean not null default true,
  push_enabled boolean not null default true,
  task_assigned_enabled boolean not null default true,
  task_reminders_enabled boolean not null default true,
  calendar_reminders_enabled boolean not null default true,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (family_id, user_id)
);

create index if not exists notifications_recipient_idx on public.notifications(recipient_user_id);
create index if not exists notifications_recipient_read_idx on public.notifications(recipient_user_id, read_at);
create index if not exists notifications_family_created_idx on public.notifications(family_id, created_at desc);
create index if not exists notifications_created_idx on public.notifications(created_at);
create unique index if not exists notifications_recipient_dedupe_unique
  on public.notifications(recipient_user_id, dedupe_key) where dedupe_key is not null;
create index if not exists reminders_due_idx on public.reminders(status, remind_at) where status = 'pending';
create index if not exists reminders_recipient_source_idx on public.reminders(recipient_user_id, source_type, source_id);
create unique index if not exists reminders_one_pending_source_unique
  on public.reminders(recipient_user_id, source_type, source_id) where status = 'pending';
create index if not exists notification_devices_user_idx on public.notification_devices(user_id);

create or replace function private.notification_type_enabled(target_family uuid, target_user uuid, event_type text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case event_type
      when 'task_assigned' then p.task_assigned_enabled
      when 'task_reminder' then p.task_reminders_enabled
      when 'calendar_reminder' then p.calendar_reminders_enabled
      else true end
    from public.notification_preferences p
    where p.family_id = target_family and p.user_id = target_user
  ), true);
$$;
revoke all on function private.notification_type_enabled(uuid,uuid,text) from public, anon, authenticated;

create or replace function private.notification_in_app_enabled(target_family uuid, target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.in_app_enabled from public.notification_preferences p
    where p.family_id = target_family and p.user_id = target_user
  ), true);
$$;
revoke all on function private.notification_in_app_enabled(uuid,uuid) from public, anon, authenticated;

create or replace function private.notification_push_enabled(target_family uuid, target_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select p.push_enabled from public.notification_preferences p
    where p.family_id = target_family and p.user_id = target_user
  ), true);
$$;
revoke all on function private.notification_push_enabled(uuid,uuid) from public, anon, authenticated;

create or replace function private.prepare_reminder_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.created_by <> (select auth.uid()) or new.recipient_user_id <> (select auth.uid()) then
      raise exception 'reminders are personal';
    end if;
    if new.status <> 'pending' or new.fired_at is not null then raise exception 'invalid initial reminder status'; end if;
  else
    if new.family_id <> old.family_id or new.created_by <> old.created_by
      or new.recipient_user_id <> old.recipient_user_id
      or new.source_type <> old.source_type or new.source_id <> old.source_id then
      raise exception 'reminder ownership and source cannot be changed';
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
end; $$;
revoke all on function private.prepare_reminder_write() from public, anon, authenticated;
drop trigger if exists prepare_reminder_write on public.reminders;
create trigger prepare_reminder_write before insert or update on public.reminders
for each row execute function private.prepare_reminder_write();

create or replace function private.prepare_notification_device_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.user_id <> (select auth.uid()) then raise exception 'device owner mismatch'; end if;
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then raise exception 'device owner cannot be changed'; end if;
  new.push_token := pg_catalog.btrim(new.push_token);
  new.device_label := nullif(pg_catalog.btrim(new.device_label), '');
  new.app_version := nullif(pg_catalog.btrim(new.app_version), '');
  new.updated_at := pg_catalog.now();
  return new;
end; $$;
revoke all on function private.prepare_notification_device_write() from public, anon, authenticated;
drop trigger if exists prepare_notification_device_write on public.notification_devices;
create trigger prepare_notification_device_write before insert or update on public.notification_devices
for each row execute function private.prepare_notification_device_write();

create or replace function private.prepare_notification_preferences_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.user_id <> (select auth.uid()) then raise exception 'preference owner mismatch'; end if;
  if tg_op = 'UPDATE' and (new.user_id <> old.user_id or new.family_id <> old.family_id) then raise exception 'preference owner cannot be changed'; end if;
  new.updated_at := pg_catalog.now(); return new;
end; $$;
revoke all on function private.prepare_notification_preferences_write() from public, anon, authenticated;
drop trigger if exists prepare_notification_preferences_write on public.notification_preferences;
create trigger prepare_notification_preferences_write before insert or update on public.notification_preferences
for each row execute function private.prepare_notification_preferences_write();

create or replace function private.notify_task_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare assignment_changed boolean;
begin
  if tg_op = 'INSERT' then
    assignment_changed := true;
  else
    assignment_changed := new.assigned_to is distinct from old.assigned_to;
  end if;
  if assignment_changed and new.assigned_to is not null and new.assigned_to <> (select auth.uid())
    and exists (select 1 from public.family_members fm where fm.family_id=new.family_id and fm.user_id=new.assigned_to and fm.status='active')
    and private.notification_type_enabled(new.family_id,new.assigned_to,'task_assigned') then
    insert into public.notifications(family_id,recipient_user_id,notification_type,title,body,source_type,source_id,payload,dedupe_key)
    values(new.family_id,new.assigned_to,'task_assigned','Przypisano Ci zadanie',new.title,'task',new.id,
      pg_catalog.jsonb_build_object('family_id',new.family_id,'source_type','task','source_id',new.id,'notification_type','task_assigned'),
      'task-assigned:'||new.id::text||':'||new.assigned_to::text||':'||new.updated_at::text)
    on conflict do nothing;
  end if;
  return new;
end; $$;
revoke all on function private.notify_task_assignment() from public, anon, authenticated;
drop trigger if exists notify_task_assignment on public.tasks;
create trigger notify_task_assignment after insert or update of assigned_to on public.tasks
for each row execute function private.notify_task_assignment();

create or replace function private.delete_source_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.reminders where family_id=old.family_id
    and source_type=case when tg_table_name='tasks' then 'task' else 'calendar_event' end
    and source_id=old.id and status='pending';
  return old;
end; $$;
revoke all on function private.delete_source_reminders() from public, anon, authenticated;
drop trigger if exists delete_task_reminders on public.tasks;
create trigger delete_task_reminders after delete on public.tasks for each row execute function private.delete_source_reminders();
drop trigger if exists delete_calendar_event_reminders on public.calendar_events;
create trigger delete_calendar_event_reminders after delete on public.calendar_events for each row execute function private.delete_source_reminders();

create or replace function private.process_due_reminders(batch_size integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare due public.reminders%rowtype; processed integer := 0; event_type text; source_title text;
begin
  for due in select * from public.reminders r where r.status='pending' and r.remind_at<=pg_catalog.now()
    order by r.remind_at for update skip locked limit pg_catalog.greatest(1,pg_catalog.least(batch_size,1000))
  loop
    event_type := case when due.source_type='task' then 'task_reminder' else 'calendar_reminder' end;
    if not exists (
      select 1 from public.family_members fm
      where fm.family_id=due.family_id and fm.user_id=due.recipient_user_id and fm.status='active'
    ) then
      update public.reminders set status='cancelled',fired_at=null,updated_at=pg_catalog.now() where id=due.id;
      processed := processed + 1;
      continue;
    end if;
    if due.source_type='task' then select t.title into source_title from public.tasks t where t.id=due.source_id and t.family_id=due.family_id;
    else select e.title into source_title from public.calendar_events e where e.id=due.source_id and e.family_id=due.family_id; end if;
    if source_title is not null and private.notification_type_enabled(due.family_id,due.recipient_user_id,event_type) then
      insert into public.notifications(family_id,recipient_user_id,notification_type,title,body,source_type,source_id,payload,dedupe_key)
      values(due.family_id,due.recipient_user_id,event_type,coalesce(due.title,'Przypomnienie'),source_title,due.source_type,due.source_id,
        pg_catalog.jsonb_build_object('family_id',due.family_id,'source_type',due.source_type,'source_id',due.source_id,'notification_type',event_type),
        'reminder:'||due.id::text) on conflict do nothing;
      update public.reminders set status='fired',fired_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=due.id;
    else
      update public.reminders set status='cancelled',fired_at=null,updated_at=pg_catalog.now() where id=due.id;
    end if;
    processed := processed + 1;
  end loop;
  return processed;
end; $$;
revoke all on function private.process_due_reminders(integer) from public, anon, authenticated;

create or replace function private.audit_reminder_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_value public.reminders%rowtype; action_value text;
begin
  if tg_op='DELETE' then row_value:=old; action_value:='reminder.deleted';
  elsif tg_op='INSERT' then row_value:=new; action_value:='reminder.created';
  else row_value:=new; action_value:='reminder.updated'; end if;
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(row_value.family_id,(select auth.uid()),action_value,'reminder',row_value.id::text,
    pg_catalog.jsonb_build_object('source_type',row_value.source_type,'source_id',row_value.source_id,'remind_at',row_value.remind_at,'status',row_value.status));
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
revoke all on function private.audit_reminder_change() from public, anon, authenticated;
drop trigger if exists audit_reminder_change on public.reminders;
create trigger audit_reminder_change after insert or update or delete on public.reminders for each row execute function private.audit_reminder_change();

create or replace function private.audit_notification_read()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.read_at is null and new.read_at is not null then
    insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id)
    values(new.family_id,(select auth.uid()),'notification.read','notification',new.id::text);
  end if; return new;
end; $$;
revoke all on function private.audit_notification_read() from public, anon, authenticated;
drop trigger if exists audit_notification_read on public.notifications;
create trigger audit_notification_read after update of read_at on public.notifications for each row execute function private.audit_notification_read();

alter table public.notifications enable row level security;
alter table public.reminders enable row level security;
alter table public.notification_devices enable row level security;
alter table public.notification_preferences enable row level security;

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update(read_at) on public.notifications to authenticated;
revoke all on public.reminders from anon, authenticated;
grant select, delete on public.reminders to authenticated;
grant insert(family_id,source_type,source_id,title,remind_at,timezone) on public.reminders to authenticated;
grant update(title,remind_at,timezone) on public.reminders to authenticated;
revoke all on public.notification_devices from anon, authenticated;
grant select, delete on public.notification_devices to authenticated;
grant insert(platform,provider,push_token,device_label,app_version,last_seen_at,disabled_at) on public.notification_devices to authenticated;
grant update(platform,provider,push_token,device_label,app_version,last_seen_at,disabled_at) on public.notification_devices to authenticated;
revoke all on public.notification_preferences from anon, authenticated;
grant select, delete on public.notification_preferences to authenticated;
grant insert(family_id,in_app_enabled,push_enabled,task_assigned_enabled,task_reminders_enabled,calendar_reminders_enabled) on public.notification_preferences to authenticated;
grant update(in_app_enabled,push_enabled,task_assigned_enabled,task_reminders_enabled,calendar_reminders_enabled) on public.notification_preferences to authenticated;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated
using(recipient_user_id=(select auth.uid()) and (select public.is_family_member(family_id)));
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update to authenticated
using(recipient_user_id=(select auth.uid()) and (select public.is_family_member(family_id)))
with check(recipient_user_id=(select auth.uid()) and (select public.is_family_member(family_id)));
drop policy if exists reminders_select_own on public.reminders;
create policy reminders_select_own on public.reminders for select to authenticated
using(recipient_user_id=(select auth.uid()) and (select public.is_family_member(family_id)));
drop policy if exists reminders_insert_own on public.reminders;
create policy reminders_insert_own on public.reminders for insert to authenticated
with check(recipient_user_id=(select auth.uid()) and created_by=(select auth.uid()) and (select public.is_family_member(family_id)));
drop policy if exists reminders_update_own on public.reminders;
create policy reminders_update_own on public.reminders for update to authenticated
using(recipient_user_id=(select auth.uid()) and (select public.is_family_member(family_id)))
with check(recipient_user_id=(select auth.uid()) and (select public.is_family_member(family_id)));
drop policy if exists reminders_delete_own on public.reminders;
create policy reminders_delete_own on public.reminders for delete to authenticated
using(recipient_user_id=(select auth.uid()) and (select public.is_family_member(family_id)));
drop policy if exists notification_devices_select_own on public.notification_devices;
create policy notification_devices_select_own on public.notification_devices for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists notification_devices_insert_own on public.notification_devices;
create policy notification_devices_insert_own on public.notification_devices for insert to authenticated with check(user_id=(select auth.uid()));
drop policy if exists notification_devices_update_own on public.notification_devices;
create policy notification_devices_update_own on public.notification_devices for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists notification_devices_delete_own on public.notification_devices;
create policy notification_devices_delete_own on public.notification_devices for delete to authenticated using(user_id=(select auth.uid()));
drop policy if exists notification_preferences_select_own on public.notification_preferences;
create policy notification_preferences_select_own on public.notification_preferences for select to authenticated using(user_id=(select auth.uid()) and (select public.is_family_member(family_id)));
drop policy if exists notification_preferences_insert_own on public.notification_preferences;
create policy notification_preferences_insert_own on public.notification_preferences for insert to authenticated with check(user_id=(select auth.uid()) and (select public.is_family_member(family_id)));
drop policy if exists notification_preferences_update_own on public.notification_preferences;
create policy notification_preferences_update_own on public.notification_preferences for update to authenticated using(user_id=(select auth.uid()) and (select public.is_family_member(family_id))) with check(user_id=(select auth.uid()) and (select public.is_family_member(family_id)));
drop policy if exists notification_preferences_delete_own on public.notification_preferences;
create policy notification_preferences_delete_own on public.notification_preferences for delete to authenticated using(user_id=(select auth.uid()) and (select public.is_family_member(family_id)));

notify pgrst, 'reload schema';
