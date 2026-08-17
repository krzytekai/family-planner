import type { FamilyRole } from '../../types/domain'

export type TaskStatus = 'todo' | 'in_progress' | 'done'
export type TaskPriority = 'low' | 'normal' | 'high'

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
  dueAt: string
}

export interface TaskStats {
  active: number
  dueToday: number
}
