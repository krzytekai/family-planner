import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Reminder } from '../notifications/types'
import { TaskCard } from './components/TaskCard'
import type { Task } from './types'

const read = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8')
const card = read('features/tasks/components/TaskCard.tsx')
const view = read('features/tasks/components/TasksView.tsx')
const modal = read('features/notifications/components/ReminderModal.tsx')
const repository = read('features/notifications/api/reminder-repository.ts')
const hook = read('features/notifications/hooks/useReminders.ts')
const migration = readFileSync(resolve(process.cwd(), '..', '..', 'database', 'migrations', '0011_recurring_tasks.sql'), 'utf8')
const task: Task = { id: 't1', familyId: 'f1', title: 'Test przypomnienia', description: null, status: 'todo', priority: 'normal', assignedTo: { id: 'u1', displayName: 'Krzysiek' }, dueAt: '2026-09-14T12:53:00Z', createdBy: { id: 'u1', displayName: 'Krzysiek' }, createdAt: '2026-09-11T10:00:00Z', updatedAt: '2026-09-11T10:00:00Z', completedAt: null, recurrence: null, assigneeReminderOffsetMinutes: 30 }
const assigneeReminder: Reminder = { id: 'r1', familyId: 'f1', sourceType: 'task', sourceId: 't1', title: null, remindAt: '2026-09-14T12:23:00Z', timezone: 'Europe/Warsaw', status: 'pending', kind: 'task_assignee', assigneeReminderOffsetMinutes: 30 }
const renderCard = (reminder?: Reminder) => renderToStaticMarkup(createElement(TaskCard, { task, currentUserId: 'u1', currentUserRole: 'adult', updating: false, reminder, onToggle: () => {}, onDelete: () => {}, onReminder: () => {}, onEdit: () => {}, onStopRecurrence: () => {} }))

describe('task reminder UX', () => {
  it('shows the active reminder in green with its date instead of a second create action', () => {
    expect(card).toContain('border-brand-green/20 text-brand-green')
    expect(card).toContain("reminder ? formatNotificationDate(reminder.remindAt) : 'Przypomnij'")
    expect(view).toContain('visibleTaskReminder(reminders, task.id, family.userId, task.assignedTo?.id ?? null)')
  })

  it('reproduces the Android scenario and shows 14:23 instead of a neutral create action', () => {
    const html = renderCard(assigneeReminder)
    expect(html).toContain('text-brand-green')
    expect(html).toContain('14:23')
    expect(html).not.toContain('>Przypomnij</button>')
    expect(html).toContain('Edytuj zadanie: Test przypomnienia')
    expect(html).toContain('Oznacz jako wykonane')
  })

  it('shows the neutral create action only when no visible reminder exists', () => {
    expect(renderCard()).toContain('>Przypomnij</span>')
  })

  it('edits the existing personal reminder and allows it to be removed', () => {
    expect(card).toContain('assigneeReminder ? onEdit(task) : onReminder(task)')
    expect(modal).toContain('reminder?.id')
    expect(modal).toContain('onDelete(reminder.id)')
    expect(modal).toContain('>Usuń</button>')
  })

  it('updates an existing pending personal reminder before attempting an insert', () => {
    expect(repository).toContain(".eq('reminder_kind', 'personal').eq('status', 'pending').maybeSingle()")
    expect(repository).toContain('const pendingId = existingId ?? await findPendingPersonal')
    expect(repository).toContain("error?.code === '23505'")
    expect(hook.match(/await refresh\(\)/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps personal and assignee reminder kinds distinct and database-unique', () => {
    expect(migration).toContain('reminders_one_pending_source_kind_unique')
    expect(migration).toContain('recipient_user_id, source_type, source_id, reminder_kind')
    expect(migration).toContain("reminder_kind = 'task_assignee'")
    expect(card).toContain("reminder?.kind === 'task_assignee'")
  })

  it('refreshes real reminder data after task creation and editing without a reload', () => {
    const app = read('app/App.tsx')
    expect(app).toContain('await taskState.createTask(input); await reminderState.refresh()')
    expect(app).toContain('await taskState.updateTask(input); await reminderState.refresh()')
    expect(hook).toContain('error, refresh, save, remove')
  })

  it('keeps mobile actions in one stable row and truncates only a long reminder label', () => {
    expect(card).toContain('flex flex-nowrap items-center gap-2')
    expect(card).toContain('min-h-11 min-w-0 flex-1')
    expect(card).toContain('<span className="min-w-0 truncate">')
    expect(card).toContain('shrink-0 items-center justify-center gap-2 whitespace-nowrap')
    expect(card).toContain('title={reminder ? formatNotificationDate(reminder.remindAt) : undefined}')
  })

  it('keeps icon actions and every primary action at least 44 pixels high', () => {
    expect(card).toContain('className="grid h-11 w-11 shrink-0 place-items-center rounded-xl')
    expect(card).toContain('className="grid h-11 w-11 shrink-0 place-items-center rounded-lg')
    expect(card.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
