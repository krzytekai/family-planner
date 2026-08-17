import { getSupabaseClient } from '../../../lib/supabase'
import type { FamilyRole } from '../../../types/domain'
import type { NewTaskInput, Task, TaskMember, TaskPerson, TaskPriority, TaskStatus } from '../types'

type RelatedProfile = { id: string; display_name: string } | Array<{ id: string; display_name: string }> | null

interface TaskRow {
  id: string
  family_id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assigned_to: string | null
  created_by: string
  due_at: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  assignee: RelatedProfile
  creator: RelatedProfile
}

interface MemberRow {
  user_id: string
  display_name: string
  role: FamilyRole
}

export interface TaskRepository {
  listTasks(familyId: string): Promise<Task[]>
  listMembers(familyId: string): Promise<TaskMember[]>
  createTask(input: NewTaskInput): Promise<void>
  setTaskCompleted(familyId: string, taskId: string, completed: boolean): Promise<void>
}

function getClient() {
  const client = getSupabaseClient()
  if (!client) throw new Error('Brak konfiguracji Supabase.')
  return client
}

function profileFromRelation(value: RelatedProfile): TaskPerson | null {
  const profile = Array.isArray(value) ? value[0] : value
  return profile ? { id: profile.id, displayName: profile.display_name } : null
}

function mapTask(row: TaskRow): Task {
  const creator = profileFromRelation(row.creator) ?? {
    id: row.created_by,
    displayName: 'Nieaktywny użytkownik',
  }
  const assignee = profileFromRelation(row.assignee)
    ?? (row.assigned_to ? { id: row.assigned_to, displayName: 'Nieaktywny użytkownik' } : null)

  return {
    id: row.id,
    familyId: row.family_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    assignedTo: assignee,
    dueAt: row.due_at,
    createdBy: creator,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

export function createTaskRepository(): TaskRepository {
  return {
    async listTasks(familyId) {
      const { data, error } = await getClient()
        .from('tasks')
        .select(`
          id,
          family_id,
          title,
          description,
          status,
          priority,
          assigned_to,
          created_by,
          due_at,
          created_at,
          updated_at,
          completed_at,
          assignee:profiles!tasks_assigned_to_fkey(id, display_name),
          creator:profiles!tasks_created_by_fkey(id, display_name)
        `)
        .eq('family_id', familyId)
        .order('due_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })

      if (error) throw new Error(error.message)
      return ((data ?? []) as unknown as TaskRow[]).map(mapTask)
    },

    async listMembers(familyId) {
      const { data, error } = await getClient()
        .from('family_members')
        .select('user_id, display_name, role')
        .eq('family_id', familyId)
        .eq('status', 'active')
        .order('display_name')

      if (error) throw new Error(error.message)
      return ((data ?? []) as MemberRow[]).map((member) => ({
        userId: member.user_id,
        displayName: member.display_name,
        role: member.role,
      }))
    },

    async createTask(input) {
      const { error } = await getClient().from('tasks').insert({
        family_id: input.familyId,
        title: input.title.trim(),
        description: input.description.trim() || null,
        priority: input.priority,
        assigned_to: input.assignedTo,
        due_at: input.dueAt,
      })

      if (error) throw new Error(error.message)
    },

    async setTaskCompleted(familyId, taskId, completed) {
      const { error } = await getClient()
        .from('tasks')
        .update({
          status: completed ? 'done' : 'todo',
        })
        .eq('id', taskId)
        .eq('family_id', familyId)
        .select('id')
        .single()

      if (error) throw new Error(error.message)
    },
  }
}
