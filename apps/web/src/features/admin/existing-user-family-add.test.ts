import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const endpoint = readFileSync(resolve(process.cwd(), '../../api/admin/users.ts'), 'utf8')
const panel = readFileSync(resolve(process.cwd(), 'src/features/admin/AdminPanel.tsx'), 'utf8')
const post = endpoint.slice(endpoint.indexOf("request.method === 'POST'"), endpoint.indexOf("request.method === 'PATCH'"))

describe('existing Auth user family add contract', () => {
  it('looks up Auth users using controlled pagination and normalized email', () => {
    expect(endpoint).toContain('listUsers({ page, perPage })')
    expect(endpoint).toContain("candidate.email?.trim().toLowerCase() === normalizedEmail")
    expect(post).toContain("String(email).trim().toLowerCase()")
  })
  it('creates Auth only when no existing account was found', () => {
    expect(post).toMatch(/if \(!authUser\)[\s\S]*createUser/)
    expect(post).toContain('createdAuthUser = true')
  })
  it('never changes the password of an existing Auth account', () => {
    expect(post).not.toContain('updateUserById')
    expect(panel).toContain('Istniejące konto zachowa dotychczasowe hasło.')
  })
  it('uses an existing active profile and creates a missing profile', () => {
    expect(post).toContain("from('profiles').select('id,deleted_at')")
    expect(post).toContain("await auth.admin.from('profiles').insert")
    expect(post).toContain("profile\n          ? { error: null }")
  })
  it('rejects tombstoned profiles and platform administrator accounts', () => {
    expect(post).toContain("code: 'profile_deleted'")
    expect(post).toContain("from('platform_admins')")
    expect(post).toContain("code: 'platform_admin_protected'")
  })
  it('rejects an already active family membership', () => {
    expect(post).toContain("membership?.status === 'active'")
    expect(post).toContain("code: 'already_member'")
  })
  it('reactivates the existing membership row instead of inserting a duplicate', () => {
    expect(post).toContain("status: 'active', updated_at: new Date().toISOString()")
    expect(post).toContain("result = createdAuthUser ? 'new_user_created' : membership ? 'membership_reactivated' : 'existing_user_added'")
  })
  it('maps a 23505 membership race to the controlled already-member response', () => {
    expect(post).toContain("memberWrite.error.code === '23505'")
    expect(post).toContain("code: 'already_member'")
  })
  it('cleans up Auth only for accounts created by this request', () => {
    expect(post).toContain('let createdAuthUser = false')
    expect(post).toMatch(/if \(createdAuthUser\) await cleanupCreatedAuthUser/g)
    expect(endpoint).toContain('deleteUser(userId, false)')
  })
  it('preserves owner/admin authorization and role hierarchy', () => {
    expect(endpoint).toContain("['owner','admin'].includes(membership.role)")
    expect(post).toContain("auth.actorRole === 'admin' && role === 'admin'")
  })
  it('shows distinct UI confirmations for create, add and reactivate outcomes', () => {
    expect(panel).toContain('Nowe konto zostało utworzone i dodane do rodziny.')
    expect(panel).toContain('Istniejące konto zostało dodane do rodziny.')
    expect(panel).toContain('Członkostwo użytkownika zostało ponownie aktywowane.')
  })
})
