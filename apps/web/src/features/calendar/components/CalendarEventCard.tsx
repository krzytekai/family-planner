import { BellRing, CalendarDays, Clock3, MapPin, Pencil, Trash2 } from 'lucide-react'
import { formatNotificationDate } from '../../notifications/notification-utils'
import type { Reminder } from '../../notifications/types'
import { formatEventTime } from '../calendar-utils'
import type { CalendarEvent } from '../types'

const typeLabels = {
  family: 'Rodzinne', appointment: 'Wizyta', school: 'Szkoła', work: 'Praca', birthday: 'Urodziny', other: 'Inne',
} as const

interface CalendarEventCardProps {
  event: CalendarEvent
  canManage: boolean
  onEdit: (event: CalendarEvent) => void
  onDelete: (event: CalendarEvent) => void
  compact?: boolean
  reminder?: Reminder
  onReminder?: (event: CalendarEvent) => void
}

export function CalendarEventCard({ event, canManage, onEdit, onDelete, compact = false, reminder, onReminder }: CalendarEventCardProps) {
  return (
    <article className={`rounded-2xl border border-brand-gold/10 bg-brand-gold/[.035] ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 shrink-0 text-brand-gold"/><h3 className="truncate font-medium">{event.title}</h3></div>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-brand-muted"><span className="rounded-full bg-white/5 px-2 py-1">{typeLabels[event.eventType]}</span><span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3"/>{formatEventTime(event)}</span>{event.location ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3"/>{event.location}</span> : null}</div>
        </div>
        {canManage ? <div className="flex shrink-0 gap-1"><button type="button" onClick={() => onEdit(event)} aria-label={`Edytuj wydarzenie: ${event.title}`} className="rounded-lg p-1.5 text-brand-muted hover:bg-white/5 hover:text-brand-gold"><Pencil className="h-3.5 w-3.5"/></button><button type="button" onClick={() => onDelete(event)} aria-label={`Usuń wydarzenie: ${event.title}`} className="rounded-lg p-1.5 text-brand-muted hover:bg-red-400/10 hover:text-red-300"><Trash2 className="h-3.5 w-3.5"/></button></div> : null}
      </div>
      {!compact && event.description ? <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-brand-muted">{event.description}</p> : null}
      {!compact ? <p className="mt-3 text-xs text-brand-muted">Dodał(a): <span className="text-brand-text/80">{event.createdBy.displayName}</span></p> : null}
      {!compact && onReminder ? <button type="button" onClick={() => onReminder(event)} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-brand-muted hover:border-brand-gold/20 hover:text-brand-gold"><BellRing className="h-3.5 w-3.5"/>{reminder ? formatNotificationDate(reminder.remindAt) : 'Przypomnij'}</button> : null}
    </article>
  )
}
