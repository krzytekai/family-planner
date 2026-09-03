import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { getMonthGrid, toDateKey } from '../features/calendar/calendar-utils'
import { CalendarDatePicker } from './CalendarDatePicker'
import { DateTimePicker } from './DateTimePicker'
import { LocalTimePicker } from './LocalTimePicker'

const read = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8')
const picker = read('components/CalendarDatePicker.tsx')
const datetime = read('components/DateTimePicker.tsx')
const task = read('features/tasks/components/QuickTaskModal.tsx')
const event = read('features/calendar/components/CalendarEventModal.tsx')

describe('shared task and event calendar/time picker', () => {
  it('opens a complete Monday-first calendar with shared grid logic', () => {
    expect(picker).toContain('setOpen(!open)')
    expect(picker).toContain('getMonthGrid(month).map')
    expect(picker).toContain("['Pn', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd']")
    const days = getMonthGrid(new Date(2026, 8, 4))
    expect(days).toHaveLength(42)
    expect(days[0]?.getDay()).toBe(1)
    expect(days.map(toDateKey)).toContain('2026-09-04')
  })
  it('shows month/year and navigates in both directions without day overflow', () => {
    expect(picker).toContain('formatMonthYear(month)')
    expect(picker).toContain('current.getMonth() - 1, 1')
    expect(picker).toContain('current.getMonth() + 1, 1')
    expect(picker).toContain('Poprzedni miesiąc')
    expect(picker).toContain('Następny miesiąc')
  })
  it('selects a date key, marks selection and closes the inline panel', () => {
    expect(picker).toContain('onChange(key); setOpen(false)')
    expect(picker).toContain('aria-pressed={value === key}')
    expect(picker).toContain('style={{ minHeight: 44 }}')
  })
  it('renders a readable date trigger rather than raw ISO', () => {
    const html = renderToStaticMarkup(createElement(CalendarDatePicker, { label: 'Termin', value: '2026-09-04', onChange: () => {} }))
    expect(html).toContain('4 wrz 2026')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('2026-09-04')
  })
  it('allows hours and minutes with native minute precision', () => {
    const html = renderToStaticMarkup(createElement(LocalTimePicker, { label: 'Godzina', value: '16:30', onChange: () => {} }))
    expect(html).toContain('type="time"')
    expect(html).toContain('step="60"')
    expect(html).toContain('value="16:30"')
  })
  it('preserves the other half when date or time changes', () => {
    expect(datetime).toContain('`${nextDate}T${time}`')
    expect(datetime).toContain('`${date}T${nextTime}`')
    const html = renderToStaticMarkup(createElement(DateTimePicker, { label: 'Termin', value: '2026-09-04T16:30', onChange: () => {} }))
    expect(html).toContain('16:30')
    expect(html).toContain('4 wrz 2026')
  })
  it('shares the same picker for new/edit tasks, converts UTC at the existing boundary', () => {
    expect(task).toContain('<DateTimePicker label="Termin"')
    expect(task).toContain('formatDateTimeLocal(new Date(task.dueAt))')
    expect(task).toContain('dueAt:dueAt?parseDateTimeLocal(dueAt).toISOString():null')
  })
  it('supports no deadline and clearing it on ordinary tasks without relaxing recurrence rules', () => {
    const html = renderToStaticMarkup(createElement(DateTimePicker, { label: 'Termin', value: '', onChange: () => {} }))
    expect(html).toContain('Brak terminu')
    expect(html).not.toContain('required=""')
    expect(datetime).toContain('Usuń termin')
    expect(task).toContain("required={type!=='none'||Boolean(task?.recurrence)}")
    expect(task).toContain('if(!value)setReminderEnabled(false)')
    expect(read('features/tasks/types.ts')).toContain('dueAt: string | null')
  })
  it('reuses both controls in Add Event and preserves separate all-day date storage', () => {
    expect(event.match(/<CalendarDatePicker/g)).toHaveLength(4)
    expect(event.match(/<LocalTimePicker/g)).toHaveLength(2)
    expect(event).toContain('startDate: form.allDay ? form.startDate : null')
    expect(event).toContain('form.allDay ? null : parseDateTimeLocal')
    expect(event).toContain('endsAt < startsAt')
  })
})
