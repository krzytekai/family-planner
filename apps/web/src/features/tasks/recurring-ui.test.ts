import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const modal = readFileSync(resolve(process.cwd(), 'src/features/tasks/components/QuickTaskModal.tsx'), 'utf8')
const card = readFileSync(resolve(process.cwd(), 'src/features/tasks/components/TaskCard.tsx'), 'utf8')

describe('recurring task UI contract', () => {
  it('shows a compact recurring badge and stop-series action', () => {
    expect(card).toContain('Cykliczne ·')
    expect(card).toContain('recurrenceLabel(task.recurrence.rule)')
    expect(card).toContain('Zakończ serię')
    expect(card).toContain('onStopRecurrence')
  })
  it('offers all supported recurrence modes', () => {
    for (const label of ['Nie powtarzaj','Codziennie / co X dni','Co tydzień / wybrane dni','Co miesiąc','Co rok']) expect(modal).toContain(label)
  })
  it('blocks assignee reminders without an assignee or deadline', () => {
    expect(modal).toContain('const reminderBlocked=!assignedTo||!dueAt')
    expect(modal).toContain('disabled={reminderBlocked||!canManageRecurrence}')
    expect(modal).toContain('Najpierw przypisz zadanie do członka rodziny.')
    expect(modal).toContain('Ustaw termin zadania, aby włączyć przypomnienie.')
    expect(modal).toContain('Tylko autor zadania lub administrator może zmienić to przypomnienie.')
  })
  it('supports preset and custom reminder offsets', () => {
    for (const value of [10,30,60,180,1440]) expect(modal).toContain(`value:${value}`)
    expect(modal).toContain('Niestandardowe')
  })
})
