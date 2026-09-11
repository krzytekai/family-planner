import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8')
const card = read('features/tasks/components/TaskCard.tsx')
const view = read('features/tasks/components/TasksView.tsx')
const modal = read('features/notifications/components/ReminderModal.tsx')
const repository = read('features/notifications/api/reminder-repository.ts')
const hook = read('features/notifications/hooks/useReminders.ts')
const migration = readFileSync(resolve(process.cwd(), '..', '..', 'database', 'migrations', '0011_recurring_tasks.sql'), 'utf8')

describe('task reminder UX', () => {
  it('shows the active reminder in green with its date instead of a second create action', () => {
    expect(card).toContain('border-brand-green/20 text-brand-green')
    expect(card).toContain("reminder ? formatNotificationDate(reminder.remindAt) : 'Przypomnij'")
    expect(view).toContain("reminderForSource(reminders, 'task', task.id, 'personal') ?? reminderForSource(reminders, 'task', task.id, 'task_assignee')")
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
})
