-- Sprint 7.6: family properties, charge definitions, occurrences, reminders and budget links.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.properties (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null check (pg_catalog.char_length(name) between 1 and 120),
  address text,
  description text,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint properties_id_family_unique unique(id,family_id)
);

create table public.property_units (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  property_id uuid not null,
  name text not null check (pg_catalog.char_length(name) between 1 and 120),
  unit_type text not null default 'other' check (unit_type in ('apartment','garage','parking','commercial','land','other')),
  active boolean not null default true,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint property_units_property_family_fkey foreign key(property_id,family_id)
    references public.properties(id,family_id) on delete cascade,
  constraint property_units_id_family_unique unique(id,family_id),
  constraint property_units_id_property_family_unique unique(id,property_id,family_id)
);

create table public.property_charge_definitions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  property_id uuid not null,
  property_unit_id uuid,
  name text not null check (pg_catalog.char_length(name) between 1 and 160),
  category text not null default 'other' check (category in ('rent','electricity','gas','water','internet','tax','insurance','parking','service','other')),
  amount_mode text not null check (amount_mode in ('fixed','variable','optional')),
  planned_amount numeric(12,2) check (planned_amount is null or planned_amount > 0),
  currency text not null default 'PLN' check (pg_catalog.char_length(currency)=3),
  recurrence_type text not null check (recurrence_type in ('one_time','monthly','interval_months','yearly','selected_dates')),
  recurrence_timezone text not null default 'Europe/Warsaw',
  start_date date not null,
  due_day integer check (due_day between 1 and 31),
  interval_months integer check (interval_months between 2 and 120),
  recurrence_month integer check (recurrence_month between 1 and 12),
  active boolean not null default true,
  auto_generate boolean not null default true,
  budget_sync_mode text not null default 'manual' check (budget_sync_mode in ('manual','automatic')),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint property_charge_definitions_property_family_fkey foreign key(property_id,family_id)
    references public.properties(id,family_id),
  constraint property_charge_definitions_unit_property_family_fkey foreign key(property_unit_id,property_id,family_id)
    references public.property_units(id,property_id,family_id),
  constraint property_charge_definitions_id_family_unique unique(id,family_id),
  constraint property_charge_definitions_amount_check check (
    (amount_mode='fixed' and planned_amount is not null) or amount_mode in ('variable','optional')
  ),
  constraint property_charge_definitions_recurrence_check check (
    (recurrence_type='one_time')
    or (recurrence_type='monthly' and due_day is not null)
    or (recurrence_type='interval_months' and due_day is not null and interval_months is not null)
    or (recurrence_type='yearly' and due_day is not null and recurrence_month is not null)
    or (recurrence_type='selected_dates')
  )
);

create table public.property_charge_schedule_dates (
  definition_id uuid not null,
  family_id uuid not null,
  month integer not null check (month between 1 and 12),
  day integer not null check (day between 1 and 31),
  primary key(definition_id,month,day),
  constraint property_charge_schedule_definition_family_fkey foreign key(definition_id,family_id)
    references public.property_charge_definitions(id,family_id) on delete cascade
);

create table public.property_charge_reminder_rules (
  definition_id uuid not null,
  family_id uuid not null,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  offset_days integer not null check (offset_days between -30 and 365),
  created_at timestamptz not null default pg_catalog.now(),
  primary key(definition_id,recipient_user_id,offset_days),
  constraint property_charge_reminder_definition_family_fkey foreign key(definition_id,family_id)
    references public.property_charge_definitions(id,family_id) on delete cascade
);

