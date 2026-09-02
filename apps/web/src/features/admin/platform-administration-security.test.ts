import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const endpoint = readFileSync(resolve(process.cwd(), '../../api/admin/platform-users.ts'), 'utf8')
const client = readFileSync(resolve(process.cwd(), 'src/features/admin/platform-admin-api.ts'), 'utf8')
const panel = readFileSync(resolve(process.cwd(), 'src/features/admin/PlatformAdminPanel.tsx'), 'utf8')
const familyPanel = readFileSync(resolve(process.cwd(), 'src/features/admin/AdminPanel.tsx'), 'utf8')
const lifecycle = readFileSync(resolve(process.cwd(), '../../database/migrations/0017_fix_platform_user_lifecycle.sql'), 'utf8')

describe('platform administration security and deletion recovery', () => {
  it('requires a verified bearer identity and active platform administrator', () => {
    expect(endpoint).toContain("authHeader?.startsWith('Bearer ')")
    expect(endpoint).toContain('userClient.auth.getUser(token)')
    expect(endpoint).toContain("from('platform_admins').select('active')")
    expect(endpoint).toContain('if (!platformAdmin?.active)')
  })

  it('never accepts actor identity from client input', () => {
    expect(endpoint).toContain('const actorUserId = userData.user.id')
    expect(endpoint).toContain('const targetUserId = body?.targetUserId')
    expect(endpoint).not.toContain('body?.actor')
    expect(client).not.toContain('actorUserId')
    expect(panel).not.toContain('service_role')
  })

  it('guards actor and target separation before invoking the finalizer', () => {
    const separationGuard = endpoint.indexOf('targetUserId === actorUserId')
    const finalizerCall = endpoint.indexOf("rpc('finalize_platform_user_deletion'")
    expect(separationGuard).toBeGreaterThan(-1)
    expect(finalizerCall).toBeGreaterThan(separationGuard)
    expect(endpoint).toContain("actor_user_id: actorUserId")
    expect(endpoint).toContain("target_user_id: targetUserId")
  })

  it('the deployed migration source tombstones only the target profile', () => {
    const profileUpdate = lifecycle.slice(lifecycle.indexOf('update public.profiles'), lifecycle.indexOf('insert into public.platform_audit_logs'))
    expect(profileUpdate).toContain('where id=target_user_id')
    expect(profileUpdate).not.toContain('where id=actor_user_id')
    expect(profileUpdate).not.toContain('where id in')
  })

  it('runs preflight and hard Auth deletion before finalization', () => {
    const preflight = endpoint.indexOf("rpc('get_platform_user_deletion_preflight'")
    const authDelete = endpoint.indexOf('deleteUser(targetUserId, false)')
    const finalize = endpoint.indexOf("rpc('finalize_platform_user_deletion'")
    expect(preflight).toBeGreaterThan(-1)
    expect(authDelete).toBeGreaterThan(preflight)
    expect(finalize).toBeGreaterThan(authDelete)
  })

  it('recovers when Auth is already absent and still runs finalization', () => {
    expect(endpoint).toContain('const authMissing = authUserIsMissing(getTargetError, authTarget?.user)')
    expect(endpoint).toContain('if (!authMissing)')
    expect(endpoint).toContain("error.code === 'user_not_found'")
    expect(endpoint.indexOf("rpc('finalize_platform_user_deletion'")).toBeGreaterThan(endpoint.indexOf('if (!authMissing)'))
  })

  it('keeps finalization and its audit idempotent', () => {
    expect(lifecycle).toContain('if profile_deleted_at is not null then return')
    expect(lifecycle).toContain("on conflict(action,entity_id) where action='platform.user.deleted' do nothing")
  })

  it('reports a stable finalization stage and PostgreSQL code without sensitive details', () => {
    expect(endpoint).toContain("code: 'PROFILE_FINALIZATION_FAILED'")
    expect(endpoint).toContain("stage: 'profile_finalization'")
    expect(endpoint).toContain("const postgresCode = finalizeError.code || 'unknown'")
    expect(endpoint).toContain('postgresCode, actorUserId, targetUserId')
    expect(endpoint).not.toContain('finalizeError.message')
    expect(endpoint).not.toContain('finalizeError.details')
  })

  it('blocks self deletion and active memberships', () => {
    expect(endpoint).toContain('targetUserId === actorUserId')
    expect(endpoint).toContain("preflight?.reason === 'active_memberships'")
    expect(panel).toContain('Nie możesz usunąć własnego konta')
    expect(panel).toContain('użytkownik należy do aktywnej rodziny')
  })

  it('uses native-safe routing and narrow CORS', () => {
    expect(client).toContain("resolveApiUrl('/api/admin/platform-users')")
    expect(endpoint).toContain("origin === 'https://localhost'")
    expect(endpoint).toContain("origin === 'capacitor://localhost'")
    expect(endpoint).not.toContain("'Access-Control-Allow-Origin': '*'")
  })

  it('bounds frontend and backend requests so busy state cannot hang forever', () => {
    expect(client).toContain('controller.abort()')
    expect(client).toContain('finally{clearTimeout(timeout)}')
    expect(endpoint).toContain('AbortSignal.timeout(BACKEND_TIMEOUT_MS)')
    expect(panel).toContain('finally{setBusy(false)}')
  })

  it('prevents duplicate delete requests before React can rerender busy state', () => {
    expect(panel).toContain('deleteInFlight=useRef(false)')
    expect(panel).toContain('if(!deleteTarget||deleteInFlight.current)return')
    expect(panel).toContain('deleteInFlight.current=true')
    expect(panel).toContain('finally{deleteInFlight.current=false;setBusy(false)}')
  })

  it('logs safe actor-target stage transitions without credentials', () => {
    for (const stage of ['platform_delete.start','platform_delete.preflight','platform_delete.auth_delete','platform_delete.auth_absent_recovery','platform_delete.finalizer_start','platform_delete.finalizer_success','platform_delete.finalizer_error']) expect(endpoint).toContain(stage)
    expect(endpoint).toContain('console.info(stage, { actorUserId, targetUserId })')
    expect(endpoint).not.toContain('console.info(token')
    expect(endpoint).not.toContain('console.info(authHeader')
  })

  it('refreshes the overview and closes confirmation after successful deletion', () => {
    const mutation = panel.slice(panel.indexOf('async function removeAccount()'))
    expect(mutation).toContain('await deletePlatformUser(deleteTarget.id)')
    expect(mutation).toContain('setDeleteTarget(null)')
    expect(mutation).toContain('await load()')
  })

  it('keeps family membership removal separate from global Auth deletion', () => {
    expect(familyPanel).toContain("rpc('manage_family_member'")
    expect(familyPanel).not.toContain('deletePlatformUser')
  })

  it('keeps owner safety and detail-first membership management', () => {
    expect(panel).toContain("item.role!=='owner'")
    expect(panel).toContain('Owner chroniony')
    expect(panel).not.toContain('<h2 className="font-semibold">Memberships</h2>')
  })
})
