-- Preserve settlement_date as the budget-month assignment date and store the
-- actual day on which the settlement was performed separately.
-- Migration 0031 is intentionally backward-compatible with Backup v1.

alter table public.budget_settlements
  add column actual_settlement_date date;

update public.budget_settlements
set actual_settlement_date=settlement_date
where actual_settlement_date is null;

-- Keep older web and Android clients compatible: when they omit the new
-- column, use the existing compatibility date. An explicitly supplied actual
-- settlement date is preserved.
create or replace function private.prepare_budget_settlement_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then return new; end if;
  if tg_op='UPDATE' and (new.family_id<>old.family_id or new.created_by<>old.created_by) then raise exception 'settlement ownership cannot be changed';end if;
  if tg_op='UPDATE' and not(select public.has_family_role(old.family_id,array['owner','admin']::public.family_role[])) and(new.from_user_id<>(select auth.uid()) and new.to_user_id<>(select auth.uid())) then raise exception 'adult may only edit a settlement they are party to';end if;
  if new.from_user_id=new.to_user_id then raise exception 'settlement parties must differ';end if;
  if not exists(select 1 from public.family_members fm where fm.family_id=new.family_id and fm.user_id=new.from_user_id and fm.status='active' and fm.role=any(array['owner','admin','adult']::public.family_role[])) or not exists(select 1 from public.family_members fm where fm.family_id=new.family_id and fm.user_id=new.to_user_id and fm.status='active' and fm.role=any(array['owner','admin','adult']::public.family_role[])) then raise exception 'settlement parties must be active adult members of the same family';end if;
  if new.actual_settlement_date is null then
    new.actual_settlement_date:=new.settlement_date;
  end if;
  new.note:=nullif(pg_catalog.btrim(new.note),'');new.currency:=pg_catalog.upper(pg_catalog.btrim(new.currency));new.updated_at:=pg_catalog.now();return new;
end;$$;
revoke all on function private.prepare_budget_settlement_write() from public,anon,authenticated;

alter table public.budget_settlements
  alter column actual_settlement_date set not null;

grant insert(actual_settlement_date) on public.budget_settlements to authenticated;
grant update(actual_settlement_date) on public.budget_settlements to authenticated;

-- Extend the effective exporter (including calendar recurrence support from 0028).
alter function public.export_family_data(uuid,text[])
  rename to export_family_data_before_actual_settlement_date;
revoke all on function public.export_family_data_before_actual_settlement_date(uuid,text[])
  from public,anon,authenticated;

