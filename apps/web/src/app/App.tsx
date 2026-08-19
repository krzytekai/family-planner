import { useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { LogOut, Search } from 'lucide-react'
import { MobileNav } from '../components/MobileNav'
import { Sidebar } from '../components/Sidebar'
import { AdminPanel } from '../features/admin/AdminPanel'
import { AuthGate } from '../features/auth/AuthGate'
import { CalendarView } from '../features/calendar/components/CalendarView'
import type { CalendarEvent } from '../features/calendar/types'
import { DashboardView } from '../features/dashboard/DashboardView'
import { FamilySetup } from '../features/family/FamilySetup'
import { useFamilyContext } from '../features/family/useFamilyContext'
import { NotificationBell } from '../features/notifications/components/NotificationBell'
import { NotificationCenter } from '../features/notifications/components/NotificationCenter'
import { ReminderModal } from '../features/notifications/components/ReminderModal'
import { useNotifications } from '../features/notifications/hooks/useNotifications'
import { useReminders } from '../features/notifications/hooks/useReminders'
import { notificationDestination, reminderForSource } from '../features/notifications/notification-utils'
import type { Reminder, ReminderSource } from '../features/notifications/types'
import { ShoppingView } from '../features/shopping/components/ShoppingView'
import { DeleteTaskModal } from '../features/tasks/components/DeleteTaskModal'
import { QuickTaskModal } from '../features/tasks/components/QuickTaskModal'
import { TasksView } from '../features/tasks/components/TasksView'
import { useTasks } from '../features/tasks/hooks/useTasks'
import type { Task } from '../features/tasks/types'
import { getSupabaseClient } from '../lib/supabase'
import type { AppView } from './navigation'
import { BudgetView } from '../features/budget/components/BudgetView'
import { canViewBudget } from '../features/budget/budget-utils'
import { NATIVE_BACK_EVENT, useNativeBackButton } from './native-platform'

function Planner({ session }: { session: Session }) {
  const { family, loading, error } = useFamilyContext(session.user.id)
  const [adminOpen, setAdminOpen] = useState(false)
  if (loading) return <div className="grid min-h-screen place-items-center bg-brand-bg text-brand-muted">Ładowanie rodziny…</div>
  if (error) return <div className="grid min-h-screen place-items-center bg-brand-bg p-6 text-center text-red-300">Błąd konfiguracji bazy: {error}</div>
  if (!family) return <FamilySetup onDone={() => window.location.reload()} />
  return <FamilyPlanner family={family} canAdmin={family.role === 'owner' || family.role === 'admin'} adminOpen={adminOpen} setAdminOpen={setAdminOpen} displayName={family.displayName}/>
}

interface FamilyPlannerProps { family: NonNullable<ReturnType<typeof useFamilyContext>['family']>; canAdmin: boolean; adminOpen: boolean; setAdminOpen: (open: boolean) => void; displayName: string }

function FamilyPlanner({ family, canAdmin, adminOpen, setAdminOpen, displayName }: FamilyPlannerProps) {
  const taskState = useTasks(family.familyId)
  const notificationState = useNotifications(family.familyId)
  const reminderState = useReminders(family.familyId)
  const [activeView, setActiveView] = useState<AppView>('dashboard')
  const [quickTaskOpen, setQuickTaskOpen] = useState(false)
  const [calendarCreateRequest, setCalendarCreateRequest] = useState(0)
  const [shoppingCreateRequest, setShoppingCreateRequest] = useState(0)
  const [budgetCreateRequest, setBudgetCreateRequest] = useState(0)
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null)
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false)
  const [reminderSource, setReminderSource] = useState<ReminderSource | null>(null)
  const viewHistory = useRef<AppView[]>(['dashboard'])
  const canCreateTasks = family.role === 'owner' || family.role === 'admin' || family.role === 'adult'
  const canBudget = canViewBudget(family.role)

  function showView(view: AppView) { setActiveView(view); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  function navigate(view: AppView) { if ((view === 'budget' && !canBudget) || view === activeView) return; viewHistory.current.push(view); showView(view) }
  function openQuickTask() { if (canCreateTasks) setQuickTaskOpen(true) }
  function openContextualQuickAdd() { if (activeView === 'calendar') setCalendarCreateRequest((value) => value + 1); else if (activeView === 'shopping') setShoppingCreateRequest((value) => value + 1); else if (activeView === 'budget' && canBudget) setBudgetCreateRequest((value) => value + 1); else openQuickTask() }
  function remindTask(task: Task) { setReminderSource({ type: 'task', id: task.id, title: task.title, occursAt: task.dueAt }) }
  function remindEvent(event: CalendarEvent) { setReminderSource({ type: 'calendar_event', id: event.id, title: event.title, occursAt: event.allDay && event.startDate ? new Date(`${event.startDate}T09:00:00`).toISOString() : event.startsAt }) }
  function editReminder(reminder: Reminder) { setReminderSource({ type: reminder.sourceType, id: reminder.sourceId, title: reminder.title?.replace(/^Przypomnienie: /, '') ?? 'Wpis', occursAt: reminder.remindAt }) }

  useNativeBackButton(() => {
    if (reminderSource) { setReminderSource(null); return }
    if (notificationCenterOpen) { setNotificationCenterOpen(false); return }
    if (taskToDelete) { setTaskToDelete(null); return }
    if (quickTaskOpen) { setQuickTaskOpen(false); return }
    if (adminOpen) { setAdminOpen(false); return }

    const overlayBack = new Event(NATIVE_BACK_EVENT, { cancelable: true })
    window.dispatchEvent(overlayBack)
    if (overlayBack.defaultPrevented) return

    if (viewHistory.current.length > 1) {
      viewHistory.current.pop()
      showView(viewHistory.current.at(-1) ?? 'dashboard')
    }
  })

  return <div className="app-mobile-density min-h-screen bg-brand-bg text-brand-text">
    <Sidebar familyName={family.familyName} canAdmin={canAdmin} canBudget={canBudget} activeView={activeView} onNavigate={navigate} onAdmin={() => setAdminOpen(true)}/>
    <MobileNav activeView={activeView} canBudget={canBudget} canQuickAdd={activeView === 'shopping' || activeView === 'budget' || canCreateTasks} onNavigate={navigate} onQuickAdd={openContextualQuickAdd}/>
    <main className="mobile-nav-safe-content lg:ml-64 lg:pb-8">
      <header className="app-topbar sticky top-0 z-30 flex h-20 items-center justify-between border-b border-white/5 bg-brand-bg/85 px-4 backdrop-blur-xl md:px-7"><div className="relative hidden max-w-md flex-1 md:block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted/50"/><input disabled aria-label="Wyszukiwanie — w przygotowaniu" placeholder="Wyszukiwanie — w przygotowaniu" className="w-full cursor-not-allowed rounded-xl border border-white/5 bg-white/[0.015] py-2.5 pl-10 pr-4 text-sm text-brand-muted/50 outline-none"/></div><div className="ml-auto flex items-center gap-1.5 sm:gap-2"><NotificationBell unreadCount={notificationState.unreadCount} onClick={() => { setNotificationCenterOpen(true); void notificationState.refresh() }}/><div className="app-avatar-shell flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.025] px-2.5 py-2"><div className="app-avatar grid h-8 w-8 place-items-center rounded-full bg-brand-gold/15 text-xs font-bold text-brand-gold">{displayName.slice(0, 1).toUpperCase()}</div><span className="hidden text-sm font-medium sm:block">{displayName}</span></div><button aria-label="Wyloguj" title="Wyloguj" onClick={() => void getSupabaseClient()?.auth.signOut()} className="grid h-10 w-10 place-items-center rounded-xl text-brand-muted hover:bg-white/5 hover:text-brand-text"><LogOut className="h-4 w-4"/></button></div></header>
      {activeView === 'dashboard' ? <DashboardView family={family} displayName={displayName} todayTasks={taskState.todayTasks} stats={taskState.stats} loading={taskState.loading} error={taskState.error} actionError={taskState.actionError} updatingIds={taskState.updatingIds} canCreateTasks={canCreateTasks} onQuickAdd={openQuickTask} onViewTasks={() => navigate('tasks')} onViewCalendar={() => navigate('calendar')} onViewShopping={() => navigate('shopping')} onToggle={(task) => void taskState.toggleCompleted(task)} onDelete={setTaskToDelete} unreadNotifications={notificationState.unreadCount} onOpenNotifications={() => setNotificationCenterOpen(true)} canBudget={canBudget} onViewBudget={() => navigate('budget')}/> : null}
      {activeView === 'calendar' ? <CalendarView family={family} createRequest={calendarCreateRequest} reminders={reminderState.reminders} onViewTask={() => navigate('tasks')} onReminder={remindEvent}/> : null}
      {activeView === 'tasks' ? <TasksView family={family} tasks={taskState.tasks} loading={taskState.loading} error={taskState.error} actionError={taskState.actionError} updatingIds={taskState.updatingIds} canCreate={canCreateTasks} onQuickAdd={openQuickTask} onToggle={(task) => void taskState.toggleCompleted(task)} onDelete={setTaskToDelete} reminders={reminderState.reminders} onReminder={remindTask}/> : null}
      {activeView === 'shopping' ? <ShoppingView family={family} quickAddRequest={shoppingCreateRequest}/> : null}
      {activeView === 'budget' && canBudget ? <BudgetView family={family} quickAddRequest={budgetCreateRequest}/> : null}
    </main>
    {adminOpen && canAdmin ? <AdminPanel family={family} onClose={() => setAdminOpen(false)}/> : null}
    {quickTaskOpen ? <QuickTaskModal familyId={family.familyId} members={taskState.members} saving={taskState.saving} onCreate={taskState.createTask} onClose={() => setQuickTaskOpen(false)}/> : null}
    {taskToDelete ? <DeleteTaskModal task={taskToDelete} deleting={taskState.deletingIds.has(taskToDelete.id)} onDelete={taskState.deleteTask} onClose={() => setTaskToDelete(null)}/> : null}
    {notificationCenterOpen ? <NotificationCenter notifications={notificationState.notifications} reminders={reminderState.reminders} preferences={notificationState.preferences} loading={notificationState.loading || reminderState.loading} saving={notificationState.saving || reminderState.saving} error={notificationState.error ?? reminderState.error} onOpen={(item) => { void notificationState.setRead(item, true); setNotificationCenterOpen(false); navigate(notificationDestination(item)) }} onToggleRead={(item) => void notificationState.setRead(item, item.readAt !== null)} onMarkAllRead={() => void notificationState.markAllRead()} onEditReminder={(item) => { editReminder(item); setNotificationCenterOpen(false) }} onDeleteReminder={(id) => void reminderState.remove(id)} onPreferences={(value) => void notificationState.savePreferences(value)} onClose={() => setNotificationCenterOpen(false)}/> : null}
    {reminderSource ? <ReminderModal source={reminderSource} reminder={reminderForSource(reminderState.reminders, reminderSource.type, reminderSource.id)} saving={reminderState.saving} error={reminderState.error} onSave={reminderState.save} onDelete={reminderState.remove} onClose={() => setReminderSource(null)}/> : null}
  </div>
}

export function App() { return <AuthGate>{(session) => <Planner session={session}/>}</AuthGate> }
