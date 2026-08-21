import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
const admin=readFileSync(resolve(process.cwd(),'src/features/admin/AdminPanel.tsx'),'utf8')
const mobile=readFileSync(resolve(process.cwd(),'src/components/MobileNav.tsx'),'utf8')
const app=readFileSync(resolve(process.cwd(),'src/app/App.tsx'),'utf8')
const api=readFileSync(resolve(process.cwd(),'../../api/admin/users.ts'),'utf8')
describe('administration UI contract',()=>{
  it('shows mobile family administration only behind role flags',()=>{expect(mobile).toContain('canAdmin?');expect(mobile).toContain('Rodzina i administracja');expect(mobile).toContain('isPlatformAdmin?')})
  it('provides member actions and custom confirmations',()=>{for(const text of ['Zablokuj','Odblokuj','Usuń','Zmienić rolę'])expect(admin).toContain(text);expect(admin).toContain('role="alertdialog"');expect(admin).not.toContain('window.confirm')})
  it('protects owner controls in UI and guards platform panel',()=>{expect(admin).toContain("member.role!=='owner'");expect(app).toContain('platformAdminOpen&&isPlatformAdmin')})
  it('keeps Auth Admin backend-only and restricts admin-created roles before account creation',()=>{const post=api.indexOf("request.method === 'POST'");const restriction=api.indexOf("auth.actorRole === 'admin' && role === 'admin'");const create=api.indexOf('auth.admin.auth.admin.createUser');expect(post).toBeGreaterThan(-1);expect(restriction).toBeGreaterThan(post);expect(create).toBeGreaterThan(restriction);expect(api).toContain('auth.admin.auth.admin.deleteUser(userId)');expect(app).not.toContain('service_role')})
})
