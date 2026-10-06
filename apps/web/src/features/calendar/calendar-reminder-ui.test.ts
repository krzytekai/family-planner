import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const card = read('src/features/calendar/components/CalendarEventCard.tsx')
const reminderModal = read('src/features/notifications/components/ReminderModal.tsx')
const dateTimePicker = read('src/components/DateTimePicker.tsx')
const timeUtils = read('src/components/local-time-utils.ts')
const localTimePicker = read('src/components/LocalTimePicker.tsx')

describe('calendar reminder UI regressions', () => {
  it('uses green active-reminder styling and neutral empty styling', () => {
    expect(card).toContain('border-brand-green/20 text-brand-green hover:bg-brand-green/10')
    expect(card).toContain('Przypomnij')
    expect(card).toContain('border-white/10 text-brand-muted')
  })
  it('uses the shared DateTimePicker instead of datetime-local', () => {
    expect(reminderModal).toContain('<DateTimePicker')
    expect(reminderModal).not.toContain('type="datetime-local"')
    expect(dateTimePicker).toContain('<LocalTimePicker')
  })
  it('keeps numeric Android time parsing rules', () => {
    expect(localTimePicker).toContain('inputMode="numeric"')
    expect(timeUtils).toContain('2[0-3]')
    expect(timeUtils).toContain('[0-5]')
  })
  it('keeps independent date and time state and future validation', () => {
    expect(dateTimePicker).toContain('const date =')
    expect(dateTimePicker).toContain('const time =')
    expect(reminderModal).toContain('Wybierz termin w przyszłości.')
  })
})
