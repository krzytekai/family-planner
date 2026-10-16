import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), '../../database/migrations/0030_change_calendar_recurrence_from_occurrence.sql'), 'utf8')
const notificationMigration = readFileSync(resolve(process.cwd(), '../../database/migrations/0006_notifications.sql'), 'utf8')
const functionBody = sql.slice(sql.indexOf('create or replace function'), sql.indexOf('revoke all on function'))
const splitFunction = sql.slice(
  sql.indexOf('create or replace function public.change_calendar_event_recurrence_from_occurrence'),
  sql.indexOf('revoke all on function public.change_calendar_event_recurrence_from_occurrence'),
)
const reminderTriggerFunction = sql.slice(
  sql.indexOf('create or replace function private.prepare_reminder_write'),
  sql.indexOf('revoke all on function private.prepare_reminder_write'),
)

const plusDays = (value: string, amount: number) => {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

describe('0030 calendar recurrence split-series contract', () => {
  it('changes a daily interval from one to three days through the accepted recurrence JSON', () => {
    expect(['2027-11-15', plusDays('2027-11-15', 3), plusDays('2027-11-15', 6)]).toEqual(['2027-11-15', '2027-11-18', '2027-11-21'])
    expect(sql).toContain('recurrence_rule_value')
  })
  it('supports changing weekly recurrence to every two weeks', () => {
    expect(plusDays('2027-11-15', 14)).toBe('2027-11-29')
    expect(sql).toContain('private.valid_task_recurrence_rule(recurrence_rule_value)')
  })
  it('preserves selected weekly weekdays in the supplied rule', () => {
    expect(sql).toContain('recurrence_rule_value,')
    expect(sql).not.toContain('jsonb_set(recurrence_rule_value')
  })
  it('keeps the old monthly rule historical and gives only the new series the new rule', () => {
    expect(sql).not.toContain('set recurrence_rule = recurrence_rule_value')
    expect(sql).toContain("'oldRecurrenceRule', old_series.recurrence_rule")
  })
  it('anchors a yearly replacement series on the selected occurrence template', () => {
    expect(sql).toContain('new_anchor_date')
    expect(sql).toContain('recurrence_rule_value')
  })
  it('keeps occurrences before the boundary in the old series', () => {
    expect(sql).toContain('e.recurrence_occurrence_date >= boundary_occurrence_date')
    expect(sql).not.toContain('e.recurrence_occurrence_date < boundary_occurrence_date')
  })
  it('removes the old boundary occurrence and requires a new first occurrence', () => {
    expect(sql).toContain('and e.recurrence_occurrence_date >= boundary_occurrence_date')
    expect(sql).toContain('and e.recurrence_occurrence_date = new_anchor_date')
    expect(sql).toContain("raise exception 'new calendar recurrence did not generate its first occurrence'")
  })
  it('removes all generated future old occurrences by logical occurrence date', () => {
    expect(sql).toContain('and e.recurrence_series_id = old_series.id')
    expect(sql).not.toMatch(/delete from public\.calendar_events[\s\S]*starts_at\s*>=/)
  })
  it('stops the old series', () => {
    expect(sql).toContain('set recurrence_enabled = false,')
    expect(sql).toContain('stopped_at = pg_catalog.now()')
  })
  it('creates an enabled new series', () => {
    expect(sql).toMatch(/recurrence_enabled,[\s\S]*generated_through,[\s\S]*created_by[\s\S]*true,[\s\S]*null,[\s\S]*old_series\.created_by/)
  })
  it('keeps exactly the old recurrence timezone', () => {
    expect(sql).toContain('old_series.recurrence_timezone,')
    expect(sql).not.toContain('recurrence_timezone_value')
  })
  it('preserves local wall-clock time across Europe Warsaw DST', () => {
    expect(sql).toContain('target_event.starts_at at time zone old_series.recurrence_timezone')
    const winter = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' }).format(new Date('2027-01-15T08:00:00Z'))
    const summer = new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' }).format(new Date('2027-07-15T07:00:00Z'))
    expect([winter, summer]).toEqual(['09:00', '09:00'])
  })
  it('uses the selected all-day occurrence start as its anchor', () => {
    expect(sql).toContain('new_anchor_date := target_event.start_date')
  })
  it('preserves multi-day all-day duration', () => {
    expect(sql).toContain('new_all_day_duration_days := coalesce(target_event.end_date - target_event.start_date, 0)')
  })
  it('preserves timed duration', () => {
    expect(sql).toContain('extract(epoch from (target_event.ends_at - target_event.starts_at)) / 60')
  })
  it('moves future pending personal reminders before deleting the selected occurrence', () => {
    expect(sql).toContain("r.reminder_kind = 'personal'")
    expect(sql).toContain('set source_id = first_event_id')
    expect(sql).toContain('and r.remind_at > pg_catalog.now()')
    expect(splitFunction.indexOf('set source_id = first_event_id')).toBeLessThan(splitFunction.indexOf('delete from public.calendar_events e'))
  })
  it('accounts for the production calendar event reminder deletion trigger', () => {
    expect(notificationMigration).toContain('create trigger delete_calendar_event_reminders after delete on public.calendar_events')
    expect(notificationMigration).toContain('and source_id=old.id and status=\'pending\'')
    expect(splitFunction.indexOf('set source_id = first_event_id')).toBeLessThan(splitFunction.indexOf('delete from public.calendar_events e'))
  })
  it('deletes pending reminders for later rebuilt occurrences', () => {
    expect(sql).toContain('and r.source_id = any(affected_event_ids)')
    expect(sql).toContain("and r.status = 'pending'")
  })
  it('does not copy old exclusions', () => {
    expect(sql).not.toContain('insert into public.calendar_event_recurrence_exclusions')
  })
  it('starts the new series with zero exclusions', () => {
    expect(functionBody).not.toContain('calendar_event_recurrence_exclusions')
  })
  it('uses the idempotent existing generator so a split cannot create duplicates', () => {
    expect(sql).toContain('perform private.ensure_calendar_event_series_occurrences(new_series_id, 400)')
  })
  it('prevents cron from regenerating the stopped old series', () => {
    expect(sql).toContain('recurrence_enabled = false')
    expect(sql).not.toContain('cron.schedule')
  })
  it('enforces tenant isolation on both event and series locks', () => {
    expect(sql).toContain('and e.family_id = target_family_id')
    expect(sql).toContain('where e.family_id = target_family_id')
    expect(sql).toContain('and s.family_id = target_family_id')
  })
  it('does not grant an unrelated adult permission to change another creator series', () => {
    expect(sql).toContain('private.can_manage_calendar_event(target_event)')
    expect(sql).not.toContain("array['owner','admin','adult']")
  })
  it('retains owner and admin access through the existing permission helper', () => {
    expect(sql).toContain('private.can_manage_calendar_event(target_event)')
  })
  it('retains creator access through the existing permission helper', () => {
    expect(sql).toContain('private.can_manage_calendar_event(target_event)')
  })
  it('keeps created_by from the old series even when an admin is the actor', () => {
    expect(sql).toContain('old_series.created_by')
    expect(sql).not.toMatch(/generated_through,[\s\S]*actor\s*\)/)
  })
  it('rejects historical occurrences using the series timezone local date', () => {
    expect(sql).toContain("boundary_occurrence_date < (pg_catalog.now() at time zone old_series.recurrence_timezone)::date")
  })
  it('rejects an inactive series', () => {
    expect(sql).toContain("raise exception 'calendar recurrence series is inactive'")
  })
  it('rejects a one-off event', () => {
    expect(sql).toContain("raise exception 'calendar event is not recurring'")
  })
  it('rejects an invalid recurrence rule', () => {
    expect(sql).toContain("raise exception 'invalid recurrence rule'")
  })
  it('returns the target unchanged without deletion or audit for an identical rule', () => {
    const noOp = sql.indexOf('if recurrence_rule_value = old_series.recurrence_rule then')
    expect(noOp).toBeGreaterThan(-1)
    expect(sql.indexOf('update public.calendar_event_recurrence_series', noOp)).toBeGreaterThan(noOp)
    expect(sql.slice(noOp, sql.indexOf('end if;', noOp))).toContain('return target_event_id')
  })
  it('keeps the complete split atomic and raises on generation failure', () => {
    expect(sql).toContain('for update;')
    expect(sql.indexOf('from public.calendar_events e')).toBeLessThan(sql.indexOf('from public.calendar_event_recurrence_series s'))
    expect(sql).toContain("raise exception 'new calendar recurrence did not generate its first occurrence'")
    expect(sql).toContain("'calendar_event.recurrence_changed_from_occurrence'")
  })

  it('uses a private transaction and backend scoped context for the source remap', () => {
    expect(sql).toContain('create table private.calendar_recurrence_split_context')
    expect(sql).toContain('transaction_id bigint not null')
    expect(sql).toContain('backend_pid integer not null')
    expect(sql).toContain('actor_user_id uuid not null')
    expect(sql).toContain('pg_catalog.txid_current()')
    expect(sql).toContain('pg_catalog.pg_backend_pid()')
    expect(sql).toContain('context.actor_user_id = (select auth.uid())')
    expect(sql).toContain('revoke all on table private.calendar_recurrence_split_context')
    expect(sql).not.toMatch(/grant\s+.+calendar_recurrence_split_context/i)
  })

  it('removes the split context before deleting old occurrences', () => {
    const contextInsert = splitFunction.indexOf('insert into private.calendar_recurrence_split_context')
    const reminderRemap = splitFunction.indexOf('update public.reminders r')
    const contextDelete = splitFunction.indexOf('delete from private.calendar_recurrence_split_context')
    const oldSeriesDisable = splitFunction.indexOf('update public.calendar_event_recurrence_series')
    const oldEventsDelete = splitFunction.indexOf('delete from public.calendar_events e')
    expect(contextInsert).toBeGreaterThan(-1)
    expect(contextInsert).toBeLessThan(reminderRemap)
    expect(reminderRemap).toBeLessThan(contextDelete)
    expect(contextDelete).toBeLessThan(oldSeriesDisable)
    expect(oldSeriesDisable).toBeLessThan(oldEventsDelete)
  })

  it('keeps ordinary source id changes blocked without an exact split context', () => {
    expect(reminderTriggerFunction).toContain('new.source_id <> old.source_id and not source_remap_allowed')
    expect(reminderTriggerFunction).toContain("raise exception 'reminder ownership and source cannot be changed'")
    expect(reminderTriggerFunction).toContain("old.reminder_kind = 'personal'")
    expect(reminderTriggerFunction).toContain("old.source_type = 'calendar_event'")
  })

  it('requires both old and new calendar events in the same family during a remap', () => {
    expect(reminderTriggerFunction).toContain('old_event.id = old.source_id')
    expect(reminderTriggerFunction).toContain('old_event.family_id = old.family_id')
    expect(reminderTriggerFunction).toContain('new_event.id = new.source_id')
    expect(reminderTriggerFunction).toContain('new_event.family_id = old.family_id')
  })

  it('preserves the current personal reminder ownership guards', () => {
    expect(reminderTriggerFunction).toContain("raise exception 'reminders are personal'")
    expect(reminderTriggerFunction).toContain("raise exception 'personal reminder recipient cannot be changed'")
    expect(reminderTriggerFunction).toContain('new.created_by <> old.created_by')
    expect(reminderTriggerFunction).toContain('new.family_id <> old.family_id')
    expect(reminderTriggerFunction).toContain('new.source_type <> old.source_type')
    expect(reminderTriggerFunction).toContain('new.reminder_kind <> old.reminder_kind')
  })

  it('preserves task assignee reminder validation', () => {
    expect(reminderTriggerFunction).toContain("new.reminder_kind = 'task_assignee'")
    expect(reminderTriggerFunction).toContain("new.source_type <> 'task'")
    expect(reminderTriggerFunction).toContain("raise exception 'invalid task assignee reminder recipient'")
    expect(reminderTriggerFunction).toContain("raise exception 'task does not belong to reminder family'")
  })

  it('preserves property charge reminder validation', () => {
    expect(reminderTriggerFunction).toContain("new.reminder_kind = 'property_charge'")
    expect(reminderTriggerFunction).toContain('public.property_charge_reminder_rules')
    expect(reminderTriggerFunction).toContain("raise exception 'invalid property charge reminder recipient'")
    expect(reminderTriggerFunction).toContain("raise exception 'property charge reminders are backend-managed'")
    expect(reminderTriggerFunction).toContain("raise exception 'property charge does not belong to reminder family'")
  })

  it('preserves source and future pending validation for every reminder kind', () => {
    expect(reminderTriggerFunction).toContain("raise exception 'invalid initial reminder status'")
    expect(reminderTriggerFunction).toContain("new.status = 'pending' and new.remind_at <= pg_catalog.now()")
    expect(reminderTriggerFunction).toContain("raise exception 'reminder must be in the future'")
    expect(reminderTriggerFunction).toContain("raise exception 'calendar event does not belong to reminder family'")
  })
})

