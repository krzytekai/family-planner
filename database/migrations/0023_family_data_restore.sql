-- Phase 2A: owner-only, atomic replacement of selected family business modules.

create table if not exists private.family_restore_context (
  operation_id uuid primary key,
  transaction_id bigint not null,
  backend_pid integer not null,
  family_id uuid not null,
  actor_user_id uuid not null,
  started_at timestamptz not null default pg_catalog.now()
);
revoke all on private.family_restore_context from public, anon, authenticated;

create or replace function private.family_restore_active(target_family_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from private.family_restore_context c
    where c.operation_id::text=pg_catalog.current_setting('family_planner.restore_operation',true)
      and c.transaction_id=pg_catalog.txid_current()
      and c.backend_pid=pg_catalog.pg_backend_pid()
      and c.family_id=target_family_id
      and c.actor_user_id=(select auth.uid())
  );
$$;
revoke all on function private.family_restore_active(uuid) from public,anon,authenticated;

create or replace function private.restore_mapping_value(mapping jsonb,source_id text,allow_none boolean default false)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare mapped text;
begin
  if source_id is null or source_id='' then return null; end if;
  mapped:=mapping->>source_id;
  if allow_none and mapped='none' then return null; end if;
  if mapped is null or mapped='none' or mapped !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'missing or invalid user mapping';
  end if;
  return mapped::uuid;
end; $$;
revoke all on function private.restore_mapping_value(jsonb,text,boolean) from public,anon,authenticated;

create or replace function private.valid_restore_mapping(
  mapping jsonb,source_id text,target_family_id uuid,allow_none boolean default false,require_adult boolean default false
) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare mapped text;
begin
  if source_id is null or source_id='' then return allow_none; end if;
  mapped:=mapping->>source_id;
  if allow_none and mapped='none' then return true; end if;
  if mapped is null or mapped='none' or mapped !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false; end if;
  return exists(
    select 1 from public.family_members fm
    where fm.family_id=target_family_id and fm.user_id=mapped::uuid and fm.status='active'
      and (not require_adult or fm.role=any(array['owner','admin','adult']::public.family_role[]))
  );
exception when others then return false;
end; $$;
revoke all on function private.valid_restore_mapping(jsonb,text,uuid,boolean,boolean) from public,anon,authenticated;

