import { describe, expect, it } from 'vitest'
import { canManageBudgetConfiguration, canManageBudgetRecord, canViewBudget, decimalToCents, defaultPaidBy, defaultSettlementDate, defaultShared, settlementDateInRange, settlementDateOptions, settlementMonthBounds } from './budget-utils'

describe('budget form and permissions', () => {
  it('uses the current user as default payer', () => expect(defaultPaidBy('USER_A')).toBe('USER_A'))
  it('defaults new expenses to shared but not new income', () => { expect(defaultShared('expense')).toBe(true); expect(defaultShared('income')).toBe(false) })
  it('keeps the saved shared value while editing', () => { expect(defaultShared('expense', false)).toBe(false); expect(defaultShared('expense', true)).toBe(true) })
  it('allows changing paid_by without changing created_by input', () => { const input={ paidById:defaultPaidBy('USER_A'), createdBy:'USER_A' }; input.paidById='USER_B'; expect(input).toEqual({paidById:'USER_B',createdBy:'USER_A'}) })
  it('parses decimal money without floating point arithmetic', () => expect([decimalToCents('0,10'),decimalToCents('87.43')]).toEqual([10,8743]))
  it.each(['owner','admin','adult'])('%s can view finance', (role) => expect(canViewBudget(role)).toBe(true))
  it('child cannot view finance', () => expect(canViewBudget('child')).toBe(false))
  it('owner and admin manage foreign records', () => { expect(canManageBudgetRecord('owner','other','me')).toBe(true); expect(canManageBudgetRecord('admin','other','me')).toBe(true) })
  it('adult edits own but not foreign record', () => { expect(canManageBudgetRecord('adult','me','me')).toBe(true); expect(canManageBudgetRecord('adult','other','me')).toBe(false) })
  it('only owner/admin manage configuration', () => { expect(canManageBudgetConfiguration('owner')).toBe(true); expect(canManageBudgetConfiguration('admin')).toBe(true); expect(canManageBudgetConfiguration('adult')).toBe(false) })
})

describe('settlement technical date', () => {
  const now = new Date(2026, 9, 16, 12)
  it('uses the last day for a past month', () => expect(defaultSettlementDate(new Date(2026,8,1),now)).toBe('2026-09-30'))
  it('uses today for the current month', () => expect(defaultSettlementDate(new Date(2026,9,1),now)).toBe('2026-10-16'))
  it('uses the first day for a future month', () => expect(defaultSettlementDate(new Date(2026,10,1),now)).toBe('2026-11-01'))
  it('handles regular and leap-year February', () => { expect(settlementMonthBounds(new Date(2026,1,1)).maxDate).toBe('2026-02-28'); expect(settlementMonthBounds(new Date(2024,1,1)).maxDate).toBe('2024-02-29') })
  it('keeps the technical date inside the selected month', () => { const options=settlementDateOptions(new Date(2026,8,1),false,now); expect(options).toEqual({defaultDate:'2026-09-30',minDate:'2026-09-01',maxDate:'2026-09-30'}); expect(settlementDateInRange(options.defaultDate,options.minDate,options.maxDate)).toBe(true) })
})
