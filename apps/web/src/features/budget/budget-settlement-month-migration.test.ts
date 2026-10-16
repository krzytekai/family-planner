import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), '../../database/migrations/0031_budget_settlement_month.sql'), 'utf8')

describe('0031 actual settlement date migration', () => {
  it('adds and backfills a required actual date without changing settlement_date', () => {
    expect(sql).toContain('add column actual_settlement_date date')
    expect(sql).toContain('set actual_settlement_date=settlement_date')
    expect(sql).toContain('alter column actual_settlement_date set not null')
    expect(sql).not.toContain('settlement_month')
  })

  it('keeps the historical family/date index and does not add a redundant month index', () => {
    expect(sql).not.toContain('budget_settlements_family_month_idx')
    expect(sql).not.toMatch(/create index[\s\S]*actual_settlement_date/i)
  })

  it('keeps the effective settlement trigger protections and restore bypass', () => {
    expect(sql).toContain('create or replace function private.prepare_budget_settlement_write()')
    expect(sql).toContain('if private.family_restore_active(new.family_id) then return new; end if;')
    expect(sql).toContain('new.family_id<>old.family_id or new.created_by<>old.created_by')
    expect(sql).toContain("array['owner','admin']::public.family_role[]")
    expect(sql).toContain('adult may only edit a settlement they are party to')
    expect(sql).toContain('settlement parties must differ')
    expect(sql).toContain("fm.role=any(array['owner','admin','adult']::public.family_role[])")
    expect(sql).toContain("new.note:=nullif(pg_catalog.btrim(new.note),'')")
    expect(sql).toContain('new.currency:=pg_catalog.upper(pg_catalog.btrim(new.currency))')
    expect(sql).toContain('new.updated_at:=pg_catalog.now()')
    expect(sql).toContain('revoke all on function private.prepare_budget_settlement_write() from public,anon,authenticated')
  })

  it('copies settlement_date only when an older client omits the actual date', () => {
    expect(sql).toContain('if new.actual_settlement_date is null then')
    expect(sql).toContain('new.actual_settlement_date:=new.settlement_date')
    const prepare = (settlementDate:string, actualDate?:string) => actualDate ?? settlementDate
    expect(prepare('2026-09-30')).toBe('2026-09-30')
    expect(prepare('2026-09-30','2026-10-16')).toBe('2026-10-16')
  })

  it('does not overwrite an existing actual date on update', () => {
    expect(sql).toContain('if new.actual_settlement_date is null then')
    expect(sql).not.toContain('new.settlement_date:=new.actual_settlement_date')
  })

  it('extends only existing authenticated column grants and does not alter RLS', () => {
    expect(sql).toContain('grant insert(actual_settlement_date) on public.budget_settlements to authenticated')
    expect(sql).toContain('grant update(actual_settlement_date) on public.budget_settlements to authenticated')
    expect(sql).not.toMatch(/create policy|drop policy|disable row level security/i)
  })

  it('exports actualSettlementDate beside the unchanged settlementDate', () => {
    expect(sql).toContain("pg_catalog.jsonb_build_object('actualSettlementDate',s.actual_settlement_date)")
    expect(sql).toContain("result#>'{modules,budget,settlements}'")
  })

  it('accepts legacy backups but validates a supplied actual date', () => {
    expect(sql).toContain("if item ? 'actualSettlementDate'")
    expect(sql).toContain("private.restore_valid_date(item->>'actualSettlementDate')")
    expect(sql).toContain("'invalid_actual_settlement_date'")
  })

  it('restores new and legacy actual dates atomically', () => {
    expect(sql).toContain('settlement_date,actual_settlement_date,note')
    expect(sql).toContain("case when item ? 'actualSettlementDate' then (item->>'actualSettlementDate')::date")
    expect(sql).toContain("else (item->>'settlementDate')::date end")
    expect(sql).toContain('perform pg_catalog.pg_advisory_xact_lock')
    expect(sql).toContain('private.family_restore_context')
  })

  it('keeps owner-only restore and authenticated RPC grants', () => {
    expect(sql).toContain("array['owner']::public.family_role[]")
    expect(sql).toContain('revoke all on function public.restore_family_data(uuid,jsonb,text[],jsonb,text,text) from public,anon,authenticated')
    expect(sql).toContain('grant execute on function public.restore_family_data(uuid,jsonb,text[],jsonb,text,text) to authenticated')
  })
})
