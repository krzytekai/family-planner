import { describe, expect, it } from 'vitest'
import { serializeRecurrence } from './task-utils'

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
})
