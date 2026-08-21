import { getSupabaseClient } from '../../../lib/supabase'
import type { FamilyRole } from '../../../types/domain'
import type { NewTaskInput, RecurrenceRule, Task, TaskMember, TaskPerson, TaskPriority, TaskStatus, UpdateTaskInput } from '../types'

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
  assignee_reminder_offset_minutes: number | null
  assignee: RelatedProfile
  creator: RelatedProfile
  occurrence_index: number
  series: { id: string; recurrence_rule: RecurrenceRule; recurrence_timezone: string; recurrence_enabled: boolean } | Array<{ id: string; recurrence_rule: RecurrenceRule; recurrence_timezone: string; recurrence_enabled: boolean }> | null
}

interface MemberRow {
  user_id: string
  display_name: string
  role: FamilyRole
}

export interface TaskRepository {
  listTasks(familyId: string): Promise<Task[]>
  listTasksInRange(familyId: string, rangeStart: Date, rangeEnd: Date): Promise<Task[]>
  listMembers(familyId: string): Promise<TaskMember[]>
  createTask(input: NewTaskInput): Promise<void>
  updateTask(input: UpdateTaskInput): Promise<void>
  stopRecurrence(taskId: string): Promise<void>
  setTaskCompleted(familyId: string, taskId: string, completed: boolean): Promise<void>
  deleteTask(familyId: string, taskId: string): Promise<void>
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
  const series = Array.isArray(row.series) ? row.series[0] : row.series

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
    recurrence: series ? {
      seriesId: series.id,
      rule: series.recurrence_rule,
      timezone: series.recurrence_timezone,
      enabled: series.recurrence_enabled,
      occurrenceIndex: row.occurrence_index,
    } : null,
    assigneeReminderOffsetMinutes: row.assignee_reminder_offset_minutes,
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
          assignee_reminder_offset_minutes,
          occurrence_index,
          series:task_recurrence_series!tasks_recurrence_series_family_fkey(id, recurrence_rule, recurrence_timezone, recurrence_enabled),
          assignee:profiles!tasks_assigned_to_fkey(id, display_name),
          creator:profiles!tasks_created_by_fkey(id, display_name)
        `)
        .eq('family_id', familyId)
        .order('due_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })

      if (error) throw new Error(error.message)
      return ((data ?? []) as unknown as TaskRow[]).map(mapTask)
    },

    async listTasksInRange(familyId, rangeStart, rangeEnd) {
      const { data, error } = await getClient()
        .from('tasks')
        .select(`
          id, family_id, title, description, status, priority, assigned_to, created_by,
          due_at, created_at, updated_at, completed_at,
          assignee_reminder_offset_minutes,
          occurrence_index,
          series:task_recurrence_series!tasks_recurrence_series_family_fkey(id, recurrence_rule, recurrence_timezone, recurrence_enabled),
          assignee:profiles!tasks_assigned_to_fkey(id, display_name),
          creator:profiles!tasks_created_by_fkey(id, display_name)
        `)
        .eq('family_id', familyId)
        .gte('due_at', rangeStart.toISOString())
        .lt('due_at', rangeEnd.toISOString())
        .order('due_at')

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
      let taskId: string
      if (input.recurrence) {
        const { data, error } = await getClient().rpc('create_recurring_task', {
          task_family_id: input.familyId,
          task_title: input.title.trim(),
          task_description: input.description.trim() || null,
          task_priority: input.priority,
          task_assigned_to: input.assignedTo,
          task_due_at: input.dueAt,
          task_recurrence_rule: input.recurrence.rule,
          task_recurrence_timezone: input.recurrence.timezone,
        })
        if (error) throw new Error(error.message)
        taskId = data as string
      } else {
        const { data, error } = await getClient().from('tasks').insert({
          family_id: input.familyId, title: input.title.trim(),
          description: input.description.trim() || null, priority: input.priority,
          assigned_to: input.assignedTo, due_at: input.dueAt,
        }).select('id').single()
        if (error) throw new Error(error.message)
        taskId = data.id
      }
      if (input.assigneeReminderOffsetMinutes !== null) {
        const { error } = await getClient().rpc('set_task_assignee_reminder', {
          target_task_id: taskId, offset_minutes: input.assigneeReminderOffsetMinutes,
        })
        if (error) throw new Error(error.message)
      }
    },

    async updateTask(input) {
      const { error } = await getClient().from('tasks').update({
        title: input.title.trim(), description: input.description.trim() || null,
        priority: input.priority, assigned_to: input.assignedTo, due_at: input.dueAt,
      }).eq('id', input.taskId).eq('family_id', input.familyId).select('id').single()
      if (error) throw new Error(error.message)
      if (input.changeRecurrence && input.recurrence) {
        const { error: recurrenceError } = await getClient().rpc('update_task_recurrence', {
          target_task_id: input.taskId, next_rule: input.recurrence.rule,
          next_timezone: input.recurrence.timezone, enabled: true,
        })
        if (recurrenceError) throw new Error(recurrenceError.message)
      } else if (input.changeRecurrence && input.stopRecurrence) {
        const { error: recurrenceError } = await getClient().rpc('update_task_recurrence', {
          target_task_id: input.taskId, next_rule: null, next_timezone: null, enabled: false,
        })
        if (recurrenceError) throw new Error(recurrenceError.message)
      }
      if (input.changeAssigneeReminder && input.assigneeReminderOffsetMinutes !== null) {
        const { error: reminderError } = await getClient().rpc('set_task_assignee_reminder', {
          target_task_id: input.taskId, offset_minutes: input.assigneeReminderOffsetMinutes,
        })
        if (reminderError) throw new Error(reminderError.message)
      } else if (input.changeAssigneeReminder) {
        const { error: reminderError } = await getClient().rpc('cancel_task_assignee_reminder', { target_task_id: input.taskId })
        if (reminderError) throw new Error(reminderError.message)
      }
    },

    async stopRecurrence(taskId) {
      const { error } = await getClient().rpc('update_task_recurrence', {
        target_task_id: taskId, next_rule: null, next_timezone: null, enabled: false,
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

    async deleteTask(familyId, taskId) {
      const { data, error } = await getClient()
        .from('tasks')
        .delete()
        .eq('id', taskId)
        .eq('family_id', familyId)
        .select('id')
        .maybeSingle()

      if (error) throw new Error(error.message)
      if (!data) throw new Error('Nie masz uprawnień do usunięcia tego zadania lub zadanie już nie istnieje.')
    },
  }
}
