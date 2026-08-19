import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), '../../database/migrations/0009_fcm_push_delivery.sql'), 'utf8')
const dispatcher = readFileSync(resolve(process.cwd(), '../../supabase/functions/push-dispatcher/index.ts'), 'utf8')
const registerStart = migration.indexOf('create or replace function public.register_notification_device(')
const registerEnd = migration.indexOf('create or replace function public.disable_notification_device(')
const registerFunction = migration.slice(registerStart, registerEnd)

describe('FCM migration security and regression coverage', () => {
  it('keeps delivery data private and client device writes behind auth-owned RPCs', () => {
    expect(migration).toContain('create table if not exists private.notification_push_deliveries')
    expect(migration).toContain('revoke all on private.notification_push_deliveries from public, anon, authenticated')
    expect(migration).toContain('revoke insert, update, delete on public.notification_devices from anon, authenticated')
    expect(migration).toContain('current_user_id uuid := (select auth.uid())')
    expect(migration).toContain('d.user_id = (select auth.uid())')
  })
  it('stores only a SHA-256 installation proof in a private credential table', () => {
    expect(migration).toContain('create table if not exists private.notification_device_credentials')
    expect(migration).toContain('installation_secret_hash bytea not null')
    expect(migration).toContain('pg_catalog.sha256(')
    expect(migration).toContain("pg_catalog.convert_to(device_installation_secret, 'UTF8')")
    expect(migration).not.toMatch(/extensions\.digest|\bpgcrypto\b|(?:create|alter)\s+extension/i)
    expect(migration).toContain('revoke all on private.notification_device_credentials from public, anon, authenticated')
    expect(migration).not.toMatch(/alter table public\.notification_devices[\s\S]*add column[^;]*installation_secret/i)
  })
  it('uses deterministic advisory locks instead of a global device table lock', () => {
    expect(registerFunction).toContain('pg_catalog.pg_advisory_xact_lock')
    expect(registerFunction).toContain('notification-device-installation:')
    expect(registerFunction).toContain('notification-device-token:')
    expect(registerFunction).toMatch(/order by d\.id\s+for update/)
    expect(registerFunction).not.toContain('lock table public.notification_devices')
  })
  it('fails closed when another user knows an installation id but not its secret', () => {
    const secretGuard = registerFunction.indexOf('not private.secure_hash_equal(stored_secret_hash, provided_secret_hash)')
    const ownerUpdate = registerFunction.indexOf('update public.notification_devices', secretGuard)
    expect(secretGuard).toBeGreaterThan(0)
    expect(registerFunction.slice(secretGuard, ownerUpdate)).toContain("raise exception 'installation ownership verification failed'")
    expect(secretGuard).toBeLessThan(ownerUpdate)
  })
  it('does not allow a known token to claim a new or different installation', () => {
    expect(registerFunction).toMatch(/if installation_device_id is null then[\s\S]*if token_device_id is not null then[\s\S]*raise exception 'installation ownership verification failed'/)
    expect(registerFunction).toMatch(/if token_device_id is not null and token_device_id <> installation_device_id then[\s\S]*raise exception 'installation ownership verification failed'/)
    expect(registerFunction).not.toContain('coalesce(token_device_id, installation_device_id)')
  })
  it('allows verified token rotation, offline recovery and account switching on the same installation', () => {
    const proofCheck = registerFunction.indexOf('private.secure_hash_equal')
    const ownerUpdate = registerFunction.indexOf('set user_id = current_user_id', proofCheck)
    expect(ownerUpdate).toBeGreaterThan(proofCheck)
    expect(registerFunction.slice(ownerUpdate)).toContain('push_token = normalized_token')
    expect(registerFunction.slice(ownerUpdate)).toContain('disabled_at = null')
  })
  it('does not expose a user_id parameter and keeps logout scoped to auth.uid()', () => {
    const signature = registerFunction.slice(0, registerFunction.indexOf('returns uuid'))
    expect(signature).toContain('device_installation_secret text')
    expect(signature).not.toMatch(/\buser_id\b/)
    expect(migration).toContain('d.user_id = (select auth.uid())')
    expect(migration).toContain('public.register_notification_device(uuid,text,text,text,text)')
  })
  it('supports one delivery per device after secure registration', () => {
    expect(migration).toContain('notification_push_deliveries_notification_device_unique')
    expect(migration).toContain('on conflict (notification_id, device_id) do nothing')
  })
  it('uses push preferences independently of in-app preferences and rechecks active membership', () => {
    expect(migration.match(/private\.notification_push_enabled/g)?.length).toBeGreaterThanOrEqual(2)
    expect(migration).not.toContain('private.notification_in_app_enabled')
    expect(migration).toContain("fm.status = 'active'")
  })
  it('claims concurrently with SKIP LOCKED and caps retries', () => {
    expect(migration).toContain('for update skip locked')
    expect(migration).toContain('attempt_count between 0 and 6')
    expect(migration).toContain("d.claimed_at < pg_catalog.now() - interval '10 minutes'")
    expect(migration).toContain("set disabled_at = coalesce(disabled_at, pg_catalog.now())")
  })
  it('restricts worker RPCs to service_role and fixes their search path', () => {
    expect(migration).not.toContain('auth.role()')
    expect(migration.match(/security definer/g)?.length).toBeGreaterThanOrEqual(6)
    expect(migration.match(/set search_path = ''/g)?.length).toBeGreaterThanOrEqual(7)
    const workerSignatures = [
      'public.claim_notification_push_deliveries(integer)',
      'public.complete_notification_push_delivery(uuid,text)',
      'public.fail_notification_push_delivery(uuid,text,boolean,integer,boolean)',
    ]
    for (const signature of workerSignatures) {
      expect(migration).toContain(`revoke all on function ${signature} from public, anon, authenticated`)
      expect(migration).toContain(`grant execute on function ${signature} to service_role`)
    }
  })
  it('grants only authenticated access to the client device RPCs', () => {
    const clientSignatures = [
      'public.register_notification_device(uuid,text,text,text,text)',
      'public.disable_notification_device(uuid)',
    ]
    for (const signature of clientSignatures) {
      expect(migration).toContain(`revoke all on function ${signature} from public, anon`)
      expect(migration).toContain(`grant execute on function ${signature} to authenticated`)
    }
  })
  it('prefers the named Supabase secret key and keeps the legacy service role key as fallback only', () => {
    const modernLookup = dispatcher.indexOf("Deno.env.get('SUPABASE_SECRET_KEYS')")
    const defaultLookup = dispatcher.indexOf('.default', modernLookup)
    const legacyLookup = dispatcher.indexOf("requiredEnv('SUPABASE_SERVICE_ROLE_KEY')", defaultLookup)
    expect(modernLookup).toBeGreaterThan(0)
    expect(defaultLookup).toBeGreaterThan(modernLookup)
    expect(legacyLookup).toBeGreaterThan(defaultLookup)
    expect(dispatcher).toContain("createClient(requiredEnv('SUPABASE_URL'), backendSupabaseSecretKey()")
    expect(dispatcher).not.toContain("createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY')")
  })
})
