import type { FamilyRole } from '../../types/domain'

export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'low' | 'normal' | 'high'
export type TaskFilter = 'all' | 'today' | 'mine' | 'active' | 'done' | 'recurring'
export type RecurrenceType = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface RecurrenceRule {
  type: RecurrenceType
  interval: number
  weekdays?: number[]
  day_of_month?: number
  month?: number
}

export interface TaskRecurrence {
  seriesId: string
  rule: RecurrenceRule
  timezone: string
  enabled: boolean
  occurrenceIndex: number
}

export interface TaskPerson {
  id: string
  displayName: string
}

export interface Task {
  id: string
  familyId: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assignedTo: TaskPerson | null
  dueAt: string | null
  createdBy: TaskPerson
  createdAt: string
  updatedAt: string
  completedAt: string | null
  recurrence: TaskRecurrence | null
  assigneeReminderOffsetMinutes: number | null
}

export interface TaskMember {
  userId: string
  displayName: string
  role: FamilyRole
}

export interface NewTaskInput {
  familyId: string
  title: string
  description: string
  priority: TaskPriority
  assignedTo: string | null
  dueAt: string | null
  recurrence: { rule: RecurrenceRule; timezone: string } | null
  assigneeReminderOffsetMinutes: number | null
}

export interface UpdateTaskInput extends NewTaskInput {
  taskId: string
  stopRecurrence: boolean
  changeRecurrence: boolean
  changeAssigneeReminder: boolean
}

export interface TaskStats {
  active: number
  dueToday: number
}
