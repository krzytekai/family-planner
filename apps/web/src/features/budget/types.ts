import type { FamilyRole } from '../../types/domain'

export interface BudgetPerson { id: string; displayName: string }
export interface BudgetMember extends BudgetPerson { role: FamilyRole; active: boolean }
export type TransactionType = 'expense' | 'income'
export interface BudgetTransaction { id: string; familyId: string; type: TransactionType; title: string; description: string | null; amountCents: number; currency: string; category: string | null; date: string; paidBy: BudgetPerson | null; shared: boolean; createdBy: BudgetPerson; createdAt: string }
export interface ExpenseParticipant { transactionId: string; user: BudgetPerson; shareWeight: number }
export interface BudgetSettlement { id: string; familyId: string; from: BudgetPerson; to: BudgetPerson; amountCents: number; currency: string; date: string; note: string | null; createdBy: BudgetPerson }
export interface BudgetPlan { id: string; familyId: string; month: string; type: 'expense_limit' | 'income_target'; category: string | null; amountCents: number; currency: string }
export interface TransactionInput { familyId: string; type: TransactionType; title: string; description: string; amountCents: number; category: string; date: string; paidById: string | null; shared: boolean }
export interface SettlementInput { familyId: string; fromUserId: string; toUserId: string; amountCents: number; date: string; note: string }
export interface PlanInput { familyId: string; month: string; type: BudgetPlan['type']; category: string; amountCents: number }
export interface SettlementBalance { userId: string; paidCents: number; owedCents: number; sentSettlementsCents: number; receivedSettlementsCents: number; balanceCents: number }
export interface SuggestedTransfer { fromUserId: string; toUserId: string; amountCents: number }
export type BudgetFilter = 'all' | 'expense' | 'income' | 'shared' | 'mine'
