-- Phase 1: transactionally consistent, family-scoped JSON data export.

create or replace function public.export_family_data(target_family_id uuid, selected_modules text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  allowed_modules constant text[] := array['family','members','tasks','calendar','shopping','budget','fixedCharges','reminders'];
  normalized_modules text[];
  payload jsonb;
  payload_size_bytes integer;
  maximum_payload_bytes constant integer := 8388608;
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if selected_modules is null or pg_catalog.cardinality(selected_modules)=0 then raise exception 'select at least one export module'; end if;
  if exists(select 1 from pg_catalog.unnest(selected_modules) module_name where module_name is null or not (module_name=any(allowed_modules))) then
    raise exception 'unknown export module';
  end if;
  select pg_catalog.array_agg(module_name order by position) into normalized_modules
  from pg_catalog.unnest(allowed_modules) with ordinality allowed(module_name,position)
  where module_name='family' or module_name=any(selected_modules);
  if not public.has_family_role(target_family_id,array['owner','admin']::public.family_role[]) then
    raise exception 'family export requires an active owner or admin';
  end if;

  -- All exported business rows are assembled by this single statement snapshot.
  with export_data as (
    select
      (select to_jsonb(x) from (
        select f.id,f.name,f.created_by as "createdBy",f.created_at as "createdAt",f.updated_at as "updatedAt"
        from public.families f where f.id=target_family_id
      ) x) as family_data,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."createdAt",x."userId") from (
        select fm.user_id as "userId",fm.display_name as "displayName",fm.role,fm.status,fm.created_at as "createdAt"
        from public.family_members fm where fm.family_id=target_family_id and 'members'=any(normalized_modules)
      ) x),'[]'::jsonb) as members,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."createdAt",x.id) from (
        select t.id,t.title,t.description,t.status,t.priority,t.assigned_to as "assignedTo",t.due_at as "dueAt",
          t.created_by as "createdBy",t.created_at as "createdAt",t.updated_at as "updatedAt",t.completed_at as "completedAt",
          t.recurrence_series_id as "recurrenceSeriesId",t.occurrence_index as "occurrenceIndex",
          t.generated_from_task_id as "generatedFromTaskId",t.assignee_reminder_offset_minutes as "assigneeReminderOffsetMinutes"
        from public.tasks t where t.family_id=target_family_id and 'tasks'=any(normalized_modules)
      ) x),'[]'::jsonb) as tasks,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."createdAt",x.id) from (
        select s.id,s.recurrence_rule as "recurrenceRule",s.recurrence_timezone as "recurrenceTimezone",
          s.anchor_due_at as "anchorDueAt",s.recurrence_enabled as "recurrenceEnabled",s.created_by as "createdBy",
          s.stopped_at as "stoppedAt",s.created_at as "createdAt",s.updated_at as "updatedAt"
        from public.task_recurrence_series s where s.family_id=target_family_id and 'tasks'=any(normalized_modules)
      ) x),'[]'::jsonb) as task_series,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."createdAt",x.id) from (
        select e.id,e.title,e.description,e.event_type as "eventType",e.location,e.all_day as "allDay",
          e.starts_at as "startsAt",e.ends_at as "endsAt",e.start_date as "startDate",e.end_date as "endDate",
          e.created_by as "createdBy",e.created_at as "createdAt",e.updated_at as "updatedAt"
        from public.calendar_events e where e.family_id=target_family_id and 'calendar'=any(normalized_modules)
      ) x),'[]'::jsonb) as calendar_events,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."createdAt",x.id) from (
        select l.id,l.name,l.description,l.is_archived as "isArchived",l.created_by as "createdBy",
          l.created_at as "createdAt",l.updated_at as "updatedAt"
        from public.shopping_lists l where l.family_id=target_family_id and 'shopping'=any(normalized_modules)
      ) x),'[]'::jsonb) as shopping_lists,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."createdAt",x.id) from (
        select i.id,i.list_id as "listId",i.name,i.quantity,i.unit,i.category,i.note,i.is_purchased as "isPurchased",
          i.created_by as "createdBy",i.purchased_by as "purchasedBy",i.purchased_at as "purchasedAt",
          i.created_at as "createdAt",i.updated_at as "updatedAt"
        from public.shopping_items i where i.family_id=target_family_id and 'shopping'=any(normalized_modules)
      ) x),'[]'::jsonb) as shopping_items,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."transactionDate",x.id) from (
        select t.id,t.transaction_type as "transactionType",t.title,t.description,t.amount,t.currency,t.category,
          t.transaction_date as "transactionDate",t.paid_by as "paidBy",t.is_shared as "isShared",
          t.created_by as "createdBy",t.created_at as "createdAt",t.updated_at as "updatedAt"
        from public.budget_transactions t where t.family_id=target_family_id and 'budget'=any(normalized_modules)
      ) x),'[]'::jsonb) as budget_transactions,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."transactionId",x."userId") from (
        select p.transaction_id as "transactionId",p.user_id as "userId",p.share_weight as "shareWeight",p.created_at as "createdAt"
        from public.budget_expense_participants p where p.family_id=target_family_id and 'budget'=any(normalized_modules)
      ) x),'[]'::jsonb) as budget_participants,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."userId") from (
        select m.user_id as "userId",m.is_active as "isActive",m.created_by as "createdBy",m.created_at as "createdAt",m.updated_at as "updatedAt"
        from public.budget_settlement_members m where m.family_id=target_family_id and 'budget'=any(normalized_modules)
      ) x),'[]'::jsonb) as budget_members,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."settlementDate",x.id) from (
        select s.id,s.from_user_id as "fromUserId",s.to_user_id as "toUserId",s.amount,s.currency,
          s.settlement_date as "settlementDate",s.note,s.created_by as "createdBy",s.created_at as "createdAt",s.updated_at as "updatedAt"
        from public.budget_settlements s where s.family_id=target_family_id and 'budget'=any(normalized_modules)
      ) x),'[]'::jsonb) as budget_settlements,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x.month,x.id) from (
        select p.id,p.month,p.plan_type as "planType",p.category,p.amount,p.currency,p.created_by as "createdBy",
          p.created_at as "createdAt",p.updated_at as "updatedAt"
        from public.budget_plans p where p.family_id=target_family_id and 'budget'=any(normalized_modules)
      ) x),'[]'::jsonb) as budget_plans,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."createdAt",x.id) from (
        select p.id,p.name,p.address,p.description,p.active,p.created_by as "createdBy",p.created_at as "createdAt",p.updated_at as "updatedAt"
        from public.properties p where p.family_id=target_family_id and 'fixedCharges'=any(normalized_modules)
      ) x),'[]'::jsonb) as properties,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."createdAt",x.id) from (
        select u.id,u.property_id as "propertyId",u.name,u.unit_type as "unitType",u.active,u.created_by as "createdBy",
          u.created_at as "createdAt",u.updated_at as "updatedAt"
        from public.property_units u where u.family_id=target_family_id and 'fixedCharges'=any(normalized_modules)
      ) x),'[]'::jsonb) as property_units,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."createdAt",x.id) from (
        select d.id,d.property_id as "propertyId",d.property_unit_id as "propertyUnitId",d.name,d.category,
          d.amount_mode as "amountMode",d.planned_amount as "plannedAmount",d.currency,d.recurrence_type as "recurrenceType",
          d.recurrence_timezone as "recurrenceTimezone",d.start_date as "startDate",d.generation_resume_date as "generationResumeDate",
          d.due_day as "dueDay",d.interval_months as "intervalMonths",d.recurrence_month as "recurrenceMonth",
          d.active,d.auto_generate as "autoGenerate",d.budget_sync_mode as "budgetSyncMode",d.created_by as "createdBy",
          d.created_at as "createdAt",d.updated_at as "updatedAt"
        from public.property_charge_definitions d where d.family_id=target_family_id and 'fixedCharges'=any(normalized_modules)
      ) x),'[]'::jsonb) as charge_definitions,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."definitionId",x.month,x.day) from (
        select d.definition_id as "definitionId",d.month,d.day from public.property_charge_schedule_dates d
        where d.family_id=target_family_id and 'fixedCharges'=any(normalized_modules)
      ) x),'[]'::jsonb) as charge_schedule_dates,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."definitionId",x."recipientUserId",x."offsetDays") from (
        select r.definition_id as "definitionId",r.recipient_user_id as "recipientUserId",r.offset_days as "offsetDays",r.created_at as "createdAt"
        from public.property_charge_reminder_rules r where r.family_id=target_family_id and 'fixedCharges'=any(normalized_modules)
      ) x),'[]'::jsonb) as charge_reminder_rules,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."dueDate",x.id) from (
        select c.id,c.property_id as "propertyId",c.property_unit_id as "propertyUnitId",c.charge_definition_id as "chargeDefinitionId",
          c.due_date as "dueDate",c.planned_amount as "plannedAmount",c.actual_amount as "actualAmount",c.currency,c.status,
          c.paid_at as "paidAt",c.notes,c.budget_transaction_id as "budgetTransactionId",c.created_at as "createdAt",c.updated_at as "updatedAt"
        from public.property_charges c where c.family_id=target_family_id and 'fixedCharges'=any(normalized_modules)
      ) x),'[]'::jsonb) as property_charges,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."createdAt",x.id) from (
        select r.id,r.source_type as "sourceType",r.source_id as "sourceId",r.title,r.remind_at as "remindAt",r.timezone,
          r.status,r.created_by as "createdBy",r.fired_at as "firedAt",r.created_at as "createdAt",r.updated_at as "updatedAt",
          r.reminder_kind as "reminderKind",r.assignee_reminder_offset_minutes as "assigneeReminderOffsetMinutes",
          r.property_charge_reminder_offset_days as "propertyChargeReminderOffsetDays"
        from public.reminders r where r.family_id=target_family_id and r.recipient_user_id=current_user_id and 'reminders'=any(normalized_modules)
      ) x),'[]'::jsonb) as reminders,
      coalesce((select pg_catalog.jsonb_agg(to_jsonb(x) order by x."userId") from (
        select p.user_id as "userId",p.in_app_enabled as "inAppEnabled",p.push_enabled as "pushEnabled",
          p.task_assigned_enabled as "taskAssignedEnabled",p.task_reminders_enabled as "taskRemindersEnabled",
          p.calendar_reminders_enabled as "calendarRemindersEnabled",p.created_at as "createdAt",p.updated_at as "updatedAt"
        from public.notification_preferences p where p.family_id=target_family_id and p.user_id=current_user_id and 'reminders'=any(normalized_modules)
      ) x),'[]'::jsonb) as reminder_preferences
  ), assembled as (
    select family_data,
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'family',family_data,
        'members',case when 'members'=any(normalized_modules) then members else null end,
        'tasks',case when 'tasks'=any(normalized_modules) then pg_catalog.jsonb_build_object('items',tasks,'recurrenceSeries',task_series) else null end,
        'calendar',case when 'calendar'=any(normalized_modules) then pg_catalog.jsonb_build_object('events',calendar_events) else null end,
        'shopping',case when 'shopping'=any(normalized_modules) then pg_catalog.jsonb_build_object('lists',shopping_lists,'items',shopping_items) else null end,
        'budget',case when 'budget'=any(normalized_modules) then pg_catalog.jsonb_build_object('transactions',budget_transactions,'expenseParticipants',budget_participants,'settlementMembers',budget_members,'settlements',budget_settlements,'plans',budget_plans) else null end,
        'fixedCharges',case when 'fixedCharges'=any(normalized_modules) then pg_catalog.jsonb_build_object('properties',properties,'units',property_units,'definitions',charge_definitions,'scheduleDates',charge_schedule_dates,'reminderRules',charge_reminder_rules,'charges',property_charges) else null end,
        'reminders',case when 'reminders'=any(normalized_modules) then pg_catalog.jsonb_build_object('scope','current_user','items',reminders,'preferences',reminder_preferences) else null end
      )) as modules_data,
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'family',1,
        'members',case when 'members'=any(normalized_modules) then pg_catalog.jsonb_array_length(members) else null end,
        'tasks',case when 'tasks'=any(normalized_modules) then pg_catalog.jsonb_build_object('items',pg_catalog.jsonb_array_length(tasks),'recurrenceSeries',pg_catalog.jsonb_array_length(task_series)) else null end,
        'calendar',case when 'calendar'=any(normalized_modules) then pg_catalog.jsonb_build_object('events',pg_catalog.jsonb_array_length(calendar_events)) else null end,
        'shopping',case when 'shopping'=any(normalized_modules) then pg_catalog.jsonb_build_object('lists',pg_catalog.jsonb_array_length(shopping_lists),'items',pg_catalog.jsonb_array_length(shopping_items)) else null end,
        'budget',case when 'budget'=any(normalized_modules) then pg_catalog.jsonb_build_object('transactions',pg_catalog.jsonb_array_length(budget_transactions),'expenseParticipants',pg_catalog.jsonb_array_length(budget_participants),'settlementMembers',pg_catalog.jsonb_array_length(budget_members),'settlements',pg_catalog.jsonb_array_length(budget_settlements),'plans',pg_catalog.jsonb_array_length(budget_plans)) else null end,
        'fixedCharges',case when 'fixedCharges'=any(normalized_modules) then pg_catalog.jsonb_build_object('properties',pg_catalog.jsonb_array_length(properties),'units',pg_catalog.jsonb_array_length(property_units),'definitions',pg_catalog.jsonb_array_length(charge_definitions),'scheduleDates',pg_catalog.jsonb_array_length(charge_schedule_dates),'reminderRules',pg_catalog.jsonb_array_length(charge_reminder_rules),'charges',pg_catalog.jsonb_array_length(property_charges)) else null end,
        'reminders',case when 'reminders'=any(normalized_modules) then pg_catalog.jsonb_build_object('items',pg_catalog.jsonb_array_length(reminders),'preferences',pg_catalog.jsonb_array_length(reminder_preferences)) else null end
      )) as counts
    from export_data
  )
  select pg_catalog.jsonb_build_object(
    'format','family-planner-backup','backupVersion',1,'schemaVersion',1,'createdAt',pg_catalog.now(),
    'scope',pg_catalog.jsonb_build_object('familyId',target_family_id,'exportedBy',current_user_id,'modules',to_jsonb(normalized_modules)),
    'family',pg_catalog.jsonb_build_object('id',family_data->'id','name',family_data->'name'),
    'modules',modules_data,'recordCounts',counts
  ) into payload from assembled;

  if payload->'family'->>'id' is null then raise exception 'target family does not exist'; end if;
  payload_size_bytes:=pg_catalog.octet_length(pg_catalog.convert_to(payload::text,'UTF8'));
  if payload_size_bytes>maximum_payload_bytes then raise exception 'family export exceeds the 8 MiB synchronous export limit'; end if;
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target_family_id,current_user_id,'family.backup.exported','family',target_family_id::text,
    pg_catalog.jsonb_build_object('format','family-planner-backup','backupVersion',1,'modules',to_jsonb(normalized_modules),'recordCounts',payload->'recordCounts'));
  return payload;
end; $$;

revoke all on function public.export_family_data(uuid,text[]) from public,anon,authenticated;
grant execute on function public.export_family_data(uuid,text[]) to authenticated;
notify pgrst, 'reload schema';