create table public.property_charges (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  property_id uuid not null,
  property_unit_id uuid,
  charge_definition_id uuid not null,
  due_date date not null,
  planned_amount numeric(12,2) check (planned_amount is null or planned_amount > 0),
  actual_amount numeric(12,2) check (actual_amount is null or actual_amount > 0),
  currency text not null default 'PLN' check (pg_catalog.char_length(currency)=3),
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  paid_at timestamptz,
  notes text,
  budget_transaction_id uuid,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint property_charges_definition_family_fkey foreign key(charge_definition_id,family_id)
    references public.property_charge_definitions(id,family_id),
  constraint property_charges_property_family_fkey foreign key(property_id,family_id)
    references public.properties(id,family_id),
  constraint property_charges_unit_property_family_fkey foreign key(property_unit_id,property_id,family_id)
    references public.property_units(id,property_id,family_id),
  constraint property_charges_budget_family_fkey foreign key(budget_transaction_id,family_id)
    references public.budget_transactions(id,family_id),
  constraint property_charges_cycle_unique unique(charge_definition_id,due_date),
  constraint property_charges_budget_unique unique(budget_transaction_id),
  constraint property_charges_paid_shape_check check (
    (status='paid' and actual_amount is not null and paid_at is not null)
    or (status<>'paid' and actual_amount is null and paid_at is null)
  )
);

create index properties_family_idx on public.properties(family_id,active);
create index property_units_family_property_idx on public.property_units(family_id,property_id,active);
create index property_charge_definitions_family_idx on public.property_charge_definitions(family_id,active);
create index property_charges_family_due_idx on public.property_charges(family_id,due_date,status);
create index property_charges_property_due_idx on public.property_charges(property_id,due_date);
create index property_charges_unit_idx on public.property_charges(property_unit_id) where property_unit_id is not null;

create or replace function private.can_manage_properties(target_family uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select public.has_family_role(target_family,array['owner','admin','adult']::public.family_role[]);
$$;
revoke all on function private.can_manage_properties(uuid) from public,anon,authenticated;

create or replace function private.valid_property_timezone(value text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from pg_catalog.pg_timezone_names z where z.name=value);
$$;
revoke all on function private.valid_property_timezone(text) from public,anon,authenticated;

create or replace function private.prepare_property_write()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.family_id<>old.family_id or new.created_by<>old.created_by) then raise exception 'property ownership cannot be changed'; end if;
  new.name:=pg_catalog.btrim(new.name); new.address:=nullif(pg_catalog.btrim(new.address),''); new.description:=nullif(pg_catalog.btrim(new.description),''); new.updated_at:=pg_catalog.now(); return new;
end; $$;
revoke all on function private.prepare_property_write() from public,anon,authenticated;
create trigger prepare_property_write before insert or update on public.properties for each row execute function private.prepare_property_write();

create or replace function private.prepare_property_unit_write()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.family_id<>old.family_id or new.property_id<>old.property_id or new.created_by<>old.created_by) then raise exception 'property unit ownership cannot be changed'; end if;
  new.name:=pg_catalog.btrim(new.name); new.updated_at:=pg_catalog.now(); return new;
end; $$;
revoke all on function private.prepare_property_unit_write() from public,anon,authenticated;
create trigger prepare_property_unit_write before insert or update on public.property_units for each row execute function private.prepare_property_unit_write();

create or replace function private.prepare_property_definition_write()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.family_id<>old.family_id or new.property_id<>old.property_id or new.property_unit_id is distinct from old.property_unit_id or new.created_by<>old.created_by) then raise exception 'charge definition ownership cannot be changed'; end if;
  if not private.valid_property_timezone(new.recurrence_timezone) then raise exception 'invalid recurrence timezone'; end if;
  new.name:=pg_catalog.btrim(new.name); new.currency:=pg_catalog.upper(pg_catalog.btrim(new.currency)); new.updated_at:=pg_catalog.now(); return new;
end; $$;
revoke all on function private.prepare_property_definition_write() from public,anon,authenticated;
create trigger prepare_property_definition_write before insert or update on public.property_charge_definitions for each row execute function private.prepare_property_definition_write();

