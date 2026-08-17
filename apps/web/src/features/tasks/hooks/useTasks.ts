import { useCallback, useEffect, useMemo, useState } from 'react'
import { createTaskRepository } from '../api/task-repository'
import { getTaskStats, getTodayTasks } from '../task-utils'
import type { NewTaskInput, Task, TaskMember } from '../types'

export function useTasks(familyId: string) {
  const repository = useMemo(() => createTaskRepository(), [])
  const [tasks, setTasks] = useState<Task[]>([])
  const [members, setMembers] = useState<TaskMember[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const [nextTasks, nextMembers] = await Promise.all([
      repository.listTasks(familyId),
      repository.listMembers(familyId),
    ])
    return { nextTasks, nextMembers }
  }, [familyId, repository])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    void fetchData()
      .then(({ nextTasks, nextMembers }) => {
        if (cancelled) return
        setTasks(nextTasks)
        setMembers(nextMembers)
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Nie udało się pobrać zadań.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [fetchData])

  const refresh = useCallback(async () => {
    const { nextTasks, nextMembers } = await fetchData()
    setTasks(nextTasks)
    setMembers(nextMembers)
  }, [fetchData])

  const createTask = useCallback(async (input: NewTaskInput) => {
    setSaving(true)
    setError(null)
    try {
      await repository.createTask(input)
      await refresh()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Nie udało się zapisać zadania.'
      setError(message)
      throw new Error(message)
    } finally {
      setSaving(false)
    }
  }, [refresh, repository])

  const toggleCompleted = useCallback(async (task: Task) => {
    setUpdatingIds((current) => new Set(current).add(task.id))
    setError(null)
    try {
      await repository.setTaskCompleted(familyId, task.id, task.status !== 'done')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się zmienić statusu zadania.')
    } finally {
      setUpdatingIds((current) => {
        const next = new Set(current)
        next.delete(task.id)
        return next
      })
    }
  }, [familyId, refresh, repository])

  const todayTasks = useMemo(() => getTodayTasks(tasks), [tasks])
  const stats = useMemo(() => getTaskStats(tasks), [tasks])

  return {
    tasks,
    todayTasks,
    members,
    stats,
    loading,
    saving,
    updatingIds,
    error,
    createTask,
    toggleCompleted,
  }
}
