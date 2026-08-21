-- Sprint 7.6.1: controlled property archive, restore and permanent deletion.

alter table public.property_charge_definitions
  add column suspended_by_property boolean not null default false;

create or replace function private.prepare_property_definition_write()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and (
    new.family_id<>old.family_id
    or new.property_id<>old.property_id
    or new.property_unit_id is distinct from old.property_unit_id
    or new.created_by<>old.created_by
  ) then raise exception 'charge definition ownership cannot be changed'; end if;
  if not private.valid_property_timezone(new.recurrence_timezone) then raise exception 'invalid recurrence timezone'; end if;
  if new.active and not exists(
    select 1 from public.properties p
    where p.id=new.property_id and p.family_id=new.family_id and p.active
  ) then raise exception 'charge definition cannot be active for an archived property'; end if;
  new.name:=pg_catalog.btrim(new.name);
  new.currency:=pg_catalog.upper(pg_catalog.btrim(new.currency));
  new.updated_at:=pg_catalog.now();
  return new;
end; $$;
revoke all on function private.prepare_property_definition_write() from public,anon,authenticated;

create or replace function private.audit_property_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare r record; action_value text; entity_value text; id_value text;
begin
  if tg_op='DELETE' then r:=old; else r:=new; end if;
  if tg_table_name='properties' then
    entity_value:='property';
    id_value:=r.id::text;
    action_value:=case
      when tg_op='INSERT' then 'property.created'
      when new.active=false and old.active=true then 'property.archived'
      when new.active=true and old.active=false then 'property.restored'
      else 'property.updated'
    end;
  elsif tg_table_name='property_units' then
    entity_value:='property_unit';
    id_value:=r.id::text;
    action_value:=case when tg_op='INSERT' then 'property.unit.created' else 'property.unit.updated' end;
  else
    entity_value:='property_charge_definition';
    id_value:=r.id::text;
    action_value:=case when tg_op='INSERT' then 'property.charge_definition.created' else 'property.charge_definition.updated' end;
  end if;
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id)
  values(r.family_id,(select auth.uid()),action_value,entity_value,id_value);
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
revoke all on function private.audit_property_change() from public,anon,authenticated;

create or replace function public.archive_property(target_family_id uuid,target_property_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target_property public.properties%rowtype;
begin
  if not private.can_manage_properties(target_family_id) then
    raise exception 'property access requires an active adult family member';
  end if;
  select * into target_property from public.properties
  where id=target_property_id and family_id=target_family_id for update;
  if not found then raise exception 'property not found'; end if;
  if not target_property.active then return; end if;

  update public.properties set active=false where id=target_property.id;
  update public.property_charge_definitions
  set active=false,suspended_by_property=true
  where family_id=target_family_id and property_id=target_property.id and active;
  update public.reminders r
  set status='cancelled',fired_at=null,updated_at=pg_catalog.now()
  where r.family_id=target_family_id and r.source_type='property_charge' and r.status='pending'
    and exists(
      select 1 from public.property_charges c
      where c.id=r.source_id and c.family_id=target_family_id and c.property_id=target_property.id
    );
end; $$;
revoke all on function public.archive_property(uuid,uuid) from public,anon;
grant execute on function public.archive_property(uuid,uuid) to authenticated;

create or replace function public.restore_property(target_family_id uuid,target_property_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target_property public.properties%rowtype; charge_id uuid;
begin
  if not private.can_manage_properties(target_family_id) then
    raise exception 'property access requires an active adult family member';
  end if;
  select * into target_property from public.properties
  where id=target_property_id and family_id=target_family_id for update;
  if not found then raise exception 'property not found'; end if;
  if target_property.active then return; end if;

  update public.properties set active=true where id=target_property.id;
  update public.property_charge_definitions
  set active=true,suspended_by_property=false
  where family_id=target_family_id and property_id=target_property.id and suspended_by_property;

  for charge_id in
    select c.id from public.property_charges c
    join public.property_charge_definitions d on d.id=c.charge_definition_id and d.family_id=c.family_id
    where c.family_id=target_family_id and c.property_id=target_property.id
      and c.status='pending' and d.active
    order by c.id
  loop
    perform private.ensure_property_charge_reminders(charge_id);
  end loop;
end; $$;
revoke all on function public.restore_property(uuid,uuid) from public,anon;
grant execute on function public.restore_property(uuid,uuid) to authenticated;

create or replace function public.delete_property_permanently(target_family_id uuid,target_property_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare target_property public.properties%rowtype; preserved_budget_count integer;
begin
  if not public.has_family_role(target_family_id,array['owner','admin']::public.family_role[]) then
    raise exception 'permanent property deletion requires owner or admin role';
  end if;
  select * into target_property from public.properties
  where id=target_property_id and family_id=target_family_id for update;
  if not found then raise exception 'property not found'; end if;

  select pg_catalog.count(*) into preserved_budget_count
  from public.property_charges c
  where c.family_id=target_family_id and c.property_id=target_property.id
    and c.budget_transaction_id is not null;

  delete from public.notifications n
  where n.family_id=target_family_id and n.source_type='property_charge'
    and exists(
      select 1 from public.property_charges c
      where c.id=n.source_id and c.family_id=target_family_id and c.property_id=target_property.id
    );
  delete from public.reminders r
  where r.family_id=target_family_id and r.source_type='property_charge'
    and exists(
      select 1 from public.property_charges c
      where c.id=r.source_id and c.family_id=target_family_id and c.property_id=target_property.id
    );
  delete from public.property_charges
  where family_id=target_family_id and property_id=target_property.id;
  delete from public.property_charge_definitions
  where family_id=target_family_id and property_id=target_property.id;
  delete from public.property_units
  where family_id=target_family_id and property_id=target_property.id;

  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(
    target_family_id,
    (select auth.uid()),
    'property.permanently_deleted',
    'property',
    target_property.id::text,
    pg_catalog.jsonb_build_object('linked_budget_transactions_preserved',preserved_budget_count)
  );
  delete from public.properties where id=target_property.id and family_id=target_family_id;
end; $$;
revoke all on function public.delete_property_permanently(uuid,uuid) from public,anon;
grant execute on function public.delete_property_permanently(uuid,uuid) to authenticated;

revoke update(active) on public.properties from authenticated;

notify pgrst,'reload schema';
