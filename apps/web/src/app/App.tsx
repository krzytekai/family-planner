import { useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AppHeader } from '../components/AppHeader'
import { MobileNav } from '../components/MobileNav'
import { Sidebar } from '../components/Sidebar'
import { AdminPanel } from '../features/admin/AdminPanel'
import { PlatformAdminPanel } from '../features/admin/PlatformAdminPanel'
import { AuthGate } from '../features/auth/AuthGate'
import { CalendarView } from '../features/calendar/components/CalendarView'
import type { CalendarEvent } from '../features/calendar/types'
import { DashboardView } from '../features/dashboard/DashboardView'
import { FamilySetup } from '../features/family/FamilySetup'
import { useFamilyContext } from '../features/family/useFamilyContext'
import { CreateFamilyModal } from '../features/family/components/CreateFamilyModal'
import { activeFamilyStorageKey, canCreateAdditionalFamily } from '../features/family/family-context'
import { NotificationCenter } from '../features/notifications/components/NotificationCenter'
import { PushPermissionPrompt } from '../features/notifications/components/PushPermissionPrompt'
import { ReminderModal } from '../features/notifications/components/ReminderModal'
import { NativePushProvider } from '../features/notifications/NativePushProvider'
import { useNativePush } from '../features/notifications/native-push-context'
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
import { canManageTaskAutomation } from '../features/tasks/task-utils'
import type { AppView } from './navigation'
import { BudgetView } from '../features/budget/components/BudgetView'
import { canViewBudget } from '../features/budget/budget-utils'
import { NATIVE_BACK_EVENT, useNativeBackButton } from './native-platform'
import { getHeaderSubtitle, type HeaderContext } from './header-context'
import { getSupabaseClient } from '../lib/supabase'
import { PropertiesView } from '../features/properties/components/PropertiesView'
import { canAccessProperties } from '../features/properties/property-utils'

function Planner({ session }: { session: Session }) {
  const { family, families, selectFamily, isPlatformAdmin, loading, error } = useFamilyContext(session.user.id)
  const [adminOpen, setAdminOpen] = useState(false)
  if (loading) return <div className="grid min-h-screen place-items-center bg-brand-bg text-brand-muted">Ładowanie rodziny…</div>
  if (error) return <div className="grid min-h-screen place-items-center bg-brand-bg p-6 text-center text-red-300">Błąd konfiguracji bazy: {error}</div>
  if (!family) return <FamilySetup onDone={() => window.location.reload()} />
  return <FamilyPlanner family={family} families={families} onFamilyChange={selectFamily} isPlatformAdmin={isPlatformAdmin} canAdmin={family.role === 'owner' || family.role === 'admin'} adminOpen={adminOpen} setAdminOpen={setAdminOpen} displayName={family.displayName}/>
}

interface FamilyPlannerProps { family: NonNullable<ReturnType<typeof useFamilyContext>['family']>; families:NonNullable<ReturnType<typeof useFamilyContext>['family']>[]; onFamilyChange:(id:string)=>void; isPlatformAdmin:boolean; canAdmin: boolean; adminOpen: boolean; setAdminOpen: (open: boolean) => void; displayName: string }

