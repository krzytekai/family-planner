import { formatDateTimeLocal as formatLocal } from '../../lib/date-time-local'
import type { FamilyRole } from '../../types/domain'
import type { Task } from '../tasks/types'
import type { CalendarEvent, CalendarFilter, CalendarItem } from './types'

const dayMs = 86_400_000

export function toDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function parseDateKey(value: string): Date {
  const [year = 0, month = 1, day = 1] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount)
}

export function getMonthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const gridStart = addDays(first, -mondayOffset)
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index))
}

export function getMonthGridRange(month: Date): { start: Date; end: Date } {
  const days = getMonthGrid(month)
  return { start: days[0]!, end: addDays(days[days.length - 1]!, 1) }
}

export function eventOccursOnDate(event: CalendarEvent, date: Date): boolean {
  const key = toDateKey(date)
  if (event.allDay) {
    if (!event.startDate) return false
    return key >= event.startDate && key <= (event.endDate ?? event.startDate)
  }
  if (!event.startsAt) return false
  const dayStart = startOfLocalDay(date).getTime()
  const dayEnd = dayStart + dayMs
  const eventStart = new Date(event.startsAt).getTime()
  if (!event.endsAt) return eventStart >= dayStart && eventStart < dayEnd
  const eventEnd = new Date(event.endsAt).getTime()
  return eventStart < dayEnd && eventEnd >= dayStart
}

export function eventOverlapsRange(event: CalendarEvent, rangeStart: Date, rangeEnd: Date): boolean {
  if (event.allDay) {
    if (!event.startDate) return false
    const rangeStartDate = toDateKey(rangeStart)
    const rangeEndDate = toDateKey(addDays(rangeEnd, -1))
    if (!event.endDate) return event.startDate >= rangeStartDate && event.startDate <= rangeEndDate
    return event.startDate <= rangeEndDate && event.endDate >= rangeStartDate
  }

  if (!event.startsAt) return false
  const eventStart = new Date(event.startsAt).getTime()
  const rangeStartTime = rangeStart.getTime()
  const rangeEndTime = rangeEnd.getTime()
  if (!event.endsAt) return eventStart >= rangeStartTime && eventStart < rangeEndTime
  return eventStart < rangeEndTime && new Date(event.endsAt).getTime() >= rangeStartTime
}

export function taskOccursOnDate(task: Task, date: Date): boolean {
  if (!task.dueAt) return false
  const due = new Date(task.dueAt)
  return !Number.isNaN(due.getTime()) && toDateKey(due) === toDateKey(date)
}

export function itemsForDate(events: CalendarEvent[], tasks: Task[], date: Date): CalendarItem[] {
  const eventItems: CalendarItem[] = events
    .filter((event) => eventOccursOnDate(event, date))
    .map((event) => ({ type: 'event', id: `event-${event.id}`, event }))
  const taskItems: CalendarItem[] = tasks
    .filter((task) => taskOccursOnDate(task, date))
    .map((task) => ({ type: 'task', id: `task-${task.id}`, task }))

  return [...eventItems, ...taskItems].sort((first, second) => {
    const rank = (item: CalendarItem) => item.type === 'event' && item.event.allDay ? 0 : item.type === 'event' ? 1 : 2
    const rankDifference = rank(first) - rank(second)
    if (rankDifference !== 0) return rankDifference
    const time = (item: CalendarItem) => item.type === 'event'
      ? new Date(item.event.startsAt ?? `${item.event.startDate}T00:00:00`).getTime()
      : new Date(item.task.dueAt!).getTime()
    return time(first) - time(second)
  })
}

export function filterCalendarItems(items: CalendarItem[], filter: CalendarFilter, userId: string): CalendarItem[] {
  switch (filter) {
    case 'events': return items.filter((item) => item.type === 'event')
    case 'tasks': return items.filter((item) => item.type === 'task')
    case 'mine': return items.filter((item) => item.type === 'event'
      ? item.event.createdBy.id === userId
      : item.task.createdBy.id === userId || item.task.assignedTo?.id === userId)
    default: return items
  }
}

export function canEditCalendarEvent(event: CalendarEvent, userId: string, role: FamilyRole): boolean {
  return role === 'owner' || role === 'admin' || event.createdBy.id === userId
}

export const canDeleteCalendarEvent = canEditCalendarEvent

export function canCreateCalendarEvent(role: FamilyRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'adult'
}

export function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) return 'Cały dzień'
  if (!event.startsAt) return ''
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(new Date(event.startsAt))
}

export function formatMonthYear(date: Date): string {
  const value = new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(date)
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export function formatAgendaDate(date: Date): string {
  return new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long' }).format(date)
}

export function formatDateTimeLocal(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  return formatLocal(date)
}
