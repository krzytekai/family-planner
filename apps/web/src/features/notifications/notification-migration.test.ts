import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), '../../database/migrations/0006_notifications.sql'), 'utf8')

describe('0006 notification safety contract', () => {
  it('creates task assignment notifications in a database trigger', () => {
    expect(sql).toContain('create trigger notify_task_assignment')
    expect(sql).toContain("new.assigned_to <> (select auth.uid())")
  })
  it('processes only due pending reminders with concurrent-safe locking', () => {
    expect(sql).toContain("r.status='pending' and r.remind_at<=pg_catalog.now()")
    expect(sql).toContain('for update skip locked')
  })
  it('separates event-type preferences from delivery-channel preferences', () => {
    expect(sql).toContain('private.notification_type_enabled')
    expect(sql).toContain('private.notification_in_app_enabled')
    expect(sql).toContain('private.notification_push_enabled')
    expect(sql).not.toContain('private.notification_channel_enabled')
  })
  it('deduplicates generated notifications', () => {
    expect(sql).toContain('notifications_recipient_dedupe_unique')
    expect(sql).toContain("'reminder:'||due.id::text")
    expect(sql).toContain('on conflict do nothing')
  })
  it('limits notification reads to the recipient and active family', () => {
    expect(sql).toMatch(/notifications_select_own[\s\S]*recipient_user_id=\(select auth\.uid\(\)\)[\s\S]*is_family_member\(family_id\)/)
  })
  it('does not allow reading another user notification', () => {
    expect(sql).not.toMatch(/notifications_select_own[\s\S]*for select[\s\S]*using\(true\)/)
  })
  it('keeps reminder creation personal and family-scoped', () => {
    expect(sql).toMatch(/reminders_insert_own[\s\S]*recipient_user_id=\(select auth\.uid\(\)\)[\s\S]*created_by=\(select auth\.uid\(\)\)[\s\S]*is_family_member\(family_id\)/)
    expect(sql).toContain('task does not belong to reminder family')
    expect(sql).toContain('calendar event does not belong to reminder family')
  })
  it('cancels due reminders when the recipient is no longer active', () => {
    expect(sql).toMatch(/family_members fm[\s\S]*fm\.status='active'/)
    expect(sql).toContain("status='cancelled',fired_at=null")
    expect(sql).toContain('continue;')
  })
})
