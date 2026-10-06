-- Allow an individual occurrence of every charge type to be marked as not occurring.
create or replace function public.update_property_charge(
  target_family_id uuid,
  target_charge_id uuid,
  next_planned_amount numeric,
  next_status text,
  next_actual_amount numeric,
  next_paid_at timestamptz,
  next_notes text,
  sync_budget boolean default false
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  charge_row public.property_charges%rowtype;
  definition_row public.property_charge_definitions%rowtype;
  transaction_id uuid;
  normalized_notes text;
begin
  if not private.can_manage_properties(target_family_id) then raise exception 'property access requires an active adult family member'; end if;
  if next_status not in ('pending','paid','cancelled','skipped') then raise exception 'invalid charge status'; end if;
  if next_planned_amount is not null and next_planned_amount <= 0 then raise exception 'planned amount must be positive'; end if;
  if next_status = 'paid' and (next_actual_amount is null or next_actual_amount <= 0 or next_paid_at is null) then raise exception 'paid charge requires a positive actual amount and payment date'; end if;
  if next_status <> 'paid' and (next_actual_amount is not null or next_paid_at is not null) then raise exception 'non-paid charge cannot contain payment data'; end if;

  select * into charge_row from public.property_charges
  where id = target_charge_id and family_id = target_family_id for update;
  if not found then raise exception 'charge not found'; end if;
  select * into definition_row from public.property_charge_definitions
  where id = charge_row.charge_definition_id and family_id = charge_row.family_id;
  if not found then raise exception 'charge definition not found'; end if;
  if charge_row.status = 'skipped' and next_status not in ('skipped','pending') then
    raise exception 'skipped charge must be restored to pending first';
  end if;
  if next_status = 'skipped' and charge_row.status not in ('pending','skipped') then
    raise exception 'only pending charges can be skipped';
  end if;

  normalized_notes := nullif(pg_catalog.btrim(next_notes),'');
  transaction_id := charge_row.budget_transaction_id;
  if next_status = 'paid' then
    if transaction_id is not null or definition_row.budget_sync_mode = 'automatic' or sync_budget then
      if transaction_id is null then
        insert into public.budget_transactions(family_id,transaction_type,title,description,amount,currency,category,transaction_date,paid_by,is_shared,created_by)
        values(charge_row.family_id,'expense','Opłata: '||definition_row.name,normalized_notes,next_actual_amount,charge_row.currency,'Nieruchomości',next_paid_at::date,(select auth.uid()),false,(select auth.uid()))
        returning id into transaction_id;
      else
        update public.budget_transactions
        set title='Opłata: '||definition_row.name,description=normalized_notes,amount=next_actual_amount,transaction_date=next_paid_at::date,paid_by=(select auth.uid())
        where id=transaction_id and family_id=charge_row.family_id;
        if not found then raise exception 'linked budget transaction not found'; end if;
      end if;
    end if;
    update public.property_charges
    set planned_amount=next_planned_amount,status='paid',actual_amount=next_actual_amount,paid_at=next_paid_at,notes=normalized_notes,budget_transaction_id=transaction_id,updated_at=pg_catalog.now()
    where id=charge_row.id;
    update public.reminders set status='cancelled',fired_at=null,updated_at=pg_catalog.now()
    where family_id=charge_row.family_id and source_type='property_charge' and source_id=charge_row.id and status='pending';
  else
    update public.property_charges
    set planned_amount=next_planned_amount,status=next_status,actual_amount=null,paid_at=null,notes=normalized_notes,budget_transaction_id=null,updated_at=pg_catalog.now()
    where id=charge_row.id;
    if transaction_id is not null then
      delete from public.budget_transactions where id=transaction_id and family_id=charge_row.family_id;
      if not found then raise exception 'linked budget transaction not found'; end if;
      transaction_id := null;
    end if;
    if next_status = 'pending' then
      perform private.resync_property_charge_reminders(charge_row.id);
    else
      update public.reminders set status='cancelled',fired_at=null,updated_at=pg_catalog.now()
      where family_id=charge_row.family_id and source_type='property_charge' and source_id=charge_row.id and status='pending';
    end if;
  end if;

  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(charge_row.family_id,(select auth.uid()),case when next_status='paid' and charge_row.status<>'paid' then 'property.charge.paid' when next_status='cancelled' and charge_row.status<>'cancelled' then 'property.charge.cancelled' when next_status='skipped' and charge_row.status<>'skipped' then 'property.charge.skipped' else 'property.charge.updated' end,'property_charge',charge_row.id::text,
    pg_catalog.jsonb_build_object('previous_status',charge_row.status,'status',next_status,'previous_planned_amount',charge_row.planned_amount,'planned_amount',next_planned_amount,'budget_linked',transaction_id is not null));
  if transaction_id is not null and charge_row.budget_transaction_id is null then
    insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
    values(charge_row.family_id,(select auth.uid()),'property.charge.budget_linked','property_charge',charge_row.id::text,pg_catalog.jsonb_build_object('budget_transaction_id',transaction_id));
  end if;
  return transaction_id;
end; $$;

revoke all on function public.update_property_charge(uuid,uuid,numeric,text,numeric,timestamptz,text,boolean) from public,anon,authenticated;
grant execute on function public.update_property_charge(uuid,uuid,numeric,text,numeric,timestamptz,text,boolean) to authenticated;

notify pgrst, 'reload schema';
