import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const view = read('src/features/budget/components/BudgetView.tsx')
const modal = read('src/features/budget/components/SettlementModal.tsx')
const hook = read('src/features/budget/hooks/useBudget.ts')
const repository = read('src/features/budget/api/budget-repository.ts')

describe('budget settlement selected-month flow', () => {
  it('passes the selected-month date and inclusive bounds from BudgetView', () => {
    expect(view).toContain('const settlementDates=settlementDateOptions(month,allTime)')
    expect(view).toContain('defaultDate={settlementDates.defaultDate}')
    expect(view).toContain('minDate={settlementDates.minDate}')
    expect(view).toContain('maxDate={settlementDates.maxDate}')
  })

  it('initializes the modal from the supplied month instead of localDate', () => {
    expect(modal).toContain('const[date,setDate]=useState(defaultDate)')
    expect(modal).not.toContain('useState(localDate())')
  })

  it('limits the date input to the selected month', () => {
    expect(modal).toContain('type="date" min={minDate} max={maxDate}')
    expect(modal).toContain('settlementDateInRange(date,minDate,maxDate)')
    expect(modal).toContain('Wybierz datę należącą do wybranego miesiąca.')
  })

  it('submits the selected date in SettlementInput', () => {
    expect(modal).toContain('amountCents:decimalToCents(amount),date,note')
  })

  it('refreshes and lists the settlement in the same exclusive month range', () => {
    expect(hook).toContain('repository.listSettlements(familyId,allTime?undefined:range.start,allTime?undefined:range.end)')
    expect(hook).toContain('await action();await refresh()')
    expect(repository).toContain("q=q.gte('settlement_date',start)")
    expect(repository).toContain("q=q.lt('settlement_date',end)")
  })

  it('does not apply selected-month bounds in all-time mode', () => {
    expect(view).toContain('settlementDateOptions(month,allTime)')
    expect(hook).toContain('allTime?undefined:range.start')
    expect(hook).toContain('allTime?undefined:range.end')
  })
})