function FamilyPlanner({ family, families, onFamilyChange, isPlatformAdmin, canAdmin, adminOpen, setAdminOpen, displayName }: FamilyPlannerProps) {
  const taskState = useTasks(family.familyId)
  const notificationState = useNotifications(family.familyId)
  const reminderState = useReminders(family.familyId)
  const nativePush = useNativePush()
  const [activeView, setActiveView] = useState<AppView>('dashboard')
  const [quickTaskOpen, setQuickTaskOpen] = useState(false)
  const [calendarCreateRequest] = useState(0)
  const [shoppingCreateRequest] = useState(0)
  const [budgetCreateRequest] = useState(0)
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null)
  const [taskToEdit, setTaskToEdit] = useState<Task | null>(null)
  const [notificationCenterOpen, setNotificationCenterOpen] = useState(false)
  const [reminderSource, setReminderSource] = useState<ReminderSource | null>(null)
  const [platformAdminOpen,setPlatformAdminOpen]=useState(false)
  const [createFamilyOpen,setCreateFamilyOpen]=useState(false)
  const viewHistory = useRef<AppView[]>(['dashboard'])
  const canCreateTasks = family.role === 'owner' || family.role === 'admin' || family.role === 'adult'
  const canBudget = canViewBudget(family.role)
  const canProperties = canAccessProperties(family.role)
  const headerContext: HeaderContext = adminOpen ? 'admin' : notificationCenterOpen ? 'notifications' : activeView
  const headerSubtitle = getHeaderSubtitle(headerContext, displayName)

  function showView(view: AppView) { setActiveView(view); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  function navigate(view: AppView) { if ((view === 'budget' && !canBudget) || (view === 'properties' && !canProperties) || view === activeView) return; viewHistory.current.push(view); showView(view) }
  function openQuickTask() { if (canCreateTasks) setQuickTaskOpen(true) }
  function remindTask(task: Task) { setReminderSource({ type: 'task', id: task.id, title: task.title, occursAt: task.dueAt }) }
  function remindEvent(event: CalendarEvent) { setReminderSource({ type: 'calendar_event', id: event.id, title: event.title, occursAt: event.allDay && event.startDate ? new Date(`${event.startDate}T09:00:00`).toISOString() : event.startsAt }) }
  function editReminder(reminder: Reminder) { setReminderSource({ type: reminder.sourceType, id: reminder.sourceId, title: reminder.title?.replace(/^Przypomnienie: /, '') ?? 'Wpis', occursAt: reminder.remindAt }) }

  const nativeCallbacks = useRef({
    refresh: notificationState.refresh,
    markReadById: notificationState.markReadById,
    navigate,
    completePendingAction: nativePush.completePendingAction,
  })
  nativeCallbacks.current = { refresh: notificationState.refresh, markReadById: notificationState.markReadById, navigate, completePendingAction: nativePush.completePendingAction }

  useEffect(() => {
    if (notificationState.loading) return
    nativePush.bindSession({
      familyId: family.familyId,
      pushEnabled: notificationState.preferences.pushEnabled,
      onForeground: () => { void nativeCallbacks.current.refresh() },
      onAction: (action) => {
        if (action.familyId !== family.familyId) return
        setNotificationCenterOpen(false)
        nativeCallbacks.current.navigate(action.route)
        void nativeCallbacks.current.markReadById(action.notificationId).finally(() => nativeCallbacks.current.completePendingAction(action.notificationId))
      },
    })
    return () => nativePush.unbindSession()
  }, [family.familyId, nativePush, notificationState.loading, notificationState.preferences.pushEnabled])

  async function logout() {
    await nativePush.disableForLogout()
    await getSupabaseClient()?.auth.signOut()
  }

  useNativeBackButton(() => {
    if (reminderSource) { setReminderSource(null); return }
    if (taskToEdit) { setTaskToEdit(null); return }
    if (notificationCenterOpen) { setNotificationCenterOpen(false); return }
    if (taskToDelete) { setTaskToDelete(null); return }
    if (quickTaskOpen) { setQuickTaskOpen(false); return }
    if (adminOpen) { setAdminOpen(false); return }
    if (platformAdminOpen) { setPlatformAdminOpen(false); return }
    if (createFamilyOpen) { setCreateFamilyOpen(false); return }

    const overlayBack = new Event(NATIVE_BACK_EVENT, { cancelable: true })
    window.dispatchEvent(overlayBack)
    if (overlayBack.defaultPrevented) return

    if (viewHistory.current.length > 1) {
      viewHistory.current.pop()
      showView(viewHistory.current.at(-1) ?? 'dashboard')
    }
  })

  return <div className="app-mobile-density min-h-screen bg-brand-bg text-brand-text">
    <Sidebar family={family} families={families} onFamilyChange={onFamilyChange} canAdmin={canAdmin} canCreateFamily={canCreateAdditionalFamily(family.role)} isPlatformAdmin={isPlatformAdmin} canBudget={canBudget} canProperties={canProperties} activeView={activeView} onNavigate={navigate} onAdmin={() => setAdminOpen(true)} onPlatformAdmin={()=>setPlatformAdminOpen(true)}/>
    <MobileNav activeView={activeView} canBudget={canBudget} canProperties={canProperties} canAdmin={canAdmin} isPlatformAdmin={isPlatformAdmin} canCreateFamily={canCreateAdditionalFamily(family.role)} onNavigate={navigate} onAdmin={()=>setAdminOpen(true)} onPlatformAdmin={()=>setPlatformAdminOpen(true)}/>
    <main className="mobile-nav-safe-content lg:ml-64 lg:pb-8">
      <AppHeader family={family} families={families} onFamilyChange={onFamilyChange} subtitle={headerSubtitle} displayName={displayName} unreadCount={notificationState.unreadCount} onOpenNotifications={() => { setNotificationCenterOpen(true); void notificationState.refresh() }} onLogout={() => void logout()}/>
      {activeView === 'dashboard' ? <DashboardView family={family} displayName={displayName} todayTasks={taskState.todayTasks} stats={taskState.stats} loading={taskState.loading} error={taskState.error} actionError={taskState.actionError} updatingIds={taskState.updatingIds} canCreateTasks={canCreateTasks} onQuickAdd={openQuickTask} onViewTasks={() => navigate('tasks')} onViewCalendar={() => navigate('calendar')} onViewShopping={() => navigate('shopping')} onToggle={(task) => void taskState.toggleCompleted(task)} onDelete={setTaskToDelete} unreadNotifications={notificationState.unreadCount} onOpenNotifications={() => setNotificationCenterOpen(true)} canBudget={canBudget} onViewBudget={() => navigate('budget')}/> : null}
      {activeView === 'calendar' ? <CalendarView family={family} createRequest={calendarCreateRequest} reminders={reminderState.reminders} onViewTask={() => navigate('tasks')} onReminder={remindEvent}/> : null}
      {activeView === 'tasks' ? <TasksView family={family} tasks={taskState.tasks} loading={taskState.loading} error={taskState.error} actionError={taskState.actionError} updatingIds={taskState.updatingIds} canCreate={canCreateTasks} onQuickAdd={openQuickTask} onToggle={(task) => void taskState.toggleCompleted(task)} onDelete={setTaskToDelete} reminders={reminderState.reminders} onReminder={remindTask} onEdit={setTaskToEdit} onStopRecurrence={(task)=>{if(window.confirm(`Zakończyć serię „${task.title}”? Historia zadań zostanie zachowana.`))void taskState.stopRecurrence(task)}}/> : null}
      {activeView === 'shopping' ? <ShoppingView family={family} quickAddRequest={shoppingCreateRequest}/> : null}
      {activeView === 'budget' && canBudget ? <BudgetView family={family} quickAddRequest={budgetCreateRequest}/> : null}
      {activeView === 'properties' && canProperties ? <PropertiesView key={family.familyId} family={family}/> : null}
    </main>
    {adminOpen && (canAdmin||canCreateAdditionalFamily(family.role)) ? <AdminPanel family={family} canCreateFamily={canCreateAdditionalFamily(family.role)} onCreateFamily={()=>{setAdminOpen(false);setCreateFamilyOpen(true)}} onClose={() => setAdminOpen(false)} onFamilyChanged={()=>window.location.reload()}/> : null}
    {platformAdminOpen&&isPlatformAdmin?<PlatformAdminPanel onClose={()=>setPlatformAdminOpen(false)}/>:null}
    {createFamilyOpen&&canCreateAdditionalFamily(family.role)?<CreateFamilyModal displayName={displayName} onClose={()=>setCreateFamilyOpen(false)} onCreated={id=>{localStorage.setItem(activeFamilyStorageKey(family.userId),id);window.location.reload()}}/>:null}
    {quickTaskOpen ? <QuickTaskModal familyId={family.familyId} members={taskState.members} saving={taskState.saving} onCreate={taskState.createTask} onClose={() => setQuickTaskOpen(false)}/> : null}
    {taskToEdit ? <QuickTaskModal familyId={family.familyId} members={taskState.members} saving={taskState.saving} task={taskToEdit} reminder={reminderForSource(reminderState.reminders,'task',taskToEdit.id)} canManageRecurrence={canManageTaskAutomation(taskToEdit,family.userId,family.role)} onCreate={taskState.createTask} onUpdate={taskState.updateTask} onClose={()=>setTaskToEdit(null)}/> : null}
    {taskToDelete ? <DeleteTaskModal task={taskToDelete} deleting={taskState.deletingIds.has(taskToDelete.id)} onDelete={taskState.deleteTask} onClose={() => setTaskToDelete(null)}/> : null}
    {notificationCenterOpen ? <NotificationCenter notifications={notificationState.notifications} reminders={reminderState.reminders} preferences={notificationState.preferences} systemPushPermission={nativePush.permission} loading={notificationState.loading || reminderState.loading} saving={notificationState.saving || reminderState.saving} error={notificationState.error ?? reminderState.error ?? nativePush.error} onOpen={(item) => { void notificationState.setRead(item, true); setNotificationCenterOpen(false); navigate(notificationDestination(item)) }} onToggleRead={(item) => void notificationState.setRead(item, item.readAt === null)} onMarkAllRead={() => void notificationState.markAllRead()} onDismiss={(item)=>void notificationState.dismiss(item)} onDismissRead={()=>void notificationState.dismissRead()} onEditReminder={(item) => { editReminder(item); setNotificationCenterOpen(false) }} onDeleteReminder={(id) => void reminderState.remove(id)} onPreferences={(value) => void notificationState.savePreferences(value)} onClose={() => setNotificationCenterOpen(false)}/> : null}
    {nativePush.showPreprompt ? <PushPermissionPrompt busy={nativePush.registering} onEnable={() => void nativePush.acceptPreprompt()} onLater={nativePush.dismissPreprompt}/> : null}
    {reminderSource ? <ReminderModal source={reminderSource} reminder={reminderForSource(reminderState.reminders, reminderSource.type, reminderSource.id)} saving={reminderState.saving} error={reminderState.error} onSave={reminderState.save} onDelete={reminderState.remove} onClose={() => setReminderSource(null)}/> : null}
  </div>
}

export function App() { return <NativePushProvider><AuthGate>{(session) => <Planner session={session}/>}</AuthGate></NativePushProvider> }
