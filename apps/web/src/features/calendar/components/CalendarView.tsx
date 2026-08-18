import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react'
import type { FamilyContext } from '../../../types/domain'
import type { Reminder } from '../../notifications/types'
import type { Task } from '../../tasks/types'
import { canCreateCalendarEvent, canEditCalendarEvent, filterCalendarItems, formatMonthYear, getMonthGrid, getMonthGridRange, itemsForDate } from '../calendar-utils'
import { useCalendar } from '../hooks/useCalendar'
import type { CalendarEvent, CalendarFilter } from '../types'
import { CalendarDay } from './CalendarDay'
import { CalendarEventModal } from './CalendarEventModal'
import { CalendarMonth } from './CalendarMonth'
import { DeleteCalendarEventModal } from './DeleteCalendarEventModal'

const filters: Array<{ value: CalendarFilter; label: string }> = [
  { value: 'all', label: 'Wszystko' }, { value: 'events', label: 'Wydarzenia' },
  { value: 'tasks', label: 'Zadania' }, { value: 'mine', label: 'Moje' },
]

interface Props { family: FamilyContext; createRequest: number; reminders: Reminder[]; onViewTask: (task: Task) => void; onReminder: (event: CalendarEvent) => void }

export function CalendarView({ family, createRequest, reminders, onViewTask, onReminder }: Props) {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [filter, setFilter] = useState<CalendarFilter>('all')
  const [editor, setEditor] = useState<{ event: CalendarEvent | null; date: Date } | null>(null)
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null)
  const handledCreateRequest = useRef(createRequest)
  const days = useMemo(() => getMonthGrid(month), [month])
  const range = useMemo(() => getMonthGridRange(month), [month])
  const calendar = useCalendar(family.familyId, range.start, range.end)
  const canCreate = canCreateCalendarEvent(family.role)
  useEffect(() => { if (createRequest !== handledCreateRequest.current) { handledCreateRequest.current = createRequest; if (canCreate) setEditor({ event: null, date: selectedDate }) } }, [canCreate, createRequest, selectedDate])
  const allItems = useMemo(() => days.flatMap((date) => itemsForDate(calendar.events, calendar.tasks, date)), [calendar.events, calendar.tasks, days])
  const filtered = useMemo(() => filterCalendarItems(allItems, filter, family.userId), [allItems, family.userId, filter])
  const visibleEventIds = useMemo(() => new Set(filtered.filter((item) => item.type === 'event').map((item) => item.event.id)), [filtered])
  const visibleTaskIds = useMemo(() => new Set(filtered.filter((item) => item.type === 'task').map((item) => item.task.id)), [filtered])
  const visibleEvents = calendar.events.filter((event) => visibleEventIds.has(event.id))
  const visibleTasks = calendar.tasks.filter((task) => visibleTaskIds.has(task.id))
  function goToMonth(offset: number) { setMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1)) }
  function goToday() { const today = new Date(); setMonth(new Date(today.getFullYear(), today.getMonth(), 1)); setSelectedDate(today) }
  function selectDate(date: Date) { setSelectedDate(date); if (date.getMonth() !== month.getMonth()) setMonth(new Date(date.getFullYear(), date.getMonth(), 1)) }
  function openEvent(event: CalendarEvent) { if (canEditCalendarEvent(event, family.userId, family.role)) setEditor({ event, date: selectedDate }) }

  return <div className="mx-auto max-w-[1500px] p-4 md:p-7">
    <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-1 text-xs uppercase tracking-[.18em] text-brand-gold">{family.familyName}</p><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Kalendarz rodzinny</h1><p className="mt-1 text-sm text-brand-muted">Wydarzenia i terminy zadań w jednym widoku.</p></div>{canCreate ? <button type="button" onClick={() => setEditor({ event: null, date: selectedDate })} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gold px-4 py-2.5 text-sm font-semibold text-black"><CalendarPlus className="h-4 w-4"/>Dodaj wydarzenie</button> : null}</section>
    <section className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center justify-between gap-2"><button type="button" onClick={() => goToMonth(-1)} aria-label="Poprzedni miesiąc" className="rounded-xl border border-white/10 p-2 text-brand-muted"><ChevronLeft className="h-5 w-5"/></button><button type="button" onClick={goToday} className="rounded-xl border border-white/10 px-3 py-2 text-xs text-brand-muted">Dzisiaj</button><button type="button" onClick={() => goToMonth(1)} aria-label="Następny miesiąc" className="rounded-xl border border-white/10 p-2 text-brand-muted"><ChevronRight className="h-5 w-5"/></button></div><h2 className="text-center text-lg font-semibold sm:order-first sm:min-w-52 sm:text-left">{formatMonthYear(month)}</h2><div className="scrollbar-none flex gap-1 overflow-x-auto">{filters.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${filter === item.value ? 'border-brand-gold/30 bg-brand-gold text-black' : 'border-white/10 text-brand-muted'}`}>{item.label}</button>)}</div></section>
    {calendar.actionError ? <p role="alert" className="mt-4 rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-sm text-red-300">{calendar.actionError}</p> : null}
    {calendar.loading ? <div className="surface mt-4 h-[38rem] animate-pulse rounded-2xl"/> : null}
    {!calendar.loading && calendar.error ? <p role="alert" className="surface mt-4 rounded-2xl p-5 text-red-300">Nie udało się pobrać kalendarza: {calendar.error}</p> : null}
    {!calendar.loading && !calendar.error ? <><div className="mt-4"><CalendarMonth days={days} month={month} selectedDate={selectedDate} events={visibleEvents} tasks={visibleTasks} onSelectDate={selectDate} onEventClick={openEvent} onTaskClick={onViewTask}/></div>{filtered.length === 0 ? <p className="mt-3 text-center text-xs text-brand-muted">Brak wpisów w tym miesiącu.</p> : null}<div className="mt-4"><CalendarDay date={selectedDate} events={visibleEvents} tasks={visibleTasks} filter="all" family={family} reminders={reminders} onEdit={(event) => setEditor({ event, date: selectedDate })} onDelete={setDeleting} onTaskClick={onViewTask} onReminder={onReminder}/></div></> : null}
    {editor ? <CalendarEventModal familyId={family.familyId} event={editor.event} initialDate={editor.date} saving={calendar.saving} onSave={calendar.saveEvent} onClose={() => setEditor(null)}/> : null}
    {deleting ? <DeleteCalendarEventModal event={deleting} deleting={calendar.deletingIds.has(deleting.id)} onDelete={calendar.deleteEvent} onClose={() => setDeleting(null)}/> : null}
  </div>
}
