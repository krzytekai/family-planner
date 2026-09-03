-- Move only a definition; generated charges retain their own property/unit snapshot.
-- Keep the seven-argument RPC from 0019 for older clients during deployment.
create or replace function private.prepare_property_definition_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.family_id <> old.family_id or new.created_by <> old.created_by then
      raise exception 'charge definition ownership cannot be changed';
    end if;
    if new.property_id is distinct from old.property_id then
      if not private.can_manage_properties(new.family_id) then
        raise exception 'property access requires an active adult family member';
      end if;
      if not exists (
        select 1 from public.properties p
        where p.id = new.property_id and p.family_id = new.family_id and p.active
      ) then raise exception 'target property must be active and belong to the same family'; end if;
      -- A legacy unit belongs to the old group and cannot follow the definition.
      if new.property_unit_id is not null then
        raise exception 'moving a definition requires clearing its property unit';
      end if;
    elsif new.property_unit_id is distinct from old.property_unit_id then
      raise exception 'charge definition unit cannot be changed';
    end if;
  end if;
  if not private.valid_property_timezone(new.recurrence_timezone) then
    raise exception 'invalid recurrence timezone';
  end if;
  if new.active and not exists (
    select 1 from public.properties p
    where p.id = new.property_id and p.family_id = new.family_id and p.active
  ) then raise exception 'charge definition cannot be active for an archived property'; end if;
  new.name := pg_catalog.btrim(new.name);
  new.currency := pg_catalog.upper(pg_catalog.btrim(new.currency));
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
revoke all on function private.prepare_property_definition_write() from public, anon, authenticated;

create or replace function public.update_property_charge_definition(
  target_family_id uuid,
  target_definition_id uuid,
  charge_name text,
  charge_category text,
  charge_amount_mode text,
  charge_planned_amount numeric,
  charge_budget_sync_mode text,
  target_property_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  target_definition public.property_charge_definitions%rowtype;
  destination public.properties%rowtype;
begin
  if not private.can_manage_properties(target_family_id) then
    raise exception 'property access requires an active adult family member';
  end if;

  -- Lock the destination before the definition, as archive/restore do.
  -- FOR SHARE prevents an active target from being archived during this move.
  select * into destination from public.properties
  where id = target_property_id and family_id = target_family_id
  for share;
  if destination.id is null or not destination.active then
    raise exception 'target property must be active and belong to the same family';
  end if;

  select * into target_definition from public.property_charge_definitions
  where id = target_definition_id and family_id = target_family_id
  for update;
  if target_definition.id is null then raise exception 'charge definition not found'; end if;

  update public.property_charge_definitions
  set property_id = target_property_id,
      property_unit_id = case when property_id = target_property_id then property_unit_id else null end,
      suspended_by_property = case when property_id = target_property_id then suspended_by_property else false end,
      name = charge_name,
      category = charge_category,
      amount_mode = charge_amount_mode,
      planned_amount = charge_planned_amount,
      budget_sync_mode = charge_budget_sync_mode
  where id = target_definition_id and family_id = target_family_id;
  -- Existing audit_property_definition_change emits the standard update audit.
  -- No writes to charges/payments, recurrence, active or generation_resume_date.
end;
$$;
revoke all on function public.update_property_charge_definition(uuid,uuid,text,text,text,numeric,text,uuid)
from public, anon, authenticated;
grant execute on function public.update_property_charge_definition(uuid,uuid,text,text,text,numeric,text,uuid)
to authenticated;

notify pgrst, 'reload schema';
