import { useCallback, useEffect, useMemo, useState } from 'react'
import { createNotificationRepository } from '../api/notification-repository'
import { unreadNotificationCount } from '../notification-utils'
import { defaultNotificationPreferences, type AppNotification, type NotificationPreferences } from '../types'

export function useNotifications(familyId: string) {
  const repository = useMemo(() => createNotificationRepository(), [])
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultNotificationPreferences)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => { setLoading(true); setError(null); try { const [items, prefs] = await Promise.all([repository.list(familyId), repository.getPreferences(familyId)]); setNotifications(items); setPreferences(prefs) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się pobrać powiadomień.') } finally { setLoading(false) } }, [familyId, repository])
  useEffect(() => { void refresh() }, [refresh])
  async function setRead(item: AppNotification, read: boolean) { setSaving(true); setError(null); try { await repository.setRead(familyId, item.id, read); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać zmiany.') } finally { setSaving(false) } }
  async function markAllRead() { setSaving(true); setError(null); try { await repository.markAllRead(familyId); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się oznaczyć powiadomień.') } finally { setSaving(false) } }
  async function savePreferences(next: NotificationPreferences) { setSaving(true); setError(null); try { await repository.savePreferences(familyId, next); setPreferences(next) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać ustawień.') } finally { setSaving(false) } }
  const inAppNotifications = preferences.inAppEnabled ? notifications : []
  return { notifications: inAppNotifications, unreadCount: unreadNotificationCount(inAppNotifications), preferences, loading, saving, error, setRead, markAllRead, savePreferences, refresh }
}
