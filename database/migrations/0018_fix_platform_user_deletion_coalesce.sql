-- Fix the platform user finalizer's use of the SQL COALESCE expression.

create or replace function public.finalize_platform_user_deletion(
  actor_user_id uuid,
  target_user_id uuid,
  previous_membership_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare profile_deleted_at timestamptz;
begin
  if actor_user_id is null or target_user_id is null or actor_user_id=target_user_id then
    raise exception 'invalid platform user deletion';
  end if;
  if not exists(
    select 1 from public.platform_admins pa
    where pa.user_id=actor_user_id and pa.active
  ) then
    raise exception 'platform administrator required';
  end if;
  if exists(select 1 from auth.users au where au.id=target_user_id) then
    raise exception 'auth account still exists';
  end if;
  if exists(
    select 1 from public.family_members fm
    where fm.user_id=target_user_id and fm.status='active'
  ) then
    raise exception 'active memberships prevent deletion';
  end if;

  select p.deleted_at into profile_deleted_at
  from public.profiles p where p.id=target_user_id for update;
  if not found then raise exception 'profile not found'; end if;
  if profile_deleted_at is not null then return; end if;

  delete from public.platform_admins where user_id=target_user_id;
  delete from public.property_charge_reminder_rules where recipient_user_id=target_user_id;
  delete from public.reminders where recipient_user_id=target_user_id;
  delete from public.notifications where recipient_user_id=target_user_id;
  delete from public.notification_preferences where user_id=target_user_id;
  delete from public.notification_devices where user_id=target_user_id;
  update public.tasks set assigned_to=null where assigned_to=target_user_id;

  update public.profiles
  set email=null,
      display_name='Usunięty użytkownik',
      avatar_url=null,
      deleted_at=pg_catalog.now(),
      updated_at=pg_catalog.now()
  where id=target_user_id;

  insert into public.platform_audit_logs(
    actor_user_id,action,entity_type,entity_id,metadata
  ) values(
    actor_user_id,
    'platform.user.deleted',
    'user',
    target_user_id::text,
    pg_catalog.jsonb_build_object(
      'membership_count',greatest(coalesce(previous_membership_count, 0), 0)
    )
  ) on conflict(action,entity_id) where action='platform.user.deleted' do nothing;
end;
$$;

revoke all on function public.finalize_platform_user_deletion(uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.finalize_platform_user_deletion(uuid,uuid,integer)
  to service_role;

notify pgrst, 'reload schema';