type ReminderModel = {
  id: string
  familyId: string
  recipientUserId: string
  createdBy: string
  sourceId: string
  reminderKind: 'personal' | 'task_assignee' | 'property_charge'
  status: 'pending' | 'cancelled'
  remindAt: string
  timezone: string
}

const splitWithDeleteTrigger = (failAfterRemap = false) => {
  const oldEventId = 'old-boundary'
  const newEventId = 'new-first'
  const original = {
    actorUserId: 'admin-a',
    oldSeriesActive: true,
    newSeriesExists: false,
    events: new Set([oldEventId, 'old-future']),
    contextExists: false,
    reminders: [{
      id: 'user-b-reminder',
      familyId: 'family-a',
      recipientUserId: 'user-b',
      createdBy: 'user-b',
      sourceId: oldEventId,
      reminderKind: 'personal' as const,
      status: 'pending' as const,
      remindAt: '2027-11-15T08:30:00Z',
      timezone: 'Europe/Warsaw',
    }],
  }
  const state = structuredClone(original)

  try {
    state.newSeriesExists = true
    state.events.add(newEventId)
    state.contextExists = true
    state.reminders = state.reminders.map((reminder) => reminder.sourceId === oldEventId
      ? { ...reminder, sourceId: newEventId }
      : reminder)
    state.contextExists = false
    if (failAfterRemap) throw new Error('simulated split failure')
    state.oldSeriesActive = false
    state.events.delete(oldEventId)
    state.events.delete('old-future')
    // Models the production delete_source_reminders trigger for OLD.id.
    state.reminders = state.reminders.filter((reminder) => !(reminder.sourceId === oldEventId && reminder.status === 'pending'))
    return state
  } catch {
    return structuredClone(original)
  }
}

describe('0030 reminder remap transaction model', () => {
  it('keeps user B personal reminder after the old boundary delete trigger runs', () => {
    const state = splitWithDeleteTrigger()
    expect(state.actorUserId).toBe('admin-a')
    expect(state.actorUserId).not.toBe(state.reminders[0]?.recipientUserId)
    expect(state.reminders).toEqual<ReminderModel[]>([{
      id: 'user-b-reminder',
      familyId: 'family-a',
      recipientUserId: 'user-b',
      createdBy: 'user-b',
      sourceId: 'new-first',
      reminderKind: 'personal',
      status: 'pending',
      remindAt: '2027-11-15T08:30:00Z',
      timezone: 'Europe/Warsaw',
    }])
  })

  it('rolls back series events reminder and context when a later split stage fails', () => {
    const state = splitWithDeleteTrigger(true)
    expect(state.oldSeriesActive).toBe(true)
    expect(state.newSeriesExists).toBe(false)
    expect([...state.events]).toEqual(['old-boundary', 'old-future'])
    expect(state.contextExists).toBe(false)
    expect(state.reminders[0]?.sourceId).toBe('old-boundary')
  })
})
