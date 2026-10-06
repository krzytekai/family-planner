import { getSupabaseClient } from '../../../lib/supabase'
import { addDays, eventOverlapsRange, toDateKey } from '../calendar-utils'
import type { RecurrenceRule } from '../../tasks/types'
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
  recurrence_series_id: string | null
  recurrence_occurrence_date: string | null
  series: { recurrence_rule: RecurrenceRule; recurrence_timezone: string; recurrence_enabled: boolean } | Array<{ recurrence_rule: RecurrenceRule; recurrence_timezone: string; recurrence_enabled: boolean }> | null
}

export interface CalendarRepository {
  listEvents(familyId: string, rangeStart: Date, rangeEnd: Date): Promise<CalendarEvent[]>
  createEvent(input: CalendarEventInput): Promise<void>
  updateEvent(familyId: string, eventId: string, input: CalendarEventInput): Promise<void>
  deleteEvent(familyId: string, eventId: string): Promise<void>
  stopRecurrence(familyId: string, eventId: string): Promise<void>
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
  const series = Array.isArray(row.series) ? row.series[0] : row.series
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
    recurrence: row.recurrence_series_id && row.recurrence_occurrence_date && series ? {
      seriesId: row.recurrence_series_id,
      occurrenceDate: row.recurrence_occurrence_date,
      rule: series.recurrence_rule,
      timezone: series.recurrence_timezone,
      enabled: series.recurrence_enabled,
    } : null,
  }
}

const eventSelect = `
  id, family_id, title, description, event_type, location, all_day,
  starts_at, ends_at, start_date, end_date, created_by, created_at, updated_at,
  creator:profiles!calendar_events_created_by_fkey(id, display_name)
  ,recurrence_series_id, recurrence_occurrence_date,
  series:calendar_event_recurrence_series!calendar_events_recurrence_series_fkey(recurrence_rule, recurrence_timezone, recurrence_enabled)
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
      if (input.recurrence) {
        const { error } = await getClient().rpc('create_recurring_calendar_event', {
          target_family_id: input.familyId,
          event_title: input.title.trim(), event_description: input.description.trim() || null,
          event_type_value: input.eventType, event_location: input.location.trim() || null,
          event_all_day: input.allDay, event_starts_at: input.allDay ? null : input.startsAt,
          event_ends_at: input.allDay ? null : input.endsAt, event_start_date: input.allDay ? input.startDate : null,
          event_end_date: input.allDay ? input.endDate : null, recurrence_rule_value: input.recurrence.rule,
          recurrence_timezone_value: input.recurrence.timezone,
        })
        if (error) throw new Error(error.message)
        return
      }
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
      const { data, error } = await getClient().rpc('delete_calendar_event_occurrence', { target_family_id: familyId, target_event_id: eventId })
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Nie masz uprawnień do usunięcia tego wydarzenia lub wydarzenie już nie istnieje.')
    },

    async stopRecurrence(familyId, eventId) {
      const { data, error } = await getClient().rpc('stop_calendar_event_recurrence', { target_family_id: familyId, target_event_id: eventId })
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Nie udało się zakończyć serii wydarzeń.')
    },
  }
}
