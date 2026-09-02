-- Fixed charges lifecycle: route definition writes through narrow RPCs.

alter table public.property_charge_definitions
  add column generation_resume_date date;

update public.property_charge_definitions
set generation_resume_date = start_date
where generation_resume_date is null;

alter table public.property_charge_definitions
  alter column generation_resume_date set not null;

create or replace function public.create_property_charge_definition(
  target_family_id uuid,target_property_id uuid,target_unit_id uuid,charge_name text,charge_category text,
  charge_amount_mode text,charge_planned_amount numeric,charge_recurrence_type text,charge_timezone text,
  charge_start_date date,charge_due_day integer,charge_interval_months integer,charge_recurrence_month integer,
  charge_selected_dates jsonb,charge_reminder_offsets integer[],charge_auto_generate boolean,charge_budget_sync_mode text
) returns uuid language plpgsql security definer set search_path='' as $$
declare definition_id uuid; item jsonb; offset_value integer;
begin
  if not private.can_manage_properties(target_family_id) then raise exception 'property access requires an active adult family member'; end if;
  insert into public.property_charge_definitions(family_id,property_id,property_unit_id,name,category,amount_mode,planned_amount,recurrence_type,recurrence_timezone,start_date,generation_resume_date,due_day,interval_months,recurrence_month,auto_generate,budget_sync_mode)
  values(target_family_id,target_property_id,target_unit_id,charge_name,charge_category,charge_amount_mode,charge_planned_amount,charge_recurrence_type,charge_timezone,charge_start_date,charge_start_date,charge_due_day,charge_interval_months,charge_recurrence_month,charge_auto_generate,charge_budget_sync_mode)
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
  target_definition public.property_charge_definitions%rowtype;
begin
  if not private.can_manage_properties(target_family_id) then
    raise exception 'property access requires an active adult family member';
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

  update public.property_charge_definitions
  set name = charge_name,
      category = charge_category,
      amount_mode = charge_amount_mode,
      planned_amount = charge_planned_amount,
      budget_sync_mode = charge_budget_sync_mode
  where id = target_definition_id
    and family_id = target_family_id;
end;
$$;

create or replace function public.set_property_charge_definition_active(
  target_family_id uuid,
  target_definition_id uuid,
  next_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_definition public.property_charge_definitions%rowtype;
begin
  if not private.can_manage_properties(target_family_id) then
    raise exception 'property access requires an active adult family member';
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

  if next_active and not exists (
    select 1
    from public.properties
    where id = target_definition.property_id
      and family_id = target_family_id
      and active
  ) then
    raise exception 'charge definition cannot be active for an archived property';
  end if;

  update public.property_charge_definitions
  set active = next_active,
      generation_resume_date = case
        when next_active and not target_definition.active then current_date
        else target_definition.generation_resume_date
      end
  where id = target_definition_id
    and family_id = target_family_id;
end;
$$;

create or replace function public.ensure_property_charges(target_family_id uuid,range_start date,range_end date)
returns integer language plpgsql security definer set search_path='' as $$
declare d public.property_charge_definitions%rowtype; candidate date; month_start date; inserted_id uuid; created_count integer:=0;
begin
  if not private.can_manage_properties(target_family_id) then raise exception 'property access requires an active adult family member'; end if;
  if range_end<range_start or range_end-range_start>400 then raise exception 'charge generation range must be between 0 and 400 days'; end if;
  for d in select * from public.property_charge_definitions x where x.family_id=target_family_id and x.active and x.auto_generate order by x.id loop
    if d.recurrence_type='one_time' then
      candidate:=d.start_date;
      if candidate>=greatest(d.start_date,d.generation_resume_date) and candidate between range_start and range_end then
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
        if candidate is not null and candidate>=greatest(d.start_date,d.generation_resume_date) and candidate between range_start and range_end then
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
          if candidate>=greatest(d.start_date,d.generation_resume_date) and candidate between range_start and range_end then
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

revoke all on function public.create_property_charge_definition(uuid,uuid,uuid,text,text,text,numeric,text,text,date,integer,integer,integer,jsonb,integer[],boolean,text)
from public, anon;
grant execute on function public.create_property_charge_definition(uuid,uuid,uuid,text,text,text,numeric,text,text,date,integer,integer,integer,jsonb,integer[],boolean,text)
to authenticated;

revoke all on function public.ensure_property_charges(uuid,date,date) from public, anon;
grant execute on function public.ensure_property_charges(uuid,date,date) to authenticated;

revoke update on table public.property_charge_definitions from authenticated;

revoke all on function public.update_property_charge_definition(uuid,uuid,text,text,text,numeric,text)
from public, anon, authenticated;
grant execute on function public.update_property_charge_definition(uuid,uuid,text,text,text,numeric,text)
to authenticated;

revoke all on function public.set_property_charge_definition_active(uuid,uuid,boolean)
from public, anon, authenticated;
grant execute on function public.set_property_charge_definition_active(uuid,uuid,boolean)
to authenticated;

notify pgrst, 'reload schema';
