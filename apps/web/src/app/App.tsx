import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Bell, LogOut, Search } from 'lucide-react'
import { Sidebar } from '../components/Sidebar'
import { MobileNav } from '../components/MobileNav'
import { AuthGate } from '../features/auth/AuthGate'
import { FamilySetup } from '../features/family/FamilySetup'
import { useFamilyContext } from '../features/family/useFamilyContext'
import { AdminPanel } from '../features/admin/AdminPanel'
import { getSupabaseClient } from '../lib/supabase'
import { useTasks } from '../features/tasks/hooks/useTasks'
import { QuickTaskModal } from '../features/tasks/components/QuickTaskModal'
import { TasksView } from '../features/tasks/components/TasksView'
import { DashboardView } from '../features/dashboard/DashboardView'
import type { AppView } from './navigation'

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
  const [activeView, setActiveView] = useState<AppView>('dashboard')
  const [quickTaskOpen, setQuickTaskOpen] = useState(false)
  const canCreateTasks = family.role === 'owner' || family.role === 'admin' || family.role === 'adult'

  function navigate(view: AppView) {
    setActiveView(view)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function openQuickTask() {
    if (canCreateTasks) setQuickTaskOpen(true)
  }

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <Sidebar familyName={family.familyName} canAdmin={canAdmin} activeView={activeView} onNavigate={navigate} onAdmin={()=>setAdminOpen(true)} />
      <MobileNav activeView={activeView} canCreateTask={canCreateTasks} onNavigate={navigate} onQuickAdd={openQuickTask} />
      <main className="pb-24 lg:ml-64 lg:pb-8">
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-white/5 bg-brand-bg/85 px-4 backdrop-blur-xl md:px-7">
          <div className="relative hidden max-w-md flex-1 md:block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted/50"/><input disabled aria-label="Wyszukiwanie — w przygotowaniu" placeholder="Wyszukiwanie — w przygotowaniu" className="w-full cursor-not-allowed rounded-xl border border-white/5 bg-white/[0.015] py-2.5 pl-10 pr-4 text-sm text-brand-muted/50 outline-none"/></div>
          <div className="ml-auto flex items-center gap-2"><button disabled aria-label="Powiadomienia — w przygotowaniu" title="Powiadomienia — w przygotowaniu" className="rounded-xl p-2 text-brand-muted opacity-50"><Bell className="h-5 w-5"/></button><div className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.025] px-2.5 py-2"><div className="grid h-8 w-8 place-items-center rounded-full bg-brand-gold/15 text-xs font-bold text-brand-gold">{displayName.slice(0,1).toUpperCase()}</div><span className="hidden text-sm font-medium sm:block">{displayName}</span></div><button aria-label="Wyloguj" title="Wyloguj" onClick={()=>void getSupabaseClient()?.auth.signOut()} className="rounded-xl p-2 text-brand-muted hover:bg-white/5 hover:text-brand-text"><LogOut className="h-4 w-4"/></button></div>
        </header>
        {activeView === 'dashboard' ? <DashboardView family={family} displayName={displayName} todayTasks={taskState.todayTasks} stats={taskState.stats} loading={taskState.loading} error={taskState.error} actionError={taskState.actionError} updatingIds={taskState.updatingIds} canCreateTasks={canCreateTasks} onQuickAdd={openQuickTask} onViewTasks={() => navigate('tasks')} onToggle={(task) => void taskState.toggleCompleted(task)} /> : null}
        {activeView === 'tasks' ? <TasksView family={family} tasks={taskState.tasks} loading={taskState.loading} error={taskState.error} actionError={taskState.actionError} updatingIds={taskState.updatingIds} canCreate={canCreateTasks} onQuickAdd={openQuickTask} onToggle={(task) => void taskState.toggleCompleted(task)} /> : null}
      </main>
      {adminOpen && canAdmin ? <AdminPanel family={family} onClose={()=>setAdminOpen(false)}/> : null}
      {quickTaskOpen ? <QuickTaskModal familyId={family.familyId} members={taskState.members} saving={taskState.saving} onCreate={taskState.createTask} onClose={() => setQuickTaskOpen(false)} /> : null}
    </div>
  )
}

export function App() {
  return <AuthGate>{(session)=><Planner session={session}/>}</AuthGate>
}
