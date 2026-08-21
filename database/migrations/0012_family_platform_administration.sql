-- Sprint 7.5: safe family administration, multi-family creation and platform administration.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'superadmin' check (role = 'superadmin'),
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);

alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa
    where pa.user_id = (select auth.uid()) and pa.active
  );
$$;
revoke all on function public.is_platform_admin() from public, anon;
grant execute on function public.is_platform_admin() to authenticated;

create or replace function private.assert_family_has_active_owner(target_family uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.families f where f.id = target_family)
    and not exists (
      select 1 from public.family_members fm
      where fm.family_id = target_family and fm.role = 'owner' and fm.status = 'active'
    ) then
    raise exception 'family must retain an active owner';
  end if;
end;
$$;
revoke all on function private.assert_family_has_active_owner(uuid) from public, anon, authenticated;

create or replace function private.enforce_family_owner_safety()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_family_has_active_owner(coalesce(new.family_id, old.family_id));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.enforce_family_owner_safety() from public, anon, authenticated;
drop trigger if exists enforce_family_owner_safety on public.family_members;
create constraint trigger enforce_family_owner_safety
after insert or update or delete on public.family_members
deferrable initially immediate for each row
execute function private.enforce_family_owner_safety();

create or replace function public.update_family_name(target_family_id uuid, next_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare normalized_name text := pg_catalog.btrim(next_name);
begin
  if not public.has_family_role(target_family_id, array['owner','admin']::public.family_role[]) then
    raise exception 'not authorized to update family';
  end if;
  if pg_catalog.char_length(normalized_name) not between 2 and 80 then raise exception 'invalid family name'; end if;
  update public.families set name = normalized_name, updated_at = pg_catalog.now() where id = target_family_id;
  if not found then raise exception 'family not found'; end if;
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target_family_id,(select auth.uid()),'family.updated','family',target_family_id::text,
    pg_catalog.jsonb_build_object('field','name'));
end;
$$;
revoke all on function public.update_family_name(uuid,text) from public, anon;
grant execute on function public.update_family_name(uuid,text) to authenticated;

create or replace function public.manage_family_member(
  target_family_id uuid,
  target_user_id uuid,
  action_name text,
  next_role public.family_role default null,
  next_display_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare actor_role public.family_role; target public.family_members%rowtype; normalized_name text;
begin
  perform 1 from public.families where id = target_family_id for update;
  select fm.role into actor_role from public.family_members fm
  where fm.family_id=target_family_id and fm.user_id=(select auth.uid()) and fm.status='active' for update;
  if actor_role not in ('owner','admin') then raise exception 'not authorized to manage family members'; end if;
  select * into target from public.family_members fm
  where fm.family_id=target_family_id and fm.user_id=target_user_id for update;
  if not found then raise exception 'family member not found'; end if;
  if target.role='owner' and not (actor_role='owner' and action_name='rename') then
    raise exception 'owner requires a dedicated ownership transfer';
  end if;
  if actor_role='admin' and (target.role not in ('adult','child') or next_role in ('owner','admin')) then
    raise exception 'admin may manage only adult and child memberships';
  end if;

  if action_name='role' then
    if next_role is null or next_role='owner' then raise exception 'invalid target role'; end if;
    update public.family_members set role=next_role,updated_at=pg_catalog.now()
      where family_id=target_family_id and user_id=target_user_id;
    insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(target_family_id,(select auth.uid()),'family.member.role_changed','family_member',target_user_id::text,
      pg_catalog.jsonb_build_object('from',target.role,'to',next_role));
  elsif action_name='block' then
    update public.family_members set status='blocked',updated_at=pg_catalog.now()
      where family_id=target_family_id and user_id=target_user_id;
    insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id)
    values(target_family_id,(select auth.uid()),'family.member.blocked','family_member',target_user_id::text);
  elsif action_name='unblock' then
    update public.family_members set status='active',updated_at=pg_catalog.now()
      where family_id=target_family_id and user_id=target_user_id;
    insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id)
    values(target_family_id,(select auth.uid()),'family.member.unblocked','family_member',target_user_id::text);
  elsif action_name='rename' then
    normalized_name := pg_catalog.btrim(next_display_name);
    if pg_catalog.char_length(normalized_name) not between 1 and 80 then raise exception 'invalid display name'; end if;
    update public.family_members set display_name=normalized_name,updated_at=pg_catalog.now()
      where family_id=target_family_id and user_id=target_user_id;
    insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(target_family_id,(select auth.uid()),'family.member.updated','family_member',target_user_id::text,
      pg_catalog.jsonb_build_object('field','display_name'));
  elsif action_name='remove' then
    delete from public.family_members where family_id=target_family_id and user_id=target_user_id;
    insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(target_family_id,(select auth.uid()),'family.member.removed','family_member',target_user_id::text,
      pg_catalog.jsonb_build_object('role',target.role));
  else raise exception 'invalid family member action';
  end if;
