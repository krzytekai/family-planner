import { describe, expect, it } from 'vitest'
import type { Task } from '../tasks/types'
import { canDeleteCalendarEvent, canEditCalendarEvent, eventOccursOnDate, eventOverlapsRange, filterCalendarItems, getMonthGrid, itemsForDate, taskOccursOnDate, toDateKey } from './calendar-utils'
import type { CalendarEvent, CalendarItem } from './types'

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1', familyId: 'family-1', title: 'Dentysta', description: null,
    eventType: 'appointment', location: null, allDay: false,
    startsAt: new Date(2026, 7, 17, 16, 30).toISOString(), endsAt: null,
    startDate: null, endDate: null, createdBy: { id: 'creator-1', displayName: 'Olek' },
    createdAt: new Date(2026, 7, 1).toISOString(), updatedAt: new Date(2026, 7, 1).toISOString(), ...overrides,
  }
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1', familyId: 'family-1', title: 'Wynieść śmieci', description: null,
    status: 'todo', priority: 'normal', assignedTo: { id: 'assignee-1', displayName: 'Ala' },
    dueAt: new Date(2026, 7, 17, 18).toISOString(), createdBy: { id: 'creator-1', displayName: 'Olek' },
    createdAt: new Date(2026, 7, 1).toISOString(), updatedAt: new Date(2026, 7, 1).toISOString(), completedAt: null, ...overrides,
  }
}

describe('calendar month grid', () => {
  it('generates six Monday-first weeks', () => {
    const grid = getMonthGrid(new Date(2026, 7, 1))
    expect(grid).toHaveLength(42)
    expect(grid[0]!.getDay()).toBe(1)
    expect(grid[41]!.getDay()).toBe(0)
  })

  it('handles a month beginning on Sunday', () => {
    const grid = getMonthGrid(new Date(2023, 9, 1))
    expect(toDateKey(grid[0]!)).toBe('2023-09-25')
    expect(toDateKey(grid[6]!)).toBe('2023-10-01')
  })

  it('includes leap day in February', () => {
    expect(getMonthGrid(new Date(2024, 1, 1)).map(toDateKey)).toContain('2024-02-29')
  })
})

describe('calendar occurrence rules', () => {
  it('keeps an all-day DATE on its exact local day', () => {
    const candidate = event({ allDay: true, startsAt: null, startDate: '2026-08-17' })
    expect(eventOccursOnDate(candidate, new Date(2026, 7, 17))).toBe(true)
    expect(eventOccursOnDate(candidate, new Date(2026, 7, 16))).toBe(false)
  })

  it('shows a multi-day event on every included date', () => {
    const candidate = event({ allDay: true, startsAt: null, startDate: '2026-08-17', endDate: '2026-08-19' })
    expect([16, 17, 18, 19, 20].filter((day) => eventOccursOnDate(candidate, new Date(2026, 7, day)))).toEqual([17, 18, 19])
  })

  it('places a timed event on its local day', () => {
    expect(eventOccursOnDate(event(), new Date(2026, 7, 17))).toBe(true)
    expect(eventOccursOnDate(event(), new Date(2026, 7, 18))).toBe(false)
  })

  it('filters entries for the selected day', () => {
    expect(itemsForDate([event()], [task()], new Date(2026, 7, 17))).toHaveLength(2)
    expect(itemsForDate([event()], [task()], new Date(2026, 7, 18))).toHaveLength(0)
  })

  it('places a task with due_at on the correct local day', () => {
    expect(taskOccursOnDate(task(), new Date(2026, 7, 17))).toBe(true)
    expect(taskOccursOnDate(task(), new Date(2026, 7, 16))).toBe(false)
  })
})

