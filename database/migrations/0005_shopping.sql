-- Sprint 4: multi-list family shopping with tenant-safe items and database audit.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.shopping_lists (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (pg_catalog.char_length(name) between 1 and 100),
  description text,
  is_archived boolean not null default false,
  created_by uuid not null default auth.uid()
    constraint shopping_lists_created_by_fkey references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint shopping_lists_id_family_unique unique (id, family_id)
);

create table if not exists public.shopping_items (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  list_id uuid not null,
  name text not null check (pg_catalog.char_length(name) between 1 and 200),
  quantity numeric(10,3) check (quantity is null or quantity > 0),
  unit text check (unit is null or pg_catalog.char_length(unit) <= 30),
  category text check (category is null or pg_catalog.char_length(category) <= 50),
  note text,
  is_purchased boolean not null default false,
  created_by uuid not null default auth.uid()
    constraint shopping_items_created_by_fkey references public.profiles(id),
  purchased_by uuid
    constraint shopping_items_purchased_by_fkey references public.profiles(id) on delete set null,
  purchased_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint shopping_items_list_family_fkey
    foreign key (list_id, family_id)
    references public.shopping_lists(id, family_id)
    on delete cascade,
  constraint shopping_items_purchase_metadata_check check (
    (is_purchased = false and purchased_by is null and purchased_at is null)
    or (is_purchased = true and purchased_at is not null)
  )
);

create index if not exists shopping_lists_family_id_idx on public.shopping_lists(family_id);
create index if not exists shopping_lists_family_archived_idx on public.shopping_lists(family_id, is_archived);
create index if not exists shopping_items_family_id_idx on public.shopping_items(family_id);
create index if not exists shopping_items_list_id_idx on public.shopping_items(list_id);
create index if not exists shopping_items_list_purchased_idx on public.shopping_items(list_id, is_purchased);
create index if not exists shopping_items_created_by_idx on public.shopping_items(created_by);
create index if not exists shopping_items_purchased_by_idx on public.shopping_items(purchased_by)
  where purchased_by is not null;

create or replace function private.prepare_shopping_list_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.family_id <> old.family_id then
      raise exception 'shopping list family cannot be changed';
    end if;
    if new.created_by <> old.created_by then
      raise exception 'shopping list creator cannot be changed';
    end if;
  end if;

  new.name := pg_catalog.btrim(new.name);
  new.description := nullif(pg_catalog.btrim(new.description), '');
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.prepare_shopping_list_write() from public, anon, authenticated;

drop trigger if exists prepare_shopping_list_write on public.shopping_lists;
create trigger prepare_shopping_list_write
before insert or update on public.shopping_lists
for each row execute function private.prepare_shopping_list_write();

create or replace function private.prepare_shopping_item_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.family_id <> old.family_id then
      raise exception 'shopping item family cannot be changed';
    end if;
    if new.list_id <> old.list_id then
      raise exception 'shopping item list cannot be changed';
    end if;
    if new.created_by <> old.created_by then
      raise exception 'shopping item creator cannot be changed';
    end if;

    if not (
      old.created_by = (select auth.uid())
      or (select public.has_family_role(
        old.family_id,
        array['owner', 'admin']::public.family_role[]
      ))
    ) and (
      new.name is distinct from old.name
      or new.quantity is distinct from old.quantity
      or new.unit is distinct from old.unit
      or new.category is distinct from old.category
      or new.note is distinct from old.note
    ) then
      raise exception 'only the purchase status may be changed for this shopping item';
    end if;
  end if;

  new.name := pg_catalog.btrim(new.name);
  new.unit := nullif(pg_catalog.btrim(new.unit), '');
  new.category := nullif(pg_catalog.btrim(new.category), '');
  new.note := nullif(pg_catalog.btrim(new.note), '');
  new.updated_at := pg_catalog.now();

  if new.is_purchased = true then
    if tg_op = 'INSERT' or old.is_purchased = false then
      new.purchased_by := (select auth.uid());
      new.purchased_at := pg_catalog.now();
    else
      if not (
        old.purchased_by is not null
        and new.purchased_by is null
        and not exists (
          select 1 from public.profiles as purchaser_profile
          where purchaser_profile.id = old.purchased_by
        )
      ) then
        new.purchased_by := old.purchased_by;
      end if;
      new.purchased_at := old.purchased_at;
    end if;
  else
    new.purchased_by := null;
    new.purchased_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.prepare_shopping_item_write() from public, anon, authenticated;

drop trigger if exists prepare_shopping_item_write on public.shopping_items;
create trigger prepare_shopping_item_write
before insert or update on public.shopping_items
for each row execute function private.prepare_shopping_item_write();

create or replace function private.audit_shopping_list_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
  audit_row public.shopping_lists%rowtype;
