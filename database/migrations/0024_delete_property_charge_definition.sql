-- Permanently delete one recurring fixed charge and only its owned data.
create or replace function public.delete_property_charge_definition_permanently(
  target_family_id uuid,
  target_definition_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_definition public.property_charge_definitions%rowtype;
  linked_budget_ids uuid[];
  deleted_charge_count integer := 0;
  deleted_budget_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required';
  end if;

  if not public.has_family_role(
    target_family_id,
    array['owner','admin']::public.family_role[]
  ) then
    raise exception 'permanent charge definition deletion requires owner or admin role';
  end if;

  select * into target_definition
  from public.property_charge_definitions
  where id = target_definition_id
    and family_id = target_family_id
  for update;

  if not found then
    raise exception 'charge definition not found';
  end if;

  select coalesce(
    pg_catalog.array_agg(distinct c.budget_transaction_id)
      filter (where c.budget_transaction_id is not null),
    '{}'::uuid[]
  ) into linked_budget_ids
  from public.property_charges c
  where c.family_id = target_family_id
    and c.charge_definition_id = target_definition_id;

  delete from public.notifications n
  where n.family_id = target_family_id
    and n.source_type = 'property_charge'
    and exists (
      select 1
      from public.property_charges c
      where c.id = n.source_id
        and c.family_id = target_family_id
        and c.charge_definition_id = target_definition_id
    );

  delete from public.reminders r
  where r.family_id = target_family_id
    and r.source_type = 'property_charge'
    and exists (
      select 1
      from public.property_charges c
      where c.id = r.source_id
        and c.family_id = target_family_id
        and c.charge_definition_id = target_definition_id
    );

  delete from public.property_charge_reminder_rules
  where family_id = target_family_id
    and definition_id = target_definition_id;

  delete from public.property_charge_schedule_dates
  where family_id = target_family_id
    and definition_id = target_definition_id;

  delete from public.property_charges
  where family_id = target_family_id
    and charge_definition_id = target_definition_id;
  get diagnostics deleted_charge_count = row_count;

  delete from public.budget_transactions
  where family_id = target_family_id
    and id = any(linked_budget_ids);
  get diagnostics deleted_budget_count = row_count;

  delete from public.property_charge_definitions
  where id = target_definition_id
    and family_id = target_family_id;

  if not found then
    raise exception 'charge definition deletion failed';
  end if;

  insert into public.audit_logs(
    family_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    target_family_id,
    (select auth.uid()),
    'property.charge_definition.permanently_deleted',
    'property_charge_definition',
    target_definition_id::text,
    pg_catalog.jsonb_build_object(
      'generated_charges_deleted', deleted_charge_count,
      'linked_budget_transactions_deleted', deleted_budget_count
    )
  );
end;
$$;

revoke all on function public.delete_property_charge_definition_permanently(uuid,uuid)
from public, anon, authenticated;

grant execute on function public.delete_property_charge_definition_permanently(uuid,uuid)
to authenticated;

notify pgrst, 'reload schema';
