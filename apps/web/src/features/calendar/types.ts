import type { Task } from '../tasks/types'

export type CalendarEventType = 'family' | 'appointment' | 'school' | 'work' | 'birthday' | 'other'
export type CalendarFilter = 'all' | 'events' | 'tasks' | 'mine'

export interface CalendarPerson {
  id: string
  displayName: string
}

export interface CalendarEvent {
  id: string
  familyId: string
  title: string
  description: string | null
  eventType: CalendarEventType
  location: string | null
  allDay: boolean
  startsAt: string | null
  endsAt: string | null
  startDate: string | null
  endDate: string | null
  createdBy: CalendarPerson
  createdAt: string
  updatedAt: string
}

export interface CalendarEventInput {
  familyId: string
  title: string
  description: string
  eventType: CalendarEventType
  location: string
  allDay: boolean
  startsAt: string | null
  endsAt: string | null
  startDate: string | null
  endDate: string | null
}

export type CalendarItem =
  | { type: 'event'; id: string; event: CalendarEvent }
  | { type: 'task'; id: string; task: Task }
