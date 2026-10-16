import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const view = read('src/features/budget/components/BudgetView.tsx')
const modal = read('src/features/budget/components/SettlementModal.tsx')
const hook = read('src/features/budget/hooks/useBudget.ts')
const repository = read('src/features/budget/api/budget-repository.ts')

describe('budget settlement month and actual date flow', () => {
  const septemberSettlement = { settlementDate:'2026-09-30', actualDate:'2026-10-16', amountCents:20000 }
  const inRange = (row:typeof septemberSettlement,start:string,end:string) => row.settlementDate>=start&&row.settlementDate<end

  it('keeps an October action in September for old-client reads and balances', () => {
    expect(inRange(septemberSettlement,'2026-09-01','2026-10-01')).toBe(true)
    expect(inRange(septemberSettlement,'2026-10-01','2026-11-01')).toBe(false)
    expect([septemberSettlement].filter(row=>inRange(row,'2026-09-01','2026-10-01')).reduce((sum,row)=>sum+row.amountCents,0)).toBe(20000)
  })

  it('passes a compatibility date from the selected month separately from today', () => {
    expect(view).toContain('const settlementDates=settlementDateOptions(month,false)')
    expect(view).toContain('settlementDate={settlementDates.defaultDate}')
    expect(view).toContain('settlementMonthLabel={formatBudgetMonth(month)}')
    expect(view).toContain('defaultDate={localDate()}')
  })

  it('shows the selected month and initializes the actual date independently', () => {
    expect(modal).toContain('Rozliczany miesiąc:')
    expect(modal).toContain('{settlementMonthLabel}')
    expect(modal).toContain('const [date, setDate] = useState(defaultDate)')
    expect(modal).not.toMatch(/min=\{minDate\}|max=\{maxDate\}/)
  })

  it('submits both the compatibility date and actual date', () => {
    expect(modal).toContain('settlementDate, date, note')
    expect(repository).toContain('settlement_date:i.settlementDate,actual_settlement_date:i.date')
  })

  it('filters by settlement_date and sorts history by actual date', () => {
    expect(hook).toContain('repository.listSettlements(familyId,allTime?undefined:range.start,allTime?undefined:range.end)')
    expect(repository).toContain("q=q.gte('settlement_date',start)")
    expect(repository).toContain("q=q.lt('settlement_date',end)")
    expect(repository).toContain("order('actual_settlement_date',{ascending:false}).order('created_at',{ascending:false})")
  })

  it('does not permit a settlement without a month in all-time mode', () => {
    expect(view).toContain('Wybierz miesiąc, aby rozliczyć')
    expect(view).toContain('settling&&!allTime')
  })

  it('shows actual date and the budget month in all-time history', () => {
    expect(view).toContain("s.date}{allTime?` · za ${formatBudgetMonth")
    expect(view).toContain('s.settlementDate')
  })
})
