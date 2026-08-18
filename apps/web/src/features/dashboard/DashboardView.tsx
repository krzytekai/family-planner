import { Bell, CheckSquare, CloudSun, ShoppingCart } from 'lucide-react'
import { ComingSoonCard } from '../../components/ComingSoonCard'
import { StatCard } from '../../components/StatCard'
import type { FamilyContext } from '../../types/domain'
import { QuickTaskAdd } from '../tasks/components/QuickTaskAdd'
import { TodayTasksCard } from '../tasks/components/TodayTasksCard'
import type { Task, TaskStats } from '../tasks/types'
import { UpcomingEventsCard } from '../calendar/components/UpcomingEventsCard'
import { ShoppingPreviewCard } from '../shopping/components/ShoppingPreviewCard'
import { useShoppingPreview } from '../shopping/hooks/useShopping'
import { BudgetDashboardStat } from '../budget/components/BudgetDashboardStat'

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
  onViewCalendar: () => void
  onViewShopping: () => void
  onToggle: (task: Task) => void
  onDelete: (task: Task) => void
  unreadNotifications: number
  onOpenNotifications: () => void
  canBudget: boolean
  onViewBudget: () => void
}

export function DashboardView({ family, displayName, todayTasks, stats, loading, error, actionError, updatingIds, canCreateTasks, onQuickAdd, onViewTasks, onViewCalendar, onViewShopping, onToggle, onDelete, unreadNotifications, onOpenNotifications, canBudget, onViewBudget }: DashboardViewProps) {
  const taskValue = loading ? '…' : error ? '—' : String(stats.active)
  const taskDetail = error ? 'Błąd danych' : `${stats.dueToday} na dzisiaj`
  const shopping = useShoppingPreview(family.familyId)

  return (
    <div className="mx-auto max-w-[1500px] p-4 md:p-7">
      <section className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-1 text-xs uppercase tracking-[.18em] text-brand-gold">{family.familyName}</p><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Dzień dobry, {displayName}! 👋</h1><p className="mt-1 text-sm text-brand-muted">Twoje rodzinne centrum organizacji • rola: {family.role}</p></div><QuickTaskAdd canCreate={canCreateTasks} onOpen={onQuickAdd} /></section>
      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4"><StatCard icon={CheckSquare} label="Zadania" value={taskValue} detail={taskDetail} onClick={onViewTasks}/><StatCard icon={ShoppingCart} label="Zakupy" value={shopping.loading ? '…' : shopping.error ? '—' : String(shopping.count)} detail={shopping.error ? 'Błąd danych' : 'produktów do kupienia'} onClick={onViewShopping}/>{canBudget?<BudgetDashboardStat familyId={family.familyId} onOpen={onViewBudget}/>:<div className="surface rounded-2xl p-4 text-sm text-brand-muted">Budżet dostępny dla dorosłych</div>}<StatCard icon={Bell} label="Powiadomienia" value={String(unreadNotifications)} detail="nieprzeczytanych" onClick={onOpenNotifications}/></section>
      <section className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_1.15fr_.8fr]">
        <TodayTasksCard tasks={todayTasks} currentUserId={family.userId} currentUserRole={family.role} loading={loading} error={error} actionError={actionError} updatingIds={updatingIds} onToggle={onToggle} onDelete={onDelete} onViewAll={onViewTasks} />
        <UpcomingEventsCard familyId={family.familyId} onViewCalendar={onViewCalendar} />
        <div className="space-y-4"><ShoppingPreviewCard compact count={shopping.count} items={shopping.items} loading={shopping.loading} error={shopping.error} onViewShopping={onViewShopping}/><ComingSoonCard compact icon={CloudSun} title="Pogoda" description="Integracja w przygotowaniu." /></div>
      </section>
      <footer className="mt-8 text-center text-xs text-brand-muted lg:hidden">Designed & developed by Krzytek</footer>
    </div>
  )
}
