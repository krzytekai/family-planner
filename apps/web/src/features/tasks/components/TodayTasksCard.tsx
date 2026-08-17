import { Check, Clock3, RotateCcw, Trash2, UserRound } from 'lucide-react'
import type { FamilyRole } from '../../../types/domain'
import { canDeleteTask, canUpdateTask, formatTaskTime } from '../task-utils'
import type { Task } from '../types'

const statusLabels = {
  todo: 'Do zrobienia',
  in_progress: 'W trakcie',
  done: 'Wykonane',
} as const

interface TodayTasksCardProps {
  tasks: Task[]
  currentUserId: string
  currentUserRole: FamilyRole
  loading: boolean
  error: string | null
  actionError: string | null
  updatingIds: Set<string>
  onToggle: (task: Task) => void
  onDelete: (task: Task) => void
  onViewAll: () => void
}

export function TodayTasksCard({ tasks, currentUserId, currentUserRole, loading, error, actionError, updatingIds, onToggle, onDelete, onViewAll }: TodayTasksCardProps) {
  return (
    <article className="surface overflow-hidden rounded-2xl">
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-4">
        <h2 className="font-semibold">Zadania na dziś</h2>
        <div className="flex items-center gap-2">{!loading ? <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs text-brand-muted">{tasks.length}</span> : null}<button type="button" onClick={onViewAll} className="text-xs font-medium text-brand-gold hover:underline">Zobacz wszystkie</button></div>
      </div>

      {loading ? <div className="space-y-3 p-5" aria-label="Ładowanie zadań"><div className="h-14 animate-pulse rounded-xl bg-white/[.035]" /><div className="h-14 animate-pulse rounded-xl bg-white/[.035]" /><div className="h-14 animate-pulse rounded-xl bg-white/[.035]" /></div> : null}
      {!loading && error ? <div className="p-5"><p role="alert" className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-sm text-red-300">Nie udało się pobrać zadań: {error}</p></div> : null}
      {!loading && !error && actionError ? <div className="px-5 pt-4"><p role="alert" className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-sm text-red-300">{actionError}</p></div> : null}
      {!loading && !error && tasks.length === 0 ? <div className="p-8 text-center"><div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-brand-gold/10 text-brand-gold"><Check className="h-5 w-5" /></div><p className="mt-3 text-sm font-medium">Brak zadań na dziś</p><p className="mt-1 text-xs text-brand-muted">Możesz spokojnie zaplanować kolejny krok.</p></div> : null}

      {!loading && !error && tasks.length > 0 ? (
        <div className="divide-y divide-white/5">
          {tasks.map((task) => {
            const done = task.status === 'done'
            const updating = updatingIds.has(task.id)
            const canToggle = canUpdateTask(task, currentUserId, currentUserRole)
            const canDelete = canDeleteTask(task, currentUserId, currentUserRole)
            const time = formatTaskTime(task.dueAt)
            return (
              <div key={task.id} className="flex items-start gap-3 px-4 py-4 sm:px-5">
                <button
                  type="button"
                  disabled={!canToggle || updating}
                  aria-label={done ? `Cofnij wykonanie: ${task.title}` : `Oznacz jako wykonane: ${task.title}`}
                  title={canToggle ? (done ? 'Cofnij wykonanie' : 'Oznacz jako wykonane') : 'Nie masz uprawnień do zmiany tego zadania'}
                  onClick={() => onToggle(task)}
                  className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-45 ${done ? 'border-brand-green bg-brand-green text-black' : 'border-white/20 hover:border-brand-gold/60'}`}
                >
                  {updating ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" /> : done ? <Check className="h-4 w-4" /> : null}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className={`text-sm font-medium ${done ? 'text-brand-muted line-through' : ''}`}>{task.title}</div>
                    <div className="flex items-center gap-1"><span className={`rounded-full px-2 py-1 text-[10px] font-medium ${done ? 'bg-brand-green/10 text-brand-green' : task.status === 'in_progress' ? 'bg-blue-400/10 text-blue-300' : 'bg-brand-gold/10 text-brand-gold'}`}>{statusLabels[task.status]}</span>{canDelete ? <button type="button" onClick={() => onDelete(task)} aria-label={`Usuń zadanie: ${task.title}`} title="Usuń zadanie" className="rounded-lg p-1.5 text-brand-muted transition hover:bg-red-400/10 hover:text-red-300"><Trash2 className="h-3.5 w-3.5" /></button> : null}</div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-brand-muted">
                    {time ? <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{time}</span> : null}
                    <span className="inline-flex items-center gap-1"><UserRound className="h-3 w-3" />Przypisano: {task.assignedTo?.displayName ?? 'nikt'}</span>
                    <span>Dodał(a): {task.createdBy.displayName}</span>
                    {done ? <span className="inline-flex items-center gap-1 text-brand-green"><RotateCcw className="h-3 w-3" />można cofnąć</span> : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </article>
  )
}