create or replace function private.audit_property_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare r record; action_value text; entity_value text; id_value text;
begin
  if tg_op='DELETE' then r:=old; else r:=new; end if;
  if tg_table_name='properties' then entity_value:='property'; id_value:=r.id::text; action_value:=case when tg_op='INSERT' then 'property.created' when new.active=false and old.active=true then 'property.archived' else 'property.updated' end;
  elsif tg_table_name='property_units' then entity_value:='property_unit'; id_value:=r.id::text; action_value:=case when tg_op='INSERT' then 'property.unit.created' else 'property.unit.updated' end;
  else entity_value:='property_charge_definition'; id_value:=r.id::text; action_value:=case when tg_op='INSERT' then 'property.charge_definition.created' else 'property.charge_definition.updated' end; end if;
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id)
  values(r.family_id,(select auth.uid()),action_value,entity_value,id_value);
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
revoke all on function private.audit_property_change() from public,anon,authenticated;
create trigger audit_property_change after insert or update on public.properties for each row execute function private.audit_property_change();
create trigger audit_property_unit_change after insert or update on public.property_units for each row execute function private.audit_property_change();
create trigger audit_property_definition_change after insert or update on public.property_charge_definitions for each row execute function private.audit_property_change();

create or replace function public.create_property_charge_definition(
  target_family_id uuid,target_property_id uuid,target_unit_id uuid,charge_name text,charge_category text,
  charge_amount_mode text,charge_planned_amount numeric,charge_recurrence_type text,charge_timezone text,
  charge_start_date date,charge_due_day integer,charge_interval_months integer,charge_recurrence_month integer,
  charge_selected_dates jsonb,charge_reminder_offsets integer[],charge_auto_generate boolean,charge_budget_sync_mode text
) returns uuid language plpgsql security definer set search_path='' as $$
declare definition_id uuid; item jsonb; offset_value integer;
begin
  if not private.can_manage_properties(target_family_id) then raise exception 'property access requires an active adult family member'; end if;
  insert into public.property_charge_definitions(family_id,property_id,property_unit_id,name,category,amount_mode,planned_amount,recurrence_type,recurrence_timezone,start_date,due_day,interval_months,recurrence_month,auto_generate,budget_sync_mode)
  values(target_family_id,target_property_id,target_unit_id,charge_name,charge_category,charge_amount_mode,charge_planned_amount,charge_recurrence_type,charge_timezone,charge_start_date,charge_due_day,charge_interval_months,charge_recurrence_month,charge_auto_generate,charge_budget_sync_mode)
  returning id into definition_id;
  if charge_recurrence_type='selected_dates' then
    for item in select value from pg_catalog.jsonb_array_elements(coalesce(charge_selected_dates,'[]'::jsonb)) loop
      insert into public.property_charge_schedule_dates(definition_id,family_id,month,day)
      values(definition_id,target_family_id,(item->>'month')::integer,(item->>'day')::integer) on conflict do nothing;
    end loop;
    if not exists(select 1 from public.property_charge_schedule_dates s where s.definition_id=definition_id) then raise exception 'selected dates recurrence requires at least one date'; end if;
  end if;
  foreach offset_value in array coalesce(charge_reminder_offsets,'{}'::integer[]) loop
    insert into public.property_charge_reminder_rules(definition_id,family_id,recipient_user_id,offset_days)
    values(definition_id,target_family_id,(select auth.uid()),offset_value) on conflict do nothing;
  end loop;
  return definition_id;
end; $$;
revoke all on function public.create_property_charge_definition(uuid,uuid,uuid,text,text,text,numeric,text,text,date,integer,integer,integer,jsonb,integer[],boolean,text) from public,anon;
grant execute on function public.create_property_charge_definition(uuid,uuid,uuid,text,text,text,numeric,text,text,date,integer,integer,integer,jsonb,integer[],boolean,text) to authenticated;

