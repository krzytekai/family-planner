import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const admin=readFileSync(resolve(process.cwd(),'src/features/admin/AdminPanel.tsx'),'utf8')
const mobile=readFileSync(resolve(process.cwd(),'src/components/MobileNav.tsx'),'utf8')
const app=readFileSync(resolve(process.cwd(),'src/app/App.tsx'),'utf8')
const api=readFileSync(resolve(process.cwd(),'../../api/admin/users.ts'),'utf8')
describe('administration UI contract',()=>{
  it('shows mobile family administration only behind role flags',()=>{expect(mobile).toContain('canAdmin||canCreateFamily');expect(mobile).toContain('Rodzina i administracja');expect(mobile).toContain('isPlatformAdmin?')})
  it('moves create-family into the guarded family administration view',()=>{expect(mobile).not.toContain('Utwórz rodzinę');expect(admin).toContain('Utwórz nową rodzinę');expect(admin).toContain('canCreateFamily?');expect(app).toContain('canCreateAdditionalFamily(family.role)')})
  it('does not expose member management to an adult-only family creator',()=>{expect(admin).toContain("canAdmin=['owner','admin'].includes(family.role)");expect(admin).toContain('if(!canAdmin)return')})
  it('provides member actions and custom confirmations',()=>{for(const text of ['Zablokuj','Odblokuj','Usuń','Zmienić rolę'])expect(admin).toContain(text);expect(admin).toContain('role="alertdialog"');expect(admin).not.toContain('window.confirm')})
  it('protects owner controls in UI and guards platform panel',()=>{expect(admin).toContain('canManageFamilyMember(family.role,m.role)');expect(app).toContain('platformAdminOpen&&isPlatformAdmin')})
  it('keeps Auth Admin backend-only and restricts admin-created roles before account creation',()=>{const post=api.indexOf("request.method === 'POST'");const restriction=api.indexOf("auth.actorRole === 'admin' && role === 'admin'");const create=api.indexOf('auth.admin.auth.admin.createUser');expect(post).toBeGreaterThan(-1);expect(restriction).toBeGreaterThan(post);expect(create).toBeGreaterThan(restriction);expect(api).toContain('auth.admin.auth.admin.deleteUser(userId)');expect(app).not.toContain('service_role')})
  it('loads members before showing owner and count',()=>{expect(admin).toContain('setLoading(true)');expect(admin).toContain('Ładowanie danych członków…');expect(admin).toContain('finally{setLoading(false)}');expect(admin).toContain("if(canAdmin&&!loading&&!loaded)return")})
  it('keeps create-family outside the admin header',()=>{const header=admin.slice(admin.indexOf('<header'),admin.indexOf('</header>'));expect(header).not.toContain('Utwórz');expect(admin).toContain('Ustawienia rodziny')})
  it('supports safe admin password changes with role hierarchy',()=>{expect(api).toContain("request.method === 'PATCH'");expect(api).toContain("['admin','adult','child'].includes(target.role)");expect(api).toContain("['adult','child'].includes(target.role)");expect(api).toContain('updateUserById(userId, { password })');expect(api).toContain('family.member.password_changed');expect(api).not.toContain('metadata: { password')})
  it('documents membership-only removal and never deletes Auth during remove',()=>{expect(admin).toContain('Utraci on dostęp tylko do tej rodziny.');const patch=api.slice(api.indexOf("request.method === 'PATCH'"));expect(patch).not.toContain('deleteUser(')})
})
