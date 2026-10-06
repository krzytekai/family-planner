import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const sql = read('../../database/migrations/0029_fix_calendar_recurrence_creation.sql')
const calendarModal = read('src/features/calendar/components/CalendarEventModal.tsx')
const taskModal = read('src/features/tasks/components/QuickTaskModal.tsx')

function generatedDates(exclusions = new Set<string>()) {
  const result: string[] = []
  for (const day of ['2027-01-01', '2027-01-02', '2027-01-03']) {
    if (!exclusions.has(day)) result.push(day)
  }
  return result
}

describe('calendar recurrence creation hotfix', () => {
  it('uses an unambiguous local occurrence variable throughout the generator', () => {
    expect(sql).toContain('v_occurrence_date date')
    expect(sql).toContain('x.occurrence_date=v_occurrence_date')
    expect(sql).not.toMatch(/x\.occurrence_date\s*=\s*occurrence_date\b/)
    expect(sql).not.toMatch(/^\s*occurrence_date date;/m)
  })
  it('generates recurring occurrences when there are no exclusions', () => {
    expect(generatedDates()).toEqual(['2027-01-01', '2027-01-02', '2027-01-03'])
    expect(sql).toContain('on conflict(recurrence_series_id,recurrence_occurrence_date)')
  })
  it('skips the excluded occurrence and generates the next one', () => {
    expect(generatedDates(new Set(['2027-01-02']))).toEqual(['2027-01-01', '2027-01-03'])
    expect(sql).toContain('last_processed_occurrence_date:=v_occurrence_date')
  })
  it('keeps both recurrence interval fields editable as numeric text', () => {
    for (const modal of [calendarModal, taskModal]) {
      expect(modal).toContain('type="text" inputMode="numeric" pattern="[0-9]*"')
      expect(modal).toContain('normalizeRecurrenceIntervalInput')
      expect(modal).not.toContain('setInterval(Number(e.target.value))')
      expect(modal).not.toContain('recurrenceInterval:Number(e.target.value)')
    }
  })
  it('shows the Polish interval validation message in both forms', () => {
    expect(calendarModal).toContain('recurrenceIntervalError')
    expect(taskModal).toContain('recurrenceIntervalError')
  })
})
