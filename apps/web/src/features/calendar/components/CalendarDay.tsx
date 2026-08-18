import { CheckSquare } from 'lucide-react'
import type { FamilyContext } from '../../../types/domain'
import { canEditCalendarEvent, filterCalendarItems, formatAgendaDate, itemsForDate } from '../calendar-utils'
import type { CalendarEvent, CalendarFilter } from '../types'
import type { Task } from '../../tasks/types'
import { CalendarEventCard } from './CalendarEventCard'
import { reminderForSource } from '../../notifications/notification-utils'
import type { Reminder } from '../../notifications/types'

interface Props { date: Date; events: CalendarEvent[]; tasks: Task[]; filter: CalendarFilter; family: FamilyContext; reminders: Reminder[]; onEdit: (event: CalendarEvent) => void; onDelete: (event: CalendarEvent) => void; onTaskClick: (task: Task) => void; onReminder: (event: CalendarEvent) => void }

export function CalendarDay({ date, events, tasks, filter, family, reminders, onEdit, onDelete, onTaskClick, onReminder }: Props) {
  const items = filterCalendarItems(itemsForDate(events, tasks, date), filter, family.userId)
  return <section className="surface rounded-2xl p-4 sm:p-5"><h2 className="font-semibold">Plan dnia — {formatAgendaDate(date)}</h2>{items.length === 0 ? <div className="py-9 text-center"><p className="text-sm font-medium">Brak wydarzeń tego dnia.</p><p className="mt-1 text-xs text-brand-muted">Wybierz inny dzień lub dodaj wydarzenie.</p></div> : <div className="mt-4 space-y-3">{items.map((item) => item.type === 'event' ? <CalendarEventCard key={item.id} event={item.event} canManage={canEditCalendarEvent(item.event, family.userId, family.role)} onEdit={onEdit} onDelete={onDelete} reminder={reminderForSource(reminders, 'calendar_event', item.event.id)} onReminder={onReminder}/> : <button key={item.id} type="button" onClick={() => onTaskClick(item.task)} className={`w-full rounded-2xl border border-blue-400/10 bg-blue-400/[.035] p-4 text-left ${item.task.status === 'done' ? 'opacity-50' : ''}`}><div className="flex items-center gap-2"><CheckSquare className="h-4 w-4 text-blue-300"/><span className={item.task.status === 'done' ? 'line-through' : ''}>{item.task.title}</span><span className="ml-auto text-xs text-brand-muted">{item.task.dueAt ? new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(new Date(item.task.dueAt)) : ''}</span></div><p className="mt-2 text-xs text-brand-muted">Zadanie • {item.task.assignedTo?.displayName ?? 'nieprzypisane'}</p></button>)}</div>}</section>
}
