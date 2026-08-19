import { getSupabaseClient } from '../../../lib/supabase'
import { defaultNotificationPreferences, type AppNotification, type NotificationPreferences } from '../types'

interface NotificationRow { id: string; family_id: string; recipient_user_id: string; notification_type: AppNotification['type']; title: string; body: string | null; source_type: AppNotification['sourceType']; source_id: string | null; read_at: string | null; created_at: string }
interface PreferencesRow { in_app_enabled: boolean; push_enabled: boolean; task_assigned_enabled: boolean; task_reminders_enabled: boolean; calendar_reminders_enabled: boolean }

function client() { const value = getSupabaseClient(); if (!value) throw new Error('Brak konfiguracji Supabase.'); return value }
function mapNotification(row: NotificationRow): AppNotification { return { id: row.id, familyId: row.family_id, recipientUserId: row.recipient_user_id, type: row.notification_type, title: row.title, body: row.body, sourceType: row.source_type, sourceId: row.source_id, readAt: row.read_at, createdAt: row.created_at } }
function mapPreferences(row: PreferencesRow): NotificationPreferences { return { inAppEnabled: row.in_app_enabled, pushEnabled: row.push_enabled, taskAssignedEnabled: row.task_assigned_enabled, taskRemindersEnabled: row.task_reminders_enabled, calendarRemindersEnabled: row.calendar_reminders_enabled } }

export function createNotificationRepository() {
  return {
    async list(familyId: string) {
      const { data, error } = await client().from('notifications').select('id,family_id,recipient_user_id,notification_type,title,body,source_type,source_id,read_at,created_at').eq('family_id', familyId).order('created_at', { ascending: false }).limit(100)
      if (error) throw new Error(error.message)
      return ((data ?? []) as NotificationRow[]).map(mapNotification)
    },
    async setRead(familyId: string, id: string, read: boolean) {
      const { error } = await client().from('notifications').update({ read_at: read ? new Date().toISOString() : null }).eq('family_id', familyId).eq('id', id)
      if (error) throw new Error(error.message)
    },
    async markAllRead(familyId: string) {
      const { error } = await client().from('notifications').update({ read_at: new Date().toISOString() }).eq('family_id', familyId).is('read_at', null)
      if (error) throw new Error(error.message)
    },
    async getPreferences(familyId: string) {
      const { data, error } = await client().from('notification_preferences').select('in_app_enabled,push_enabled,task_assigned_enabled,task_reminders_enabled,calendar_reminders_enabled').eq('family_id', familyId).maybeSingle()
      if (error) throw new Error(error.message)
      return data ? mapPreferences(data as PreferencesRow) : defaultNotificationPreferences
    },
    async savePreferences(familyId: string, preferences: NotificationPreferences) {
      const values = { family_id: familyId, in_app_enabled: preferences.inAppEnabled, push_enabled: preferences.pushEnabled, task_assigned_enabled: preferences.taskAssignedEnabled, task_reminders_enabled: preferences.taskRemindersEnabled, calendar_reminders_enabled: preferences.calendarRemindersEnabled }
      const { data: existing, error: readError } = await client().from('notification_preferences').select('family_id').eq('family_id', familyId).maybeSingle()
      if (readError) throw new Error(readError.message)
      const query = existing
        ? client().from('notification_preferences').update({ in_app_enabled: preferences.inAppEnabled, push_enabled: preferences.pushEnabled, task_assigned_enabled: preferences.taskAssignedEnabled, task_reminders_enabled: preferences.taskRemindersEnabled, calendar_reminders_enabled: preferences.calendarRemindersEnabled }).eq('family_id', familyId)
        : client().from('notification_preferences').insert(values)
      const { error } = await query
      if (error) throw new Error(error.message)
    },
    async registerDevice(input: { installationId: string; installationSecret: string; pushToken: string; appVersion: string | null; deviceLabel: string }) {
      const { error } = await client().rpc('register_notification_device', {
        device_installation_id: input.installationId,
        device_installation_secret: input.installationSecret,
        device_push_token: input.pushToken,
        device_app_version: input.appVersion,
        device_label_value: input.deviceLabel,
      })
      if (error) throw new Error(error.message)
    },
    async disableDevice(installationId: string) {
      const { error } = await client().rpc('disable_notification_device', { device_installation_id: installationId })
      if (error) throw new Error(error.message)
    },
  }
}
