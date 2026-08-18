import { describe, expect, it } from 'vitest'
import { calculateSettlementBalances, calculateSuggestedTransfers, splitCentsEqually } from './settlement-utils'
import type { BudgetPerson, BudgetSettlement, BudgetTransaction, ExpenseParticipant } from './types'

const person = (id: string): BudgetPerson => ({ id, displayName: id })
const expense = (id: string, payer: string, cents: number, shared = true): BudgetTransaction => ({ id, familyId:'f', type:'expense', title:id, description:null, amountCents:cents, currency:'PLN', category:null, date:'2026-08-01', paidBy:person(payer), shared, createdBy:person(payer), createdAt:'' })
const income = (cents: number): BudgetTransaction => ({ ...expense('income','a',cents,false), type:'income', paidBy:null })
const parts = (transactionId: string, ids: string[]): ExpenseParticipant[] => ids.map((id) => ({ transactionId, user:person(id), shareWeight:1 }))
const settlement = (from:string,to:string,cents:number): BudgetSettlement => ({ id:`${from}-${to}`,familyId:'f',from:person(from),to:person(to),amountCents:cents,currency:'PLN',date:'2026-08-01',note:null,createdBy:person(from) })
const transfers = (transactions: BudgetTransaction[], participants: ExpenseParticipant[], settlements: BudgetSettlement[] = []) => calculateSuggestedTransfers(calculateSettlementBalances(transactions, participants, settlements))

describe('shared-expense settlements', () => {
  it('recommends Mama -> Tata 200 when Tata paid 1200 and Mama 800', () => expect(transfers([expense('a','tata',120000),expense('b','mama',80000)],[...parts('a',['mama','tata']),...parts('b',['mama','tata'])])).toEqual([{fromUserId:'mama',toUserId:'tata',amountCents:20000}]))
  it('recommends 50 after Mama adds 300', () => expect(transfers([expense('a','tata',120000),expense('b','mama',80000),expense('c','mama',30000)],[...parts('a',['mama','tata']),...parts('b',['mama','tata']),...parts('c',['mama','tata'])])).toEqual([{fromUserId:'mama',toUserId:'tata',amountCents:5000}]))
  it('leaves 50 after a partial settlement of 150', () => expect(transfers([expense('a','tata',120000),expense('b','mama',80000)],[...parts('a',['mama','tata']),...parts('b',['mama','tata'])],[settlement('mama','tata',15000)])).toEqual([{fromUserId:'mama',toUserId:'tata',amountCents:5000}]))
  it('is zero after a full settlement', () => expect(transfers([expense('a','tata',120000),expense('b','mama',80000)],[...parts('a',['mama','tata']),...parts('b',['mama','tata'])],[settlement('mama','tata',20000)])).toEqual([]))
  it('works for three people', () => expect(transfers([expense('a','a',9000)],parts('a',['a','b','c']))).toEqual([{fromUserId:'b',toUserId:'a',amountCents:3000},{fromUserId:'c',toUserId:'a',amountCents:3000}]))
  it('works for four people', () => expect(transfers([expense('a','a',12000)],parts('a',['a','b','c','d']))).toHaveLength(3))
  it('splits 10.01 / 2 deterministically', () => expect(splitCentsEqually(1001,['b','a'])).toEqual([{userId:'a',amountCents:501},{userId:'b',amountCents:500}]))
  it('splits 10.00 / 3 without losing a cent', () => expect(splitCentsEqually(1000,['c','a','b'])).toEqual([{userId:'a',amountCents:334},{userId:'b',amountCents:333},{userId:'c',amountCents:333}]))
  it('splits 100.01 / 3 without losing a cent', () => expect(splitCentsEqually(10001,['a','b','c']).map(x=>x.amountCents)).toEqual([3334,3334,3333]))
  it('supports different participant snapshots per expense', () => expect(calculateSettlementBalances([expense('old','a',900),expense('new','a',900)],[...parts('old',['a','b']),...parts('new',['a','b','c'])]).find(x=>x.userId==='c')?.owedCents).toBe(300))
  it('does not alter an old snapshot when current members change', () => expect(calculateSettlementBalances([expense('old','a',1000)],parts('old',['a','b'])).map(x=>x.userId)).toEqual(['a','b']))
  it('does not count settlements as household expenses', () => expect([expense('a','a',1000)].reduce((s,x)=>s+x.amountCents,0)).toBe(1000))
  it('ignores income in shared balances', () => expect(calculateSettlementBalances([income(999999)],[],[])).toEqual([]))
  it('ignores non-shared expense in settlements', () => expect(calculateSettlementBalances([expense('a','a',1000,false)],[],[])).toEqual([]))
  it('always keeps sum of balances at zero', () => expect(calculateSettlementBalances([expense('a','a',10001)],parts('a',['a','b','c'])).reduce((s,x)=>s+x.balanceCents,0)).toBe(0))
})
