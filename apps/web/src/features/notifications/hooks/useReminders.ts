import { useCallback, useEffect, useMemo, useState } from 'react'
import { createReminderRepository } from '../api/reminder-repository'
import type { Reminder, ReminderSource } from '../types'

export function useReminders(familyId: string) {
  const repository = useMemo(() => createReminderRepository(), [])
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(async () => { setLoading(true); setError(null); try { setReminders(await repository.list(familyId)) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się pobrać przypomnień.') } finally { setLoading(false) } }, [familyId, repository])
  useEffect(() => { void refresh() }, [refresh])
  async function save(source: ReminderSource, remindAt: string, timezone: string, existingId?: string) { setSaving(true); setError(null); try { await repository.save(familyId, source, remindAt, timezone, existingId); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się zapisać przypomnienia.'); throw cause } finally { setSaving(false) } }
  async function remove(id: string) { setSaving(true); setError(null); try { await repository.remove(familyId, id); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Nie udało się usunąć przypomnienia.') } finally { setSaving(false) } }
  return { reminders, loading, saving, error, save, remove }
}
