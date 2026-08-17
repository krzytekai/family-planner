import { Bell, CalendarDays, CheckSquare, CloudSun, ShoppingCart, WalletCards } from 'lucide-react'
import { ComingSoonCard } from '../../components/ComingSoonCard'
import { StatCard } from '../../components/StatCard'
import type { FamilyContext } from '../../types/domain'
import { QuickTaskAdd } from '../tasks/components/QuickTaskAdd'
import { TodayTasksCard } from '../tasks/components/TodayTasksCard'
import type { Task, TaskStats } from '../tasks/types'

interface DashboardViewProps {
  family: FamilyContext
  displayName: string
  todayTasks: Task[]
  stats: TaskStats
  loading: boolean
  error: string | null
  actionError: string | null
  updatingIds: Set<string>
  canCreateTasks: boolean
  onQuickAdd: () => void
  onViewTasks: () => void
  onToggle: (task: Task) => void
  onDelete: (task: Task) => void
}

export function DashboardView({ family, displayName, todayTasks, stats, loading, error, actionError, updatingIds, canCreateTasks, onQuickAdd, onViewTasks, onToggle, onDelete }: DashboardViewProps) {
  const taskValue = loading ? '…' : error ? '—' : String(stats.active)
  const taskDetail = error ? 'Błąd danych' : `${stats.dueToday} na dzisiaj`

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-7">
      <section className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-1 text-xs uppercase tracking-[.18em] text-brand-gold">{family.familyName}</p><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Dzień dobry, {displayName}! 👋</h1><p className="mt-1 text-sm text-brand-muted">Twoje rodzinne centrum organizacji • rola: {family.role}</p></div><QuickTaskAdd canCreate={canCreateTasks} onOpen={onQuickAdd} /></section>
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4"><StatCard icon={CheckSquare} label="Zadania" value={taskValue} detail={taskDetail} onClick={onViewTasks}/><StatCard icon={ShoppingCart} label="Zakupy" value="—" detail="w przygotowaniu"/><StatCard icon={WalletCards} label="Wydatki" value="—" detail="w przygotowaniu"/><StatCard icon={Bell} label="Powiadomienia" value="—" detail="w przygotowaniu"/></section>
      <section className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_1.15fr_.8fr]">
        <TodayTasksCard tasks={todayTasks} currentUserId={family.userId} currentUserRole={family.role} loading={loading} error={error} actionError={actionError} updatingIds={updatingIds} onToggle={onToggle} onDelete={onDelete} onViewAll={onViewTasks} />
        <ComingSoonCard icon={CalendarDays} title="Kalendarz" description="Prawdziwe wydarzenia rodzinne pojawią się w kolejnym sprincie." />
        <div className="space-y-4"><ComingSoonCard compact icon={ShoppingCart} title="Lista zakupów" description="Moduł w przygotowaniu." /><ComingSoonCard compact icon={CloudSun} title="Pogoda" description="Integracja w przygotowaniu." /></div>
      </section>
      <footer className="mt-8 text-center text-xs text-brand-muted lg:hidden">Designed & developed by Krzytek</footer>
    </div>
  )
}
