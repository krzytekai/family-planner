import { formatDateTimeLocal } from '../../lib/date-time-local'
import type { AppNotification, NotificationPreferences, NotificationType, Reminder } from './types'

export type NotificationDestination = 'dashboard' | 'tasks' | 'calendar' | 'properties'

export function unreadNotificationCount(notifications: AppNotification[]) {
  return notifications.filter((notification) => notification.dismissedAt === null && notification.readAt === null).length
}

export function visibleNotifications(notifications: AppNotification[]) {
  return notifications.filter((notification) => notification.dismissedAt === null)
}

export function notificationDestination(notification: Pick<AppNotification, 'sourceType'>): NotificationDestination {
  if (notification.sourceType === 'task') return 'tasks'
  if (notification.sourceType === 'calendar_event') return 'calendar'
  if (notification.sourceType === 'property_charge') return 'properties'
  return 'dashboard'
}

export function groupNotifications(notifications: AppNotification[], now = new Date()) {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const visible = visibleNotifications(notifications)
  return {
    new: visible.filter((item) => item.readAt === null),
    today: visible.filter((item) => item.readAt !== null && new Date(item.createdAt).getTime() >= startOfToday),
    earlier: visible.filter((item) => item.readAt !== null && new Date(item.createdAt).getTime() < startOfToday),
  }
}

export function isReminderDue(reminder: Pick<Reminder, 'status' | 'remindAt'>, now = new Date()) {
  return reminder.status === 'pending' && new Date(reminder.remindAt).getTime() <= now.getTime()
}

export function shouldNotifyAssignment(previousAssignee: string | null | undefined, assignee: string | null, actorId: string) {
  return assignee !== null && assignee !== actorId && assignee !== previousAssignee
}

export function isNotificationTypeEnabled(preferences: NotificationPreferences, type: NotificationType) {
  if (type === 'task_assigned') return preferences.taskAssignedEnabled
  if (type === 'task_reminder') return preferences.taskRemindersEnabled
  if (type === 'calendar_reminder') return preferences.calendarRemindersEnabled
  return true
}

export function reminderProcessingDecision(recipientActive: boolean, typeEnabled: boolean) {
  return recipientActive && typeEnabled
    ? { createNotification: true, status: 'fired' as const }
    : { createNotification: false, status: 'cancelled' as const }
}

export function reminderForSource(reminders: Reminder[], sourceType: Reminder['sourceType'], sourceId: string, kind: Reminder['kind'] = 'personal') {
  return reminders.find((item) => item.status === 'pending' && item.sourceType === sourceType && item.sourceId === sourceId && item.kind === kind)
}

export function formatNotificationDate(value: string) {
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function toDateTimeLocal(value: string | null) {
  const date = value ? new Date(value) : new Date(Date.now() + 60 * 60 * 1000)
  return formatDateTimeLocal(date)
}
