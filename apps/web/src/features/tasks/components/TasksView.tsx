import { CheckCircle2, CircleDot, ClipboardList } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { FamilyContext } from '../../../types/domain'
import { filterTasks, groupTasksByStatus } from '../task-utils'
import type { Task, TaskFilter } from '../types'
import { QuickTaskAdd } from './QuickTaskAdd'
import { TaskCard } from './TaskCard'
import { reminderForSource } from '../../notifications/notification-utils'
import type { Reminder } from '../../notifications/types'

const filters: Array<{ value: TaskFilter; label: string }> = [
  { value: 'all', label: 'Wszystkie' },
  { value: 'today', label: 'Dzisiaj' },
  { value: 'mine', label: 'Moje' },
  { value: 'active', label: 'Do zrobienia' },
  { value: 'done', label: 'Wykonane' },
  { value: 'recurring', label: 'Cykliczne' },
]

const groups = [
  { status: 'todo', title: 'Do zrobienia', icon: ClipboardList, empty: 'Brak zadań do zrobienia.' },
  { status: 'in_progress', title: 'W trakcie', icon: CircleDot, empty: 'Brak zadań w trakcie.' },
  { status: 'done', title: 'Wykonane', icon: CheckCircle2, empty: 'Brak wykonanych zadań.' },
] as const

interface TasksViewProps {
  family: FamilyContext
  tasks: Task[]
  loading: boolean
  error: string | null
  actionError: string | null
  updatingIds: Set<string>
  canCreate: boolean
  onQuickAdd: () => void
  onToggle: (task: Task) => void
  onDelete: (task: Task) => void
  reminders: Reminder[]
  onReminder: (task: Task) => void
  onEdit: (task: Task) => void
  onStopRecurrence: (task: Task) => void
}

export function TasksView({ family, tasks, loading, error, actionError, updatingIds, canCreate, onQuickAdd, onToggle, onDelete, reminders, onReminder, onEdit, onStopRecurrence }: TasksViewProps) {
  const [filter, setFilter] = useState<TaskFilter>('all')
  const filteredTasks = useMemo(() => filterTasks(tasks, filter, family.userId), [family.userId, filter, tasks])
  const groupedTasks = useMemo(() => groupTasksByStatus(filteredTasks), [filteredTasks])

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-7">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="view-heading-identity"><p className="mb-1 text-xs uppercase tracking-[.18em] text-brand-gold">{family.familyName}</p><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Zadania rodziny</h1></div><p className="mt-1 text-sm text-brand-muted">Wszystkie zadania, terminy i przypisania w jednym miejscu.</p></div>
        <QuickTaskAdd canCreate={canCreate} onOpen={onQuickAdd} />
      </section>

      <div className="scrollbar-none mt-6 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtry zadań">
        {filters.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)} className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-medium transition ${filter === item.value ? 'border-brand-gold/30 bg-brand-gold text-black' : 'border-white/10 bg-white/[.025] text-brand-muted hover:border-brand-gold/20 hover:text-brand-text'}`}>{item.label}</button>)}
      </div>
      {!loading && !error && actionError ? <p role="alert" className="mt-4 rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-sm text-red-300">{actionError}</p> : null}

      {loading ? <div className="mt-5 grid gap-4 lg:grid-cols-3" aria-label="Ładowanie zadań">{groups.map(({ status }) => <div key={status} className="surface h-72 animate-pulse rounded-2xl" />)}</div> : null}
      {!loading && error ? <div className="surface mt-5 rounded-2xl p-5"><p role="alert" className="rounded-xl border border-red-400/15 bg-red-400/5 p-4 text-sm text-red-300">Nie udało się pobrać zadań: {error}</p></div> : null}
      {!loading && !error && filteredTasks.length === 0 ? <div className="surface mt-5 rounded-2xl p-10 text-center"><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-brand-gold/10 text-brand-gold"><ClipboardList className="h-6 w-6" /></div><h2 className="mt-4 font-semibold">Brak zadań dla tego filtra</h2><p className="mt-1 text-sm text-brand-muted">Wybierz inny filtr lub dodaj nowe zadanie.</p></div> : null}

      {!loading && !error && filteredTasks.length > 0 ? <div className="mt-5 grid items-start gap-4 lg:grid-cols-3">{groups.map(({ status, title, icon: Icon, empty }) => <section key={status} className="surface overflow-hidden rounded-2xl"><header className="flex items-center justify-between border-b border-white/5 px-4 py-3.5"><h2 className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-brand-gold" />{title}</h2><span className="rounded-full bg-white/5 px-2 py-1 text-[10px] text-brand-muted">{groupedTasks[status].length}</span></header><div className="space-y-3 p-3">{groupedTasks[status].length > 0 ? groupedTasks[status].map((task) => <TaskCard key={task.id} task={task} currentUserId={family.userId} currentUserRole={family.role} updating={updatingIds.has(task.id)} onToggle={onToggle} onDelete={onDelete} reminder={reminderForSource(reminders, 'task', task.id)} onReminder={onReminder} onEdit={onEdit} onStopRecurrence={onStopRecurrence} />) : <p className="px-2 py-8 text-center text-xs text-brand-muted">{empty}</p>}</div></section>)}</div> : null}
    </div>
  )
}
