import { describe, expect, it } from 'vitest'
import { groupNotifications, isNotificationTypeEnabled, isReminderDue, notificationDestination, reminderForSource, reminderProcessingDecision, shouldNotifyAssignment, unreadNotificationCount } from './notification-utils'
import { defaultNotificationPreferences, type AppNotification, type Reminder } from './types'

const notification = (overrides: Partial<AppNotification> = {}): AppNotification => ({ id: 'n1', familyId: 'f1', recipientUserId: 'u1', type: 'system', title: 'T', body: null, sourceType: null, sourceId: null, readAt: null, createdAt: '2026-08-18T08:00:00Z', ...overrides })
const reminder = (overrides: Partial<Reminder> = {}): Reminder => ({ id: 'r1', familyId: 'f1', sourceType: 'task', sourceId: 't1', title: null, remindAt: '2026-08-18T08:00:00Z', timezone: 'Europe/Warsaw', status: 'pending', ...overrides })

describe('notification utilities', () => {
  it('counts only unread notifications', () => expect(unreadNotificationCount([notification(), notification({ id: 'n2', readAt: '2026-08-18T09:00:00Z' })])).toBe(1))
  it('routes task notifications to tasks', () => expect(notificationDestination(notification({ sourceType: 'task' }))).toBe('tasks'))
  it('routes calendar notifications to calendar', () => expect(notificationDestination(notification({ sourceType: 'calendar_event' }))).toBe('calendar'))
  it('falls back to dashboard for system notifications', () => expect(notificationDestination(notification())).toBe('dashboard'))
  it('groups unread, read today and earlier notifications', () => {
    const groups = groupNotifications([notification(), notification({ id: 'n2', readAt: 'x' }), notification({ id: 'n3', readAt: 'x', createdAt: '2026-08-17T08:00:00Z' })], new Date('2026-08-18T12:00:00Z'))
    expect([groups.new.length, groups.today.length, groups.earlier.length]).toEqual([1, 1, 1])
  })
  it('selects a pending reminder for a source', () => expect(reminderForSource([reminder()], 'task', 't1')?.id).toBe('r1'))
})

describe('backend notification decisions', () => {
  it('detects a due pending reminder', () => expect(isReminderDue(reminder(), new Date('2026-08-18T09:00:00Z'))).toBe(true))
  it('does not fire a future reminder', () => expect(isReminderDue(reminder(), new Date('2026-08-18T07:00:00Z'))).toBe(false))
  it('does not fire an already fired reminder', () => expect(isReminderDue(reminder({ status: 'fired' }), new Date('2026-08-18T09:00:00Z'))).toBe(false))
  it('notifies when another user receives a new assignment', () => expect(shouldNotifyAssignment(null, 'u2', 'u1')).toBe(true))
  it('does not notify the assigning user about themselves', () => expect(shouldNotifyAssignment(null, 'u1', 'u1')).toBe(false))
  it('does not duplicate an unchanged assignment', () => expect(shouldNotifyAssignment('u2', 'u2', 'u1')).toBe(false))
  it('keeps task assignment canonical when in-app is off and future push is on', () => {
    const preferences = { ...defaultNotificationPreferences, inAppEnabled: false, pushEnabled: true }
    expect(isNotificationTypeEnabled(preferences, 'task_assigned')).toBe(true)
  })
  it('does not create task assignment when its event type is disabled', () => {
    const preferences = { ...defaultNotificationPreferences, taskAssignedEnabled: false }
    expect(isNotificationTypeEnabled(preferences, 'task_assigned')).toBe(false)
  })
  it('fires a due reminder for an active recipient and enabled type', () => expect(reminderProcessingDecision(true, true)).toEqual({ createNotification: true, status: 'fired' }))
  it('cancels a due reminder for a blocked or removed recipient', () => expect(reminderProcessingDecision(false, true)).toEqual({ createNotification: false, status: 'cancelled' }))
  it('does not lose an enabled reminder event when in-app is off', () => {
    const preferences = { ...defaultNotificationPreferences, inAppEnabled: false }
    expect(isNotificationTypeEnabled(preferences, 'task_reminder')).toBe(true)
  })
})
