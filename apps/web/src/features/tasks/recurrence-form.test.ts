import { describe, expect, it } from 'vitest'
import { normalizeRecurrenceIntervalInput, parseRecurrenceInterval, recurrenceIntervalError, serializeRecurrence } from './task-utils'

describe('recurrence form serialization', () => {
  const dueAt = '2028-02-29T20:00:00'
  it('serializes no recurrence and interval recurrence', () => {
    expect(serializeRecurrence('none', 1, [], dueAt)).toBeNull()
    expect(serializeRecurrence('daily', 4, [], dueAt)).toEqual({ type: 'daily', interval: 4 })
  })
  it('sorts weekly weekdays', () => {
    expect(serializeRecurrence('weekly', 2, [5, 2], dueAt)).toEqual({ type: 'weekly', interval: 2, weekdays: [2, 5] })
  })
  it('anchors monthly and yearly rules in the chosen local date', () => {
    expect(serializeRecurrence('monthly', 1, [], dueAt)).toEqual({ type: 'monthly', interval: 1, day_of_month: 29 })
    expect(serializeRecurrence('yearly', 1, [], dueAt)).toEqual({ type: 'yearly', interval: 1, month: 2, day_of_month: 29 })
  })
  it('allows clearing the interval and entering 5 without a leading zero', () => {
    expect(normalizeRecurrenceIntervalInput('')).toBe('')
    expect(normalizeRecurrenceIntervalInput('5')).toBe('5')
    expect(normalizeRecurrenceIntervalInput('05')).toBe('5')
  })
  it('validates recurrence intervals from 1 through 1000', () => {
    expect(parseRecurrenceInterval('')).toBeNull()
    expect(parseRecurrenceInterval('0')).toBeNull()
    expect(parseRecurrenceInterval('1001')).toBeNull()
    expect(parseRecurrenceInterval('1')).toBe(1)
    expect(parseRecurrenceInterval('1000')).toBe(1000)
    expect(recurrenceIntervalError).toBe('Podaj poprawną wartość pola „Co ile okresów” (1–1000).')
  })
})