-- Existing reminder/notification rows keep their meaning; property_charge is an additive source and kind.
alter table public.notifications drop constraint if exists notifications_notification_type_check;
alter table public.notifications add constraint notifications_notification_type_check check(notification_type in ('task_assigned','task_reminder','calendar_reminder','property_charge_reminder','system'));
alter table public.notifications drop constraint if exists notifications_source_type_check;
alter table public.notifications add constraint notifications_source_type_check check(source_type is null or source_type in ('task','calendar_event','property_charge','system'));
alter table public.notifications drop constraint if exists notifications_source_shape_check;
alter table public.notifications add constraint notifications_source_shape_check check(
  (source_type in ('task','calendar_event','property_charge') and source_id is not null) or (source_type is null and source_id is null) or source_type='system'
);
alter table public.reminders drop constraint if exists reminders_source_type_check;
alter table public.reminders add constraint reminders_source_type_check check(source_type in ('task','calendar_event','property_charge'));
alter table public.reminders add column property_charge_reminder_offset_days integer;
alter table public.reminders drop constraint if exists reminders_kind_check;
alter table public.reminders add constraint reminders_kind_check check(reminder_kind in ('personal','task_assignee','property_charge'));
alter table public.reminders drop constraint if exists reminders_assignee_offset_check;
alter table public.reminders add constraint reminders_kind_shape_check check(
  (reminder_kind='personal' and assignee_reminder_offset_minutes is null and property_charge_reminder_offset_days is null)
  or (reminder_kind='task_assignee' and source_type='task' and assignee_reminder_offset_minutes between 1 and 525600 and property_charge_reminder_offset_days is null)
  or (reminder_kind='property_charge' and source_type='property_charge' and assignee_reminder_offset_minutes is null and property_charge_reminder_offset_days between -30 and 365)
);
drop index if exists public.reminders_one_pending_source_kind_unique;
create unique index reminders_one_pending_non_property_kind_unique on public.reminders(recipient_user_id,source_type,source_id,reminder_kind) where status='pending' and reminder_kind<>'property_charge';
create unique index reminders_one_pending_property_offset_unique on public.reminders(recipient_user_id,source_type,source_id,reminder_kind,property_charge_reminder_offset_days) where status='pending' and reminder_kind='property_charge';

create or replace function private.prepare_reminder_write()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.reminder_kind='personal' and (new.created_by<>(select auth.uid()) or new.recipient_user_id<>(select auth.uid())) then raise exception 'reminders are personal'; end if;
    if new.reminder_kind='task_assignee' and (new.source_type<>'task' or not exists(select 1 from public.tasks t join public.family_members fm on fm.family_id=t.family_id and fm.user_id=t.assigned_to and fm.status='active' where t.id=new.source_id and t.family_id=new.family_id and t.assigned_to=new.recipient_user_id)) then raise exception 'invalid task assignee reminder recipient'; end if;
    if new.reminder_kind='property_charge' and (new.source_type<>'property_charge' or not exists(select 1 from public.property_charges c join public.property_charge_reminder_rules rr on rr.definition_id=c.charge_definition_id and rr.family_id=c.family_id where c.id=new.source_id and c.family_id=new.family_id and rr.recipient_user_id=new.recipient_user_id and rr.offset_days=new.property_charge_reminder_offset_days)) then raise exception 'invalid property charge reminder recipient'; end if;
    if new.source_type='property_charge' and new.reminder_kind<>'property_charge' then raise exception 'property charge reminders are backend-managed'; end if;
    if new.status<>'pending' or new.fired_at is not null then raise exception 'invalid initial reminder status'; end if;
  else
    if new.family_id<>old.family_id or new.created_by<>old.created_by or new.source_type<>old.source_type or new.source_id<>old.source_id or new.reminder_kind<>old.reminder_kind then raise exception 'reminder ownership and source cannot be changed'; end if;
    if old.reminder_kind='personal' and new.recipient_user_id<>old.recipient_user_id then raise exception 'personal reminder recipient cannot be changed'; end if;
  end if;
  if new.status='pending' and new.remind_at<=pg_catalog.now() then raise exception 'reminder must be in the future'; end if;
  if new.source_type='task' and not exists(select 1 from public.tasks t where t.id=new.source_id and t.family_id=new.family_id) then raise exception 'task does not belong to reminder family';
  elsif new.source_type='calendar_event' and not exists(select 1 from public.calendar_events e where e.id=new.source_id and e.family_id=new.family_id) then raise exception 'calendar event does not belong to reminder family';
  elsif new.source_type='property_charge' and not exists(select 1 from public.property_charges c where c.id=new.source_id and c.family_id=new.family_id) then raise exception 'property charge does not belong to reminder family'; end if;
  new.title:=nullif(pg_catalog.btrim(new.title),''); new.timezone:=nullif(pg_catalog.btrim(new.timezone),''); new.updated_at:=pg_catalog.now(); return new;
