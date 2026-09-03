import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseDateTimeLocal } from './date-time-local'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const helperUrl = pathToFileURL(resolve(process.cwd(), 'src/lib/date-time-local.ts')).href

describe('device-local form time versus UTC storage', () => {
  // A fresh process sets TZ before Date is initialized; independent of worker/host TZ.
  it.each([
    ['Europe/Warsaw', '2026-09-03T14:39', '2026-09-03T12:39:00.000Z'],
    ['Europe/Warsaw', '2026-01-03T14:39', '2026-01-03T13:39:00.000Z'],
    ['Europe/Warsaw', '2026-09-03T00:39', '2026-09-02T22:39:00.000Z'],
    ['Europe/Warsaw', '2026-03-29T01:30', '2026-03-29T00:30:00.000Z'],
    ['Europe/Warsaw', '2026-03-29T03:30', '2026-03-29T01:30:00.000Z'],
    ['America/New_York', '2026-09-03T14:39', '2026-09-03T18:39:00.000Z'],
    ['Asia/Kolkata', '2026-09-03T14:39', '2026-09-03T09:09:00.000Z'],
  ])('%s: %s has correct default, submit and edit round-trip', (tz, local, utc) => {
    const script = `
      import { formatDateTimeLocal, parseDateTimeLocal } from ${JSON.stringify(helperUrl)};
      const local = ${JSON.stringify(local)};
      const [year, month, day, hour, minute] = local.split(/[-T:]/).map(Number);
      const deviceNow = new Date(year, month - 1, day, hour, minute);
      console.log(JSON.stringify({
        defaultValue: formatDateTimeLocal(deviceNow),
        stored: parseDateTimeLocal(local).toISOString(),
        edited: formatDateTimeLocal(new Date(${JSON.stringify(utc)}))
      }));
    `
    const result = JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', script], { env: { ...process.env, TZ: tz }, encoding: 'utf8' }))
    expect(result).toEqual({ defaultValue: local, stored: utc, edited: local })
  })

  it('does not reinterpret date-only or timezone-qualified inputs as wall clock', () => {
    for (const value of ['2026-09-03', '2026-09-03T14:39Z', '2026-09-03T14:39+02:00', '']) {
      expect(Number.isNaN(parseDateTimeLocal(value).getTime())).toBe(true)
    }
  })

  it('initializes payment locally and converts to UTC only when submitting', () => {
    const payment = read('src/features/properties/components/PayChargeModal.tsx')
    expect(payment).toContain('useState(()=>formatDateTimeLocal(new Date()))')
    expect(payment).toContain('paidAt:parseDateTimeLocal(paidAt).toISOString()')
  })

  it('uses shared conversion in task, calendar and reminder create/edit forms', () => {
    expect(read('src/features/tasks/components/QuickTaskModal.tsx')).toContain('formatDateTimeLocal(new Date(task.dueAt))')
    for (const path of ['tasks/components/QuickTaskModal.tsx', 'calendar/components/CalendarEventModal.tsx', 'notifications/components/ReminderModal.tsx']) {
      expect(read(`src/features/${path}`)).toContain('parseDateTimeLocal')
    }
    expect(read('src/features/calendar/calendar-utils.ts')).toContain('return formatLocal(date)')
    expect(read('src/features/notifications/notification-utils.ts')).toContain('return formatDateTimeLocal(date)')
  })

  it('never slices an ISO timestamp into a runtime datetime-local value', () => {
    function scan(directory: string) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = resolve(directory, entry.name)
        if (entry.isDirectory()) scan(path)
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
          expect(readFileSync(path, 'utf8'), path).not.toMatch(/toISOString\(\)\s*\.\s*(?:slice|substring)\(\s*0\s*,\s*16\s*\)/)
        }
      }
    }
    scan(resolve(process.cwd(), 'src'))
  })

  it('keeps date-only calendar fields separate from timed conversion', () => {
    const calendar = read('src/features/calendar/components/CalendarEventModal.tsx')
    expect(calendar).toContain('startDate: event?.startDate ?? date')
    expect(calendar).toContain('endDate: event?.endDate ??')
    expect(calendar).toContain('form.allDay ? null : parseDateTimeLocal')
    for (const path of ['properties/components/ChargeDefinitionModal.tsx', 'budget/components/BudgetTransactionModal.tsx', 'budget/components/SettlementModal.tsx']) {
      const source = read(`src/features/${path}`)
      expect(source).toContain('type="date"')
      expect(source).not.toContain('parseDateTimeLocal')
    }
  })
})
