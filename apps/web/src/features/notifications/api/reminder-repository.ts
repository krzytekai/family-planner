import { getSupabaseClient } from '../../../lib/supabase'
import type { Reminder, ReminderSource } from '../types'

interface ReminderRow { id: string; family_id: string; source_type: Reminder['sourceType']; source_id: string; title: string | null; remind_at: string; timezone: string | null; status: Reminder['status']; reminder_kind: Reminder['kind']; assignee_reminder_offset_minutes: number | null }
function client() { const value = getSupabaseClient(); if (!value) throw new Error('Brak konfiguracji Supabase.'); return value }
function map(row: ReminderRow): Reminder { return { id: row.id, familyId: row.family_id, sourceType: row.source_type, sourceId: row.source_id, title: row.title, remindAt: row.remind_at, timezone: row.timezone, status: row.status, kind: row.reminder_kind, assigneeReminderOffsetMinutes: row.assignee_reminder_offset_minutes } }

export function createReminderRepository() {
  async function findPendingPersonal(familyId: string, source: ReminderSource) {
    const { data, error } = await client().from('reminders').select('id').eq('family_id', familyId).eq('source_type', source.type).eq('source_id', source.id).eq('reminder_kind', 'personal').eq('status', 'pending').maybeSingle()
    if (error) throw new Error(error.message)
    return data?.id as string | undefined
  }

  return {
    async list(familyId: string) {
      const { data, error } = await client().from('reminders').select('id,family_id,source_type,source_id,title,remind_at,timezone,status,reminder_kind,assignee_reminder_offset_minutes').eq('family_id', familyId).eq('status', 'pending').order('remind_at')
      if (error) throw new Error(error.message)
      return ((data ?? []) as ReminderRow[]).map(map)
    },
    async save(familyId: string, source: ReminderSource, remindAt: string, timezone: string, existingId?: string) {
      const values = { title: `Przypomnienie: ${source.title}`, remind_at: remindAt, timezone }
      const pendingId = existingId ?? await findPendingPersonal(familyId, source)
      if (pendingId) {
        const { error } = await client().from('reminders').update(values).eq('family_id', familyId).eq('id', pendingId).eq('reminder_kind', 'personal')
        if (error) throw new Error(error.message)
        return
      }
      const { error } = await client().from('reminders').insert({ family_id: familyId, source_type: source.type, source_id: source.id, ...values })
      if (error?.code === '23505') {
        const concurrentId = await findPendingPersonal(familyId, source)
        if (concurrentId) {
          const { error: updateError } = await client().from('reminders').update(values).eq('family_id', familyId).eq('id', concurrentId).eq('reminder_kind', 'personal')
          if (!updateError) return
          throw new Error(updateError.message)
        }
      }
      if (error) throw new Error(error.message)
    },
    async remove(familyId: string, id: string) {
      const { error } = await client().from('reminders').delete().eq('family_id', familyId).eq('id', id)
      if (error) throw new Error(error.message)
    },
  }
}
