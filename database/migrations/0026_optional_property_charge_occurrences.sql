-- Add an explicit terminal state for recurring charges which did not occur.
alter table public.property_charges
  drop constraint if exists property_charges_status_check;
alter table public.property_charges
  add constraint property_charges_status_check
  check (status in ('pending','paid','cancelled','skipped'));

alter table public.property_charges
  drop constraint if exists property_charges_paid_shape_check;
alter table public.property_charges
  add constraint property_charges_paid_shape_check check (
    (status='paid' and actual_amount is not null and paid_at is not null)
    or (status in ('pending','cancelled','skipped') and actual_amount is null and paid_at is null)
  );

alter table public.property_charges
  drop constraint if exists property_charges_skipped_shape_check;
alter table public.property_charges
  add constraint property_charges_skipped_shape_check check (
    status<>'skipped' or budget_transaction_id is null
  );

-- Keep all occurrence mutations behind the existing authenticated RPC.
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
  if next_status = 'skipped' and charge_row.status <> 'skipped' and definition_row.amount_mode <> 'optional' then
    raise exception 'only optional charges can be skipped';
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

-- Existing lifecycle RPCs must not bypass the skipped-state transition rules.
create or replace function public.pay_property_charge(target_family_id uuid,target_charge_id uuid,paid_amount numeric,paid_timestamp timestamptz,payment_notes text,sync_budget boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.property_charges%rowtype; d public.property_charge_definitions%rowtype; transaction_id uuid;
begin
  if not private.can_manage_properties(target_family_id) then raise exception 'property access requires an active adult family member'; end if;
  if paid_amount<=0 or paid_timestamp is null then raise exception 'invalid payment data'; end if;
  select * into c from public.property_charges where id=target_charge_id and family_id=target_family_id for update;
  if not found or c.status in ('cancelled','skipped') then raise exception 'charge not found or cancelled'; end if;
  select * into d from public.property_charge_definitions where id=c.charge_definition_id;
  transaction_id:=c.budget_transaction_id;
  if transaction_id is not null or d.budget_sync_mode='automatic' or sync_budget then
    if transaction_id is null then
      insert into public.budget_transactions(family_id,transaction_type,title,description,amount,currency,category,transaction_date,paid_by,is_shared,created_by)
      values(c.family_id,'expense','Opłata: '||d.name,nullif(pg_catalog.btrim(payment_notes),''),paid_amount,c.currency,'Nieruchomości',paid_timestamp::date,(select auth.uid()),false,(select auth.uid())) returning id into transaction_id;
    else
      update public.budget_transactions set title='Opłata: '||d.name,description=nullif(pg_catalog.btrim(payment_notes),''),amount=paid_amount,transaction_date=paid_timestamp::date,paid_by=(select auth.uid()) where id=transaction_id and family_id=c.family_id;
    end if;
  end if;
  update public.property_charges set status='paid',actual_amount=paid_amount,paid_at=paid_timestamp,notes=nullif(pg_catalog.btrim(payment_notes),''),budget_transaction_id=transaction_id,updated_at=pg_catalog.now() where id=c.id;
  update public.reminders set status='cancelled',fired_at=null,updated_at=pg_catalog.now() where family_id=c.family_id and source_type='property_charge' and source_id=c.id and status='pending';
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(
    c.family_id,
    (select auth.uid()),
    case when c.status='paid' then 'property.charge.updated' else 'property.charge.paid' end,
    'property_charge',
    c.id::text,
    pg_catalog.jsonb_build_object('budget_linked',transaction_id is not null)
  );
  if transaction_id is not null and c.budget_transaction_id is null then insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata) values(c.family_id,(select auth.uid()),'property.charge.budget_linked','property_charge',c.id::text,pg_catalog.jsonb_build_object('budget_transaction_id',transaction_id)); end if;
  return transaction_id;
end; $$;
revoke all on function public.pay_property_charge(uuid,uuid,numeric,timestamptz,text,boolean) from public,anon;
grant execute on function public.pay_property_charge(uuid,uuid,numeric,timestamptz,text,boolean) to authenticated;

create or replace function public.cancel_property_charge(target_family_id uuid,target_charge_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.property_charges%rowtype;
begin
  if not private.can_manage_properties(target_family_id) then raise exception 'property access requires an active adult family member'; end if;
  select * into c from public.property_charges where id=target_charge_id and family_id=target_family_id for update;
  if not found or c.status in ('paid','skipped') then raise exception 'paid charges remain in history'; end if;
  update public.property_charges set status='cancelled',actual_amount=null,paid_at=null,updated_at=pg_catalog.now() where id=c.id;
  update public.reminders set status='cancelled',fired_at=null,updated_at=pg_catalog.now() where family_id=c.family_id and source_type='property_charge' and source_id=c.id and status='pending';
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id) values(c.family_id,(select auth.uid()),'property.charge.cancelled','property_charge',c.id::text);
end; $$;
revoke all on function public.cancel_property_charge(uuid,uuid) from public,anon;
grant execute on function public.cancel_property_charge(uuid,uuid) to authenticated;

