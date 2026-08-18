export type NotificationType = 'task_assigned' | 'task_reminder' | 'calendar_reminder' | 'system'
export type NotificationSourceType = 'task' | 'calendar_event' | 'system' | null
export type ReminderSourceType = 'task' | 'calendar_event'

export interface AppNotification {
  id: string
  familyId: string
  recipientUserId: string
  type: NotificationType
  title: string
  body: string | null
  sourceType: NotificationSourceType
  sourceId: string | null
  readAt: string | null
  createdAt: string
}

export interface Reminder {
  id: string
  familyId: string
  sourceType: ReminderSourceType
  sourceId: string
  title: string | null
  remindAt: string
  timezone: string | null
  status: 'pending' | 'fired' | 'cancelled'
}

export interface ReminderSource {
  type: ReminderSourceType
  id: string
  title: string
  occursAt: string | null
}

export interface NotificationPreferences {
  inAppEnabled: boolean
  pushEnabled: boolean
  taskAssignedEnabled: boolean
  taskRemindersEnabled: boolean
  calendarRemindersEnabled: boolean
}

export const defaultNotificationPreferences: NotificationPreferences = {
  inAppEnabled: true,
  pushEnabled: true,
  taskAssignedEnabled: true,
  taskRemindersEnabled: true,
  calendarRemindersEnabled: true,
}
