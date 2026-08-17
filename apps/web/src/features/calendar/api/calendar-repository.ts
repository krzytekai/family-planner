import { getSupabaseClient } from '../../../lib/supabase'
import { addDays, eventOverlapsRange, toDateKey } from '../calendar-utils'
import type { CalendarEvent, CalendarEventInput, CalendarEventType, CalendarPerson } from '../types'

type RelatedProfile = { id: string; display_name: string } | Array<{ id: string; display_name: string }> | null

interface CalendarEventRow {
  id: string
  family_id: string
  title: string
  description: string | null
  event_type: CalendarEventType
  location: string | null
  all_day: boolean
  starts_at: string | null
  ends_at: string | null
  start_date: string | null
  end_date: string | null
  created_by: string
  created_at: string
  updated_at: string
  creator: RelatedProfile
}

export interface CalendarRepository {
  listEvents(familyId: string, rangeStart: Date, rangeEnd: Date): Promise<CalendarEvent[]>
  createEvent(input: CalendarEventInput): Promise<void>
  updateEvent(familyId: string, eventId: string, input: CalendarEventInput): Promise<void>
  deleteEvent(familyId: string, eventId: string): Promise<void>
}

export function buildCalendarRangeFilters(rangeStart: Date, rangeEnd: Date) {
  const rangeStartIso = rangeStart.toISOString()
  const rangeEndIso = rangeEnd.toISOString()
  const rangeStartDate = toDateKey(rangeStart)
  const rangeEndDate = toDateKey(addDays(rangeEnd, -1))

  return {
    rangeStartIso,
    rangeEndIso,
    rangeStartDate,
    rangeEndDate,
    timedOverlap: `and(ends_at.is.null,starts_at.gte.${rangeStartIso}),ends_at.gte.${rangeStartIso}`,
    allDayOverlap: `and(end_date.is.null,start_date.gte.${rangeStartDate}),end_date.gte.${rangeStartDate}`,
  }
}

function getClient() {
  const client = getSupabaseClient()
  if (!client) throw new Error('Brak konfiguracji Supabase.')
  return client
}

function profileFromRelation(value: RelatedProfile, fallbackId: string): CalendarPerson {
  const profile = Array.isArray(value) ? value[0] : value
  return profile ? { id: profile.id, displayName: profile.display_name } : { id: fallbackId, displayName: 'Nieaktywny użytkownik' }
}

function mapEvent(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    familyId: row.family_id,
    title: row.title,
    description: row.description,
    eventType: row.event_type,
    location: row.location,
    allDay: row.all_day,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    startDate: row.start_date,
    endDate: row.end_date,
    createdBy: profileFromRelation(row.creator, row.created_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const eventSelect = `
  id, family_id, title, description, event_type, location, all_day,
  starts_at, ends_at, start_date, end_date, created_by, created_at, updated_at,
  creator:profiles!calendar_events_created_by_fkey(id, display_name)
`

function eventPayload(input: CalendarEventInput) {
  return {
    title: input.title.trim(),
    description: input.description.trim() || null,
    event_type: input.eventType,
    location: input.location.trim() || null,
    all_day: input.allDay,
    starts_at: input.allDay ? null : input.startsAt,
    ends_at: input.allDay ? null : input.endsAt,
    start_date: input.allDay ? input.startDate : null,
    end_date: input.allDay ? input.endDate : null,
  }
}

export function createCalendarRepository(): CalendarRepository {
  return {
    async listEvents(familyId, rangeStart, rangeEnd) {
      const filters = buildCalendarRangeFilters(rangeStart, rangeEnd)
      const [timedResult, allDayResult] = await Promise.all([
        getClient().from('calendar_events').select(eventSelect)
          .eq('family_id', familyId).eq('all_day', false)
          .lt('starts_at', filters.rangeEndIso)
          .or(filters.timedOverlap),
        getClient().from('calendar_events').select(eventSelect)
          .eq('family_id', familyId).eq('all_day', true)
          .lte('start_date', filters.rangeEndDate)
          .or(filters.allDayOverlap),
      ])

      if (timedResult.error) throw new Error(timedResult.error.message)
      if (allDayResult.error) throw new Error(allDayResult.error.message)
      return ([...(allDayResult.data ?? []), ...(timedResult.data ?? [])] as unknown as CalendarEventRow[])
        .map(mapEvent)
        .filter((event) => eventOverlapsRange(event, rangeStart, rangeEnd))
    },

    async createEvent(input) {
      const { error } = await getClient().from('calendar_events').insert({ family_id: input.familyId, ...eventPayload(input) })
      if (error) throw new Error(error.message)
    },

    async updateEvent(familyId, eventId, input) {
      const { data, error } = await getClient().from('calendar_events').update(eventPayload(input))
        .eq('family_id', familyId).eq('id', eventId).select('id').maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Nie masz uprawnień do edycji tego wydarzenia lub wydarzenie już nie istnieje.')
    },

    async deleteEvent(familyId, eventId) {
      const { data, error } = await getClient().from('calendar_events').delete()
        .eq('family_id', familyId).eq('id', eventId).select('id').maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Nie masz uprawnień do usunięcia tego wydarzenia lub wydarzenie już nie istnieje.')
    },
  }
}
