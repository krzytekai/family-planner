-- Sprint 2: family tasks, tenant-safe RLS and database-level audit events.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists public.tasks (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  title text not null check (pg_catalog.char_length(title) between 1 and 200),
  description text,
  status text not null default 'todo'
    constraint tasks_status_check check (status in ('todo', 'in_progress', 'done')),
  priority text not null default 'normal'
    constraint tasks_priority_check check (priority in ('low', 'normal', 'high')),
  assigned_to uuid
    constraint tasks_assigned_to_fkey references public.profiles(id) on delete set null,
  due_at timestamptz,
  created_by uuid not null default auth.uid()
    constraint tasks_created_by_fkey references public.profiles(id),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  completed_at timestamptz,
  constraint tasks_completion_check check (
    (status = 'done' and completed_at is not null)
    or (status <> 'done' and completed_at is null)
  )
);

create index if not exists tasks_family_id_idx on public.tasks(family_id);
create index if not exists tasks_status_idx on public.tasks(status);
create index if not exists tasks_assigned_to_idx on public.tasks(assigned_to) where assigned_to is not null;
create index if not exists tasks_due_at_idx on public.tasks(due_at) where due_at is not null;
create index if not exists tasks_family_status_due_idx on public.tasks(family_id, status, due_at);

create or replace function private.prepare_task_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.family_id <> old.family_id then
      raise exception 'task family cannot be changed';
    end if;
    if new.created_by <> old.created_by then
      raise exception 'task creator cannot be changed';
    end if;
  end if;

  new.title := pg_catalog.btrim(new.title);
  new.description := nullif(pg_catalog.btrim(new.description), '');
  new.updated_at := pg_catalog.now();

  if new.status = 'done' then
    if tg_op = 'INSERT' then
      new.completed_at := pg_catalog.now();
    elsif old.status <> 'done' then
      new.completed_at := pg_catalog.now();
    else
      new.completed_at := old.completed_at;
    end if;
  else
    new.completed_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.prepare_task_write() from public, anon, authenticated;

drop trigger if exists prepare_task_write on public.tasks;
create trigger prepare_task_write
before insert or update on public.tasks
for each row execute function private.prepare_task_write();

create or replace function private.audit_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
  audit_family_id uuid;
  audit_task_id uuid;
  audit_actor_id uuid;
  audit_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    audit_action := 'task.created';
    audit_family_id := new.family_id;
    audit_task_id := new.id;
    audit_actor_id := (select auth.uid());
    audit_metadata := pg_catalog.jsonb_build_object(
      'status', new.status,
      'priority', new.priority,
      'assigned_to', new.assigned_to,
      'due_at', new.due_at
    );
  elsif tg_op = 'UPDATE' then
    audit_action := case
      when old.status <> 'done' and new.status = 'done' then 'task.completed'
      else 'task.updated'
    end;
    audit_family_id := new.family_id;
    audit_task_id := new.id;
    audit_actor_id := (select auth.uid());
    audit_metadata := pg_catalog.jsonb_build_object(
      'old_status', old.status,
      'new_status', new.status,
      'old_priority', old.priority,
      'new_priority', new.priority,
      'assigned_to', new.assigned_to,
      'due_at', new.due_at
    );
  else
    audit_action := 'task.deleted';
    audit_family_id := old.family_id;
    audit_task_id := old.id;
    audit_actor_id := (select auth.uid());
    audit_metadata := pg_catalog.jsonb_build_object(
      'status', old.status,
      'priority', old.priority,
      'assigned_to', old.assigned_to,
      'due_at', old.due_at
    );
  end if;

  insert into public.audit_logs (
    family_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) values (
    audit_family_id,
    audit_actor_id,
    audit_action,
    'task',
    audit_task_id::text,
    audit_metadata
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.audit_task_change() from public, anon, authenticated;

drop trigger if exists audit_task_change on public.tasks;
create trigger audit_task_change
after insert or update or delete on public.tasks
for each row execute function private.audit_task_change();

alter table public.tasks enable row level security;

revoke all on public.tasks from anon, authenticated;
grant select on public.tasks to authenticated;
grant insert (family_id, title, description, status, priority, assigned_to, due_at)
  on public.tasks to authenticated;
grant update (title, description, status, priority, assigned_to, due_at)
  on public.tasks to authenticated;
grant delete on public.tasks to authenticated;

drop policy if exists tasks_select_family_member on public.tasks;
create policy tasks_select_family_member on public.tasks for select to authenticated
using ((select public.is_family_member(family_id)));

drop policy if exists tasks_insert_adult on public.tasks;
create policy tasks_insert_adult on public.tasks for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select public.has_family_role(
    family_id,
    array['owner', 'admin', 'adult']::public.family_role[]
  ))
  and (
    assigned_to is null
    or exists (
      select 1
      from public.family_members as assignee
      where assignee.family_id = tasks.family_id
        and assignee.user_id = tasks.assigned_to
        and assignee.status = 'active'
    )
  )
);

drop policy if exists tasks_update_authorized on public.tasks;
create policy tasks_update_authorized on public.tasks for update to authenticated
using (
  (select public.is_family_member(family_id))
  and (
    (select public.has_family_role(
      family_id,
      array['owner', 'admin']::public.family_role[]
    ))
    or created_by = (select auth.uid())
    or assigned_to = (select auth.uid())
  )
)
with check (
  (select public.is_family_member(family_id))
  and (
    assigned_to is null
    or exists (
      select 1
      from public.family_members as assignee
      where assignee.family_id = tasks.family_id
        and assignee.user_id = tasks.assigned_to
        and assignee.status = 'active'
    )
  )
);

drop policy if exists tasks_delete_authorized on public.tasks;
create policy tasks_delete_authorized on public.tasks for delete to authenticated
using (
  (select public.is_family_member(family_id))
  and (
    (select public.has_family_role(
      family_id,
      array['owner', 'admin']::public.family_role[]
    ))
    or created_by = (select auth.uid())
  )
);

notify pgrst, 'reload schema';
