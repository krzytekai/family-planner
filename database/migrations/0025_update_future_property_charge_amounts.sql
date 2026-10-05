-- Propagate a definition amount change only to matching pending occurrences
-- from the current month in the definition's recurrence timezone.
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
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_definition public.property_charge_definitions%rowtype;
  destination public.properties%rowtype;
  effective_month_start date;
begin
  if not private.can_manage_properties(target_family_id) then
    raise exception 'property access requires an active adult family member';
  end if;

  -- Keep the lock order introduced in 0020: destination before definition.
  select *
  into destination
  from public.properties
  where id = target_property_id
    and family_id = target_family_id
  for share;

  if destination.id is null or not destination.active then
    raise exception 'target property must be active and belong to the same family';
  end if;

  select *
  into target_definition
  from public.property_charge_definitions
  where id = target_definition_id
    and family_id = target_family_id
  for update;

  if target_definition.id is null then
    raise exception 'charge definition not found';
  end if;

  effective_month_start := pg_catalog.date_trunc(
    'month',
    pg_catalog.now() at time zone target_definition.recurrence_timezone
  )::date;

  update public.property_charge_definitions
  set property_id = target_property_id,
      property_unit_id = case
        when property_id = target_property_id then property_unit_id
        else null
      end,
      suspended_by_property = case
        when property_id = target_property_id then suspended_by_property
        else false
      end,
      name = charge_name,
      category = charge_category,
      amount_mode = charge_amount_mode,
      planned_amount = charge_planned_amount,
      budget_sync_mode = charge_budget_sync_mode
  where id = target_definition_id
    and family_id = target_family_id;

  if charge_planned_amount is distinct from target_definition.planned_amount then
    update public.property_charges
    set planned_amount = charge_planned_amount,
        updated_at = pg_catalog.now()
    where family_id = target_family_id
      and charge_definition_id = target_definition_id
      and status = 'pending'
      and due_date >= effective_month_start
      and planned_amount is not distinct from target_definition.planned_amount;
  end if;
end;
$$;

revoke all on function public.update_property_charge_definition(uuid,uuid,text,text,text,numeric,text,uuid)
from public, anon, authenticated;
grant execute on function public.update_property_charge_definition(uuid,uuid,text,text,text,numeric,text,uuid)
to authenticated;

-- Preserve the seven-argument compatibility signature with identical amount semantics.
create or replace function public.update_property_charge_definition(
  target_family_id uuid,
  target_definition_id uuid,
  charge_name text,
  charge_category text,
  charge_amount_mode text,
  charge_planned_amount numeric,
  charge_budget_sync_mode text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_property_id uuid;
begin
  select d.property_id
  into current_property_id
  from public.property_charge_definitions d
  where d.id = target_definition_id
    and d.family_id = target_family_id;

  if current_property_id is null then
    raise exception 'charge definition not found';
  end if;

  perform public.update_property_charge_definition(
    target_family_id,
    target_definition_id,
    charge_name,
    charge_category,
    charge_amount_mode,
    charge_planned_amount,
    charge_budget_sync_mode,
    current_property_id
  );
end;
$$;

revoke all on function public.update_property_charge_definition(uuid,uuid,text,text,text,numeric,text)
from public, anon, authenticated;
grant execute on function public.update_property_charge_definition(uuid,uuid,text,text,text,numeric,text)
to authenticated;

notify pgrst, 'reload schema';