end;
$$;
revoke all on function public.manage_family_member(uuid,uuid,text,public.family_role,text) from public, anon;
grant execute on function public.manage_family_member(uuid,uuid,text,public.family_role,text) to authenticated;

create or replace function public.create_additional_family(family_name text, owner_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare new_family_id uuid; normalized_name text:=pg_catalog.btrim(family_name); normalized_display text:=pg_catalog.btrim(owner_display_name);
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  if exists (
    select 1 from public.family_members fm
    where fm.user_id=(select auth.uid()) and fm.status='active'
  ) and not exists (
    select 1 from public.family_members fm
    where fm.user_id=(select auth.uid()) and fm.status='active'
      and fm.role in ('owner','admin','adult')
  ) then raise exception 'not authorized to create an additional family'; end if;
  if pg_catalog.char_length(normalized_name) not between 2 and 80 or pg_catalog.char_length(normalized_display) not between 1 and 80 then
    raise exception 'invalid family data';
  end if;
  insert into public.families(name,created_by) values(normalized_name,(select auth.uid())) returning id into new_family_id;
  insert into public.family_members(family_id,user_id,display_name,role,status,created_by)
  values(new_family_id,(select auth.uid()),normalized_display,'owner','active',(select auth.uid()));
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id)
  values(new_family_id,(select auth.uid()),'family.created','family',new_family_id::text);
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(new_family_id,(select auth.uid()),'family.member.created','family_member',(select auth.uid())::text,
    pg_catalog.jsonb_build_object('role','owner'));
  return new_family_id;
end;
$$;
revoke all on function public.create_additional_family(text,text) from public, anon;
grant execute on function public.create_additional_family(text,text) to authenticated;

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
      'users',(select count(*) from public.profiles),
      'activeMemberships',(select count(*) from public.family_members where status='active'),
      'blockedMemberships',(select count(*) from public.family_members where status='blocked')
    ),
    'families',coalesce((select pg_catalog.jsonb_agg(row_data order by row_data->>'createdAt' desc) from (
      select pg_catalog.jsonb_build_object('id',f.id,'name',f.name,'createdAt',f.created_at,
        'memberCount',count(fm.user_id),'owner',max(fm.display_name) filter(where fm.role='owner' and fm.status='active')) row_data
      from public.families f left join public.family_members fm on fm.family_id=f.id group by f.id
    ) q),'[]'::jsonb),
    'users',coalesce((select pg_catalog.jsonb_agg(row_data order by row_data->>'displayName') from (
      select pg_catalog.jsonb_build_object('id',p.id,'displayName',p.display_name,'email',p.email,
        'familyCount',count(fm.family_id),'active',coalesce(bool_or(fm.status='active'),false)) row_data
      from public.profiles p left join public.family_members fm on fm.user_id=p.id group by p.id
    ) q),'[]'::jsonb),
    'memberships',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'familyId',fm.family_id,'familyName',f.name,'userId',fm.user_id,'displayName',fm.display_name,
      'role',fm.role,'status',fm.status
    ) order by f.name,fm.display_name) from public.family_members fm join public.families f on f.id=fm.family_id),'[]'::jsonb)
  ) end;
$$;
revoke all on function public.get_platform_admin_overview() from public, anon;
grant execute on function public.get_platform_admin_overview() to authenticated;

create or replace function public.platform_manage_membership(target_family_id uuid,target_user_id uuid,blocked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare target_role public.family_role;
begin
  if not public.is_platform_admin() then raise exception 'platform administrator required'; end if;
  perform 1 from public.families where id=target_family_id for update;
  select role into target_role from public.family_members where family_id=target_family_id and user_id=target_user_id for update;
  if not found then raise exception 'family member not found'; end if;
  if target_role='owner' and blocked then raise exception 'owner cannot be blocked without ownership transfer'; end if;
  update public.family_members set status=case when blocked then 'blocked'::public.membership_status else 'active'::public.membership_status end,
    updated_at=pg_catalog.now() where family_id=target_family_id and user_id=target_user_id;
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target_family_id,(select auth.uid()),case when blocked then 'platform.member.blocked' else 'platform.member.unblocked' end,
    'family_member',target_user_id::text,pg_catalog.jsonb_build_object('platform_admin',true));
end;
$$;
revoke all on function public.platform_manage_membership(uuid,uuid,boolean) from public, anon;
grant execute on function public.platform_manage_membership(uuid,uuid,boolean) to authenticated;

-- Direct membership writes remain unavailable; critical changes only use guarded RPCs.
revoke insert, update, delete on public.family_members from anon, authenticated;
revoke update(name, updated_at) on public.families from authenticated;

notify pgrst, 'reload schema';
