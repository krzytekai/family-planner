import type { BudgetSettlement, BudgetTransaction, ExpenseParticipant, SettlementBalance, SuggestedTransfer } from './types'

export function splitCentsEqually(amountCents: number, userIds: string[]) {
  const sorted = [...new Set(userIds)].sort()
  if (!sorted.length) throw new Error('Wydatek wspólny musi mieć uczestników.')
  const base = Math.floor(amountCents / sorted.length); let remainder = amountCents % sorted.length
  return sorted.map((userId) => ({ userId, amountCents: base + (remainder-- > 0 ? 1 : 0) }))
}

export function calculateSettlementBalances(transactions: BudgetTransaction[], participants: ExpenseParticipant[], settlements: BudgetSettlement[] = []): SettlementBalance[] {
  const balances = new Map<string, SettlementBalance>()
  const get = (id: string) => { let value = balances.get(id); if (!value) { value = { userId: id, paidCents: 0, owedCents: 0, sentSettlementsCents: 0, receivedSettlementsCents: 0, balanceCents: 0 }; balances.set(id, value) } return value }
  for (const transaction of transactions) {
    if (transaction.type !== 'expense' || !transaction.shared || !transaction.paidBy) continue
    get(transaction.paidBy.id).paidCents += transaction.amountCents
    const users = participants.filter((item) => item.transactionId === transaction.id).map((item) => item.user.id)
    for (const share of splitCentsEqually(transaction.amountCents, users)) get(share.userId).owedCents += share.amountCents
  }
  for (const settlement of settlements) { get(settlement.from.id).sentSettlementsCents += settlement.amountCents; get(settlement.to.id).receivedSettlementsCents += settlement.amountCents }
  for (const value of balances.values()) value.balanceCents = value.paidCents - value.owedCents + value.sentSettlementsCents - value.receivedSettlementsCents
  return [...balances.values()].sort((a, b) => a.userId.localeCompare(b.userId))
}

export function calculateSuggestedTransfers(balances: SettlementBalance[]): SuggestedTransfer[] {
  const debtors = balances.filter((b) => b.balanceCents < 0).map((b) => ({ id: b.userId, amount: -b.balanceCents })).sort((a,b) => a.id.localeCompare(b.id))
  const creditors = balances.filter((b) => b.balanceCents > 0).map((b) => ({ id: b.userId, amount: b.balanceCents })).sort((a,b) => a.id.localeCompare(b.id))
  const result: SuggestedTransfer[] = []; let d = 0; let c = 0
  while (d < debtors.length && c < creditors.length) { const debtor=debtors[d]!;const creditor=creditors[c]!;const amount = Math.min(debtor.amount, creditor.amount); if (amount) result.push({ fromUserId: debtor.id, toUserId: creditor.id, amountCents: amount }); debtor.amount -= amount; creditor.amount -= amount; if (!debtor.amount) d++; if (!creditor.amount) c++ }
  return result
}