begin
  if tg_op = 'DELETE' then audit_row := old; else audit_row := new; end if;
  if tg_op = 'INSERT' then
    audit_action := 'shopping_list.created';
  elsif tg_op = 'DELETE' then
    audit_action := 'shopping_list.deleted';
  elsif old.is_archived = false and new.is_archived = true then
    audit_action := 'shopping_list.archived';
  else
    audit_action := 'shopping_list.updated';
  end if;

  insert into public.audit_logs (family_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    audit_row.family_id,
    (select auth.uid()),
    audit_action,
    'shopping_list',
    audit_row.id::text,
    pg_catalog.jsonb_build_object('name', audit_row.name, 'is_archived', audit_row.is_archived)
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.audit_shopping_list_change() from public, anon, authenticated;

drop trigger if exists audit_shopping_list_change on public.shopping_lists;
create trigger audit_shopping_list_change
after insert or update or delete on public.shopping_lists
for each row execute function private.audit_shopping_list_change();

create or replace function private.audit_shopping_item_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
  audit_row public.shopping_items%rowtype;
begin
  if tg_op = 'DELETE' then audit_row := old; else audit_row := new; end if;
  if tg_op = 'INSERT' then
    audit_action := 'shopping_item.created';
  elsif tg_op = 'DELETE' then
    audit_action := 'shopping_item.deleted';
  elsif old.is_purchased = false and new.is_purchased = true then
    audit_action := 'shopping_item.purchased';
  elsif old.is_purchased = true and new.is_purchased = false then
    audit_action := 'shopping_item.unpurchased';
  else
    audit_action := 'shopping_item.updated';
  end if;

  insert into public.audit_logs (family_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (
    audit_row.family_id,
    (select auth.uid()),
    audit_action,
    'shopping_item',
    audit_row.id::text,
    pg_catalog.jsonb_build_object(
      'list_id', audit_row.list_id,
      'name', audit_row.name,
      'quantity', audit_row.quantity,
      'unit', audit_row.unit,
      'category', audit_row.category,
      'is_purchased', audit_row.is_purchased,
      'purchased_by', audit_row.purchased_by
    )
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.audit_shopping_item_change() from public, anon, authenticated;

drop trigger if exists audit_shopping_item_change on public.shopping_items;
create trigger audit_shopping_item_change
after insert or update or delete on public.shopping_items
for each row execute function private.audit_shopping_item_change();

alter table public.shopping_lists enable row level security;
alter table public.shopping_items enable row level security;

revoke all on public.shopping_lists from anon, authenticated;
grant select on public.shopping_lists to authenticated;
grant insert (family_id, name, description, is_archived) on public.shopping_lists to authenticated;
grant update (name, description, is_archived) on public.shopping_lists to authenticated;
grant delete on public.shopping_lists to authenticated;

revoke all on public.shopping_items from anon, authenticated;
grant select on public.shopping_items to authenticated;
grant insert (family_id, list_id, name, quantity, unit, category, note, is_purchased)
  on public.shopping_items to authenticated;
grant update (name, quantity, unit, category, note, is_purchased)
  on public.shopping_items to authenticated;
grant delete on public.shopping_items to authenticated;

drop policy if exists shopping_lists_select_family_member on public.shopping_lists;
create policy shopping_lists_select_family_member on public.shopping_lists for select to authenticated
using ((select public.is_family_member(family_id)));

drop policy if exists shopping_lists_insert_adult on public.shopping_lists;
create policy shopping_lists_insert_adult on public.shopping_lists for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select public.has_family_role(
    family_id,
    array['owner', 'admin', 'adult']::public.family_role[]
  ))
);

drop policy if exists shopping_lists_update_authorized on public.shopping_lists;
create policy shopping_lists_update_authorized on public.shopping_lists for update to authenticated
using (
  (select public.is_family_member(family_id))
  and (
    created_by = (select auth.uid())
    or (select public.has_family_role(
      family_id,
      array['owner', 'admin']::public.family_role[]
    ))
  )
)
with check ((select public.is_family_member(family_id)));

drop policy if exists shopping_lists_delete_authorized on public.shopping_lists;
create policy shopping_lists_delete_authorized on public.shopping_lists for delete to authenticated
using (
  (select public.is_family_member(family_id))
  and (
    created_by = (select auth.uid())
    or (select public.has_family_role(
      family_id,
      array['owner', 'admin']::public.family_role[]
    ))
  )
);

drop policy if exists shopping_items_select_family_member on public.shopping_items;
create policy shopping_items_select_family_member on public.shopping_items for select to authenticated
using ((select public.is_family_member(family_id)));

drop policy if exists shopping_items_insert_family_member on public.shopping_items;
create policy shopping_items_insert_family_member on public.shopping_items for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select public.is_family_member(family_id))
  and exists (
    select 1 from public.shopping_lists as target_list
    where target_list.id = shopping_items.list_id
      and target_list.family_id = shopping_items.family_id
  )
);

drop policy if exists shopping_items_update_family_member on public.shopping_items;
create policy shopping_items_update_family_member on public.shopping_items for update to authenticated
using ((select public.is_family_member(family_id)))
with check ((select public.is_family_member(family_id)));

drop policy if exists shopping_items_delete_authorized on public.shopping_items;
create policy shopping_items_delete_authorized on public.shopping_items for delete to authenticated
using (
  (select public.is_family_member(family_id))
  and (
    created_by = (select auth.uid())
    or (select public.has_family_role(
      family_id,
      array['owner', 'admin']::public.family_role[]
    ))
  )
);

notify pgrst, 'reload schema';