create or replace function private.restore_ids_valid_unique(items jsonb)
returns boolean language plpgsql immutable security definer set search_path = '' as $$
begin
  if pg_catalog.jsonb_typeof(items) is distinct from 'array' then return false; end if;
  return not exists(
      select 1 from pg_catalog.jsonb_array_elements(items) row_value
      where pg_catalog.jsonb_typeof(row_value) is distinct from 'object'
        or coalesce(row_value->>'id','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    )
    and (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(items))
      =(select pg_catalog.count(distinct row_value->>'id') from pg_catalog.jsonb_array_elements(items) row_value);
end;
$$;
revoke all on function private.restore_ids_valid_unique(jsonb) from public,anon,authenticated;

create or replace function private.restore_valid_uuid(value text)
returns boolean language plpgsql immutable security definer set search_path='' as $$
begin
  if value is null or value='' or value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return false;end if;
  perform value::uuid;return true;
exception when others then return false;
end;$$;
revoke all on function private.restore_valid_uuid(text) from public,anon,authenticated;

create or replace function private.restore_valid_timestamp(value text,nullable boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if value is null or value='' then return nullable;end if;
  perform value::timestamptz;return true;
exception when others then return false;
end;$$;
revoke all on function private.restore_valid_timestamp(text,boolean) from public,anon,authenticated;

create or replace function private.restore_valid_date(value text,nullable boolean default false)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if value is null or value='' then return nullable;end if;
  perform value::date;return true;
exception when others then return false;
end;$$;
revoke all on function private.restore_valid_date(text,boolean) from public,anon,authenticated;

create or replace function private.restore_valid_positive_numeric(value text,nullable boolean default false)
returns boolean language plpgsql immutable security definer set search_path='' as $$
begin
  if value is null or value='' then return nullable;end if;
  return value::numeric>0;
exception when others then return false;
end;$$;
revoke all on function private.restore_valid_positive_numeric(text,boolean) from public,anon,authenticated;

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
        or item->>'status' is null or item->>'status' not in ('pending','paid','cancelled')
        or not private.restore_valid_timestamp(item->>'paidAt',true)
        or (item->>'status'='paid' and item->>'paidAt' is null)
        or (item->>'status'<>'paid' and item->>'paidAt' is not null)
        or (item->>'status'='paid' and item->>'actualAmount' is null)
        or (item->>'status'<>'paid' and item->>'actualAmount' is not null)
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

create or replace function public.preflight_family_restore(target_family_id uuid,backup jsonb,selected_modules text[],user_mapping jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.validate_family_restore(target_family_id,backup,selected_modules,user_mapping);
$$;
revoke all on function public.preflight_family_restore(uuid,jsonb,text[],jsonb) from public,anon,authenticated;
grant execute on function public.preflight_family_restore(uuid,jsonb,text[],jsonb) to authenticated;

-- Suppress only notification/audit rows emitted inside a verified restore context.
create or replace function private.suppress_family_restore_side_effect()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then return null; end if;
  return new;
end; $$;
revoke all on function private.suppress_family_restore_side_effect() from public,anon,authenticated;
drop trigger if exists suppress_family_restore_audit on public.audit_logs;
create trigger suppress_family_restore_audit before insert on public.audit_logs for each row execute function private.suppress_family_restore_side_effect();
drop trigger if exists suppress_family_restore_notification on public.notifications;
create trigger suppress_family_restore_notification before insert on public.notifications for each row execute function private.suppress_family_restore_side_effect();

-- Preserve database-managed historical fields during a verified restore only.
create or replace function private.prepare_task_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then return new; end if;
  if tg_op='UPDATE' then if new.family_id<>old.family_id then raise exception 'task family cannot be changed'; end if; if new.created_by<>old.created_by then raise exception 'task creator cannot be changed'; end if; end if;
  new.title:=pg_catalog.btrim(new.title); new.description:=nullif(pg_catalog.btrim(new.description),''); new.updated_at:=pg_catalog.now();
  if new.status='done' then if tg_op='INSERT' or old.status<>'done' then new.completed_at:=pg_catalog.now(); else new.completed_at:=old.completed_at; end if; else new.completed_at:=null; end if;
  return new;
end; $$;
revoke all on function private.prepare_task_write() from public,anon,authenticated;

create or replace function private.prepare_calendar_event_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then return new; end if;
  if tg_op='UPDATE' then if new.family_id<>old.family_id then raise exception 'calendar event family cannot be changed'; end if; if new.created_by<>old.created_by then raise exception 'calendar event creator cannot be changed'; end if; end if;
  new.title:=pg_catalog.btrim(new.title); new.description:=nullif(pg_catalog.btrim(new.description),''); new.location:=nullif(pg_catalog.btrim(new.location),''); new.updated_at:=pg_catalog.now(); return new;
end; $$;
revoke all on function private.prepare_calendar_event_write() from public,anon,authenticated;

create or replace function private.prepare_shopping_list_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then return new; end if;
  if tg_op='UPDATE' then if new.family_id<>old.family_id then raise exception 'shopping list family cannot be changed'; end if; if new.created_by<>old.created_by then raise exception 'shopping list creator cannot be changed'; end if; end if;
  new.name:=pg_catalog.btrim(new.name); new.description:=nullif(pg_catalog.btrim(new.description),''); new.updated_at:=pg_catalog.now(); return new;
end; $$;
revoke all on function private.prepare_shopping_list_write() from public,anon,authenticated;

create or replace function private.prepare_shopping_item_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then return new; end if;
  if tg_op='UPDATE' then if new.family_id<>old.family_id or new.list_id<>old.list_id or new.created_by<>old.created_by then raise exception 'shopping item ownership cannot be changed'; end if; end if;
  new.name:=pg_catalog.btrim(new.name); new.unit:=nullif(pg_catalog.btrim(new.unit),''); new.category:=nullif(pg_catalog.btrim(new.category),''); new.note:=nullif(pg_catalog.btrim(new.note),''); new.updated_at:=pg_catalog.now();
  if new.is_purchased then if tg_op='INSERT' or not old.is_purchased then new.purchased_by:=(select auth.uid()); new.purchased_at:=pg_catalog.now(); else new.purchased_by:=old.purchased_by; new.purchased_at:=old.purchased_at; end if; else new.purchased_by:=null; new.purchased_at:=null; end if; return new;
end; $$;
revoke all on function private.prepare_shopping_item_write() from public,anon,authenticated;

create or replace function private.prepare_budget_transaction_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then return new; end if;
  if tg_op='UPDATE' and (new.family_id<>old.family_id or new.created_by<>old.created_by) then raise exception 'budget transaction ownership cannot be changed'; end if;
  new.title:=pg_catalog.btrim(new.title); new.description:=nullif(pg_catalog.btrim(new.description),''); new.category:=nullif(pg_catalog.btrim(new.category),''); new.currency:=pg_catalog.upper(pg_catalog.btrim(new.currency)); new.updated_at:=pg_catalog.now();
  if new.transaction_type='income' then new.paid_by:=null; new.is_shared:=false; end if;
  if new.transaction_type='expense' and not exists(select 1 from public.family_members fm where fm.family_id=new.family_id and fm.user_id=new.paid_by and fm.status='active' and fm.role=any(array['owner','admin','adult']::public.family_role[])) then raise exception 'payer must be an active adult member of the transaction family'; end if; return new;
end; $$;
revoke all on function private.prepare_budget_transaction_write() from public,anon,authenticated;

create or replace function private.prepare_budget_settlement_member_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then return new; end if;
  if tg_op='UPDATE' and (new.family_id<>old.family_id or new.user_id<>old.user_id or new.created_by<>old.created_by) then raise exception 'settlement member ownership cannot be changed'; end if;
  if not exists(select 1 from public.family_members fm where fm.family_id=new.family_id and fm.user_id=new.user_id and fm.status='active' and fm.role=any(array['owner','admin','adult']::public.family_role[])) then raise exception 'settlement member must be an active adult family member'; end if;
  new.updated_at:=pg_catalog.now();return new;
end;$$;
revoke all on function private.prepare_budget_settlement_member_write() from public,anon,authenticated;

create or replace function private.prepare_budget_settlement_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then return new; end if;
  if tg_op='UPDATE' and (new.family_id<>old.family_id or new.created_by<>old.created_by) then raise exception 'settlement ownership cannot be changed';end if;
  if tg_op='UPDATE' and not(select public.has_family_role(old.family_id,array['owner','admin']::public.family_role[])) and(new.from_user_id<>(select auth.uid()) and new.to_user_id<>(select auth.uid())) then raise exception 'adult may only edit a settlement they are party to';end if;
  if new.from_user_id=new.to_user_id then raise exception 'settlement parties must differ';end if;
  if not exists(select 1 from public.family_members fm where fm.family_id=new.family_id and fm.user_id=new.from_user_id and fm.status='active' and fm.role=any(array['owner','admin','adult']::public.family_role[])) or not exists(select 1 from public.family_members fm where fm.family_id=new.family_id and fm.user_id=new.to_user_id and fm.status='active' and fm.role=any(array['owner','admin','adult']::public.family_role[])) then raise exception 'settlement parties must be active adult members of the same family';end if;
  new.note:=nullif(pg_catalog.btrim(new.note),'');new.currency:=pg_catalog.upper(pg_catalog.btrim(new.currency));new.updated_at:=pg_catalog.now();return new;
end;$$;
revoke all on function private.prepare_budget_settlement_write() from public,anon,authenticated;

create or replace function private.prepare_budget_plan_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then return new; end if;
  if tg_op='UPDATE' and(new.family_id<>old.family_id or new.created_by<>old.created_by) then raise exception 'budget plan ownership cannot be changed';end if;
  new.category:=nullif(pg_catalog.btrim(new.category),'');new.currency:=pg_catalog.upper(pg_catalog.btrim(new.currency));new.updated_at:=pg_catalog.now();return new;
end;$$;
revoke all on function private.prepare_budget_plan_write() from public,anon,authenticated;

create or replace function private.prepare_property_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then return new;end if;
  if tg_op='UPDATE' and(new.family_id<>old.family_id or new.created_by<>old.created_by) then raise exception 'property ownership cannot be changed';end if;
  new.name:=pg_catalog.btrim(new.name);new.address:=nullif(pg_catalog.btrim(new.address),'');new.description:=nullif(pg_catalog.btrim(new.description),'');new.updated_at:=pg_catalog.now();return new;
end;$$;
revoke all on function private.prepare_property_write() from public,anon,authenticated;

create or replace function private.prepare_property_unit_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then return new;end if;
  if tg_op='UPDATE' and(new.family_id<>old.family_id or new.property_id<>old.property_id or new.created_by<>old.created_by) then raise exception 'property unit ownership cannot be changed';end if;
  new.name:=pg_catalog.btrim(new.name);new.updated_at:=pg_catalog.now();return new;
end;$$;
revoke all on function private.prepare_property_unit_write() from public,anon,authenticated;

create or replace function private.prepare_property_definition_write()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.family_restore_active(new.family_id) then
    if new.active and not exists(select 1 from public.properties p where p.id=new.property_id and p.family_id=new.family_id and p.active) then raise exception 'charge definition cannot be active for an archived property';end if;
    if not private.valid_property_timezone(new.recurrence_timezone) then raise exception 'invalid recurrence timezone';end if;
    return new;
  end if;
  if tg_op='UPDATE' then
    if new.family_id<>old.family_id or new.created_by<>old.created_by then raise exception 'charge definition ownership cannot be changed';end if;
    if new.property_id is distinct from old.property_id then
      if not private.can_manage_properties(new.family_id) then raise exception 'property access requires an active adult family member';end if;
      if not exists(select 1 from public.properties p where p.id=new.property_id and p.family_id=new.family_id and p.active) then raise exception 'target property must be active and belong to the same family';end if;
      if new.property_unit_id is not null then raise exception 'moving a definition requires clearing its property unit';end if;
    elsif new.property_unit_id is distinct from old.property_unit_id then raise exception 'charge definition unit cannot be changed';end if;
  end if;
  if not private.valid_property_timezone(new.recurrence_timezone) then raise exception 'invalid recurrence timezone';end if;
  if new.active and not exists(select 1 from public.properties p where p.id=new.property_id and p.family_id=new.family_id and p.active) then raise exception 'charge definition cannot be active for an archived property';end if;
  new.name:=pg_catalog.btrim(new.name);new.currency:=pg_catalog.upper(pg_catalog.btrim(new.currency));new.updated_at:=pg_catalog.now();return new;
end;$$;
revoke all on function private.prepare_property_definition_write() from public,anon,authenticated;

create or replace function private.sync_budget_expense_participants()
returns trigger language plpgsql security definer set search_path = '' as $$
declare participant_count integer;
begin
  if private.family_restore_active(new.family_id) then return new; end if;
  if not new.is_shared then if tg_op='UPDATE' and old.is_shared then delete from public.budget_expense_participants p where p.transaction_id=new.id; end if; return new; end if;
  if tg_op='INSERT' or not old.is_shared then
    select pg_catalog.count(*) into participant_count from public.budget_settlement_members m join public.family_members fm on fm.family_id=m.family_id and fm.user_id=m.user_id where m.family_id=new.family_id and m.is_active and fm.status='active' and fm.role=any(array['owner','admin','adult']::public.family_role[]);
    if participant_count<2 then raise exception 'shared expense requires at least two active settlement members'; end if;
    insert into public.budget_expense_participants(transaction_id,family_id,user_id) select new.id,new.family_id,m.user_id from public.budget_settlement_members m join public.family_members fm on fm.family_id=m.family_id and fm.user_id=m.user_id where m.family_id=new.family_id and m.is_active and fm.status='active' and fm.role=any(array['owner','admin','adult']::public.family_role[]) order by m.user_id;
  end if;
  if not exists(select 1 from public.budget_expense_participants p where p.transaction_id=new.id and p.family_id=new.family_id and p.user_id=new.paid_by) then raise exception 'payer must be a participant of the shared expense'; end if; return new;
end; $$;

-- Restore performs fixed table writes only; no dynamic SQL or source family_id is used.
create or replace function public.restore_family_data(
  target_family_id uuid,backup jsonb,selected_modules text[],user_mapping jsonb,restore_mode text,confirmation_family_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  report jsonb; normalized text[]; restore_operation_id uuid:=pg_catalog.gen_random_uuid(); destination_name text;
  item jsonb; source_id text; mapped_id uuid; transaction_id uuid; ignored integer:=0; cleared integer:=0;
  series_map jsonb:='{}'::jsonb; task_map jsonb:='{}'::jsonb; event_map jsonb:='{}'::jsonb;
  list_map jsonb:='{}'::jsonb; item_map jsonb:='{}'::jsonb; transaction_map jsonb:='{}'::jsonb;
  settlement_map jsonb:='{}'::jsonb; plan_map jsonb:='{}'::jsonb; property_map jsonb:='{}'::jsonb;
  unit_map jsonb:='{}'::jsonb; definition_map jsonb:='{}'::jsonb; charge_map jsonb:='{}'::jsonb;
begin
  if restore_mode<>'replace_selected' then raise exception 'unsupported restore mode'; end if;
  if (select auth.uid()) is null or not public.has_family_role(target_family_id,array['owner']::public.family_role[]) then raise exception 'only an active family owner may restore a backup'; end if;
  -- Serialize first, then lock the destination row and perform the authoritative
  -- validation against the same transaction snapshot used by destructive writes.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_family_id::text,0));
  select f.name into destination_name from public.families f where f.id=target_family_id for update;
  if destination_name is null or confirmation_family_name is distinct from destination_name then raise exception 'destination family confirmation does not match'; end if;
  report:=private.validate_family_restore(target_family_id,backup,selected_modules,user_mapping);
  if not coalesce((report->>'valid')::boolean,false) then raise exception 'restore validation failed: %',report->'errors'; end if;
  normalized:=array(select pg_catalog.jsonb_array_elements_text(report->'normalizedModules'));
  perform pg_catalog.set_config('family_planner.restore_operation',restore_operation_id::text,true);
  insert into private.family_restore_context(operation_id,transaction_id,backend_pid,family_id,actor_user_id)
  values(restore_operation_id,pg_catalog.txid_current(),pg_catalog.pg_backend_pid(),target_family_id,(select auth.uid()));

  -- Generate all destination IDs before writing relationships.
  if 'tasks'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,recurrenceSeries}') loop series_map:=series_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,items}') loop task_map:=task_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop;
  end if;
  if 'calendar'=any(normalized) then for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,calendar,events}') loop event_map:=event_map||pg_catalog.jsonb_build_object(item->>'id',pg_catalog.gen_random_uuid()); end loop; end if;
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

  -- Delete selected modules, children before parents.
  if 'tasks'=any(normalized) then delete from public.notifications where family_id=target_family_id and source_type='task'; delete from public.reminders where family_id=target_family_id and source_type='task'; delete from public.tasks where family_id=target_family_id; delete from public.task_recurrence_series where family_id=target_family_id; end if;
  if 'calendar'=any(normalized) then delete from public.notifications where family_id=target_family_id and source_type='calendar_event'; delete from public.reminders where family_id=target_family_id and source_type='calendar_event'; delete from public.calendar_events where family_id=target_family_id; end if;
  if 'shopping'=any(normalized) then delete from public.shopping_items where family_id=target_family_id; delete from public.shopping_lists where family_id=target_family_id; end if;
  if 'fixedCharges'=any(normalized) then delete from public.notifications where family_id=target_family_id and source_type='property_charge'; delete from public.reminders where family_id=target_family_id and source_type='property_charge'; delete from public.property_charges where family_id=target_family_id; delete from public.property_charge_reminder_rules where family_id=target_family_id; delete from public.property_charge_schedule_dates where family_id=target_family_id; delete from public.property_charge_definitions where family_id=target_family_id; delete from public.property_units where family_id=target_family_id; delete from public.properties where family_id=target_family_id; end if;
  if 'budget'=any(normalized) then delete from public.budget_expense_participants where family_id=target_family_id; delete from public.budget_settlements where family_id=target_family_id; delete from public.budget_plans where family_id=target_family_id; delete from public.budget_settlement_members where family_id=target_family_id; delete from public.budget_transactions where family_id=target_family_id; end if;
  if 'reminders'=any(normalized) then delete from public.reminders where family_id=target_family_id and recipient_user_id=(select auth.uid()) and reminder_kind='personal'; end if;

  -- Budget precedes fixed charges so restored charge links can target mapped transactions.
  if 'budget'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlementMembers}') loop insert into public.budget_settlement_members(family_id,user_id,is_active,created_by,created_at,updated_at) values(target_family_id,private.restore_mapping_value(user_mapping,item->>'userId'),(item->>'isActive')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,transactions}') loop insert into public.budget_transactions(id,family_id,transaction_type,title,description,amount,currency,category,transaction_date,paid_by,is_shared,created_by,created_at,updated_at) values((transaction_map->>(item->>'id'))::uuid,target_family_id,item->>'transactionType',item->>'title',item->>'description',(item->>'amount')::numeric,item->>'currency',item->>'category',(item->>'transactionDate')::date,private.restore_mapping_value(user_mapping,item->>'paidBy',true),(item->>'isShared')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,expenseParticipants}') loop insert into public.budget_expense_participants(transaction_id,family_id,user_id,share_weight,created_at) values((transaction_map->>(item->>'transactionId'))::uuid,target_family_id,private.restore_mapping_value(user_mapping,item->>'userId'),(item->>'shareWeight')::numeric,(item->>'createdAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,settlements}') loop insert into public.budget_settlements(id,family_id,from_user_id,to_user_id,amount,currency,settlement_date,note,created_by,created_at,updated_at) values((settlement_map->>(item->>'id'))::uuid,target_family_id,private.restore_mapping_value(user_mapping,item->>'fromUserId'),private.restore_mapping_value(user_mapping,item->>'toUserId'),(item->>'amount')::numeric,item->>'currency',(item->>'settlementDate')::date,item->>'note',private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,budget,plans}') loop insert into public.budget_plans(id,family_id,month,plan_type,category,amount,currency,created_by,created_at,updated_at) values((plan_map->>(item->>'id'))::uuid,target_family_id,(item->>'month')::date,item->>'planType',item->>'category',(item->>'amount')::numeric,item->>'currency',private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
  end if;

  if 'tasks'=any(normalized) then
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,recurrenceSeries}') loop insert into public.task_recurrence_series(id,family_id,recurrence_rule,recurrence_timezone,anchor_due_at,recurrence_enabled,created_by,stopped_at,created_at,updated_at) values((series_map->>(item->>'id'))::uuid,target_family_id,item->'recurrenceRule',item->>'recurrenceTimezone',(item->>'anchorDueAt')::timestamptz,(item->>'recurrenceEnabled')::boolean,private.restore_mapping_value(user_mapping,item->>'createdBy'),nullif(item->>'stoppedAt','')::timestamptz,(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop;
    for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,tasks,items}') order by coalesce((value->>'occurrenceIndex')::integer,0) loop insert into public.tasks(id,family_id,title,description,status,priority,assigned_to,due_at,created_by,created_at,updated_at,completed_at,recurrence_series_id,occurrence_index,generated_from_task_id,assignee_reminder_offset_minutes) values((task_map->>(item->>'id'))::uuid,target_family_id,item->>'title',item->>'description',item->>'status',item->>'priority',private.restore_mapping_value(user_mapping,item->>'assignedTo',true),nullif(item->>'dueAt','')::timestamptz,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz,nullif(item->>'completedAt','')::timestamptz,nullif(series_map->>(item->>'recurrenceSeriesId'),'')::uuid,coalesce((item->>'occurrenceIndex')::integer,0),nullif(task_map->>(item->>'generatedFromTaskId'),'')::uuid,nullif(item->>'assigneeReminderOffsetMinutes','')::integer); end loop;
  end if;
  if 'calendar'=any(normalized) then for item in select value from pg_catalog.jsonb_array_elements(backup#>'{modules,calendar,events}') loop insert into public.calendar_events(id,family_id,title,description,event_type,location,all_day,starts_at,ends_at,start_date,end_date,created_by,created_at,updated_at) values((event_map->>(item->>'id'))::uuid,target_family_id,item->>'title',item->>'description',item->>'eventType',item->>'location',(item->>'allDay')::boolean,nullif(item->>'startsAt','')::timestamptz,nullif(item->>'endsAt','')::timestamptz,nullif(item->>'startDate','')::date,nullif(item->>'endDate','')::date,private.restore_mapping_value(user_mapping,item->>'createdBy'),(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz); end loop; end if;
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

  -- Regenerate future task-assignee reminders from task configuration, never old technical rows.
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

  -- Turn off context before writing the single restore audit event.
  delete from private.family_restore_context c where c.operation_id=restore_operation_id;
  perform pg_catalog.set_config('family_planner.restore_operation','',true);
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(target_family_id,(select auth.uid()),'family.backup.restored','family',target_family_id::text,
    pg_catalog.jsonb_build_object('backupVersion',1,'schemaVersion',1,'sourceFamilyId',backup#>>'{family,id}','sourceCreatedAt',backup->>'createdAt','modules',to_jsonb(normalized),'restoreMode','replace_selected','importedCounts',report->'moduleCounts','removedCounts',report->'recordsToRemove','clearedBudgetLinkCount',cleared,'ignoredReminderCount',ignored,'restoreOperationId',restore_operation_id));
  return pg_catalog.jsonb_build_object('success',true,'operationId',restore_operation_id,'modules',to_jsonb(normalized),'importedCounts',report->'moduleCounts','removedCounts',report->'recordsToRemove','clearedBudgetLinks',cleared,'ignoredReminders',ignored,'warnings',report->'warnings');
end; $$;

revoke all on function public.restore_family_data(uuid,jsonb,text[],jsonb,text,text) from public,anon,authenticated;
grant execute on function public.restore_family_data(uuid,jsonb,text[],jsonb,text,text) to authenticated;

notify pgrst,'reload schema';
