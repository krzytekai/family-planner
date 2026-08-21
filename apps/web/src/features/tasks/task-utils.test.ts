import { describe, expect, it } from 'vitest'
import { canDeleteTask, canManageTaskAutomation, canUpdateTask, filterTasks, getTaskStats, getTodayTasks, isDueToday, recurrenceLabel, validateRecurrenceRule } from './task-utils'
import type { Task, TaskFilter } from './types'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    familyId: 'family-1',
    title: 'Testowe zadanie',
    description: null,
    status: 'todo',
    priority: 'normal',
    assignedTo: { id: 'assignee-1', displayName: 'Ala' },
    dueAt: '2026-08-17T10:00:00.000Z',
    createdBy: { id: 'creator-1', displayName: 'Olek' },
    createdAt: '2026-08-16T10:00:00.000Z',
    updatedAt: '2026-08-16T10:00:00.000Z',
    completedAt: null,
    recurrence: null,
    assigneeReminderOffsetMinutes: null,
    ...overrides,
  }
}

const filterCases: Array<{ filter: TaskFilter; expected: string[] }> = [
  { filter: 'all', expected: ['today-active', 'tomorrow-active', 'today-done'] },
  { filter: 'today', expected: ['today-active', 'today-done'] },
  { filter: 'mine', expected: ['tomorrow-active', 'today-done'] },
  { filter: 'active', expected: ['today-active', 'tomorrow-active'] },
  { filter: 'done', expected: ['today-done'] },
]

describe('task dashboard logic', () => {
  const now = new Date('2026-08-17T12:00:00.000Z')

  it('counts active tasks and active tasks due today', () => {
    const tasks = [
      task(),
      task({ id: 'task-2', status: 'done', completedAt: '2026-08-17T11:00:00.000Z' }),
      task({ id: 'task-3', dueAt: '2026-08-18T10:00:00.000Z' }),
    ]

    expect(getTaskStats(tasks, now)).toEqual({ active: 2, dueToday: 1 })
  })

  it('returns all of today tasks in deadline order, including completed tasks', () => {
    const later = task({ id: 'later', dueAt: '2026-08-17T18:00:00.000Z' })
    const earlier = task({ id: 'earlier', dueAt: '2026-08-17T08:00:00.000Z', status: 'done', completedAt: '2026-08-17T09:00:00.000Z' })

    expect(getTodayTasks([later, earlier], now).map(({ id }) => id)).toEqual(['earlier', 'later'])
    expect(isDueToday(null, now)).toBe(false)
  })

  it('allows updates only for administrators, creators and assignees', () => {
    const candidate = task()
    expect(canUpdateTask(candidate, 'owner-1', 'owner')).toBe(true)
    expect(canUpdateTask(candidate, 'creator-1', 'adult')).toBe(true)
    expect(canUpdateTask(candidate, 'assignee-1', 'child')).toBe(true)
    expect(canUpdateTask(candidate, 'other-1', 'adult')).toBe(false)
  })

  describe('task deletion permissions', () => {
    const candidate = task({
      createdBy: { id: 'creator-1', displayName: 'Olek' },
      assignedTo: { id: 'assignee-1', displayName: 'Ala' },
    })

    it('allows an owner to delete another user task', () => {
      expect(canDeleteTask(candidate, 'owner-1', 'owner')).toBe(true)
    })

    it('allows an admin to delete another user task', () => {
      expect(canDeleteTask(candidate, 'admin-1', 'admin')).toBe(true)
    })

    it('allows an adult to delete their own task', () => {
      expect(canDeleteTask(candidate, 'creator-1', 'adult')).toBe(true)
    })

    it('does not allow an adult to delete another user task', () => {
      expect(canDeleteTask(candidate, 'adult-1', 'adult')).toBe(false)
    })

    it('does not allow deletion only because the user is assigned', () => {
      expect(canDeleteTask(candidate, 'assignee-1', 'adult')).toBe(false)
    })

    it('does not allow a child to delete another user task', () => {
      expect(canDeleteTask(candidate, 'child-1', 'child')).toBe(false)
    })
  })

  describe('task automation permissions', () => {
    const candidate = task({ createdBy: { id: 'creator-1', displayName: 'Olek' }, assignedTo: { id: 'child-1', displayName: 'Ala' } })
    it('allows owner, admin and task creator to manage recurrence and assignee reminders', () => {
      expect(canManageTaskAutomation(candidate, 'owner-1', 'owner')).toBe(true)
      expect(canManageTaskAutomation(candidate, 'admin-1', 'admin')).toBe(true)
      expect(canManageTaskAutomation(candidate, 'creator-1', 'adult')).toBe(true)
    })
    it('does not allow an assigned child to manage automation only because they can complete the task', () => {
      expect(canUpdateTask(candidate, 'child-1', 'child')).toBe(true)
      expect(canManageTaskAutomation(candidate, 'child-1', 'child')).toBe(false)
    })
  })

  it.each(filterCases)('filters tasks using $filter', ({ filter, expected }) => {
    const tasks = [
      task({ id: 'today-active' }),
      task({ id: 'tomorrow-active', dueAt: '2026-08-18T10:00:00.000Z', assignedTo: { id: 'current-user', displayName: 'Ja' }, status: 'in_progress' }),
      task({ id: 'today-done', assignedTo: { id: 'current-user', displayName: 'Ja' }, status: 'done', completedAt: '2026-08-17T11:00:00.000Z' }),
    ]

    expect(filterTasks(tasks, filter, 'current-user', now).map(({ id }) => id)).toEqual(expected)
  })

  it('validates and labels supported recurrence rules', () => {
    expect(recurrenceLabel({ type: 'daily', interval: 1 })).toBe('codziennie')
    expect(recurrenceLabel({ type: 'daily', interval: 4 })).toBe('co 4 dni')
    expect(recurrenceLabel({ type: 'weekly', interval: 1, weekdays: [2, 5] })).toBe('wtorek i piątek')
    expect(recurrenceLabel({ type: 'monthly', interval: 1, day_of_month: 31 })).toBe('co miesiąc, 31. dnia')
    expect(validateRecurrenceRule({ type: 'weekly', interval: 1, weekdays: [] })).toBe(false)
    expect(validateRecurrenceRule({ type: 'monthly', interval: 1, day_of_month: 32 })).toBe(false)
    expect(validateRecurrenceRule({ type: 'yearly', interval: 1, month: 2, day_of_month: 29 })).toBe(true)
    expect(validateRecurrenceRule({ type: 'daily', interval: 0 })).toBe(false)
  })

  it('filters only active recurring series', () => {
    const recurring = task({ id: 'recurring', recurrence: { seriesId: 'series-1', rule: { type: 'daily', interval: 1 }, timezone: 'Europe/Warsaw', enabled: true, occurrenceIndex: 0 } })
    const stopped = task({ id: 'stopped', recurrence: { seriesId: 'series-2', rule: { type: 'daily', interval: 1 }, timezone: 'Europe/Warsaw', enabled: false, occurrenceIndex: 2 } })
    expect(filterTasks([recurring, stopped, task({ id: 'plain' })], 'recurring', 'user', now).map(({ id }) => id)).toEqual(['recurring'])
  })
})
