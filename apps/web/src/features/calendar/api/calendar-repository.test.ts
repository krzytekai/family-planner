import { describe, expect, it } from 'vitest'
import { buildCalendarRangeFilters } from './calendar-repository'

describe('calendar repository range filters', () => {
  it('builds separate point and interval overlap branches', () => {
    const filters = buildCalendarRangeFilters(
      new Date('2026-09-01T00:00:00.000Z'),
      new Date('2026-10-01T00:00:00.000Z'),
    )

    expect(filters.timedOverlap).toBe(
      'and(ends_at.is.null,starts_at.gte.2026-09-01T00:00:00.000Z),ends_at.gte.2026-09-01T00:00:00.000Z',
    )
    expect(filters.allDayOverlap).toBe(
      'and(end_date.is.null,start_date.gte.2026-09-01),end_date.gte.2026-09-01',
    )
    expect(filters.rangeEndDate).toBe('2026-09-30')
  })
})
