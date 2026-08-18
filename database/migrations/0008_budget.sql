-- Sprint Budget: family finances and shared-expense settlements.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.budget_transactions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('expense', 'income')),
  title text not null check (pg_catalog.char_length(title) between 1 and 200),
  description text,
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'PLN' check (pg_catalog.char_length(currency) = 3),
  category text check (category is null or pg_catalog.char_length(category) <= 80),
  transaction_date date not null default current_date,
  paid_by uuid constraint budget_transactions_paid_by_fkey references public.profiles(id),
  is_shared boolean not null default false,
  created_by uuid not null default auth.uid()
    constraint budget_transactions_created_by_fkey references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint budget_transactions_id_family_unique unique (id, family_id),
  constraint budget_transactions_shape_check check (
    (transaction_type = 'expense' and paid_by is not null)
    or (transaction_type = 'income' and paid_by is null and is_shared = false)
  )
);

create table if not exists public.budget_settlement_members (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null constraint budget_settlement_members_user_id_fkey references public.profiles(id) on delete cascade,
  is_active boolean not null default true,
  created_by uuid not null default auth.uid()
    constraint budget_settlement_members_created_by_fkey references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  primary key (family_id, user_id)
);

create table if not exists public.budget_expense_participants (
  transaction_id uuid not null,
  family_id uuid not null,
  user_id uuid not null constraint budget_expense_participants_user_id_fkey references public.profiles(id),
  share_weight numeric(12,4) not null default 1 check (share_weight > 0),
  created_at timestamptz not null default pg_catalog.now(),
  primary key (transaction_id, user_id),
  constraint budget_expense_participants_transaction_family_fkey
    foreign key (transaction_id, family_id)
    references public.budget_transactions(id, family_id)
    on delete cascade
);

create table if not exists public.budget_settlements (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  from_user_id uuid not null constraint budget_settlements_from_user_id_fkey references public.profiles(id),
  to_user_id uuid not null constraint budget_settlements_to_user_id_fkey references public.profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'PLN' check (pg_catalog.char_length(currency) = 3),
  settlement_date date not null default current_date,
  note text,
  created_by uuid not null default auth.uid()
    constraint budget_settlements_created_by_fkey references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint budget_settlements_different_users_check check (from_user_id <> to_user_id)
);

create table if not exists public.budget_plans (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  month date not null check (month = pg_catalog.date_trunc('month', month::timestamp)::date),
  plan_type text not null check (plan_type in ('expense_limit', 'income_target')),
  category text check (category is null or pg_catalog.char_length(category) <= 80),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'PLN' check (pg_catalog.char_length(currency) = 3),
  created_by uuid not null default auth.uid()
    constraint budget_plans_created_by_fkey references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint budget_plans_family_month_type_category_unique unique nulls not distinct
    (family_id, month, plan_type, category)
);

create index if not exists budget_transactions_family_idx on public.budget_transactions(family_id);
create index if not exists budget_transactions_family_date_idx on public.budget_transactions(family_id, transaction_date desc);
create index if not exists budget_transactions_family_type_date_idx on public.budget_transactions(family_id, transaction_type, transaction_date desc);
create index if not exists budget_transactions_paid_by_idx on public.budget_transactions(paid_by) where paid_by is not null;
create index if not exists budget_transactions_shared_idx on public.budget_transactions(family_id, transaction_date) where is_shared;
create index if not exists budget_expense_participants_user_idx on public.budget_expense_participants(user_id);
create index if not exists budget_settlements_family_date_idx on public.budget_settlements(family_id, settlement_date desc);
create index if not exists budget_settlements_from_idx on public.budget_settlements(from_user_id);
create index if not exists budget_settlements_to_idx on public.budget_settlements(to_user_id);
create index if not exists budget_plans_family_month_idx on public.budget_plans(family_id, month);

create or replace function private.prepare_budget_transaction_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.family_id <> old.family_id or new.created_by <> old.created_by) then
    raise exception 'budget transaction ownership cannot be changed';
  end if;
  new.title := pg_catalog.btrim(new.title);
  new.description := nullif(pg_catalog.btrim(new.description), '');
  new.category := nullif(pg_catalog.btrim(new.category), '');
  new.currency := pg_catalog.upper(pg_catalog.btrim(new.currency));
  new.updated_at := pg_catalog.now();
  if new.transaction_type = 'income' then new.paid_by := null; new.is_shared := false; end if;
  if new.transaction_type = 'expense' and not exists (
    select 1 from public.family_members fm
    where fm.family_id = new.family_id and fm.user_id = new.paid_by and fm.status = 'active'
      and fm.role = any(array['owner','admin','adult']::public.family_role[])
  ) then raise exception 'payer must be an active adult member of the transaction family'; end if;
  return new;