end; $$;
revoke all on function private.prepare_reminder_write() from public,anon,authenticated;

create or replace function private.ensure_property_charge_reminders(target_charge_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare c public.property_charges%rowtype; d public.property_charge_definitions%rowtype; rule record; reminder_time timestamptz;
begin
  select * into c from public.property_charges where id=target_charge_id;
  if not found or c.status<>'pending' then return; end if;
  select * into d from public.property_charge_definitions where id=c.charge_definition_id;
  for rule in select * from public.property_charge_reminder_rules r where r.definition_id=d.id loop
    reminder_time:=((c.due_date::timestamp+time '09:00') at time zone d.recurrence_timezone)-pg_catalog.make_interval(days=>rule.offset_days);
    if reminder_time>pg_catalog.now() then
      insert into public.reminders(family_id,recipient_user_id,source_type,source_id,title,remind_at,timezone,status,created_by,reminder_kind,property_charge_reminder_offset_days)
      values(c.family_id,rule.recipient_user_id,'property_charge',c.id,'Opłata: '||d.name,reminder_time,d.recurrence_timezone,'pending',rule.recipient_user_id,'property_charge',rule.offset_days)
      on conflict do nothing;
    end if;
  end loop;
end; $$;
revoke all on function private.ensure_property_charge_reminders(uuid) from public,anon,authenticated;

create or replace function public.ensure_property_charges(target_family_id uuid,range_start date,range_end date)
returns integer language plpgsql security definer set search_path='' as $$
declare d public.property_charge_definitions%rowtype; candidate date; month_start date; inserted_id uuid; created_count integer:=0;
begin
  if not private.can_manage_properties(target_family_id) then raise exception 'property access requires an active adult family member'; end if;
  if range_end<range_start or range_end-range_start>400 then raise exception 'charge generation range must be between 0 and 400 days'; end if;
  for d in select * from public.property_charge_definitions x where x.family_id=target_family_id and x.active and x.auto_generate order by x.id loop
    if d.recurrence_type='one_time' then
      candidate:=d.start_date;
      if candidate between range_start and range_end then
        insert into public.property_charges(family_id,property_id,property_unit_id,charge_definition_id,due_date,planned_amount,currency)
        values(d.family_id,d.property_id,d.property_unit_id,d.id,candidate,d.planned_amount,d.currency) on conflict do nothing returning id into inserted_id;
        if inserted_id is not null then
          created_count:=created_count+1;
          perform private.ensure_property_charge_reminders(inserted_id);
          insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id)
          values(d.family_id,(select auth.uid()),'property.charge.created','property_charge',inserted_id::text);
        end if;
      end if;
    else
      for month_start in select g::date from pg_catalog.generate_series(pg_catalog.date_trunc('month',range_start::timestamp),pg_catalog.date_trunc('month',range_end::timestamp),interval '1 month') g loop
        candidate:=null;
        if d.recurrence_type in ('monthly','interval_months') and (d.recurrence_type='monthly' or mod((extract(year from month_start)::integer-extract(year from d.start_date)::integer)*12+extract(month from month_start)::integer-extract(month from d.start_date)::integer,d.interval_months)=0) then
          candidate:=(month_start+(least(d.due_day,extract(day from (month_start+interval '1 month'-interval '1 day'))::integer)-1)*interval '1 day')::date;
        elsif d.recurrence_type='yearly' and extract(month from month_start)::integer=d.recurrence_month then
          candidate:=(month_start+(least(d.due_day,extract(day from (month_start+interval '1 month'-interval '1 day'))::integer)-1)*interval '1 day')::date;
        end if;
        if candidate is not null and candidate>=d.start_date and candidate between range_start and range_end then
          inserted_id:=null; insert into public.property_charges(family_id,property_id,property_unit_id,charge_definition_id,due_date,planned_amount,currency)
          values(d.family_id,d.property_id,d.property_unit_id,d.id,candidate,d.planned_amount,d.currency) on conflict do nothing returning id into inserted_id;
          if inserted_id is not null then
            created_count:=created_count+1;
            perform private.ensure_property_charge_reminders(inserted_id);
            insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id)
            values(d.family_id,(select auth.uid()),'property.charge.created','property_charge',inserted_id::text);
          end if;
        end if;
      end loop;
      if d.recurrence_type='selected_dates' then
        for candidate in
          select pg_catalog.make_date(
            y.year_value,
            s.month,
            least(
              s.day,
              extract(
                day from (pg_catalog.make_date(y.year_value,s.month,1)+interval '1 month'-interval '1 day')
              )::integer
            )
          )
          from public.property_charge_schedule_dates s
          cross join lateral pg_catalog.generate_series(
            extract(year from range_start)::integer,
            extract(year from range_end)::integer
          ) as y(year_value)
          where s.definition_id=d.id
        loop
          if candidate>=d.start_date and candidate between range_start and range_end then
            inserted_id:=null; insert into public.property_charges(family_id,property_id,property_unit_id,charge_definition_id,due_date,planned_amount,currency)
            values(d.family_id,d.property_id,d.property_unit_id,d.id,candidate,d.planned_amount,d.currency) on conflict do nothing returning id into inserted_id;
            if inserted_id is not null then
              created_count:=created_count+1;
              perform private.ensure_property_charge_reminders(inserted_id);
              insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id)
              values(d.family_id,(select auth.uid()),'property.charge.created','property_charge',inserted_id::text);
            end if;
          end if;
        end loop;
      end if;
    end if;
  end loop;
  return created_count;
