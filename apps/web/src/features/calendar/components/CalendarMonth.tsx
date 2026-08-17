import { CalendarDays, CheckSquare } from 'lucide-react'
import { eventOccursOnDate, formatEventTime, taskOccursOnDate, toDateKey } from '../calendar-utils'
import type { CalendarEvent } from '../types'
import type { Task } from '../../tasks/types'

const weekdays = ['Pon', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd']

interface Props {
  days: Date[]; month: Date; selectedDate: Date; events: CalendarEvent[]; tasks: Task[]
  onSelectDate: (date: Date) => void; onEventClick: (event: CalendarEvent) => void; onTaskClick: (task: Task) => void
}

export function CalendarMonth({ days, month, selectedDate, events, tasks, onSelectDate, onEventClick, onTaskClick }: Props) {
  return <div className="surface overflow-hidden rounded-2xl"><div className="grid grid-cols-7 border-b border-white/5">{weekdays.map((day) => <div key={day} className="px-1 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-brand-muted sm:text-xs">{day}</div>)}</div><div className="grid grid-cols-7">{days.map((date) => {
    const dateEvents = events.filter((event) => eventOccursOnDate(event, date))
    const dateTasks = tasks.filter((task) => taskOccursOnDate(task, date))
    const inMonth = date.getMonth() === month.getMonth()
    const selected = toDateKey(date) === toDateKey(selectedDate)
    const today = toDateKey(date) === toDateKey(new Date())
    return <div key={toDateKey(date)} className={`min-h-16 border-b border-r border-white/5 p-1 sm:min-h-28 sm:p-2 ${!inMonth ? 'bg-black/20 text-brand-muted/40' : ''} ${selected ? 'bg-brand-gold/[.045]' : ''}`}><button type="button" aria-label={`Wybierz ${toDateKey(date)}`} onClick={() => onSelectDate(date)} className={`grid h-7 w-7 place-items-center rounded-full text-xs ${today ? 'bg-brand-gold font-bold text-black' : selected ? 'ring-1 ring-brand-gold/50' : ''}`}>{date.getDate()}</button><div className="mt-1 hidden space-y-1 sm:block">{dateEvents.slice(0, 2).map((event) => <button key={event.id} type="button" onClick={() => onEventClick(event)} className="flex w-full items-center gap-1 truncate rounded bg-brand-gold/10 px-1.5 py-1 text-left text-[10px] text-brand-gold"><CalendarDays className="h-3 w-3 shrink-0"/><span className="truncate">{event.title}</span><span className="ml-auto shrink-0 opacity-70">{formatEventTime(event)}</span></button>)}{dateTasks.slice(0, 2).map((task) => <button key={task.id} type="button" onClick={() => onTaskClick(task)} className={`flex w-full items-center gap-1 truncate rounded bg-blue-400/10 px-1.5 py-1 text-left text-[10px] text-blue-300 ${task.status === 'done' ? 'opacity-45 line-through' : ''}`}><CheckSquare className="h-3 w-3 shrink-0"/><span className="truncate">{task.title}</span></button>)}{dateEvents.length + dateTasks.length > 4 ? <button type="button" onClick={() => onSelectDate(date)} className="text-[9px] text-brand-muted">+{dateEvents.length + dateTasks.length - 4} więcej</button> : null}</div>{dateEvents.length + dateTasks.length > 0 ? <div className="mt-1 flex gap-0.5 sm:hidden">{dateEvents.length ? <span className="h-1.5 w-1.5 rounded-full bg-brand-gold"/> : null}{dateTasks.length ? <span className="h-1.5 w-1.5 rounded-full bg-blue-400"/> : null}</div> : null}</div>
  })}</div></div>
}
