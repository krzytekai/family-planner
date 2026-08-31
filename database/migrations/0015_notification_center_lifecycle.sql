-- Hotfix 7.6.2: user-owned notification center lifecycle.

alter table public.notifications
  add column dismissed_at timestamptz;

create index notifications_visible_recipient_family_created_idx
  on public.notifications(recipient_user_id,family_id,created_at desc)
  where dismissed_at is null;

create or replace function private.audit_notification_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
declare action_value text;
begin
  if old.dismissed_at is null and new.dismissed_at is not null then
    action_value:='notification.dismissed';
  elsif old.read_at is null and new.read_at is not null then
    action_value:='notification.read';
  elsif old.read_at is not null and new.read_at is null then
    action_value:='notification.unread';
  end if;
  if action_value is not null then
    insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id)
    values(new.family_id,(select auth.uid()),action_value,'notification',new.id::text);
  end if;
  return new;
end; $$;
revoke all on function private.audit_notification_lifecycle() from public,anon,authenticated;

drop trigger if exists audit_notification_read on public.notifications;
drop trigger if exists audit_notification_lifecycle on public.notifications;
create trigger audit_notification_lifecycle
after update of read_at,dismissed_at on public.notifications
for each row execute function private.audit_notification_lifecycle();

create or replace function public.mark_notification_read(target_family_id uuid,target_notification_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare current_user_id uuid:=(select auth.uid());
begin
  if current_user_id is null or not public.is_family_member(target_family_id) then
    raise exception 'notification access denied';
  end if;
  update public.notifications
  set read_at=coalesce(read_at,pg_catalog.now())
  where id=target_notification_id and family_id=target_family_id
    and recipient_user_id=current_user_id and dismissed_at is null;
  if not found then raise exception 'notification not found'; end if;
end; $$;
revoke all on function public.mark_notification_read(uuid,uuid) from public,anon;
grant execute on function public.mark_notification_read(uuid,uuid) to authenticated;

create or replace function public.mark_notification_unread(target_family_id uuid,target_notification_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare current_user_id uuid:=(select auth.uid());
begin
  if current_user_id is null or not public.is_family_member(target_family_id) then
    raise exception 'notification access denied';
  end if;
  update public.notifications
  set read_at=null
  where id=target_notification_id and family_id=target_family_id
    and recipient_user_id=current_user_id and dismissed_at is null;
  if not found then raise exception 'notification not found'; end if;
end; $$;
revoke all on function public.mark_notification_unread(uuid,uuid) from public,anon;
grant execute on function public.mark_notification_unread(uuid,uuid) to authenticated;

create or replace function public.mark_all_notifications_read(target_family_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare current_user_id uuid:=(select auth.uid()); affected integer;
begin
  if current_user_id is null or not public.is_family_member(target_family_id) then
    raise exception 'notification access denied';
  end if;
  update public.notifications set read_at=pg_catalog.now()
  where family_id=target_family_id and recipient_user_id=current_user_id
    and read_at is null and dismissed_at is null;
  get diagnostics affected=row_count;
  return affected;
end; $$;
revoke all on function public.mark_all_notifications_read(uuid) from public,anon;
grant execute on function public.mark_all_notifications_read(uuid) to authenticated;

create or replace function public.dismiss_notification(target_family_id uuid,target_notification_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare current_user_id uuid:=(select auth.uid());
begin
  if current_user_id is null or not public.is_family_member(target_family_id) then
    raise exception 'notification access denied';
  end if;
  update public.notifications set dismissed_at=pg_catalog.now()
  where id=target_notification_id and family_id=target_family_id
    and recipient_user_id=current_user_id and dismissed_at is null;
  if not found then raise exception 'notification not found'; end if;
end; $$;
revoke all on function public.dismiss_notification(uuid,uuid) from public,anon;
grant execute on function public.dismiss_notification(uuid,uuid) to authenticated;

create or replace function public.dismiss_read_notifications(target_family_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare current_user_id uuid:=(select auth.uid()); affected integer;
begin
  if current_user_id is null or not public.is_family_member(target_family_id) then
    raise exception 'notification access denied';
  end if;
  update public.notifications set dismissed_at=pg_catalog.now()
  where family_id=target_family_id and recipient_user_id=current_user_id
    and read_at is not null and dismissed_at is null;
  get diagnostics affected=row_count;
  return affected;
end; $$;
revoke all on function public.dismiss_read_notifications(uuid) from public,anon;
grant execute on function public.dismiss_read_notifications(uuid) to authenticated;

revoke update(read_at) on public.notifications from authenticated;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications for select to authenticated
using(
  recipient_user_id=(select auth.uid())
  and dismissed_at is null
  and (select public.is_family_member(family_id))
);

notify pgrst,'reload schema';
