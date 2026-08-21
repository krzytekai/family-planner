import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), '../../database/migrations/0011_recurring_tasks.sql'), 'utf8')

describe('0011 recurring tasks database contract', () => {
  it('supports strict daily, weekly, monthly and yearly rules', () => {
    expect(sql).toContain("rule_type not in ('daily', 'weekly', 'monthly', 'yearly')")
    expect(sql).toContain("rule_type = 'weekly'")
    expect(sql).toContain("rule -> 'weekdays'")
    expect(sql).toContain("rule ->> 'day_of_month'")
    expect(sql).toContain("rule ->> 'month'")
    expect(sql).toContain('interval_value > 1000')
    expect(sql).toContain("(rule ->> 'interval') is null")
    expect(sql).toContain("rule_type is null")
    expect(sql.match(/return coalesce\(/g)?.length).toBe(3)
  })

  it('keeps a stable series, occurrence history and two unique idempotency guards', () => {
    expect(sql).toContain('create table public.task_recurrence_series')
    expect(sql).toContain('tasks_series_occurrence_unique')
    expect(sql).toContain('tasks_generated_from_unique')
    expect(sql).toContain('on conflict (generated_from_task_id)')
    expect(sql).toContain("if old.status = 'done' or new.status <> 'done'")
  })

  it('preserves the monthly anchor day and leap-year calendar semantics', () => {
    expect(sql).toContain("target_day := (recurrence_rule ->> 'day_of_month')::integer")
    expect(sql).toContain('least(target_day, last_day)')
    expect(sql).toContain('series.anchor_due_at')
    expect(sql).toContain('pg_catalog.make_date')
  })

  it('calculates calendar recurrences in the named timezone instead of adding hours', () => {
    expect(sql).toContain('previous_due_at at time zone recurrence_timezone')
    expect(sql).toContain('at time zone recurrence_timezone')
    expect(sql).toContain('pg_catalog.pg_timezone_names')
    expect(sql).not.toMatch(/previous_due_at\s*\+\s*interval\s+'(?:24|168) hours'/)
  })

  it('locks the series and generates exactly one next task', () => {
    expect(sql).toMatch(/task_recurrence_series s[\s\S]*for update/)
    expect(sql).toContain('new.occurrence_index + 1')
    expect(sql).toContain("new.status <> 'done'")
    expect(sql).toContain("if found and series.recurrence_enabled")
  })

  it('keeps assignee reminders backend-owned and recipient-derived from the task', () => {
    expect(sql).toContain('public.set_task_assignee_reminder')
    expect(sql).toContain('target_task.assigned_to')
    expect(sql).toContain('invalid task assignee')
    expect(sql).toContain('assignee_reminder_offset_minutes')
    expect(sql).toContain('revoke insert(assignee_reminder_offset_minutes) on public.reminders from authenticated')
    expect(sql).not.toMatch(/set_task_assignee_reminder\([^)]*recipient/i)
  })

  it('does not let assignment alone grant assignee-reminder management', () => {
    const helper = sql.slice(sql.indexOf('private.can_manage_task_assignee_reminder'), sql.indexOf('create or replace function public.set_task_assignee_reminder'))
    expect(helper).toContain("array['owner','admin']")
    expect(helper).toContain('target_task.created_by = (select auth.uid())')
    expect(helper).not.toContain('target_task.assigned_to = (select auth.uid())')
  })

  it('separates legacy personal reminders from backend-owned assignee reminders', () => {
    expect(sql).toContain("add column reminder_kind text not null default 'personal'")
    expect(sql).toContain("reminder_kind in ('personal', 'task_assignee')")
    expect(sql).toContain('reminders_one_pending_source_kind_unique')
    expect(sql).toContain('recipient_user_id, source_type, source_id, reminder_kind')
    expect(sql).toContain("reminder_kind = 'personal' and recipient_user_id = (select auth.uid())")
    expect(sql).toContain("'task_assignee', offset_minutes")
    expect(sql).toMatch(/reminder_kind = 'task_assignee'[\s\S]*assignee_reminder_offset_minutes is not null[\s\S]*assignee_reminder_offset_minutes between 1 and 525600/)
  })

  it('moves or cancels pending reminders after task assignment and due-date changes', () => {
    expect(sql).toContain('after update of assigned_to, due_at, title')
    expect(sql).toContain('new.assigned_to is distinct from old.assigned_to')
    expect(sql).toContain('new.due_at is distinct from old.due_at')
    expect(sql).toContain("set recipient_user_id = new.assigned_to, remind_at = next_time")
    expect(sql).toContain("set status = 'cancelled'")
    expect(sql).toContain("r.reminder_kind = 'task_assignee'")
  })

  it('keeps completion generation and old-reminder cancellation in one trigger', () => {
    const completion = sql.slice(sql.indexOf('create or replace function private.generate_next_recurring_task'), sql.indexOf('alter table public.task_recurrence_series enable row level security'))
    expect(completion).toContain("new.status <> 'done'")
    expect(completion).toContain("reminder_kind = 'task_assignee' and status = 'pending'")
    expect(completion).toContain("'task_assignee',\n              new.assignee_reminder_offset_minutes")
    expect(sql).not.toContain('after update of assigned_to, due_at, status, title')
  })

  it('creates task-assigned notifications for every generated occurrence', () => {
    expect(sql).toContain('new.generated_from_task_id is not null')
    expect(sql).toContain("private.notification_type_enabled(new.family_id, new.assigned_to, 'task_assigned')")
    expect(sql).toContain("'task-assigned:' || new.id::text")
  })

  it('moves and cancels only task-assignee reminders, leaving personal reminders intact', () => {
    expect(sql.match(/reminder_kind = 'task_assignee'/g)?.length).toBeGreaterThanOrEqual(8)
    expect(sql).toContain("reminder_kind = 'personal' and assignee_reminder_offset_minutes is null")
    expect(sql).toContain("reminder_kind = 'personal' and recipient_user_id = (select auth.uid())")
  })

  it('intentionally omits recurrence_until until a complete product path exists', () => {
    expect(sql).not.toContain('recurrence_until')
  })

  it('inherits logical reminder configuration without copying fired or cancelled rows', () => {
    expect(sql).toContain('new.assignee_reminder_offset_minutes')
    expect(sql).toContain('next_remind_at := next_due - pg_catalog.make_interval')
    const generator = sql.slice(sql.indexOf('create or replace function private.generate_next_recurring_task'))
    expect(generator).not.toMatch(/old_reminder|status in \('pending', 'fired'\)/)
  })

  it('keeps cross-family references and recurrence writes constrained', () => {
    expect(sql).toContain('tasks_recurrence_series_family_fkey')
    expect(sql).toContain('not authorized to create recurring tasks')
    expect(sql).toContain("fm.status = 'active'")
    expect(sql).toContain("set search_path = ''")
    expect(sql).toContain('revoke all on schema private from public, anon, authenticated')
  })

  it('emits the recurrence and assignee-reminder audit vocabulary', () => {
    for (const action of ['task.recurrence_started','task.recurrence_updated','task.recurrence_stopped','task.recurrence_occurrence_created','task.assignee_reminder_created','task.assignee_reminder_updated','task.assignee_reminder_cancelled']) {
      expect(sql).toContain(action)
    }
  })
})