describe('calendar range overlap', () => {
  const rangeStart = new Date(2026, 8, 1)
  const rangeEnd = new Date(2026, 9, 1)

  it('fetches an all-day event that starts before September and ends inside it', () => {
    const candidate = event({ allDay: true, startsAt: null, startDate: '2026-08-30', endDate: '2026-09-03' })
    expect(eventOverlapsRange(candidate, rangeStart, rangeEnd)).toBe(true)
    expect([1, 2, 3, 4].filter((day) => eventOccursOnDate(candidate, new Date(2026, 8, day)))).toEqual([1, 2, 3])
  })

  it('fetches a timed event that starts before the range and ends inside it', () => {
    const candidate = event({
      startsAt: new Date(2026, 7, 31, 22).toISOString(),
      endsAt: new Date(2026, 8, 1, 2).toISOString(),
    })
    expect(eventOverlapsRange(candidate, rangeStart, rangeEnd)).toBe(true)
  })

  it('treats all-day events without end_date as single-day points', () => {
    expect(eventOverlapsRange(event({ allDay: true, startsAt: null, startDate: '2026-09-12' }), rangeStart, rangeEnd)).toBe(true)
    expect(eventOverlapsRange(event({ allDay: true, startsAt: null, startDate: '2026-08-12' }), rangeStart, rangeEnd)).toBe(false)
  })

  it('treats timed events without ends_at as single moments', () => {
    expect(eventOverlapsRange(event({ startsAt: new Date(2026, 8, 12, 12).toISOString() }), rangeStart, rangeEnd)).toBe(true)
    expect(eventOverlapsRange(event({ startsAt: new Date(2026, 7, 12, 12).toISOString() }), rangeStart, rangeEnd)).toBe(false)
  })

  it('fetches events spanning the whole visible range', () => {
    const allDay = event({ allDay: true, startsAt: null, startDate: '2026-08-01', endDate: '2026-10-15' })
    const timed = event({ startsAt: new Date(2026, 7, 1).toISOString(), endsAt: new Date(2026, 9, 15).toISOString() })
    expect(eventOverlapsRange(allDay, rangeStart, rangeEnd)).toBe(true)
    expect(eventOverlapsRange(timed, rangeStart, rangeEnd)).toBe(true)
  })

  it('includes an interval ending exactly at the range start', () => {
    const allDay = event({ allDay: true, startsAt: null, startDate: '2026-08-30', endDate: '2026-09-01' })
    const timed = event({ startsAt: new Date(2026, 7, 31, 22).toISOString(), endsAt: rangeStart.toISOString() })
    expect(eventOverlapsRange(allDay, rangeStart, rangeEnd)).toBe(true)
    expect(eventOverlapsRange(timed, rangeStart, rangeEnd)).toBe(true)
    expect(eventOccursOnDate(timed, rangeStart)).toBe(true)
  })

  it('includes an event starting on the last day but excludes the exclusive range end', () => {
    const lastDay = event({ startsAt: new Date(2026, 8, 30, 23, 59).toISOString() })
    const atRangeEnd = event({ startsAt: rangeEnd.toISOString() })
    expect(eventOverlapsRange(lastDay, rangeStart, rangeEnd)).toBe(true)
    expect(eventOverlapsRange(atRangeEnd, rangeStart, rangeEnd)).toBe(false)
  })
})

describe('calendar filters and permissions', () => {
  const eventItem: CalendarItem = { type: 'event', id: 'event-event-1', event: event() }
  const taskItem: CalendarItem = { type: 'task', id: 'task-task-1', task: task() }

  it('filters events and tasks independently', () => {
    expect(filterCalendarItems([eventItem, taskItem], 'events', 'user').map((item) => item.type)).toEqual(['event'])
    expect(filterCalendarItems([eventItem, taskItem], 'tasks', 'user').map((item) => item.type)).toEqual(['task'])
  })

  it('defines Mine as created events and assigned or created tasks', () => {
    expect(filterCalendarItems([eventItem, taskItem], 'mine', 'creator-1')).toHaveLength(2)
    expect(filterCalendarItems([eventItem, taskItem], 'mine', 'assignee-1').map((item) => item.type)).toEqual(['task'])
  })

  it('allows the creator to edit and delete an event', () => {
    expect(canEditCalendarEvent(event(), 'creator-1', 'adult')).toBe(true)
    expect(canDeleteCalendarEvent(event(), 'creator-1', 'adult')).toBe(true)
  })

  it('does not allow a child to edit another user event', () => {
    expect(canEditCalendarEvent(event(), 'child-1', 'child')).toBe(false)
  })

  it('allows an owner to edit another user event', () => {
    expect(canEditCalendarEvent(event(), 'owner-1', 'owner')).toBe(true)
  })
})