end; $$;
revoke all on function private.prepare_budget_transaction_write() from public, anon, authenticated;
drop trigger if exists prepare_budget_transaction_write on public.budget_transactions;
create trigger prepare_budget_transaction_write before insert or update on public.budget_transactions
for each row execute function private.prepare_budget_transaction_write();

create or replace function private.sync_budget_expense_participants()
returns trigger language plpgsql security definer set search_path = '' as $$
declare participant_count integer;
begin
  if new.is_shared = false then
    if tg_op = 'UPDATE' and old.is_shared = true then
      delete from public.budget_expense_participants p where p.transaction_id = new.id;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' or old.is_shared = false then
    select pg_catalog.count(*) into participant_count
    from public.budget_settlement_members m
    join public.family_members fm on fm.family_id=m.family_id and fm.user_id=m.user_id
    where m.family_id=new.family_id and m.is_active and fm.status='active'
      and fm.role=any(array['owner','admin','adult']::public.family_role[]);
    if participant_count < 2 then raise exception 'shared expense requires at least two active settlement members'; end if;
    insert into public.budget_expense_participants(transaction_id,family_id,user_id)
    select new.id,new.family_id,m.user_id
    from public.budget_settlement_members m
    join public.family_members fm on fm.family_id=m.family_id and fm.user_id=m.user_id
    where m.family_id=new.family_id and m.is_active and fm.status='active'
      and fm.role=any(array['owner','admin','adult']::public.family_role[])
    order by m.user_id;
  end if;
  if not exists (
    select 1 from public.budget_expense_participants p
    where p.transaction_id=new.id and p.family_id=new.family_id and p.user_id=new.paid_by
  ) then raise exception 'payer must be a participant of the shared expense'; end if;
  return new;
end; $$;
revoke all on function private.sync_budget_expense_participants() from public, anon, authenticated;
drop trigger if exists sync_budget_expense_participants on public.budget_transactions;
create trigger sync_budget_expense_participants after insert or update of transaction_type,is_shared,paid_by on public.budget_transactions
for each row execute function private.sync_budget_expense_participants();

create or replace function private.prepare_budget_settlement_member_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op='UPDATE' and (new.family_id<>old.family_id or new.user_id<>old.user_id or new.created_by<>old.created_by) then
    raise exception 'settlement member ownership cannot be changed';
  end if;
  if not exists (select 1 from public.family_members fm where fm.family_id=new.family_id and fm.user_id=new.user_id
    and fm.status='active' and fm.role=any(array['owner','admin','adult']::public.family_role[])) then
    raise exception 'settlement member must be an active adult family member';
  end if;
  new.updated_at:=pg_catalog.now(); return new;
end; $$;
revoke all on function private.prepare_budget_settlement_member_write() from public, anon, authenticated;
drop trigger if exists prepare_budget_settlement_member_write on public.budget_settlement_members;
create trigger prepare_budget_settlement_member_write before insert or update on public.budget_settlement_members
for each row execute function private.prepare_budget_settlement_member_write();

create or replace function private.prepare_budget_settlement_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op='UPDATE' and (new.family_id<>old.family_id or new.created_by<>old.created_by) then raise exception 'settlement ownership cannot be changed'; end if;
  if tg_op='UPDATE'
    and not (select public.has_family_role(old.family_id,array['owner','admin']::public.family_role[]))
    and (new.from_user_id<>(select auth.uid()) and new.to_user_id<>(select auth.uid())) then
    raise exception 'adult may only edit a settlement they are party to';
  end if;
  if new.from_user_id=new.to_user_id then raise exception 'settlement parties must differ'; end if;
  if not exists (select 1 from public.family_members fm where fm.family_id=new.family_id and fm.user_id=new.from_user_id and fm.status='active' and fm.role=any(array['owner','admin','adult']::public.family_role[]))
    or not exists (select 1 from public.family_members fm where fm.family_id=new.family_id and fm.user_id=new.to_user_id and fm.status='active' and fm.role=any(array['owner','admin','adult']::public.family_role[])) then
    raise exception 'settlement parties must be active adult members of the same family';
  end if;
  new.note:=nullif(pg_catalog.btrim(new.note),''); new.currency:=pg_catalog.upper(pg_catalog.btrim(new.currency)); new.updated_at:=pg_catalog.now(); return new;
