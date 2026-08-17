import { useCallback, useEffect, useMemo, useState } from 'react'
import { createTaskRepository } from '../../tasks/api/task-repository'
import { createCalendarRepository } from '../api/calendar-repository'
import type { CalendarEvent, CalendarEventInput } from '../types'

export function useCalendar(familyId: string, rangeStart: Date, rangeEnd: Date) {
  const calendarRepository = useMemo(() => createCalendarRepository(), [])
  const taskRepository = useMemo(() => createTaskRepository(), [])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [tasks, setTasks] = useState<Awaited<ReturnType<typeof taskRepository.listTasksInRange>>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const startIso = rangeStart.toISOString()
  const endIso = rangeEnd.toISOString()

  const fetchData = useCallback(async () => {
    const start = new Date(startIso)
    const end = new Date(endIso)
    const [nextEvents, nextTasks] = await Promise.all([
      calendarRepository.listEvents(familyId, start, end),
      taskRepository.listTasksInRange(familyId, start, end),
    ])
    return { nextEvents, nextTasks }
  }, [calendarRepository, endIso, familyId, startIso, taskRepository])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void fetchData()
      .then(({ nextEvents, nextTasks }) => {
        if (!cancelled) {
          setEvents(nextEvents)
          setTasks(nextTasks)
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Nie udało się pobrać kalendarza.')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [fetchData])

  const refresh = useCallback(async () => {
    const { nextEvents, nextTasks } = await fetchData()
    setEvents(nextEvents)
    setTasks(nextTasks)
  }, [fetchData])

  const saveEvent = useCallback(async (input: CalendarEventInput, eventId?: string) => {
    setSaving(true)
    setActionError(null)
    try {
      if (eventId) await calendarRepository.updateEvent(familyId, eventId, input)
      else await calendarRepository.createEvent(input)
      await refresh()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Nie udało się zapisać wydarzenia.'
      setActionError(message)
      throw new Error(message)
    } finally {
      setSaving(false)
    }
  }, [calendarRepository, familyId, refresh])

  const deleteEvent = useCallback(async (event: CalendarEvent) => {
    setDeletingIds((current) => new Set(current).add(event.id))
    setActionError(null)
    try {
      await calendarRepository.deleteEvent(familyId, event.id)
      await refresh()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'Nie udało się usunąć wydarzenia.'
      setActionError(message)
      throw new Error(message)
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current)
        next.delete(event.id)
        return next
      })
    }
  }, [calendarRepository, familyId, refresh])

  return { events, tasks, loading, saving, deletingIds, error, actionError, saveEvent, deleteEvent }
}

export function useUpcomingCalendarEvents(familyId: string) {
  const repository = useMemo(() => createCalendarRepository(), [])
  const range = useMemo(() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 90)
    return { start, end }
  }, [])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void repository.listEvents(familyId, range.start, range.end)
      .then((data) => { if (!cancelled) setEvents(data.slice().sort((a, b) => {
        const first = new Date(a.startsAt ?? `${a.startDate}T00:00:00`).getTime()
        const second = new Date(b.startsAt ?? `${b.startDate}T00:00:00`).getTime()
        return first - second
      }).slice(0, 3)) })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Nie udało się pobrać wydarzeń.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [familyId, range, repository])

  return { events, loading, error }
}
