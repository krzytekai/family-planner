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
  useEffect(() => { setNotifications([]); void refresh() }, [refresh])
  async function setRead(item: AppNotification, read: boolean) { const previous=item.readAt; setNotifications(values=>values.map(value=>value.id===item.id?{...value,readAt:read?new Date().toISOString():null}:value)); setSaving(true); setError(null); try { await repository.setRead(familyId, item.id, read) } catch (cause) { setNotifications(values=>values.map(value=>value.id===item.id?{...value,readAt:previous}:value)); setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać zmiany.') } finally { setSaving(false) } }
  async function markReadById(id: string) { setSaving(true); setError(null); try { await repository.setRead(familyId, id, true); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się oznaczyć powiadomienia.') } finally { setSaving(false) } }
  async function markAllRead() { setSaving(true); setError(null); try { await repository.markAllRead(familyId); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się oznaczyć powiadomień.') } finally { setSaving(false) } }
  async function dismiss(item: AppNotification) { setNotifications(values=>values.filter(value=>value.id!==item.id)); setSaving(true); setError(null); try { await repository.dismiss(familyId,item.id) } catch (cause) { await refresh(); setError(cause instanceof Error ? cause.message : 'Nie udało się usunąć powiadomienia.') } finally { setSaving(false) } }
  async function dismissRead() { setSaving(true); setError(null); try { await repository.dismissRead(familyId); setNotifications(values=>values.filter(value=>value.readAt===null)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się usunąć przeczytanych powiadomień.') } finally { setSaving(false) } }
  async function savePreferences(next: NotificationPreferences) { setSaving(true); setError(null); try { await repository.savePreferences(familyId, next); setPreferences(next) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać ustawień.') } finally { setSaving(false) } }
  const inAppNotifications = preferences.inAppEnabled ? notifications.filter(item=>item.familyId===familyId) : []
  return { notifications: inAppNotifications, unreadCount: unreadNotificationCount(inAppNotifications), preferences, loading, saving, error, setRead, markReadById, markAllRead, dismiss, dismissRead, savePreferences, refresh }
}
