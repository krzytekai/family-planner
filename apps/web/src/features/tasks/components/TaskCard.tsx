import { BellRing, CalendarClock, Check, RotateCcw, Trash2, UserRound } from 'lucide-react'
import { formatNotificationDate } from '../../notifications/notification-utils'
import type { Reminder } from '../../notifications/types'
import type { FamilyRole } from '../../../types/domain'
import { canDeleteTask, canUpdateTask, formatTaskDateTime } from '../task-utils'
import type { Task } from '../types'

const statusLabels = {
  todo: 'Do zrobienia',
  in_progress: 'W trakcie',
  done: 'Wykonane',
} as const

const priorityLabels = {
  low: 'Niski',
  normal: 'Normalny',
  high: 'Wysoki',
} as const

const priorityClasses = {
  low: 'bg-white/5 text-brand-muted',
  normal: 'bg-blue-400/10 text-blue-300',
  high: 'bg-red-400/10 text-red-300',
} as const

interface TaskCardProps {
  task: Task
  currentUserId: string
  currentUserRole: FamilyRole
  updating: boolean
  onToggle: (task: Task) => void
  onDelete: (task: Task) => void
  reminder?: Reminder
  onReminder: (task: Task) => void
}

export function TaskCard({ task, currentUserId, currentUserRole, updating, onToggle, onDelete, reminder, onReminder }: TaskCardProps) {
  const done = task.status === 'done'
  const canToggle = canUpdateTask(task, currentUserId, currentUserRole)
  const canDelete = canDeleteTask(task, currentUserId, currentUserRole)
  const dueAt = formatTaskDateTime(task.dueAt)
  const completedAt = formatTaskDateTime(task.completedAt)

  return (
    <article className="mobile-card mobile-task-card rounded-2xl border border-white/[.07] bg-black/20 p-4 transition hover:border-brand-gold/15">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={`font-medium leading-snug ${done ? 'text-brand-muted line-through' : 'text-brand-text'}`}>{task.title}</h3>
          {task.description ? <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-brand-muted">{task.description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1"><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${done ? 'bg-brand-green/10 text-brand-green' : task.status === 'in_progress' ? 'bg-blue-400/10 text-blue-300' : 'bg-brand-gold/10 text-brand-gold'}`}>{statusLabels[task.status]}</span>{canDelete ? <button type="button" onClick={() => onDelete(task)} aria-label={`Usuń zadanie: ${task.title}`} title="Usuń zadanie" className="grid h-10 w-10 place-items-center rounded-lg text-brand-muted transition hover:bg-red-400/10 hover:text-red-300"><Trash2 className="h-[17px] w-[17px]" /></button> : null}</div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
        <span className={`rounded-full px-2 py-1 ${priorityClasses[task.priority]}`}>Priorytet: {priorityLabels[task.priority]}</span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-brand-muted"><CalendarClock className="h-3 w-3" />{dueAt ?? 'Bez terminu'}</span>
      </div>

      <dl className="mt-4 grid gap-2 text-xs text-brand-muted sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <div className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5 shrink-0" /><dt className="sr-only">Przypisano</dt><dd>Przypisano: <span className="text-brand-text/85">{task.assignedTo?.displayName ?? 'nikt'}</span></dd></div>
        <div><dt className="sr-only">Twórca</dt><dd>Dodał(a): <span className="text-brand-text/85">{task.createdBy.displayName}</span></dd></div>
        {done ? <div className="sm:col-span-2 xl:col-span-1 2xl:col-span-2"><dt className="sr-only">Data wykonania</dt><dd className="text-brand-green">Wykonano: {completedAt ?? 'brak daty'}</dd></div> : null}
      </dl>

      <div className="mt-4 flex gap-2"><button type="button" onClick={() => onReminder(task)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs text-brand-muted hover:border-brand-gold/20 hover:text-brand-gold"><BellRing className="h-3.5 w-3.5"/>{reminder ? formatNotificationDate(reminder.remindAt) : 'Przypomnij'}</button><button
        type="button"
        disabled={!canToggle || updating}
        onClick={() => onToggle(task)}
        title={canToggle ? undefined : 'Nie masz uprawnień do zmiany tego zadania'}
        className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-45 ${done ? 'border-white/10 text-brand-muted hover:bg-white/5' : 'border-brand-gold/20 text-brand-gold hover:bg-brand-gold/10'}`}
      >
        {updating ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : done ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
        {updating ? 'Zapisywanie…' : done ? 'Cofnij wykonanie' : 'Oznacz jako wykonane'}
      </button></div>
    </article>
  )
}
