import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), '../../database/migrations/0023_family_data_restore.sql'), 'utf8').toLowerCase()
const chargeLifecycleSql = readFileSync(resolve(process.cwd(), '../../database/migrations/0021_update_property_charge_instance.sql'), 'utf8').toLowerCase()

describe('0023 family restore contract', () => {
  it('exposes only owner-checked narrow RPCs', () => {
    expect(sql).toContain('public.preflight_family_restore')
    expect(sql).toContain('public.restore_family_data')
    expect(sql).toContain("array['owner']::public.family_role[]")
    expect(sql).not.toContain('grant usage on schema private')
  })

  it('performs authoritative validation after transaction locks', () => {
    const restore = sql.slice(sql.indexOf('create or replace function public.restore_family_data'))
    expect(restore).toContain("restore_mode<>'replace_selected'")
    expect(restore.indexOf('pg_advisory_xact_lock')).toBeLessThan(restore.indexOf('report:=private.validate_family_restore'))
    expect(restore.indexOf('for update')).toBeLessThan(restore.indexOf('report:=private.validate_family_restore'))
    expect(sql).not.toContain('session_replication_role')
  })

  it('uses null-safe manifest and selected collection validation', () => {
    for (const key of [
      "backup->>'format' is distinct from",
      "backup->>'backupversion' is distinct from",
      "backup->>'schemaversion' is distinct from",
      "jsonb_typeof(backup->'scope') is distinct from 'object'",
      "jsonb_typeof(backup->'modules') is distinct from 'object'",
      "jsonb_typeof(backup->'recordcounts') is distinct from 'object'",
      "jsonb_typeof(backup#>'{modules,tasks,items}') is distinct from 'array'",
    ]) expect(sql).toContain(key)
  })

  it('defines a private UUID validator and rejects malformed reminder source IDs safely', () => {
    expect(sql).toContain('create or replace function private.restore_valid_uuid(value text)')
    expect(sql).toContain('revoke all on function private.restore_valid_uuid(text) from public,anon,authenticated')
    expect(sql).toContain("value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'")
    expect(sql).toContain("or not private.restore_valid_uuid(item->>'sourceid')")
    expect(sql).toContain('exception when others then return false')
  })

  it('does not make optional fingerprinting a restore dependency', () => {
    expect(sql).not.toContain('pg_catalog.sha256')
    expect(sql).not.toMatch(/\bdigest\s*\(/)
    expect(sql).not.toContain("'fingerprint'")
  })

  it('marks date and timestamp parsing helpers stable', () => {
    expect(sql).toMatch(/restore_valid_timestamp\(value text,nullable boolean default false\)\s+returns boolean language plpgsql stable/)
    expect(sql).toMatch(/restore_valid_date\(value text,nullable boolean default false\)\s+returns boolean language plpgsql stable/)
  })

  it('explicitly validates required task and calendar fields', () => {
    for (const marker of ["item->>'title' is null", "item->>'status' is null", "item->>'priority' is null", "item->>'eventtype' is null", "jsonb_typeof(item->'allday') is distinct from 'boolean'", 'invalid_task_recurrence_series', 'invalid_calendar_event']) expect(sql).toContain(marker)
  })

  it('rejects forged budget income and duplicate participants', () => {
    expect(sql).toContain("item->>'transactiontype'='income' and (item->>'paidby' is not null or (item->>'isshared')::boolean)")
    expect(sql).toContain('duplicate_budget_participant')
    expect(sql).toContain('duplicate_settlement_member')
  })

  it('validates fixed-charge relationships and composite keys', () => {
    for (const marker of ['invalid_property_unit', 'invalid_fixed_charge_definition', 'invalid_fixed_charge_schedule_date', 'invalid_fixed_charge_reminder_mapping', 'invalid_property_charge', 'duplicate_fixed_charge_schedule_date', 'duplicate_fixed_charge_reminder_rule', 'duplicate_property_charge_period']) expect(sql).toContain(marker)
    expect(sql).toContain("u->>'propertyid'=item->>'propertyid'")
    expect(sql).toContain("d->>'propertyid'=item->>'propertyid'")
  })

  it('requires exact personal reminder sources', () => {
    expect(sql).toContain('personal_reminder_source_missing')
    expect(sql).toContain("t->>'id'=r->>'sourceid'")
    expect(sql).toContain("e->>'id'=r->>'sourceid'")
  })

  it('uses future-only property reminder resynchronization', () => {
    const restore = sql.slice(sql.indexOf('create or replace function public.restore_family_data'))
    expect(restore).toContain('private.resync_property_charge_reminders(mapped_id)')
    expect(restore).not.toContain('private.ensure_property_charge_reminders(mapped_id)')
    expect(chargeLifecycleSql).toContain("and status='pending'")
    expect(chargeLifecycleSql).toContain("set status='cancelled'")
    expect(chargeLifecycleSql).toContain('reminder_time>pg_catalog.now()')
    expect(chargeLifecycleSql).toContain('from public.property_charge_reminder_rules r')
    expect(chargeLifecycleSql).toContain('on conflict do nothing')
  })

  it('protects identities and preferences', () => {
    expect(sql).not.toMatch(/(insert|update|delete)\s+(into\s+|from\s+)?auth\./)
    expect(sql).not.toMatch(/(insert|update|delete)\s+(into\s+|from\s+)?public\.family_members/)
    expect(sql).not.toMatch(/(insert|update|delete)\s+(into\s+|from\s+)?public\.notification_(devices|preferences)/)
    expect(sql).toContain('notification_preferences_are_ignored')
  })

  it('uses new ID maps and transaction-bound private context', () => {
    for (const map of ['series_map', 'task_map', 'event_map', 'list_map', 'transaction_map', 'property_map', 'definition_map', 'charge_map']) expect(sql).toContain(map)
    expect(sql).toContain('pg_catalog.txid_current()')
    expect(sql).toContain('pg_catalog.pg_backend_pid()')
  })

  it('enforces limits and dependency rules', () => {
    for (const value of ['8388608', '262144', '50000', '10000', 'budget_replace_blocked_by_existing_fixed_charges', 'broken_fixed_charge_budget_reference']) expect(sql).toContain(value)
  })

  it('turns malformed casts into a structured preflight failure', () => {
    expect(sql).toContain('exception when others then')
    expect(sql).toContain("jsonb_build_array('malformed_value')")
  })

  it('contains no known broken draft syntax', () => {
    expect(sql).not.toContain('lambert:')
    expect(sql).not.toMatch(/->>item->>/)
    expect(sql).not.toContain('operation_id=operation_id')
    expect(sql).toContain("case when 'budget'=any(normalized) then 0 else cleared_links end")
  })
})