end; $$;
revoke all on function private.prepare_budget_settlement_write() from public, anon, authenticated;
drop trigger if exists prepare_budget_settlement_write on public.budget_settlements;
create trigger prepare_budget_settlement_write before insert or update on public.budget_settlements
for each row execute function private.prepare_budget_settlement_write();

create or replace function private.prepare_budget_plan_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op='UPDATE' and (new.family_id<>old.family_id or new.created_by<>old.created_by) then raise exception 'budget plan ownership cannot be changed'; end if;
  new.category:=nullif(pg_catalog.btrim(new.category),''); new.currency:=pg_catalog.upper(pg_catalog.btrim(new.currency)); new.updated_at:=pg_catalog.now(); return new;
end; $$;
revoke all on function private.prepare_budget_plan_write() from public, anon, authenticated;
drop trigger if exists prepare_budget_plan_write on public.budget_plans;
create trigger prepare_budget_plan_write before insert or update on public.budget_plans
for each row execute function private.prepare_budget_plan_write();

create or replace function private.audit_budget_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare row_data record; action_name text; entity_name text; entity_id_value text; metadata_value jsonb;
begin
  if tg_op='DELETE' then row_data:=old; else row_data:=new; end if;
  if tg_table_name='budget_transactions' then
    entity_name:='budget_transaction'; action_name:='budget.transaction.'||pg_catalog.lower(tg_op); entity_id_value:=row_data.id::text;
    metadata_value:=pg_catalog.jsonb_build_object('amount',row_data.amount,'category',row_data.category,'transaction_type',row_data.transaction_type,'paid_by',row_data.paid_by,'is_shared',row_data.is_shared);
  elsif tg_table_name='budget_settlements' then
    entity_name:='budget_settlement'; action_name:='budget.settlement.'||pg_catalog.lower(tg_op); entity_id_value:=row_data.id::text;
    metadata_value:=pg_catalog.jsonb_build_object('amount',row_data.amount,'from_user_id',row_data.from_user_id,'to_user_id',row_data.to_user_id);
  elsif tg_table_name='budget_plans' then
    entity_name:='budget_plan'; action_name:='budget.plan.'||pg_catalog.lower(tg_op); entity_id_value:=row_data.id::text;
    metadata_value:=pg_catalog.jsonb_build_object('month',row_data.month,'plan_type',row_data.plan_type,'category',row_data.category,'amount',row_data.amount);
  else
    entity_name:='budget_members'; action_name:='budget.members.'||pg_catalog.lower(tg_op); entity_id_value:=row_data.user_id::text; metadata_value:=pg_catalog.jsonb_build_object('user_id',row_data.user_id,'is_active',row_data.is_active);
  end if;
  action_name:=pg_catalog.replace(action_name,'insert','created'); action_name:=pg_catalog.replace(action_name,'update','updated'); action_name:=pg_catalog.replace(action_name,'delete','deleted');
  insert into public.audit_logs(family_id,actor_user_id,action,entity_type,entity_id,metadata)
  values(row_data.family_id,(select auth.uid()),action_name,entity_name,
    entity_id_value,metadata_value);
  if tg_op='DELETE' then return old; end if; return new;
end; $$;
revoke all on function private.audit_budget_change() from public, anon, authenticated;
drop trigger if exists audit_budget_transaction on public.budget_transactions;
create trigger audit_budget_transaction after insert or update or delete on public.budget_transactions for each row execute function private.audit_budget_change();
drop trigger if exists audit_budget_settlement on public.budget_settlements;
create trigger audit_budget_settlement after insert or update or delete on public.budget_settlements for each row execute function private.audit_budget_change();
drop trigger if exists audit_budget_plan on public.budget_plans;
create trigger audit_budget_plan after insert or update or delete on public.budget_plans for each row execute function private.audit_budget_change();
drop trigger if exists audit_budget_members on public.budget_settlement_members;
create trigger audit_budget_members after insert or update or delete on public.budget_settlement_members for each row execute function private.audit_budget_change();

alter table public.budget_transactions enable row level security;
alter table public.budget_settlement_members enable row level security;
alter table public.budget_expense_participants enable row level security;
alter table public.budget_settlements enable row level security;
alter table public.budget_plans enable row level security;

