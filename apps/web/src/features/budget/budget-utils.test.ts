import { describe, expect, it } from 'vitest'
import { canManageBudgetConfiguration, canManageBudgetRecord, canViewBudget, decimalToCents, defaultPaidBy, defaultShared } from './budget-utils'

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