-- Backups already export status verbatim; extend only the authoritative restore validator.
create or replace function private.validate_family_restore(
  target_family_id uuid,backup jsonb,selected_modules text[],user_mapping jsonb
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid:=(select auth.uid());
  allowed constant text[]:=array['tasks','calendar','shopping','budget','fixedCharges','reminders'];
  normalized text[];
  errors jsonb:='[]'::jsonb;
  warnings jsonb:='[]'::jsonb;
  item jsonb;
  module_name text;
  ids text[];
  total_records integer:=0;
  payload_bytes integer:=0;
  cleared_links integer:=0;
  ignored_reminders integer:=0;
  source_family_id text;
  source_family_name text;
  destination_name text;
  incoming jsonb:='{}'::jsonb;
  removing jsonb:='{}'::jsonb;
  required_users text[]:='{}'::text[];
begin
  if actor is null then errors:=errors||pg_catalog.jsonb_build_array('authentication_required'); end if;
  select f.name into destination_name from public.families f where f.id=target_family_id;
  if destination_name is null then errors:=errors||pg_catalog.jsonb_build_array('target_family_not_found'); end if;
  if actor is not null and not public.has_family_role(target_family_id,array['owner']::public.family_role[]) then
    errors:=errors||pg_catalog.jsonb_build_array('restore_requires_owner');
  end if;
  if backup is null or pg_catalog.jsonb_typeof(backup) is distinct from 'object' then
    errors:=errors||pg_catalog.jsonb_build_array('backup_must_be_object');
    return pg_catalog.jsonb_build_object('valid',false,'errors',errors,'warnings',warnings);
  end if;
  payload_bytes:=pg_catalog.octet_length(pg_catalog.convert_to(backup::text,'UTF8'));
  if payload_bytes>8388608 then errors:=errors||pg_catalog.jsonb_build_array('backup_exceeds_8_mib'); end if;
  if backup->>'format' is distinct from 'family-planner-backup' then errors:=errors||pg_catalog.jsonb_build_array('unsupported_format'); end if;
  if backup->>'backupVersion' is distinct from '1' then errors:=errors||pg_catalog.jsonb_build_array('unsupported_backup_version'); end if;
  if backup->>'schemaVersion' is distinct from '1' then errors:=errors||pg_catalog.jsonb_build_array('unsupported_schema_version'); end if;
  if not private.restore_valid_timestamp(backup->>'createdAt') then errors:=errors||pg_catalog.jsonb_build_array('invalid_backup_created_at');end if;
  source_family_id:=backup#>>'{family,id}'; source_family_name:=backup#>>'{family,name}';
  if source_family_id is null or source_family_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or source_family_name is null then
    errors:=errors||pg_catalog.jsonb_build_array('invalid_family_manifest');
  end if;
  if pg_catalog.jsonb_typeof(backup->'scope') is distinct from 'object'
    or pg_catalog.jsonb_typeof(backup->'family') is distinct from 'object'
    or pg_catalog.jsonb_typeof(backup->'modules') is distinct from 'object'
    or pg_catalog.jsonb_typeof(backup->'recordCounts') is distinct from 'object' then
    errors:=errors||pg_catalog.jsonb_build_array('invalid_modules_or_record_counts');
  end if;
  if backup#>>'{scope,familyId}' is distinct from source_family_id
    or backup#>>'{scope,exportedBy}' is null
    or pg_catalog.jsonb_typeof(backup#>'{scope,modules}') is distinct from 'array'
    or not (backup->'modules' ? 'family')
    or backup#>>'{modules,family,id}' is distinct from source_family_id
    or backup#>>'{modules,family,name}' is distinct from source_family_name
    or backup#>>'{recordCounts,family}' is distinct from '1' then
    errors:=errors||pg_catalog.jsonb_build_array('inconsistent_family_manifest');
  end if;
  if selected_modules is null or pg_catalog.cardinality(selected_modules)=0 then errors:=errors||pg_catalog.jsonb_build_array('select_at_least_one_module'); end if;
  if pg_catalog.jsonb_typeof(user_mapping) is distinct from 'object' then errors:=errors||pg_catalog.jsonb_build_array('user_mapping_must_be_object'); end if;
  if pg_catalog.octet_length(pg_catalog.convert_to(coalesce(user_mapping,'{}'::jsonb)::text,'UTF8'))>262144 then
    errors:=errors||pg_catalog.jsonb_build_array('user_mapping_exceeds_256_kib');
  end if;
  if exists(select 1 from pg_catalog.unnest(coalesce(selected_modules,'{}'::text[])) m where m is null or not(m=any(allowed))) then
    errors:=errors||pg_catalog.jsonb_build_array('unknown_or_metadata_only_module');
  end if;
  select pg_catalog.array_agg(m order by ord) into normalized
  from pg_catalog.unnest(allowed) with ordinality a(m,ord)
  where m=any(coalesce(selected_modules,'{}'::text[]));
  normalized:=coalesce(normalized,'{}'::text[]);
  foreach module_name in array normalized loop
    if not (backup->'modules' ? module_name) or pg_catalog.jsonb_typeof(backup->'modules'->module_name) is distinct from 'object' then errors:=errors||pg_catalog.jsonb_build_array('selected_module_missing_or_invalid:'||module_name); end if;
  end loop;
  if 'tasks'=any(normalized) and (not private.restore_ids_valid_unique(backup#>'{modules,tasks,items}') or not private.restore_ids_valid_unique(backup#>'{modules,tasks,recurrenceSeries}')) then errors:=errors||pg_catalog.jsonb_build_array('invalid_or_duplicate_task_ids'); end if;
  if 'calendar'=any(normalized) and not private.restore_ids_valid_unique(backup#>'{modules,calendar,events}') then errors:=errors||pg_catalog.jsonb_build_array('invalid_or_duplicate_calendar_ids'); end if;
  if 'shopping'=any(normalized) and (not private.restore_ids_valid_unique(backup#>'{modules,shopping,lists}') or not private.restore_ids_valid_unique(backup#>'{modules,shopping,items}')) then errors:=errors||pg_catalog.jsonb_build_array('invalid_or_duplicate_shopping_ids'); end if;
  if 'budget'=any(normalized) and (not private.restore_ids_valid_unique(backup#>'{modules,budget,transactions}') or not private.restore_ids_valid_unique(backup#>'{modules,budget,settlements}') or not private.restore_ids_valid_unique(backup#>'{modules,budget,plans}')) then errors:=errors||pg_catalog.jsonb_build_array('invalid_or_duplicate_budget_ids'); end if;
  if 'fixedCharges'=any(normalized) and (not private.restore_ids_valid_unique(backup#>'{modules,fixedCharges,properties}') or not private.restore_ids_valid_unique(backup#>'{modules,fixedCharges,units}') or not private.restore_ids_valid_unique(backup#>'{modules,fixedCharges,definitions}') or not private.restore_ids_valid_unique(backup#>'{modules,fixedCharges,charges}')) then errors:=errors||pg_catalog.jsonb_build_array('invalid_or_duplicate_fixed_charge_ids'); end if;

  -- Validate array shapes, duplicate UUIDs, record counts and conservative collection limits.
  if 'tasks'=any(normalized) then
    if pg_catalog.jsonb_typeof(backup#>'{modules,tasks,items}') is distinct from 'array' or pg_catalog.jsonb_typeof(backup#>'{modules,tasks,recurrenceSeries}') is distinct from 'array' then errors:=errors||pg_catalog.jsonb_build_array('invalid_tasks_shape'); else
      incoming:=incoming||pg_catalog.jsonb_build_object('tasks',pg_catalog.jsonb_build_object('items',pg_catalog.jsonb_array_length(backup#>'{modules,tasks,items}'),'recurrenceSeries',pg_catalog.jsonb_array_length(backup#>'{modules,tasks,recurrenceSeries}')));
      total_records:=total_records+pg_catalog.jsonb_array_length(backup#>'{modules,tasks,items}')+pg_catalog.jsonb_array_length(backup#>'{modules,tasks,recurrenceSeries}');
      select pg_catalog.array_agg(v->>'id') into ids from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,items}') v;
      if coalesce(pg_catalog.cardinality(ids),0)<>coalesce((select pg_catalog.count(distinct x) from pg_catalog.unnest(ids) x),0) then errors:=errors||pg_catalog.jsonb_build_array('duplicate_task_id'); end if;
      for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,recurrenceSeries}') loop
        if item->'recurrenceRule' is null or not private.valid_task_recurrence_rule(item->'recurrenceRule')
          or item->>'recurrenceTimezone' is null or not private.valid_timezone(item->>'recurrenceTimezone')
          or not private.restore_valid_timestamp(item->>'anchorDueAt')
          or item->'recurrenceEnabled' is null or pg_catalog.jsonb_typeof(item->'recurrenceEnabled')<>'boolean'
          or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false)
          or not private.restore_valid_timestamp(item->>'stoppedAt',true)
          or not private.restore_valid_timestamp(item->>'createdAt')
          or not private.restore_valid_timestamp(item->>'updatedAt') then errors:=errors||pg_catalog.jsonb_build_array('invalid_task_recurrence_series');end if;
        required_users:=pg_catalog.array_append(required_users,item->>'createdBy');
      end loop;
      for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,items}') loop
        if item->>'status' is null or item->>'status' not in ('todo','in_progress','done')
          or item->>'priority' is null or item->>'priority' not in ('low','normal','high')
          or item->>'title' is null or pg_catalog.char_length(item->>'title') not between 1 and 200
          or not private.restore_valid_timestamp(item->>'dueAt',true)
          or not private.restore_valid_timestamp(item->>'createdAt')
          or not private.restore_valid_timestamp(item->>'updatedAt')
          or not private.restore_valid_timestamp(item->>'completedAt',true)
          or (item->>'status'='done' and item->>'completedAt' is null)
          or (item->>'status'<>'done' and item->>'completedAt' is not null)
          or item->>'occurrenceIndex' is null or (item->>'occurrenceIndex')::integer<0
          or (item->>'assigneeReminderOffsetMinutes' is not null and (item->>'assigneeReminderOffsetMinutes')::integer not between 1 and 525600)
          then errors:=errors||pg_catalog.jsonb_build_array('invalid_task'); end if;
        if not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false) then errors:=errors||pg_catalog.jsonb_build_array('invalid_mapping:tasks.createdBy'); end if;
        if item->>'assignedTo' is not null and not private.valid_restore_mapping(user_mapping,item->>'assignedTo',target_family_id,true,false) then errors:=errors||pg_catalog.jsonb_build_array('invalid_mapping:tasks.assignedTo'); end if;
        required_users:=pg_catalog.array_append(required_users,item->>'createdBy'); if item->>'assignedTo' is not null then required_users:=pg_catalog.array_append(required_users,item->>'assignedTo'); end if;
        if item->>'recurrenceSeriesId' is not null and not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,recurrenceSeries}') s where s->>'id'=item->>'recurrenceSeriesId') then errors:=errors||pg_catalog.jsonb_build_array('broken_task_recurrence_reference'); end if;
        if item->>'generatedFromTaskId' is not null and not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,items}') t where t->>'id'=item->>'generatedFromTaskId') then errors:=errors||pg_catalog.jsonb_build_array('broken_generated_task_reference'); end if;
      end loop;
    end if;
  end if;
  if 'calendar'=any(normalized) then
    if pg_catalog.jsonb_typeof(backup#>'{modules,calendar,events}') is distinct from 'array' then errors:=errors||pg_catalog.jsonb_build_array('invalid_calendar_shape'); else
      incoming:=incoming||pg_catalog.jsonb_build_object('calendar',pg_catalog.jsonb_build_object('events',pg_catalog.jsonb_array_length(backup#>'{modules,calendar,events}'))); total_records:=total_records+pg_catalog.jsonb_array_length(backup#>'{modules,calendar,events}');
      for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,calendar,events}') loop
        if item->>'title' is null or pg_catalog.char_length(item->>'title') not between 1 and 200
          or item->>'eventType' is null or item->>'eventType' not in ('family','appointment','school','work','birthday','other')
          or pg_catalog.jsonb_typeof(item->'allDay') is distinct from 'boolean'
          or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false)
          or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt') then
          errors:=errors||pg_catalog.jsonb_build_array('invalid_calendar_event_or_mapping');
        elsif (item->>'allDay')::boolean then
          if not private.restore_valid_date(item->>'startDate') or not private.restore_valid_date(item->>'endDate',true) or item->>'startsAt' is not null or item->>'endsAt' is not null or (item->>'endDate' is not null and (item->>'endDate')::date<(item->>'startDate')::date) then errors:=errors||pg_catalog.jsonb_build_array('invalid_all_day_calendar_shape');end if;
        elsif not private.restore_valid_timestamp(item->>'startsAt') or not private.restore_valid_timestamp(item->>'endsAt',true) or item->>'startDate' is not null or item->>'endDate' is not null or (item->>'endsAt' is not null and (item->>'endsAt')::timestamptz<(item->>'startsAt')::timestamptz) then errors:=errors||pg_catalog.jsonb_build_array('invalid_timed_calendar_shape');end if;
        required_users:=pg_catalog.array_append(required_users,item->>'createdBy');
      end loop;
    end if;
  end if;
  if 'shopping'=any(normalized) then
    if pg_catalog.jsonb_typeof(backup#>'{modules,shopping,lists}') is distinct from 'array' or pg_catalog.jsonb_typeof(backup#>'{modules,shopping,items}') is distinct from 'array' then errors:=errors||pg_catalog.jsonb_build_array('invalid_shopping_shape'); else
      incoming:=incoming||pg_catalog.jsonb_build_object('shopping',pg_catalog.jsonb_build_object('lists',pg_catalog.jsonb_array_length(backup#>'{modules,shopping,lists}'),'items',pg_catalog.jsonb_array_length(backup#>'{modules,shopping,items}'))); total_records:=total_records+pg_catalog.jsonb_array_length(backup#>'{modules,shopping,lists}')+pg_catalog.jsonb_array_length(backup#>'{modules,shopping,items}');
      for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,shopping,lists}') loop if item->>'name' is null or pg_catalog.char_length(item->>'name') not between 1 and 100 or item->'isArchived' is null or pg_catalog.jsonb_typeof(item->'isArchived')<>'boolean' or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt') or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false) then errors:=errors||pg_catalog.jsonb_build_array('invalid_shopping_list'); end if; required_users:=pg_catalog.array_append(required_users,item->>'createdBy'); end loop;
      for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,shopping,items}') loop
        if not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,shopping,lists}') l where l->>'id'=item->>'listId') then errors:=errors||pg_catalog.jsonb_build_array('orphan_shopping_item'); end if;
        if item->>'name' is null or pg_catalog.char_length(item->>'name') not between 1 and 200
          or item->'isPurchased' is null or pg_catalog.jsonb_typeof(item->'isPurchased')<>'boolean'
          or not private.restore_valid_positive_numeric(item->>'quantity',true)
          or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt')
          or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false)
          or (item->>'purchasedBy' is not null and not private.valid_restore_mapping(user_mapping,item->>'purchasedBy',target_family_id,true,false))
          or ((item->>'isPurchased')::boolean and not private.restore_valid_timestamp(item->>'purchasedAt'))
          or (not (item->>'isPurchased')::boolean and (item->>'purchasedBy' is not null or item->>'purchasedAt' is not null)) then errors:=errors||pg_catalog.jsonb_build_array('invalid_shopping_item'); end if;
        required_users:=pg_catalog.array_append(required_users,item->>'createdBy'); if item->>'purchasedBy' is not null then required_users:=pg_catalog.array_append(required_users,item->>'purchasedBy'); end if;
      end loop;
    end if;
  end if;
  if 'budget'=any(normalized) then
    if pg_catalog.jsonb_typeof(backup#>'{modules,budget,transactions}') is distinct from 'array'
      or pg_catalog.jsonb_typeof(backup#>'{modules,budget,expenseParticipants}') is distinct from 'array'
      or pg_catalog.jsonb_typeof(backup#>'{modules,budget,settlementMembers}') is distinct from 'array'
      or pg_catalog.jsonb_typeof(backup#>'{modules,budget,settlements}') is distinct from 'array'
      or pg_catalog.jsonb_typeof(backup#>'{modules,budget,plans}') is distinct from 'array' then errors:=errors||pg_catalog.jsonb_build_array('invalid_budget_shape'); else
      incoming:=incoming||pg_catalog.jsonb_build_object('budget',pg_catalog.jsonb_build_object('transactions',pg_catalog.jsonb_array_length(backup#>'{modules,budget,transactions}'),'expenseParticipants',pg_catalog.jsonb_array_length(backup#>'{modules,budget,expenseParticipants}'),'settlementMembers',pg_catalog.jsonb_array_length(backup#>'{modules,budget,settlementMembers}'),'settlements',pg_catalog.jsonb_array_length(backup#>'{modules,budget,settlements}'),'plans',pg_catalog.jsonb_array_length(backup#>'{modules,budget,plans}')));
      total_records:=total_records+pg_catalog.jsonb_array_length(backup#>'{modules,budget,transactions}')+pg_catalog.jsonb_array_length(backup#>'{modules,budget,expenseParticipants}')+pg_catalog.jsonb_array_length(backup#>'{modules,budget,settlementMembers}')+pg_catalog.jsonb_array_length(backup#>'{modules,budget,settlements}')+pg_catalog.jsonb_array_length(backup#>'{modules,budget,plans}');
      for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,transactions}') loop
        if item->>'transactionType' is null or item->>'transactionType' not in ('expense','income')
          or item->>'title' is null or pg_catalog.char_length(item->>'title') not between 1 and 200
          or not private.restore_valid_positive_numeric(item->>'amount')
          or item->>'currency' is null or pg_catalog.char_length(item->>'currency')<>3
          or not private.restore_valid_date(item->>'transactionDate')
          or item->'isShared' is null or pg_catalog.jsonb_typeof(item->'isShared')<>'boolean'
          or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt')
          or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false)
          or (item->>'transactionType'='expense' and not private.valid_restore_mapping(user_mapping,item->>'paidBy',target_family_id,false,true))
          or (item->>'transactionType'='income' and (item->>'paidBy' is not null or (item->>'isShared')::boolean)) then errors:=errors||pg_catalog.jsonb_build_array('invalid_budget_transaction_or_mapping'); end if;
        required_users:=pg_catalog.array_append(required_users,item->>'createdBy');if item->>'paidBy' is not null then required_users:=pg_catalog.array_append(required_users,item->>'paidBy');end if;
      end loop;
      for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,expenseParticipants}') loop if not private.restore_valid_positive_numeric(item->>'shareWeight') or not private.restore_valid_timestamp(item->>'createdAt') or not private.valid_restore_mapping(user_mapping,item->>'userId',target_family_id,false,true) or not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,transactions}') t where t->>'id'=item->>'transactionId' and t->>'transactionType'='expense' and (t->>'isShared')::boolean) then errors:=errors||pg_catalog.jsonb_build_array('invalid_budget_participant'); end if;required_users:=pg_catalog.array_append(required_users,item->>'userId');end loop;
      for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlementMembers}') loop if item->'isActive' is null or pg_catalog.jsonb_typeof(item->'isActive')<>'boolean' or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt') or not private.valid_restore_mapping(user_mapping,item->>'userId',target_family_id,false,true) or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false) then errors:=errors||pg_catalog.jsonb_build_array('invalid_settlement_member'); end if;required_users:=pg_catalog.array_append(required_users,item->>'userId');required_users:=pg_catalog.array_append(required_users,item->>'createdBy');end loop;
      for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlements}') loop if not private.restore_valid_positive_numeric(item->>'amount') or item->>'currency' is null or pg_catalog.char_length(item->>'currency')<>3 or not private.restore_valid_date(item->>'settlementDate') or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt') or not private.valid_restore_mapping(user_mapping,item->>'fromUserId',target_family_id,false,true) or not private.valid_restore_mapping(user_mapping,item->>'toUserId',target_family_id,false,true) or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false) then errors:=errors||pg_catalog.jsonb_build_array('invalid_settlement_mapping');elsif private.restore_mapping_value(user_mapping,item->>'fromUserId')=private.restore_mapping_value(user_mapping,item->>'toUserId') then errors:=errors||pg_catalog.jsonb_build_array('settlement_parties_map_to_same_user');end if;required_users:=required_users||array[item->>'fromUserId',item->>'toUserId',item->>'createdBy'];end loop;
      for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,plans}') loop if item->>'planType' is null or item->>'planType' not in('expense_limit','income_target') or not private.restore_valid_date(item->>'month') or pg_catalog.date_trunc('month',(item->>'month')::timestamp)::date<>(item->>'month')::date or not private.restore_valid_positive_numeric(item->>'amount') or item->>'currency' is null or pg_catalog.char_length(item->>'currency')<>3 or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt') or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false) then errors:=errors||pg_catalog.jsonb_build_array('invalid_budget_plan');end if;required_users:=pg_catalog.array_append(required_users,item->>'createdBy');end loop;
      if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,expenseParticipants}'))<>(select pg_catalog.count(distinct (p->>'transactionId',p->>'userId')) from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,expenseParticipants}') p) then errors:=errors||pg_catalog.jsonb_build_array('duplicate_budget_participant');end if;
      if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlementMembers}'))<>(select pg_catalog.count(distinct m->>'userId') from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlementMembers}') m) then errors:=errors||pg_catalog.jsonb_build_array('duplicate_settlement_member');end if;
      if exists(
        select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,transactions}') t
        where t->>'transactionType'='expense' and (t->>'isShared')::boolean
          and (
            (select pg_catalog.count(distinct private.restore_mapping_value(user_mapping,p->>'userId')) from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,expenseParticipants}') p where p->>'transactionId'=t->>'id')<2
            or not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,expenseParticipants}') p where p->>'transactionId'=t->>'id' and private.restore_mapping_value(user_mapping,p->>'userId')=private.restore_mapping_value(user_mapping,t->>'paidBy'))
          )
      ) then errors:=errors||pg_catalog.jsonb_build_array('invalid_shared_expense_participant_set');end if;
      if exists(
        select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,expenseParticipants}') p
        group by p->>'transactionId',private.restore_mapping_value(user_mapping,p->>'userId') having pg_catalog.count(*)>1
      ) then errors:=errors||pg_catalog.jsonb_build_array('participant_mapping_collision');end if;
      if exists(
        select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlementMembers}') m
        group by private.restore_mapping_value(user_mapping,m->>'userId') having pg_catalog.count(*)>1
      ) then errors:=errors||pg_catalog.jsonb_build_array('settlement_member_mapping_collision');end if;
    end if;
    if not 'fixedCharges'=any(normalized) and exists(select 1 from public.property_charges c where c.family_id=target_family_id and c.budget_transaction_id is not null) then errors:=errors||pg_catalog.jsonb_build_array('budget_replace_blocked_by_existing_fixed_charges'); end if;
  end if;
  if 'fixedCharges'=any(normalized) then
    if pg_catalog.jsonb_typeof(backup#>'{modules,fixedCharges,properties}') is distinct from 'array'
      or pg_catalog.jsonb_typeof(backup#>'{modules,fixedCharges,units}') is distinct from 'array'
      or pg_catalog.jsonb_typeof(backup#>'{modules,fixedCharges,definitions}') is distinct from 'array'
      or pg_catalog.jsonb_typeof(backup#>'{modules,fixedCharges,scheduleDates}') is distinct from 'array'
      or pg_catalog.jsonb_typeof(backup#>'{modules,fixedCharges,reminderRules}') is distinct from 'array'
      or pg_catalog.jsonb_typeof(backup#>'{modules,fixedCharges,charges}') is distinct from 'array' then
      errors:=errors||pg_catalog.jsonb_build_array('invalid_fixed_charges_shape');
    else
    incoming:=incoming||pg_catalog.jsonb_build_object('fixedCharges',pg_catalog.jsonb_build_object('properties',pg_catalog.jsonb_array_length(backup#>'{modules,fixedCharges,properties}'),'units',pg_catalog.jsonb_array_length(backup#>'{modules,fixedCharges,units}'),'definitions',pg_catalog.jsonb_array_length(backup#>'{modules,fixedCharges,definitions}'),'scheduleDates',pg_catalog.jsonb_array_length(backup#>'{modules,fixedCharges,scheduleDates}'),'reminderRules',pg_catalog.jsonb_array_length(backup#>'{modules,fixedCharges,reminderRules}'),'charges',pg_catalog.jsonb_array_length(backup#>'{modules,fixedCharges,charges}')));
    total_records:=total_records+pg_catalog.jsonb_array_length(backup#>'{modules,fixedCharges,properties}')+pg_catalog.jsonb_array_length(backup#>'{modules,fixedCharges,units}')+pg_catalog.jsonb_array_length(backup#>'{modules,fixedCharges,definitions}')+pg_catalog.jsonb_array_length(backup#>'{modules,fixedCharges,scheduleDates}')+pg_catalog.jsonb_array_length(backup#>'{modules,fixedCharges,reminderRules}')+pg_catalog.jsonb_array_length(backup#>'{modules,fixedCharges,charges}');
    select pg_catalog.count(*) into cleared_links from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,charges}') c where c->>'budgetTransactionId' is not null;
    if not 'budget'=any(normalized) and cleared_links>0 then warnings:=warnings||pg_catalog.jsonb_build_array('fixed_charge_budget_links_will_be_cleared:'||cleared_links); end if;
    warnings:=warnings||pg_catalog.jsonb_build_array('generation_resume_date_will_not_precede_restore_date','backup_v1_missing_suspended_by_property_defaults_false');
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,properties}') loop
      if item->>'name' is null or pg_catalog.char_length(item->>'name') not between 1 and 120
        or pg_catalog.jsonb_typeof(item->'active') is distinct from 'boolean'
        or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt')
        or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false) then
        errors:=errors||pg_catalog.jsonb_build_array('invalid_property');
      end if;
      required_users:=pg_catalog.array_append(required_users,item->>'createdBy');
    end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,units}') loop
      if item->>'name' is null or pg_catalog.char_length(item->>'name') not between 1 and 120
        or item->>'unitType' is null or item->>'unitType' not in ('apartment','garage','parking','commercial','land','other')
        or pg_catalog.jsonb_typeof(item->'active') is distinct from 'boolean'
        or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt')
        or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false)
        or not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,properties}') p where p->>'id'=item->>'propertyId') then
        errors:=errors||pg_catalog.jsonb_build_array('invalid_property_unit');
      end if;
      required_users:=pg_catalog.array_append(required_users,item->>'createdBy');
    end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,definitions}') loop
      if item->>'name' is null or pg_catalog.char_length(item->>'name') not between 1 and 160
        or item->>'category' is null or item->>'category' not in ('rent','electricity','gas','water','internet','tax','insurance','parking','service','other')
        or item->>'amountMode' is null or item->>'amountMode' not in ('fixed','variable','optional')
        or not private.restore_valid_positive_numeric(item->>'plannedAmount',true)
        or (item->>'amountMode'='fixed' and item->>'plannedAmount' is null)
        or item->>'currency' is null or pg_catalog.char_length(item->>'currency')<>3
        or item->>'recurrenceType' is null or item->>'recurrenceType' not in ('one_time','monthly','interval_months','yearly','selected_dates')
        or item->>'recurrenceTimezone' is null or not private.valid_timezone(item->>'recurrenceTimezone')
        or not private.restore_valid_date(item->>'startDate') or not private.restore_valid_date(item->>'generationResumeDate')
        or not private.restore_valid_positive_numeric(item->>'dueDay',true)
        or not private.restore_valid_positive_numeric(item->>'intervalMonths',true)
        or not private.restore_valid_positive_numeric(item->>'recurrenceMonth',true)
        or (item->>'dueDay' is not null and (item->>'dueDay')::integer not between 1 and 31)
        or (item->>'intervalMonths' is not null and (item->>'intervalMonths')::integer not between 2 and 120)
        or (item->>'recurrenceMonth' is not null and (item->>'recurrenceMonth')::integer not between 1 and 12)
        or (item->>'recurrenceType'='monthly' and item->>'dueDay' is null)
        or (item->>'recurrenceType'='interval_months' and (item->>'dueDay' is null or item->>'intervalMonths' is null))
        or (item->>'recurrenceType'='yearly' and (item->>'dueDay' is null or item->>'recurrenceMonth' is null))
        or pg_catalog.jsonb_typeof(item->'active') is distinct from 'boolean'
        or pg_catalog.jsonb_typeof(item->'autoGenerate') is distinct from 'boolean'
        or item->>'budgetSyncMode' is null or item->>'budgetSyncMode' not in ('manual','automatic')
        or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt')
        or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false)
        or not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,properties}') p where p->>'id'=item->>'propertyId')
        or ((item->>'active')::boolean and not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,properties}') p where p->>'id'=item->>'propertyId' and (p->>'active')::boolean))
        or (item->>'propertyUnitId' is not null and not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,units}') u where u->>'id'=item->>'propertyUnitId' and u->>'propertyId'=item->>'propertyId')) then
        errors:=errors||pg_catalog.jsonb_build_array('invalid_fixed_charge_definition');
      end if;
      required_users:=pg_catalog.array_append(required_users,item->>'createdBy');
    end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,scheduleDates}') loop
      if item->>'definitionId' is null or item->>'month' is null or item->>'day' is null
        or (item->>'month')::integer not between 1 and 12 or (item->>'day')::integer not between 1 and 31
        or not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,definitions}') d where d->>'id'=item->>'definitionId' and d->>'recurrenceType'='selected_dates') then
        errors:=errors||pg_catalog.jsonb_build_array('invalid_fixed_charge_schedule_date');
      end if;
    end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,reminderRules}') loop
      if item->>'offsetDays' is null or (item->>'offsetDays')::integer not between -30 and 365
        or not private.restore_valid_timestamp(item->>'createdAt')
        or not private.valid_restore_mapping(user_mapping,item->>'recipientUserId',target_family_id,false,false)
        or not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,definitions}') d where d->>'id'=item->>'definitionId') then
        errors:=errors||pg_catalog.jsonb_build_array('invalid_fixed_charge_reminder_mapping');
      end if;
      required_users:=pg_catalog.array_append(required_users,item->>'recipientUserId');
    end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,charges}') loop
      if not private.restore_valid_date(item->>'dueDate')
        or not private.restore_valid_positive_numeric(item->>'plannedAmount',true)
        or not private.restore_valid_positive_numeric(item->>'actualAmount',true)
        or item->>'currency' is null or pg_catalog.char_length(item->>'currency')<>3
        or item->>'status' is null or item->>'status' not in ('pending','paid','cancelled','skipped')
        or not private.restore_valid_timestamp(item->>'paidAt',true)
        or (item->>'status'='paid' and item->>'paidAt' is null)
        or (item->>'status'<>'paid' and item->>'paidAt' is not null)
        or (item->>'status'='paid' and item->>'actualAmount' is null)
        or (item->>'status'<>'paid' and item->>'actualAmount' is not null)
        or (item->>'status'='skipped' and item->>'budgetTransactionId' is not null)
        or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt')
        or not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,definitions}') d where d->>'id'=item->>'chargeDefinitionId' and d->>'propertyId'=item->>'propertyId' and coalesce(d->>'propertyUnitId','')=coalesce(item->>'propertyUnitId',''))
        or not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,properties}') p where p->>'id'=item->>'propertyId')
        or (item->>'propertyUnitId' is not null and not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,units}') u where u->>'id'=item->>'propertyUnitId' and u->>'propertyId'=item->>'propertyId')) then
        errors:=errors||pg_catalog.jsonb_build_array('invalid_property_charge');
      end if;
    end loop;
    if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,scheduleDates}'))<>(select pg_catalog.count(distinct (s->>'definitionId',s->>'month',s->>'day')) from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,scheduleDates}') s) then errors:=errors||pg_catalog.jsonb_build_array('duplicate_fixed_charge_schedule_date');end if;
    if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,reminderRules}'))<>(select pg_catalog.count(distinct (r->>'definitionId',r->>'recipientUserId',r->>'offsetDays')) from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,reminderRules}') r) then errors:=errors||pg_catalog.jsonb_build_array('duplicate_fixed_charge_reminder_rule');end if;
    if exists(
      select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,reminderRules}') r
      group by r->>'definitionId',private.restore_mapping_value(user_mapping,r->>'recipientUserId'),r->>'offsetDays' having pg_catalog.count(*)>1
    ) then errors:=errors||pg_catalog.jsonb_build_array('fixed_charge_reminder_mapping_collision');end if;
    if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,charges}'))<>(select pg_catalog.count(distinct (c->>'chargeDefinitionId',c->>'dueDate')) from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,charges}') c) then errors:=errors||pg_catalog.jsonb_build_array('duplicate_property_charge_period');end if;
    if 'budget'=any(normalized) and exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,charges}') c where c->>'budgetTransactionId' is not null and not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,transactions}') t where t->>'id'=c->>'budgetTransactionId')) then errors:=errors||pg_catalog.jsonb_build_array('broken_fixed_charge_budget_reference'); end if;
    end if;
  end if;
  if 'reminders'=any(normalized) then
    if pg_catalog.jsonb_typeof(backup#>'{modules,reminders,items}') is distinct from 'array' or pg_catalog.jsonb_typeof(backup#>'{modules,reminders,preferences}') is distinct from 'array' then errors:=errors||pg_catalog.jsonb_build_array('invalid_reminders_shape');
    else incoming:=incoming||pg_catalog.jsonb_build_object('reminders',pg_catalog.jsonb_build_object('items',pg_catalog.jsonb_array_length(backup#>'{modules,reminders,items}'),'preferences',pg_catalog.jsonb_array_length(backup#>'{modules,reminders,preferences}')));total_records:=total_records+pg_catalog.jsonb_array_length(backup#>'{modules,reminders,items}')+pg_catalog.jsonb_array_length(backup#>'{modules,reminders,preferences}');
    if backup#>>'{modules,reminders,scope}' is distinct from 'current_user' then errors:=errors||pg_catalog.jsonb_build_array('invalid_reminder_scope'); end if;
    if not private.valid_restore_mapping(user_mapping,backup#>>'{scope,exportedBy}',target_family_id,false,false) or private.restore_mapping_value(user_mapping,backup#>>'{scope,exportedBy}')<>actor then errors:=errors||pg_catalog.jsonb_build_array('reminder_exporter_must_map_to_current_owner'); end if;
    if not private.restore_ids_valid_unique(backup#>'{modules,reminders,items}') then errors:=errors||pg_catalog.jsonb_build_array('invalid_or_duplicate_reminder_ids'); end if;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,reminders,items}') loop
      if item->>'sourceType' is null or item->>'sourceType' not in ('task','calendar_event','property_charge')
        or item->>'sourceId' is null or not private.restore_valid_uuid(item->>'sourceId')
        or item->>'title' is null or pg_catalog.char_length(item->>'title') not between 1 and 200
        or not private.restore_valid_timestamp(item->>'remindAt')
        or item->>'timezone' is null or not private.valid_timezone(item->>'timezone')
        or item->>'status' is null or item->>'status' not in ('pending','fired','cancelled')
        or item->>'reminderKind' is null or item->>'reminderKind' not in ('personal','task_assignee','property_charge')
        or not private.restore_valid_timestamp(item->>'firedAt',true)
        or not private.restore_valid_timestamp(item->>'createdAt') or not private.restore_valid_timestamp(item->>'updatedAt')
        or not private.valid_restore_mapping(user_mapping,item->>'createdBy',target_family_id,false,false) then
        errors:=errors||pg_catalog.jsonb_build_array('invalid_reminder');
      end if;
      required_users:=pg_catalog.array_append(required_users,item->>'createdBy');
    end loop;
    select pg_catalog.count(*) into ignored_reminders from pg_catalog.jsonb_array_elements(backup#>'{modules,reminders,items}') r where not(r->>'reminderKind'='personal' and r->>'status'='pending' and private.restore_valid_timestamp(r->>'remindAt') and (r->>'remindAt')::timestamptz>pg_catalog.now() and r->>'sourceType' in ('task','calendar_event'));
    warnings:=warnings||pg_catalog.jsonb_build_array('notification_preferences_are_ignored','ignored_reminders:'||ignored_reminders);
    if exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,reminders,items}') r where r->>'reminderKind'='personal' and r->>'status'='pending' and (r->>'remindAt')::timestamptz>pg_catalog.now() and ((r->>'sourceType'='task' and not 'tasks'=any(normalized)) or (r->>'sourceType'='calendar_event' and not 'calendar'=any(normalized)))) then errors:=errors||pg_catalog.jsonb_build_array('personal_reminder_source_module_required'); end if;
    if exists(
      select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,reminders,items}') r
      where r->>'reminderKind'='personal' and r->>'status'='pending' and (r->>'remindAt')::timestamptz>pg_catalog.now()
        and (
          (r->>'sourceType'='task' and not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,items}') t where t->>'id'=r->>'sourceId'))
          or (r->>'sourceType'='calendar_event' and not exists(select 1 from pg_catalog.jsonb_array_elements(backup#>'{modules,calendar,events}') e where e->>'id'=r->>'sourceId'))
          or r->>'sourceType'='property_charge'
        )
    ) then errors:=errors||pg_catalog.jsonb_build_array('personal_reminder_source_missing'); end if;
    end if;
  end if;
  foreach module_name in array normalized loop
    if backup->'recordCounts'->module_name is distinct from incoming->module_name then
      errors:=errors||pg_catalog.jsonb_build_array('record_count_mismatch:'||module_name);
    end if;
  end loop;
  if total_records>50000 then errors:=errors||pg_catalog.jsonb_build_array('restore_exceeds_50000_records'); end if;
  if exists(
    select 1 from pg_catalog.jsonb_each(incoming) module_entry
    cross join lateral pg_catalog.jsonb_each(module_entry.value) collection_entry
    where (collection_entry.value #>> '{}')::integer>10000
  ) then errors:=errors||pg_catalog.jsonb_build_array('collection_exceeds_10000_records'); end if;

  removing:=pg_catalog.jsonb_build_object(
    'tasks',case when 'tasks'=any(normalized) then (select pg_catalog.count(*) from public.tasks t where t.family_id=target_family_id) else 0 end,
    'calendar',case when 'calendar'=any(normalized) then (select pg_catalog.count(*) from public.calendar_events e where e.family_id=target_family_id) else 0 end,
    'shopping',case when 'shopping'=any(normalized) then (select pg_catalog.count(*) from public.shopping_lists l where l.family_id=target_family_id)+(select pg_catalog.count(*) from public.shopping_items i where i.family_id=target_family_id) else 0 end,
    'budget',case when 'budget'=any(normalized) then (select pg_catalog.count(*) from public.budget_transactions b where b.family_id=target_family_id) else 0 end,
    'fixedCharges',case when 'fixedCharges'=any(normalized) then (select pg_catalog.count(*) from public.property_charges c where c.family_id=target_family_id) else 0 end,
    'reminders',case when 'reminders'=any(normalized) then (select pg_catalog.count(*) from public.reminders r where r.family_id=target_family_id and r.recipient_user_id=actor and r.reminder_kind='personal') else 0 end
  );
  return pg_catalog.jsonb_build_object(
    'valid',pg_catalog.jsonb_array_length(errors)=0,'errors',errors,'warnings',warnings,
    'source',pg_catalog.jsonb_build_object('familyId',source_family_id,'familyName',source_family_name,'createdAt',backup->>'createdAt'),
    'destination',pg_catalog.jsonb_build_object('familyId',target_family_id,'familyName',destination_name),
    'normalizedModules',to_jsonb(normalized),'moduleCounts',incoming,'recordsToRemove',removing,
    'dependentRecordsAffected',pg_catalog.jsonb_build_object('clearedBudgetLinks',case when 'budget'=any(normalized) then 0 else cleared_links end,'ignoredReminders',ignored_reminders),
    'requiredUserMappings',(select coalesce(pg_catalog.jsonb_agg(x order by x),'[]'::jsonb) from (select distinct x from pg_catalog.unnest(required_users) x where x is not null) q),
    'payloadBytes',payload_bytes
  );
exception when others then
  return pg_catalog.jsonb_build_object('valid',false,'errors',errors||pg_catalog.jsonb_build_array('malformed_value'),'warnings',warnings,'payloadBytes',payload_bytes);
end; $$;
revoke all on function private.validate_family_restore(uuid,jsonb,text[],jsonb) from public,anon,authenticated;

notify pgrst, 'reload schema';
