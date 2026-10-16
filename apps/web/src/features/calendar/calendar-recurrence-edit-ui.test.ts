import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeRecurrenceIntervalInput, parseRecurrenceInterval } from '../tasks/task-utils'
import { canChangeCalendarRecurrence } from './calendar-utils'
import type { CalendarEvent } from './types'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const modal = read('src/features/calendar/components/CalendarRecurrenceEditModal.tsx')
const card = read('src/features/calendar/components/CalendarEventCard.tsx')
const view = read('src/features/calendar/components/CalendarView.tsx')
const repository = read('src/features/calendar/api/calendar-repository.ts')
const hook = read('src/features/calendar/hooks/useCalendar.ts')

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1', familyId: 'family-1', title: 'Spotkanie', description: null, eventType: 'family', location: null,
    allDay: true, startsAt: null, endsAt: null, startDate: '2027-11-15', endDate: null,
    createdBy: { id: 'creator-1', displayName: 'Autor' }, createdAt: '2027-01-01T10:00:00Z', updatedAt: '2027-01-01T10:00:00Z',
    recurrence: { seriesId: 'series-1', occurrenceDate: '2027-11-15', rule: { type: 'weekly', interval: 1, weekdays: [1] }, timezone: 'Europe/Warsaw', enabled: true },
    ...overrides,
  }
}

describe('calendar recurrence edit UI', () => {
  it('shows change recurrence for an active manageable occurrence', () => {
    expect(canChangeCalendarRecurrence(event(), 'creator-1', 'adult', new Date('2027-11-14T10:00:00Z'))).toBe(true)
    expect(card).toContain('Zmień powtarzanie')
  })
  it('hides the action for a one-off event', () => {
    expect(canChangeCalendarRecurrence(event({ recurrence: null }), 'creator-1', 'adult')).toBe(false)
  })
  it('hides the action for a stopped series', () => {
    const stopped = event({ recurrence: { ...event().recurrence!, enabled: false } })
    expect(canChangeCalendarRecurrence(stopped, 'creator-1', 'adult')).toBe(false)
  })
  it('hides the action for a historical occurrence in the series timezone', () => {
    expect(canChangeCalendarRecurrence(event({ recurrence: { ...event().recurrence!, occurrenceDate: '2027-11-13' } }), 'creator-1', 'adult', new Date('2027-11-14T10:00:00Z'))).toBe(false)
  })
  it('opens the modal with the current rule', () => {
    expect(modal).toContain('useState<RecurrenceType>(currentRule.type)')
    expect(modal).toContain('useState(String(currentRule.interval))')
  })
  it('allows the interval to be cleared', () => {
    expect(normalizeRecurrenceIntervalInput('')).toBe('')
    expect(modal).toContain('inputMode="numeric"')
  })
  it('turns clear then 5 into exactly 5', () => {
    expect(normalizeRecurrenceIntervalInput('5')).toBe('5')
    expect(normalizeRecurrenceIntervalInput('05')).toBe('5')
  })
  it('shows all Polish weekly weekday controls', () => {
    for (const label of ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd']) expect(modal).toContain(`label: '${label}'`)
  })
  it('blocks an invalid interval with the shared Polish validation', () => {
    expect(parseRecurrenceInterval('')).toBeNull()
    expect(parseRecurrenceInterval('0')).toBeNull()
    expect(parseRecurrenceInterval('1001')).toBeNull()
    expect(modal).toContain('recurrenceIntervalError')
  })
  it('sends a valid interval through the repository RPC', () => {
    expect(parseRecurrenceInterval('1')).toBe(1)
    expect(parseRecurrenceInterval('1000')).toBe(1000)
    expect(repository).toContain("rpc('change_calendar_event_recurrence_from_occurrence'")
    expect(repository).toContain('recurrence_rule_value: input.rule')
  })
  it('closes on success and refreshes calendar data', () => {
    expect(modal).toContain('await onSave(nextRule)')
    expect(modal).toContain('onClose()')
    expect(hook).toContain('await refresh()')
    expect(view).toContain('CalendarRecurrenceEditModal')
  })
  it('shows a Polish error without exposing a raw backend message', () => {
    expect(modal).toContain('Nie udało się zmienić powtarzania wydarzenia. Spróbuj ponownie.')
    expect(modal).toContain('Zapisz od tego wystąpienia')
    expect(modal).toContain('Wcześniejsze wystąpienia pozostaną bez zmian.')
  })
})