create or replace function public.export_family_data(target_family_id uuid,selected_modules text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  settlement_items jsonb;
begin
  result:=public.export_family_data_before_actual_settlement_date(target_family_id,selected_modules);
  if 'budget'=any(selected_modules) then
    select coalesce(
      pg_catalog.jsonb_agg(
        exported.value||pg_catalog.jsonb_build_object('actualSettlementDate',s.actual_settlement_date)
        order by exported.value->>'settlementDate',exported.value->>'id'
      ),
      '[]'::jsonb
    )
    into settlement_items
    from pg_catalog.jsonb_array_elements(result#>'{modules,budget,settlements}') exported(value)
    join public.budget_settlements s
      on s.id=(exported.value->>'id')::uuid
      and s.family_id=target_family_id;

    result:=pg_catalog.jsonb_set(result,'{modules,budget,settlements}',settlement_items,true);
    if pg_catalog.octet_length(pg_catalog.convert_to(result::text,'UTF8'))>8388608 then
      raise exception 'family export exceeds the 8 MiB synchronous export limit';
    end if;
  end if;
  return result;
end;
$$;

revoke all on function public.export_family_data(uuid,text[]) from public,anon,authenticated;
grant execute on function public.export_family_data(uuid,text[]) to authenticated;

-- Preserve all current preflight rules and add optional Backup v1 actualSettlementDate validation.
alter function public.preflight_family_restore(uuid,jsonb,text[],jsonb)
  rename to preflight_family_restore_before_actual_settlement_date;
revoke all on function public.preflight_family_restore_before_actual_settlement_date(uuid,jsonb,text[],jsonb)
  from public,anon,authenticated;

create or replace function public.preflight_family_restore(
  target_family_id uuid,backup jsonb,selected_modules text[],user_mapping jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
  errors jsonb;
  item jsonb;
begin
  result:=public.preflight_family_restore_before_actual_settlement_date(
    target_family_id,backup,selected_modules,user_mapping
  );
  errors:=coalesce(result->'errors','[]'::jsonb);

  if 'budget'=any(coalesce(selected_modules,'{}'::text[]))
    and pg_catalog.jsonb_typeof(backup#>'{modules,budget,settlements}')='array' then
    for item in
      select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlements}')
    loop
      if item ? 'actualSettlementDate'
        and not private.restore_valid_date(item->>'actualSettlementDate') then
        errors:=errors||pg_catalog.jsonb_build_array('invalid_actual_settlement_date');
      end if;
    end loop;
  end if;

  result:=pg_catalog.jsonb_set(result,'{errors}',errors,true);
  result:=pg_catalog.jsonb_set(
    result,'{valid}',to_jsonb(pg_catalog.jsonb_array_length(errors)=0),true
  );
  return result;
end;
$$;

revoke all on function public.preflight_family_restore(uuid,jsonb,text[],jsonb)
  from public,anon,authenticated;
grant execute on function public.preflight_family_restore(uuid,jsonb,text[],jsonb)
  to authenticated;

-- Replace the effective atomic restore only to persist actual_settlement_date.
create or replace function public.restore_family_data(
  target_family_id uuid,backup jsonb,selected_modules text[],user_mapping jsonb,restore_mode text,confirmation_family_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  report jsonb; normalized text[]; restore_operation_id uuid:=pg_catalog.gen_random_uuid(); destination_name text;
  item jsonb; mapped_id uuid; transaction_id uuid; ignored integer:=0; cleared integer:=0;
  series_map jsonb:='{}'::jsonb; task_map jsonb:='{}'::jsonb; event_map jsonb:='{}'::jsonb;
  calendar_series_map jsonb:='{}'::jsonb;
  list_map jsonb:='{}'::jsonb; item_map jsonb:='{}'::jsonb; transaction_map jsonb:='{}'::jsonb;
  settlement_map jsonb:='{}'::jsonb; plan_map jsonb:='{}'::jsonb; property_map jsonb:='{}'::jsonb;
  unit_map jsonb:='{}'::jsonb; definition_map jsonb:='{}'::jsonb; charge_map jsonb:='{}'::jsonb;
begin
  if restore_mode<>'replace_selected' then raise exception 'unsupported restore mode'; end if;
  if (select auth.uid()) is null or not public.has_family_role(target_family_id,array['owner']::public.family_role[]) then raise exception 'only an active family owner may restore a backup'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_family_id::text,0));
  select f.name into destination_name from public.families f where f.id=target_family_id for update;
  if destination_name is null or confirmation_family_name is distinct from destination_name then raise exception 'destination family confirmation does not match'; end if;
  report:=public.preflight_family_restore(target_family_id,backup,selected_modules,user_mapping);
  if not coalesce((report->>'valid')::boolean,false) then raise exception 'restore validation failed: %',report->'errors'; end if;
  normalized:=array(select pg_catalog.jsonb_array_elements_text(report->'normalizedModules'));
  perform pg_catalog.set_config('family_planner.restore_operation',restore_operation_id::text,true);
  insert into private.family_restore_context(operation_id,transaction_id,backend_pid,family_id,actor_user_id)
  values(restore_operation_id,pg_catalog.txid_current(),pg_catalog.pg_backend_pid(),target_family_id,(select auth.uid()));

  -- Generate every destination identifier before any relationship is written.
  if 'tasks'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,recurrenceSeries}') loop series_map:=series_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,items}') loop task_map:=task_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
  end if;
  if 'calendar'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(coalesce(backup#>'{modules,calendar,recurrenceSeries}','[]'::jsonb)) loop calendar_series_map:=calendar_series_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,calendar,events}') loop event_map:=event_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
  end if;
  if 'shopping'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,shopping,lists}') loop list_map:=list_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,shopping,items}') loop item_map:=item_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
  end if;
  if 'budget'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,transactions}') loop transaction_map:=transaction_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlements}') loop settlement_map:=settlement_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,plans}') loop plan_map:=plan_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
  end if;
  if 'fixedCharges'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,properties}') loop property_map:=property_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,units}') loop unit_map:=unit_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,definitions}') loop definition_map:=definition_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,charges}') loop charge_map:=charge_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
  end if;

  -- Delete selected modules while restore context suppresses technical triggers/audits.
  if 'tasks'=any(normalized) then delete from public.notifications where family_id=target_family_id and source_type='task'; delete from public.reminders where family_id=target_family_id and source_type='task'; delete from public.tasks where family_id=target_family_id; delete from public.task_recurrence_series where family_id=target_family_id; end if;
  if 'calendar'=any(normalized) then delete from public.notifications where family_id=target_family_id and source_type='calendar_event'; delete from public.reminders where family_id=target_family_id and source_type='calendar_event'; delete from public.calendar_events where family_id=target_family_id; delete from public.calendar_event_recurrence_series where family_id=target_family_id; end if;
  if 'shopping'=any(normalized) then delete from public.shopping_items where family_id=target_family_id; delete from public.shopping_lists where family_id=target_family_id; end if;
  if 'fixedCharges'=any(normalized) then delete from public.notifications where family_id=target_family_id and source_type='property_charge'; delete from public.reminders where family_id=target_family_id and source_type='property_charge'; delete from public.property_charges where family_id=target_family_id; delete from public.property_charge_reminder_rules where family_id=target_family_id; delete from public.property_charge_schedule_dates where family_id=target_family_id; delete from public.property_charge_definitions where family_id=target_family_id; delete from public.property_units where family_id=target_family_id; delete from public.properties where family_id=target_family_id; end if;
  if 'budget'=any(normalized) then delete from public.budget_expense_participants where family_id=target_family_id; delete from public.budget_settlements where family_id=target_family_id; delete from public.budget_plans where family_id=target_family_id; delete from public.budget_settlement_members where family_id=target_family_id; delete from public.budget_transactions where family_id=target_family_id; end if;
  if 'reminders'=any(normalized) then delete from public.reminders where family_id=target_family_id and recipient_user_id=(select auth.uid()) and reminder_kind='personal'; end if;

  -- Budget precedes fixed charges so restored charges can target mapped transactions.
  if 'budget'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlementMembers}') loop insert into public.budget_settlement_members(family_id,user_id,is_active,created_by,created_at,updated_at) values(target_family_id,private.restore_mapping_value(user_mapping,item->>'userId'),(item->>'isActive')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,transactions}') loop insert into public.budget_transactions(id,family_id,transaction_type,title,description,amount,currency,category,transaction_date,paid_by,is_shared,created_by,created_at,updated_at) values((transaction_map->>(item->>'id'))::uuid,target_family_id,item->>'transactionType',item->>'title',item->>'description',(item->>'amount')::numeric,item->>'currency',item->>'category',(item->>'transactionDate')::date,private.restore_mapping_value(user_mapping,item->>'paidBy',true),(item->>'isShared')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,expenseParticipants}') loop insert into public.budget_expense_participants(transaction_id,family_id,user_id,share_weight,created_at) values((transaction_map->>(item->>'transactionId'))::uuid,target_family_id,private.restore_mapping_value(user_mapping,item->>'userId'),(item->>'shareWeight')::numeric,(item->>'createdAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlements}') loop insert into public.budget_settlements(id,family_id,from_user_id,to_user_id,amount,currency,settlement_date,actual_settlement_date,note,created_by,created_at,updated_at) values((settlement_map->>(item->>'id'))::uuid,target_family_id,private.restore_mapping_value(user_mapping,item->>'fromUserId'),private.restore_mapping_value(user_mapping,item->>'toUserId'),(item->>'amount')::numeric,item->>'currency',(item->>'settlementDate')::date,case when item ? 'actualSettlementDate' then (item->>'actualSettlementDate')::date else (item->>'settlementDate')::date end,item->>'note',private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,plans}') loop insert into public.budget_plans(id,family_id,month,plan_type,category,amount,currency,created_by,created_at,updated_at) values((plan_map->>(item->>'id'))::uuid,target_family_id,(item->>'month')::date,item->>'planType',item->>'category',(item->>'amount')::numeric,item->>'currency',private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
  end if;

  if 'tasks'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,recurrenceSeries}') loop insert into public.task_recurrence_series(id,family_id,recurrence_rule,recurrence_timezone,anchor_due_at,recurrence_enabled,created_by,stopped_at,created_at,updated_at) values((series_map->>(item->>'id'))::uuid,target_family_id,item->'recurrenceRule',item->>'recurrenceTimezone',(item->>'anchorDueAt')::timestamptz,(item->>'recurrenceEnabled')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),nullif(item->>'stoppedAt','')::timestamptz,(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,items}') order by coalesce((value->>'occurrenceIndex')::integer,0) loop insert into public.tasks(id,family_id,title,description,status,priority,assigned_to,due_at,created_by,created_at,updated_at,completed_at,recurrence_series_id,occurrence_index,generated_from_task_id,assignee_reminder_offset_minutes) values((task_map->>(item->>'id'))::uuid,target_family_id,item->>'title',item->>'description',item->>'status',item->>'priority',private.restore_mapping_value(user_mapping,item->>'assignedTo',true),nullif(item->>'dueAt','')::timestamptz,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz,nullif(item->>'completedAt','')::timestamptz,nullif(series_map->>(item->>'recurrenceSeriesId'),'')::uuid,coalesce((item->>'occurrenceIndex')::integer,0),nullif(task_map->>(item->>'generatedFromTaskId'),'')::uuid,nullif(item->>'assigneeReminderOffsetMinutes','')::integer); end loop;
  end if;

  if 'calendar'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(coalesce(backup#>'{modules,calendar,recurrenceSeries}','[]'::jsonb)) loop
      insert into public.calendar_event_recurrence_series(
        id,family_id,title,description,event_type,location,all_day,anchor_date,anchor_local_time,timed_duration_minutes,
        all_day_duration_days,recurrence_rule,recurrence_timezone,recurrence_enabled,generated_through,created_by,stopped_at,created_at,updated_at
      ) values(
        (calendar_series_map->>(item->>'id'))::uuid,target_family_id,item->>'title',item->>'description',item->>'eventType',item->>'location',(item->>'allDay')::boolean,
        (item->>'anchorDate')::date,nullif(item->>'anchorLocalTime','')::time,nullif(item->>'timedDurationMinutes','')::integer,
        nullif(item->>'allDayDurationDays','')::integer,item->'recurrenceRule',item->>'recurrenceTimezone',(item->>'recurrenceEnabled')::boolean,
        nullif(item->>'generatedThrough','')::date,private.restore_mapping_value(user_mapping,item->>'createdBy'),nullif(item->>'stoppedAt','')::timestamptz,
        (item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz
      );
    end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,calendar,events}') loop
      insert into public.calendar_events(
        id,family_id,title,description,event_type,location,all_day,starts_at,ends_at,start_date,end_date,created_by,created_at,updated_at,
        recurrence_series_id,recurrence_occurrence_date
      ) values(
        (event_map->>(item->>'id'))::uuid,target_family_id,item->>'title',item->>'description',item->>'eventType',item->>'location',(item->>'allDay')::boolean,
        nullif(item->>'startsAt','')::timestamptz,nullif(item->>'endsAt','')::timestamptz,nullif(item->>'startDate','')::date,nullif(item->>'endDate','')::date,
        private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz,
        case when item->>'recurrenceSeriesId' is null then null else (calendar_series_map->>(item->>'recurrenceSeriesId'))::uuid end,
        nullif(item->>'recurrenceOccurrenceDate','')::date
      );
    end loop;
    for item in select value from pg_catalog.jsonb_array_elements(coalesce(backup#>'{modules,calendar,exclusions}','[]'::jsonb)) loop
      insert into public.calendar_event_recurrence_exclusions(series_id,family_id,occurrence_date,excluded_by,created_at)
      values((calendar_series_map->>(item->>'seriesId'))::uuid,target_family_id,(item->>'occurrenceDate')::date,
        private.restore_mapping_value(user_mapping,item->>'excludedBy'),(item->>'createdAt')::timestamptz);
    end loop;
  end if;

  if 'shopping'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,shopping,lists}') loop insert into public.shopping_lists(id,family_id,name,description,is_archived,created_by,created_at,updated_at) values((list_map->>(item->>'id'))::uuid,target_family_id,item->>'name',item->>'description',(item->>'isArchived')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,shopping,items}') loop insert into public.shopping_items(id,family_id,list_id,name,quantity,unit,category,note,is_purchased,created_by,purchased_by,purchased_at,created_at,updated_at) values((item_map->>(item->>'id'))::uuid,target_family_id,(list_map->>(item->>'listId'))::uuid,item->>'name',nullif(item->>'quantity','')::numeric,item->>'unit',item->>'category',item->>'note',(item->>'isPurchased')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),private.restore_mapping_value(user_mapping,item->>'purchasedBy',true),nullif(item->>'purchasedAt','')::timestamptz,(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
  end if;

  if 'fixedCharges'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,properties}') loop insert into public.properties(id,family_id,name,address,description,active,created_by,created_at,updated_at) values((property_map->>(item->>'id'))::uuid,target_family_id,item->>'name',item->>'address',item->>'description',(item->>'active')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,units}') loop insert into public.property_units(id,family_id,property_id,name,unit_type,active,created_by,created_at,updated_at) values((unit_map->>(item->>'id'))::uuid,target_family_id,(property_map->>(item->>'propertyId'))::uuid,item->>'name',item->>'unitType',(item->>'active')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,definitions}') loop insert into public.property_charge_definitions(id,family_id,property_id,property_unit_id,name,category,amount_mode,planned_amount,currency,recurrence_type,recurrence_timezone,start_date,generation_resume_date,due_day,interval_months,recurrence_month,active,auto_generate,budget_sync_mode,created_by,created_at,updated_at,suspended_by_property) values((definition_map->>(item->>'id'))::uuid,target_family_id,(property_map->>(item->>'propertyId'))::uuid,nullif(unit_map->>(item->>'propertyUnitId'),'')::uuid,item->>'name',item->>'category',item->>'amountMode',nullif(item->>'plannedAmount','')::numeric,item->>'currency',item->>'recurrenceType',item->>'recurrenceTimezone',(item->>'startDate')::date,greatest((item->>'generationResumeDate')::date,current_date),nullif(item->>'dueDay','')::integer,nullif(item->>'intervalMonths','')::integer,nullif(item->>'recurrenceMonth','')::integer,(item->>'active')::boolean,(item->>'autoGenerate')::boolean,item->>'budgetSyncMode',private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz,false); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,scheduleDates}') loop insert into public.property_charge_schedule_dates(definition_id,family_id,month,day) values((definition_map->>(item->>'definitionId'))::uuid,target_family_id,(item->>'month')::integer,(item->>'day')::integer); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,reminderRules}') loop insert into public.property_charge_reminder_rules(definition_id,family_id,recipient_user_id,offset_days,created_at) values((definition_map->>(item->>'definitionId'))::uuid,target_family_id,private.restore_mapping_value(user_mapping,item->>'recipientUserId'),(item->>'offsetDays')::integer,(item->>'createdAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,fixedCharges,charges}') loop transaction_id:=null; if 'budget'=any(normalized) and item->>'budgetTransactionId' is not null then transaction_id:=(transaction_map->>(item->>'budgetTransactionId'))::uuid; elsif item->>'budgetTransactionId' is not null then cleared:=cleared+1; end if; insert into public.property_charges(id,family_id,property_id,property_unit_id,charge_definition_id,due_date,planned_amount,actual_amount,currency,status,paid_at,notes,budget_transaction_id,created_at,updated_at) values((charge_map->>(item->>'id'))::uuid,target_family_id,(property_map->>(item->>'propertyId'))::uuid,nullif(unit_map->>(item->>'propertyUnitId'),'')::uuid,(definition_map->>(item->>'chargeDefinitionId'))::uuid,(item->>'dueDate')::date,nullif(item->>'plannedAmount','')::numeric,nullif(item->>'actualAmount','')::numeric,item->>'currency',item->>'status',nullif(item->>'paidAt','')::timestamptz,item->>'notes',transaction_id,(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for mapped_id in select (value #>> '{}')::uuid from pg_catalog.jsonb_each(charge_map) loop perform private.resync_property_charge_reminders(mapped_id); end loop;
  end if;

  if 'tasks'=any(normalized) then
    insert into public.reminders(family_id,recipient_user_id,source_type,source_id,title,remind_at,timezone,status,created_by,reminder_kind,assignee_reminder_offset_minutes)
    select target_family_id,t.assigned_to,'task',t.id,'Przypomnienie: '||t.title,t.due_at-pg_catalog.make_interval(mins=>t.assignee_reminder_offset_minutes),coalesce(s.recurrence_timezone,'Europe/Warsaw'),'pending',t.created_by,'task_assignee',t.assignee_reminder_offset_minutes
    from public.tasks t left join public.task_recurrence_series s on s.id=t.recurrence_series_id and s.family_id=t.family_id
    where t.family_id=target_family_id and t.status<>'done' and t.assigned_to is not null and t.due_at is not null and t.assignee_reminder_offset_minutes is not null and t.due_at-pg_catalog.make_interval(mins=>t.assignee_reminder_offset_minutes)>pg_catalog.now() on conflict do nothing;
  end if;
  if 'reminders'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,reminders,items}') loop
      if item->>'reminderKind'='personal' and item->>'status'='pending' and (item->>'remindAt')::timestamptz>pg_catalog.now() and item->>'sourceType' in ('task','calendar_event') then
        mapped_id:=case when item->>'sourceType'='task' then (task_map->>(item->>'sourceId'))::uuid else (event_map->>(item->>'sourceId'))::uuid end;
        insert into public.reminders(id,family_id,recipient_user_id,source_type,source_id,title,remind_at,timezone,status,created_by,created_at,updated_at,reminder_kind)
        values(pg_catalog.gen_random_uuid(),target_family_id,(select auth.uid()),item->>'sourceType',mapped_id,item->>'title',(item->>'remindAt')::timestamptz,item->>'timezone','pending',(select auth.uid()),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz,'personal');
      else ignored:=ignored+1; end if;
    end loop;
  end if;

  -- Disable restore context only before the single controlled restore audit entry.
  delete from private.family_restore_context c where c.operation_id=restore_operation_id;
  perform pg_catalog.set_config('family_planner.restore_operation','',true);
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target_family_id,(select auth.uid()),'family.backup.restored','family',target_family_id::text,
    pg_catalog.jsonb_build_object('backupVersion',1,'schemaVersion',1,'sourceFamilyId',backup#>>'{family,id}','sourceCreatedAt',backup->>'createdAt','modules',to_jsonb(normalized),'restoreMode','replace_selected','importedCounts',report->'moduleCounts','removedCounts',report->'recordsToRemove','clearedBudgetLinkCount',cleared,'ignoredReminderCount',ignored,'restoreOperationId',restore_operation_id));
  return pg_catalog.jsonb_build_object(
    'success',true,'operationId',restore_operation_id,'modules',to_jsonb(normalized),'importedCounts',report->'moduleCounts',
    'removedCounts',report->'recordsToRemove','clearedBudgetLinks',cleared,'ignoredReminders',ignored,'warnings',report->'warnings',
    'calendarRecurrenceRestored',pg_catalog.jsonb_array_length(coalesce(backup#>'{modules,calendar,recurrenceSeries}','[]'::jsonb))
  );
end;
$$;

revoke all on function public.restore_family_data(uuid,jsonb,text[],jsonb,text,text) from public,anon,authenticated;
grant execute on function public.restore_family_data(uuid,jsonb,text[],jsonb,text,text) to authenticated;

notify pgrst,'reload schema';
