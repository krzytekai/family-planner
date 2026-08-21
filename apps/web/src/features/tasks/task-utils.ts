import type { FamilyRole } from '../../types/domain'
import type { RecurrenceRule, RecurrenceType, Task, TaskFilter, TaskStats, TaskStatus } from './types'

export function isDueToday(dueAt: string | null, now = new Date()): boolean {
  if (!dueAt) return false
  const dueDate = new Date(dueAt)
  if (Number.isNaN(dueDate.getTime())) return false

  return dueDate.getFullYear() === now.getFullYear()
    && dueDate.getMonth() === now.getMonth()
    && dueDate.getDate() === now.getDate()
}

export function getTodayTasks(tasks: Task[], now = new Date()): Task[] {
  return tasks
    .filter((task) => isDueToday(task.dueAt, now))
    .sort((first, second) => new Date(first.dueAt!).getTime() - new Date(second.dueAt!).getTime())
}

export function getTaskStats(tasks: Task[], now = new Date()): TaskStats {
  const activeTasks = tasks.filter((task) => task.status !== 'done')
  return {
    active: activeTasks.length,
    dueToday: activeTasks.filter((task) => isDueToday(task.dueAt, now)).length,
  }
}

export function filterTasks(tasks: Task[], filter: TaskFilter, userId: string, now = new Date()): Task[] {
  switch (filter) {
    case 'today':
      return tasks.filter((task) => isDueToday(task.dueAt, now))
    case 'mine':
      return tasks.filter((task) => task.assignedTo?.id === userId)
    case 'active':
      return tasks.filter((task) => task.status !== 'done')
    case 'done':
      return tasks.filter((task) => task.status === 'done')
    case 'recurring':
      return tasks.filter((task) => task.recurrence?.enabled)
    default:
      return tasks
  }
}

const weekdayNames = ['poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela']

export function recurrenceLabel(rule: RecurrenceRule): string {
  if (rule.type === 'daily') return rule.interval === 1 ? 'codziennie' : `co ${rule.interval} dni`
  if (rule.type === 'weekly') {
    const days = (rule.weekdays ?? []).map((day) => weekdayNames[day - 1]).filter(Boolean).join(' i ')
    return rule.interval === 1 ? days || 'co tydzień' : `co ${rule.interval} tyg., ${days}`
  }
  if (rule.type === 'monthly') {
    const suffix = `${rule.day_of_month ?? 1}. dnia`
    return rule.interval === 1 ? `co miesiąc, ${suffix}` : `co ${rule.interval} mies., ${suffix}`
  }
  return rule.interval === 1 ? 'co rok' : `co ${rule.interval} lat`
}

export function validateRecurrenceRule(rule: RecurrenceRule): boolean {
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 1000) return false
  if (rule.type === 'weekly') {
    const days = rule.weekdays ?? []
    return days.length > 0 && days.length <= 7 && new Set(days).size === days.length
      && days.every((day) => Number.isInteger(day) && day >= 1 && day <= 7)
  }
  if (rule.type === 'monthly') return Number.isInteger(rule.day_of_month) && rule.day_of_month! >= 1 && rule.day_of_month! <= 31
  if (rule.type === 'yearly') return Number.isInteger(rule.month) && rule.month! >= 1 && rule.month! <= 12
    && Number.isInteger(rule.day_of_month) && rule.day_of_month! >= 1 && rule.day_of_month! <= 31
  return true
}

export function serializeRecurrence(type: RecurrenceType | 'none', interval: number, days: number[], dueAt: string): RecurrenceRule | null {
  if (type === 'none') return null
  const due = new Date(dueAt)
  if (type === 'weekly') return { type, interval, weekdays: [...days].sort((a, b) => a - b) }
  if (type === 'monthly') return { type, interval, day_of_month: due.getDate() }
  if (type === 'yearly') return { type, interval, month: due.getMonth() + 1, day_of_month: due.getDate() }
  return { type, interval }
}

export function groupTasksByStatus(tasks: Task[]): Record<TaskStatus, Task[]> {
  return {
    todo: tasks.filter((task) => task.status === 'todo'),
    in_progress: tasks.filter((task) => task.status === 'in_progress'),
    done: tasks.filter((task) => task.status === 'done'),
  }
}

export function canUpdateTask(task: Task, userId: string, role: FamilyRole): boolean {
  return role === 'owner'
    || role === 'admin'
    || task.createdBy.id === userId
    || task.assignedTo?.id === userId
}

export function canDeleteTask(task: Task, userId: string, role: FamilyRole): boolean {
  return role === 'owner'
    || role === 'admin'
    || task.createdBy.id === userId
}

export function canManageTaskAutomation(task: Task, userId: string, role: FamilyRole): boolean {
  return role === 'owner' || role === 'admin' || task.createdBy.id === userId
}

export function formatTaskTime(dueAt: string | null): string | null {
  if (!dueAt) return null
  const date = new Date(dueAt)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(date)
}

export function formatTaskDateTime(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
