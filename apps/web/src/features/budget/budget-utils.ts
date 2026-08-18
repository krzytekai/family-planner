import type { BudgetFilter, BudgetPlan, BudgetTransaction, TransactionType } from './types'

export function decimalToCents(value: string | number): number {
  const normalized = String(value).trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) throw new Error('Podaj prawidłową kwotę z maksymalnie dwoma miejscami po przecinku.')
  const [whole, fraction = ''] = normalized.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
}
export function centsToDatabase(cents: number) { return (cents / 100).toFixed(2) }
export function formatMoney(cents: number, currency = 'PLN') { return new Intl.NumberFormat('pl-PL', { style: 'currency', currency }).format(cents / 100) }
export function monthRange(month: Date) { const start = new Date(month.getFullYear(), month.getMonth(), 1); const end = new Date(month.getFullYear(), month.getMonth() + 1, 1); return { start: localDate(start), end: localDate(end) } }
export function localDate(date = new Date()) { const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 10) }
export function formatBudgetMonth(month: Date) { return new Intl.DateTimeFormat('pl-PL', { month: 'long', year: 'numeric' }).format(month) }
export function filterBudgetTransactions(items: BudgetTransaction[], filter: BudgetFilter, userId: string) { return items.filter((item) => filter === 'all' || filter === item.type || (filter === 'shared' && item.shared) || (filter === 'mine' && (item.createdBy.id === userId || item.paidBy?.id === userId))) }
export function budgetSummary(items: BudgetTransaction[], plans: BudgetPlan[]) { const expenses = items.filter((i) => i.type === 'expense').reduce((sum, i) => sum + i.amountCents, 0); const income = items.filter((i) => i.type === 'income').reduce((sum, i) => sum + i.amountCents, 0); const shared = items.filter((i) => i.shared).reduce((sum, i) => sum + i.amountCents, 0); const plan = plans.filter((p) => p.type === 'expense_limit' && !p.category).reduce((sum, p) => sum + p.amountCents, 0); return { expenses, income, shared, plan, balance: income - expenses, usedPercent: plan > 0 ? expenses / plan * 100 : null } }
export function defaultPaidBy(currentUserId: string) { return currentUserId }
export function defaultShared(type: TransactionType, existingValue?: boolean) { return existingValue ?? type === 'expense' }
export function canViewBudget(role: string) { return role === 'owner' || role === 'admin' || role === 'adult' }
export function canManageBudgetRecord(role: string, creatorId: string, userId: string) { return role === 'owner' || role === 'admin' || creatorId === userId }
export function canManageBudgetConfiguration(role: string) { return role === 'owner' || role === 'admin' }
