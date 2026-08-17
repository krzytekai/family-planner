import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Bell, CalendarDays, CheckSquare, CloudSun, LogOut, Search, ShoppingCart, WalletCards } from 'lucide-react'
import { Sidebar } from '../components/Sidebar'
import { MobileNav } from '../components/MobileNav'
import { StatCard } from '../components/StatCard'
import { ComingSoonCard } from '../components/ComingSoonCard'
import { AuthGate } from '../features/auth/AuthGate'
import { FamilySetup } from '../features/family/FamilySetup'
import { useFamilyContext } from '../features/family/useFamilyContext'
import { AdminPanel } from '../features/admin/AdminPanel'
import { getSupabaseClient } from '../lib/supabase'
import { QuickTaskAdd } from '../features/tasks/components/QuickTaskAdd'
import { TodayTasksCard } from '../features/tasks/components/TodayTasksCard'
import { useTasks } from '../features/tasks/hooks/useTasks'

function Planner({ session }: { session: Session }) {
  const { family, loading, error } = useFamilyContext(session.user.id)
  const [adminOpen, setAdminOpen] = useState(false)

  if (loading) return <div className="grid min-h-screen place-items-center bg-brand-bg text-brand-muted">Ładowanie rodziny…</div>
  if (error) return <div className="grid min-h-screen place-items-center bg-brand-bg p-6 text-center text-red-300">Błąd konfiguracji bazy: {error}</div>
  if (!family) return <FamilySetup onDone={() => window.location.reload()} />

  const canAdmin = family.role === 'owner' || family.role === 'admin'
  const displayName = family.displayName

  return <FamilyPlanner family={family} canAdmin={canAdmin} adminOpen={adminOpen} setAdminOpen={setAdminOpen} displayName={displayName} />
}

interface FamilyPlannerProps {
  family: NonNullable<ReturnType<typeof useFamilyContext>['family']>
  canAdmin: boolean
  adminOpen: boolean
  setAdminOpen: (open: boolean) => void
  displayName: string
}

function FamilyPlanner({ family, canAdmin, adminOpen, setAdminOpen, displayName }: FamilyPlannerProps) {
  const taskState = useTasks(family.familyId)
  const canCreateTasks = family.role === 'owner' || family.role === 'admin' || family.role === 'adult'
  const taskValue = taskState.loading ? '…' : taskState.error ? '—' : String(taskState.stats.active)
  const taskDetail = taskState.error ? 'Błąd danych' : `${taskState.stats.dueToday} do zrobienia dzisiaj`

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <Sidebar familyName={family.familyName} canAdmin={canAdmin} onAdmin={()=>setAdminOpen(true)} />
      <MobileNav />
      <main className="pb-24 lg:ml-64 lg:pb-8">
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-white/5 bg-brand-bg/85 px-4 backdrop-blur-xl md:px-7">
          <div className="relative hidden max-w-md flex-1 md:block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted"/><input aria-label="Szukaj w planerze" placeholder="Szukaj w planerze..." className="w-full rounded-xl border border-white/10 bg-white/[0.025] py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-gold/40"/></div>
          <div className="ml-auto flex items-center gap-2"><button disabled aria-label="Powiadomienia — w przygotowaniu" title="Powiadomienia — w przygotowaniu" className="rounded-xl p-2 text-brand-muted opacity-50"><Bell className="h-5 w-5"/></button><div className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.025] px-2.5 py-2"><div className="grid h-8 w-8 place-items-center rounded-full bg-brand-gold/15 text-xs font-bold text-brand-gold">{displayName.slice(0,1).toUpperCase()}</div><span className="hidden text-sm font-medium sm:block">{displayName}</span></div><button aria-label="Wyloguj" title="Wyloguj" onClick={()=>void getSupabaseClient()?.auth.signOut()} className="rounded-xl p-2 text-brand-muted hover:bg-white/5 hover:text-brand-text"><LogOut className="h-4 w-4"/></button></div>
        </header>
        <div className="mx-auto max-w-[1500px] p-4 md:p-7">
          <section className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-1 text-xs uppercase tracking-[.18em] text-brand-gold">{family.familyName}</p><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Dzień dobry, {displayName}! 👋</h1><p className="mt-1 text-sm text-brand-muted">Twoje rodzinne centrum organizacji • rola: {family.role}</p></div><QuickTaskAdd familyId={family.familyId} members={taskState.members} canCreate={canCreateTasks} saving={taskState.saving} onCreate={taskState.createTask} /></section>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4"><StatCard icon={CheckSquare} label="Zadania" value={taskValue} detail={taskDetail}/><StatCard icon={ShoppingCart} label="Zakupy" value="—" detail="w przygotowaniu"/><StatCard icon={WalletCards} label="Wydatki" value="—" detail="w przygotowaniu"/><StatCard icon={Bell} label="Powiadomienia" value="—" detail="w przygotowaniu"/></section>
          <section className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_1.15fr_.8fr]">
            <TodayTasksCard tasks={taskState.todayTasks} currentUserId={family.userId} currentUserRole={family.role} loading={taskState.loading} error={taskState.error} updatingIds={taskState.updatingIds} onToggle={(task) => void taskState.toggleCompleted(task)} />
            <ComingSoonCard icon={CalendarDays} title="Kalendarz" description="Prawdziwe wydarzenia rodzinne pojawią się w kolejnym sprincie." />
            <div className="space-y-4"><ComingSoonCard compact icon={ShoppingCart} title="Lista zakupów" description="Moduł w przygotowaniu." /><ComingSoonCard compact icon={CloudSun} title="Pogoda" description="Integracja w przygotowaniu." /></div>
          </section>
          <footer className="mt-8 text-center text-xs text-brand-muted lg:hidden">Designed & developed by Krzytek</footer>
        </div>
      </main>
      {adminOpen && canAdmin ? <AdminPanel family={family} onClose={()=>setAdminOpen(false)}/> : null}
    </div>
  )
}

export function App() {
  return <AuthGate>{(session)=><Planner session={session}/>}</AuthGate>
}