end; $$;
revoke all on function public.ensure_property_charges(uuid,date,date) from public,anon;
grant execute on function public.ensure_property_charges(uuid,date,date) to authenticated;

create or replace function public.pay_property_charge(target_family_id uuid,target_charge_id uuid,paid_amount numeric,paid_timestamp timestamptz,payment_notes text,sync_budget boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare c public.property_charges%rowtype; d public.property_charge_definitions%rowtype; transaction_id uuid;
begin
  if not private.can_manage_properties(target_family_id) then raise exception 'property access requires an active adult family member'; end if;
  if paid_amount<=0 or paid_timestamp is null then raise exception 'invalid payment data'; end if;
  select * into c from public.property_charges where id=target_charge_id and family_id=target_family_id for update;
  if not found or c.status='cancelled' then raise exception 'charge not found or cancelled'; end if;
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
  if not found or c.status='paid' then raise exception 'paid charges remain in history'; end if;
  update public.property_charges set status='cancelled',actual_amount=null,paid_at=null,updated_at=pg_catalog.now() where id=c.id;
  update public.reminders set status='cancelled',fired_at=null,updated_at=pg_catalog.now() where family_id=c.family_id and source_type='property_charge' and source_id=c.id and status='pending';
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id) values(c.family_id,(select auth.uid()),'property.charge.cancelled','property_charge',c.id::text);
end; $$;
revoke all on function public.cancel_property_charge(uuid,uuid) from public,anon;
grant execute on function public.cancel_property_charge(uuid,uuid) to authenticated;

