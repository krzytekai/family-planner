-- Planer rodzinny — Sprint 1
-- Auth, multi-family, roles, audit log and Row Level Security.

create extension if not exists pgcrypto;

do $$ begin
  create type public.family_role as enum ('owner','admin','adult','child');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.membership_status as enum ('active','blocked');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text not null default 'Użytkownik',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.family_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role public.family_role not null default 'adult',
  status public.membership_status not null default 'active',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  family_id uuid not null references public.families(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists family_members_user_idx on public.family_members(user_id, status);
create index if not exists family_members_family_idx on public.family_members(family_id, role, status);
create index if not exists audit_logs_family_created_idx on public.audit_logs(family_id, created_at desc);

create or replace function public.is_family_member(target_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = (select auth.uid())
      and fm.status = 'active'
  );
$$;

create or replace function public.has_family_role(target_family_id uuid, allowed_roles public.family_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.family_members fm
    where fm.family_id = target_family_id
      and fm.user_id = (select auth.uid())
      and fm.status = 'active'
      and fm.role = any(allowed_roles)
  );
$$;

grant execute on function public.is_family_member(uuid) to authenticated;
grant execute on function public.has_family_role(uuid, public.family_role[]) to authenticated;

alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.audit_logs enable row level security;

-- Profiles: user can see profiles of people sharing an active family.
drop policy if exists profiles_select_shared_family on public.profiles;
create policy profiles_select_shared_family on public.profiles for select to authenticated
using (
  id = (select auth.uid()) or exists (
    select 1 from public.family_members me
    join public.family_members other on other.family_id = me.family_id
    where me.user_id = (select auth.uid()) and me.status = 'active'
      and other.user_id = profiles.id and other.status = 'active'
  )
);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update to authenticated
using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Families are visible to active members only.
drop policy if exists families_select_member on public.families;
create policy families_select_member on public.families for select to authenticated
using ((select public.is_family_member(id)));

drop policy if exists families_update_admin on public.families;
create policy families_update_admin on public.families for update to authenticated
using ((select public.has_family_role(id, array['owner','admin']::public.family_role[])))
with check ((select public.has_family_role(id, array['owner','admin']::public.family_role[])));

-- Membership rows are visible only within the same family.
drop policy if exists members_select_family on public.family_members;
create policy members_select_family on public.family_members for select to authenticated
using ((select public.is_family_member(family_id)));

-- Audit log is readable by owner/admin; writes happen on trusted server paths.
drop policy if exists audit_select_admin on public.audit_logs;
create policy audit_select_admin on public.audit_logs for select to authenticated
using ((select public.has_family_role(family_id, array['owner','admin']::public.family_role[])));

revoke insert, update, delete on public.family_members from anon, authenticated;
revoke insert, update, delete on public.audit_logs from anon, authenticated;
revoke insert, delete on public.families from anon, authenticated;

-- Create/update profile automatically for every Auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(coalesce(new.email,'Użytkownik'),'@',1)))
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert or update of email on auth.users
for each row execute procedure public.handle_new_user();

-- One-time helper used only to create the first family for an authenticated owner.
create or replace function public.bootstrap_family(family_name text, owner_display_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare new_family_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  if exists (select 1 from public.family_members where user_id = (select auth.uid())) then raise exception 'user already belongs to a family'; end if;
  insert into public.families(name, created_by) values (family_name, (select auth.uid())) returning id into new_family_id;
  insert into public.family_members(family_id,user_id,display_name,role,status,created_by)
  values (new_family_id,(select auth.uid()),owner_display_name,'owner','active',(select auth.uid()));
  update public.profiles set display_name = owner_display_name, updated_at = now() where id = (select auth.uid());
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id) values (new_family_id,(select auth.uid()),'family.bootstrapped','family',new_family_id::text);
  return new_family_id;
end;
$$;

grant execute on function public.bootstrap_family(text,text) to authenticated;
