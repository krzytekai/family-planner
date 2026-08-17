import type { FamilyRole } from '../../types/domain'
import type { Task, TaskStats } from './types'

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

export function canUpdateTask(task: Task, userId: string, role: FamilyRole): boolean {
  return role === 'owner'
    || role === 'admin'
    || task.createdBy.id === userId
    || task.assignedTo?.id === userId
}

export function formatTaskTime(dueAt: string | null): string | null {
  if (!dueAt) return null
  const date = new Date(dueAt)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(date)
}