create or replace function private.process_due_reminders(batch_size integer default 100)
returns integer language plpgsql security definer set search_path='' as $$
declare due public.reminders%rowtype; processed integer:=0; event_type text; source_title text;
begin
  for due in select * from public.reminders r where r.status='pending' and r.remind_at<=pg_catalog.now() order by r.remind_at for update skip locked limit greatest(1,least(batch_size,1000)) loop
    event_type:=case due.source_type when 'task' then 'task_reminder' when 'calendar_event' then 'calendar_reminder' else 'property_charge_reminder' end;
    if not exists(select 1 from public.family_members fm where fm.family_id=due.family_id and fm.user_id=due.recipient_user_id and fm.status='active') then
      update public.reminders set status='cancelled',fired_at=null,updated_at=pg_catalog.now() where id=due.id; processed:=processed+1; continue;
    end if;
    if due.source_type='task' then select t.title into source_title from public.tasks t where t.id=due.source_id and t.family_id=due.family_id;
    elsif due.source_type='calendar_event' then select e.title into source_title from public.calendar_events e where e.id=due.source_id and e.family_id=due.family_id;
    else select d.name into source_title from public.property_charges c join public.property_charge_definitions d on d.id=c.charge_definition_id where c.id=due.source_id and c.family_id=due.family_id and c.status='pending'; end if;
    if source_title is not null and private.notification_type_enabled(due.family_id,due.recipient_user_id,event_type) then
      insert into public.notifications(family_id,recipient_user_id,notification_type,title,body,source_type,source_id,payload,dedupe_key)
      values(due.family_id,due.recipient_user_id,event_type,coalesce(due.title,'Przypomnienie'),source_title,due.source_type,due.source_id,pg_catalog.jsonb_build_object('family_id',due.family_id,'source_type',due.source_type,'source_id',due.source_id,'notification_type',event_type),'reminder:'||due.id::text) on conflict do nothing;
      update public.reminders set status='fired',fired_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=due.id;
    else update public.reminders set status='cancelled',fired_at=null,updated_at=pg_catalog.now() where id=due.id; end if;
    processed:=processed+1;
  end loop; return processed;
end; $$;
revoke all on function private.process_due_reminders(integer) from public,anon,authenticated;

alter table public.properties enable row level security;
alter table public.property_units enable row level security;
alter table public.property_charge_definitions enable row level security;
alter table public.property_charge_schedule_dates enable row level security;
alter table public.property_charge_reminder_rules enable row level security;
alter table public.property_charges enable row level security;
revoke all on public.properties,public.property_units,public.property_charge_definitions,public.property_charge_schedule_dates,public.property_charge_reminder_rules,public.property_charges from public,anon,authenticated;
grant select on public.properties,public.property_units,public.property_charge_definitions,public.property_charge_schedule_dates,public.property_charge_reminder_rules,public.property_charges to authenticated;
grant insert(family_id,name,address,description,active) on public.properties to authenticated;
grant update(name,address,description,active) on public.properties to authenticated;
grant insert(family_id,property_id,name,unit_type,active) on public.property_units to authenticated;
grant update(name,unit_type,active) on public.property_units to authenticated;
grant update(name,category,amount_mode,planned_amount,currency,recurrence_type,recurrence_timezone,start_date,due_day,interval_months,recurrence_month,active,auto_generate,budget_sync_mode) on public.property_charge_definitions to authenticated;

create policy properties_select_adult on public.properties for select to authenticated using((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
create policy properties_insert_adult on public.properties for insert to authenticated with check(created_by=(select auth.uid()) and (select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
create policy properties_update_adult on public.properties for update to authenticated using((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[]))) with check((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
create policy property_units_select_adult on public.property_units for select to authenticated using((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
create policy property_units_insert_adult on public.property_units for insert to authenticated with check(created_by=(select auth.uid()) and (select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
create policy property_units_update_adult on public.property_units for update to authenticated using((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[]))) with check((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
create policy property_definitions_select_adult on public.property_charge_definitions for select to authenticated using((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
create policy property_definitions_update_adult on public.property_charge_definitions for update to authenticated using((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[]))) with check((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
create policy property_schedule_select_adult on public.property_charge_schedule_dates for select to authenticated using((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
create policy property_reminder_rules_select_own on public.property_charge_reminder_rules for select to authenticated using(recipient_user_id=(select auth.uid()) and (select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
create policy property_charges_select_adult on public.property_charges for select to authenticated using((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));

revoke insert(property_charge_reminder_offset_days) on public.reminders from authenticated;
revoke update(property_charge_reminder_offset_days) on public.reminders from authenticated;

notify pgrst,'reload schema';
