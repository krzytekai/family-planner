import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), '../../database/migrations/0018_fix_platform_user_deletion_coalesce.sql'), 'utf8')

describe('0018 platform user finalizer COALESCE fix', () => {
  it('uses PostgreSQL special expressions without schema qualification', () => {
    expect(sql).toContain("'membership_count',greatest(coalesce(previous_membership_count, 0), 0)")
    expect(sql).not.toMatch(/pg_catalog\.(?:coalesce|greatest|least)\s*\(/i)
  })

  it('preserves target and authorization safeguards', () => {
    expect(sql).toContain('actor_user_id=target_user_id')
    expect(sql).toContain('pa.user_id=actor_user_id and pa.active')
    expect(sql).toContain('exists(select 1 from auth.users au where au.id=target_user_id)')
    expect(sql).toContain("fm.user_id=target_user_id and fm.status='active'")
    expect(sql).toContain('from public.profiles p where p.id=target_user_id for update')
  })

  it('preserves idempotent cleanup, tombstone and audit behavior', () => {
    expect(sql).toContain('if profile_deleted_at is not null then return')
    for (const statement of [
      'delete from public.platform_admins',
      'delete from public.property_charge_reminder_rules',
      'delete from public.reminders',
      'delete from public.notifications',
      'delete from public.notification_preferences',
      'delete from public.notification_devices',
      'update public.tasks set assigned_to=null',
      'update public.profiles',
    ]) expect(sql).toContain(statement)
    expect(sql).toContain("display_name='Usunięty użytkownik'")
    expect(sql).toContain("on conflict(action,entity_id) where action='platform.user.deleted' do nothing")
  })

  it('keeps the finalizer service-role only and reloads PostgREST', () => {
    expect(sql).toContain("security definer\nset search_path = ''")
    expect(sql).toContain('from public, anon, authenticated;')
    expect(sql).toContain('to service_role;')
    expect(sql).toContain("notify pgrst, 'reload schema';")
  })
})