revoke all on public.budget_transactions,public.budget_settlement_members,public.budget_expense_participants,public.budget_settlements,public.budget_plans from anon,authenticated;
grant select on public.budget_transactions,public.budget_settlement_members,public.budget_expense_participants,public.budget_settlements,public.budget_plans to authenticated;
grant insert(family_id,transaction_type,title,description,amount,currency,category,transaction_date,paid_by,is_shared) on public.budget_transactions to authenticated;
grant update(transaction_type,title,description,amount,currency,category,transaction_date,paid_by,is_shared) on public.budget_transactions to authenticated;
grant delete on public.budget_transactions to authenticated;
grant insert(family_id,user_id,is_active) on public.budget_settlement_members to authenticated;
grant update(is_active) on public.budget_settlement_members to authenticated;
grant delete on public.budget_settlement_members to authenticated;
grant insert(family_id,from_user_id,to_user_id,amount,currency,settlement_date,note) on public.budget_settlements to authenticated;
grant update(from_user_id,to_user_id,amount,currency,settlement_date,note) on public.budget_settlements to authenticated;
grant delete on public.budget_settlements to authenticated;
grant insert(family_id,month,plan_type,category,amount,currency) on public.budget_plans to authenticated;
grant update(month,plan_type,category,amount,currency) on public.budget_plans to authenticated;
grant delete on public.budget_plans to authenticated;

drop policy if exists budget_transactions_select_adult on public.budget_transactions;
create policy budget_transactions_select_adult on public.budget_transactions for select to authenticated using ((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
drop policy if exists budget_transactions_insert_adult on public.budget_transactions;
create policy budget_transactions_insert_adult on public.budget_transactions for insert to authenticated with check (created_by=(select auth.uid()) and (select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
drop policy if exists budget_transactions_update_authorized on public.budget_transactions;
create policy budget_transactions_update_authorized on public.budget_transactions for update to authenticated using (created_by=(select auth.uid()) or (select public.has_family_role(family_id,array['owner','admin']::public.family_role[]))) with check ((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
drop policy if exists budget_transactions_delete_authorized on public.budget_transactions;
create policy budget_transactions_delete_authorized on public.budget_transactions for delete to authenticated using (created_by=(select auth.uid()) or (select public.has_family_role(family_id,array['owner','admin']::public.family_role[])));

drop policy if exists budget_members_select_adult on public.budget_settlement_members;
create policy budget_members_select_adult on public.budget_settlement_members for select to authenticated using ((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
drop policy if exists budget_members_manage_admin on public.budget_settlement_members;
create policy budget_members_manage_admin on public.budget_settlement_members for all to authenticated using ((select public.has_family_role(family_id,array['owner','admin']::public.family_role[]))) with check ((select public.has_family_role(family_id,array['owner','admin']::public.family_role[])));
drop policy if exists budget_participants_select_adult on public.budget_expense_participants;
create policy budget_participants_select_adult on public.budget_expense_participants for select to authenticated using ((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));

drop policy if exists budget_settlements_select_adult on public.budget_settlements;
create policy budget_settlements_select_adult on public.budget_settlements for select to authenticated using ((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
drop policy if exists budget_settlements_insert_authorized on public.budget_settlements;
create policy budget_settlements_insert_authorized on public.budget_settlements for insert to authenticated with check (created_by=(select auth.uid()) and ((select public.has_family_role(family_id,array['owner','admin']::public.family_role[])) or ((select public.has_family_role(family_id,array['adult']::public.family_role[])) and (from_user_id=(select auth.uid()) or to_user_id=(select auth.uid())))));
drop policy if exists budget_settlements_update_authorized on public.budget_settlements;
create policy budget_settlements_update_authorized on public.budget_settlements for update to authenticated using (created_by=(select auth.uid()) or (select public.has_family_role(family_id,array['owner','admin']::public.family_role[]))) with check ((select public.has_family_role(family_id,array['owner','admin']::public.family_role[])) or ((select public.has_family_role(family_id,array['adult']::public.family_role[])) and (from_user_id=(select auth.uid()) or to_user_id=(select auth.uid()))));
drop policy if exists budget_settlements_delete_authorized on public.budget_settlements;
create policy budget_settlements_delete_authorized on public.budget_settlements for delete to authenticated using (created_by=(select auth.uid()) or (select public.has_family_role(family_id,array['owner','admin']::public.family_role[])));

drop policy if exists budget_plans_select_adult on public.budget_plans;
create policy budget_plans_select_adult on public.budget_plans for select to authenticated using ((select public.has_family_role(family_id,array['owner','admin','adult']::public.family_role[])));
drop policy if exists budget_plans_manage_admin on public.budget_plans;
create policy budget_plans_manage_admin on public.budget_plans for all to authenticated using ((select public.has_family_role(family_id,array['owner','admin']::public.family_role[]))) with check ((select public.has_family_role(family_id,array['owner','admin']::public.family_role[])));

notify pgrst, 'reload schema';
