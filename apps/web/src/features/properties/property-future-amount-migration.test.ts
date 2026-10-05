import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), '..', '..', 'database', 'migrations', '0025_update_future_property_charge_amounts.sql'), 'utf8')

type Charge = { family: string; definition: string; due: string; status: 'pending' | 'paid' | 'cancelled'; amount: number }
const updateLikeMigration = (charges: Charge[], oldAmount: number, nextAmount: number, effectiveMonth: string) => charges.map(charge =>
  charge.family === 'f1' && charge.definition === 'garage' && charge.status === 'pending' && charge.due >= effectiveMonth && charge.amount === oldAmount
    ? { ...charge, amount: nextAmount }
    : charge,
)

describe('future fixed-charge amount migration', () => {
  it('replaces both RPC signatures and keeps their security boundary', () => {
    expect(sql.match(/create or replace function public\.update_property_charge_definition\(/g)).toHaveLength(2)
    expect(sql.match(/security definer/g)).toHaveLength(2)
    expect(sql.match(/set search_path = ''/g)).toHaveLength(2)
    expect(sql).toContain('from public, anon, authenticated')
  })

  it('uses the definition timezone month boundary and the old inherited amount', () => {
    expect(sql).toContain('pg_catalog.now() at time zone target_definition.recurrence_timezone')
    expect(sql).toContain('due_date >= effective_month_start')
    expect(sql).toContain("status = 'pending'")
    expect(sql).toContain('planned_amount is not distinct from target_definition.planned_amount')
  })

  it('updates October 2026 onward, including generated 2027 records, without changing September', () => {
    const charges: Charge[] = ['2026-09-15','2026-10-15','2026-11-15','2026-12-15','2027-01-15','2027-02-15'].map(due => ({ family: 'f1', definition: 'garage', due, status: 'pending', amount: 3865 }))
    expect(updateLikeMigration(charges, 3865, 4001, '2026-10-01').map(item => item.amount)).toEqual([3865,4001,4001,4001,4001,4001])
  })

  it('protects paid, cancelled, manually overridden, other-definition and other-family rows', () => {
    const charges: Charge[] = [
      { family: 'f1', definition: 'garage', due: '2027-01-15', status: 'paid', amount: 3865 },
      { family: 'f1', definition: 'garage', due: '2027-01-15', status: 'cancelled', amount: 3865 },
      { family: 'f1', definition: 'garage', due: '2027-01-15', status: 'pending', amount: 3900 },
      { family: 'f1', definition: 'internet', due: '2027-01-15', status: 'pending', amount: 3865 },
      { family: 'f2', definition: 'garage', due: '2027-01-15', status: 'pending', amount: 3865 },
    ]
    expect(updateLikeMigration(charges, 3865, 4001, '2026-10-01')).toEqual(charges)
  })

  it('leaves generator semantics intact so newly inserted rows use the updated definition', () => {
    expect(sql).not.toContain('create or replace function public.ensure_property_charges')
    expect(sql).not.toContain('actual_amount =')
    expect(sql).not.toContain('paid_at =')
    expect(sql).not.toContain('budget_transaction_id =')
  })
})
