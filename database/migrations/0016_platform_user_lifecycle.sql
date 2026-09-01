-- Platform user lifecycle: durable profile tombstones and global audit.
-- This migration must be reviewed and deployed before the platform-account delete API.

alter table public.profiles
  add column if not exists deleted_at timestamptz;

-- A profile becomes a durable historical identity. Removing Auth access must not
-- cascade through task, calendar, shopping, budget, property or audit history.
alter table public.profiles
  drop constraint if exists profiles_id_fkey;

-- Blocked memberships are durable history and must not disappear through the
-- auth.users cascade after the active-membership preflight has passed.
alter table public.family_members
  drop constraint if exists family_members_user_id_fkey;

alter table public.families
  drop constraint if exists families_created_by_fkey;
alter table public.families
  add constraint families_created_by_fkey
  foreign key(created_by) references public.profiles(id);

alter table public.family_members
  drop constraint if exists family_members_created_by_fkey;
alter table public.family_members
  add constraint family_members_created_by_fkey
  foreign key(created_by) references public.profiles(id);

alter table public.audit_logs
  drop constraint if exists audit_logs_actor_user_id_fkey;
alter table public.audit_logs
  add constraint audit_logs_actor_user_id_fkey
  foreign key(actor_user_id) references public.profiles(id) on delete set null;

create index if not exists profiles_deleted_at_idx
  on public.profiles(deleted_at)
  where deleted_at is not null;

create table if not exists public.platform_audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists platform_audit_logs_created_idx
  on public.platform_audit_logs(created_at desc);

create unique index if not exists platform_user_deleted_audit_unique
  on public.platform_audit_logs(action,entity_id)
  where action='platform.user.deleted';

alter table public.platform_audit_logs enable row level security;
revoke all on public.platform_audit_logs from public, anon, authenticated;

create or replace function public.get_platform_admin_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.is_platform_admin() then
    pg_catalog.jsonb_build_object('authorized',false)
  else pg_catalog.jsonb_build_object(
    'authorized',true,
    'counts',pg_catalog.jsonb_build_object(
      'families',(select count(*) from public.families),
      'users',(select count(*) from public.profiles where deleted_at is null),
      'activeMemberships',(select count(*) from public.family_members where status='active'),
      'blockedMemberships',(select count(*) from public.family_members where status='blocked'),
      'orphanUsers',(select count(*) from public.profiles p where p.deleted_at is null and not exists(
        select 1 from public.family_members fm where fm.user_id=p.id
      )),
      'withoutActiveMemberships',(select count(*) from public.profiles p where p.deleted_at is null and not exists(
        select 1 from public.family_members fm where fm.user_id=p.id and fm.status='active'
      ))
    ),
    'families',coalesce((select pg_catalog.jsonb_agg(row_data order by row_data->>'createdAt' desc) from (
      select pg_catalog.jsonb_build_object(
        'id',f.id,
        'name',f.name,
        'createdAt',f.created_at,
        'memberCount',count(mp.id),
        'owner',max(fm.display_name) filter(where fm.role='owner' and fm.status='active' and mp.id is not null)
      ) row_data
      from public.families f
      left join public.family_members fm on fm.family_id=f.id and fm.status='active'
      left join public.profiles mp on mp.id=fm.user_id and mp.deleted_at is null
      group by f.id
    ) q),'[]'::jsonb),
    'users',coalesce((select pg_catalog.jsonb_agg(row_data order by row_data->>'displayName') from (
      select pg_catalog.jsonb_build_object(
        'id',p.id,
        'displayName',p.display_name,
        'email',p.email,
        'familyCount',count(fm.family_id),
        'activeMembershipCount',count(fm.family_id) filter(where fm.status='active'),
        'blockedMembershipCount',count(fm.family_id) filter(where fm.status='blocked'),
        'active',coalesce(bool_or(fm.status='active'),false)
      ) row_data
      from public.profiles p
      left join public.family_members fm on fm.user_id=p.id
      where p.deleted_at is null
      group by p.id
    ) q),'[]'::jsonb),
    'memberships',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'familyId',fm.family_id,
      'familyName',f.name,
      'userId',fm.user_id,
      'displayName',fm.display_name,
      'role',fm.role,
      'status',fm.status
    ) order by f.name,fm.display_name)
      from public.family_members fm
      join public.families f on f.id=fm.family_id
      join public.profiles p on p.id=fm.user_id and p.deleted_at is null
    ),'[]'::jsonb)
  ) end;
$$;

revoke all on function public.get_platform_admin_overview() from public, anon;
grant execute on function public.get_platform_admin_overview() to authenticated;

create or replace function public.get_platform_user_deletion_preflight(target_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  active_count integer;
  membership_count integer;
  target_exists boolean;
begin
  if not public.is_platform_admin() then
    raise exception 'platform administrator required';
  end if;
  if target_user_id=(select auth.uid()) then
    return pg_catalog.jsonb_build_object('allowed',false,'reason','self_delete');
  end if;

  select exists(select 1 from public.profiles p where p.id=target_user_id and p.deleted_at is null)
    into target_exists;
  if not target_exists then
    return pg_catalog.jsonb_build_object('allowed',false,'reason','not_found');
  end if;

  select
    count(*) filter(where fm.status='active'),
    count(*)
  into active_count,membership_count
  from public.family_members fm
  where fm.user_id=target_user_id;

  return pg_catalog.jsonb_build_object(
    'allowed',active_count=0,
    'reason',case when active_count>0 then 'active_memberships' else null end,
    'activeMembershipCount',active_count,
    'membershipCount',membership_count
  );
end;
$$;

revoke all on function public.get_platform_user_deletion_preflight(uuid) from public, anon;
grant execute on function public.get_platform_user_deletion_preflight(uuid) to authenticated;

-- Called only by the trusted backend after Auth Admin has successfully removed
-- the target auth.users row. It removes personal delivery data, detaches current
-- assignments and converts the durable profile into an anonymous tombstone.
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
    where pa.user_id=actor_user_id and pa.is_active
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
      'membership_count',greatest(pg_catalog.coalesce(previous_membership_count,0), 0)
    )
  ) on conflict(action,entity_id) where action='platform.user.deleted' do nothing;
end;
$$;

revoke all on function public.finalize_platform_user_deletion(uuid,uuid,integer)
  from public, anon, authenticated;
grant execute on function public.finalize_platform_user_deletion(uuid,uuid,integer)
  to service_role;

notify pgrst, 'reload schema';
