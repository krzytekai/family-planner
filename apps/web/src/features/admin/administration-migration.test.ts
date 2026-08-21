import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql=readFileSync(resolve(process.cwd(),'../../database/migrations/0012_family_platform_administration.sql'),'utf8')
describe('0012 family and platform administration contract',()=>{
  it('protects owner continuity at database level',()=>{expect(sql).toContain('family must retain an active owner');expect(sql).toContain('constraint trigger enforce_family_owner_safety');expect(sql).toContain("if target.role='owner'");expect(sql).toContain("owner cannot be blocked without ownership transfer")})
  it('gives admins only adult/child management',()=>{expect(sql).toContain("actor_role='admin'");expect(sql).toContain("target.role not in ('adult','child')");expect(sql).toContain("next_role in ('owner','admin')")})
  it('separates membership removal from Auth deletion',()=>{expect(sql).toContain('delete from public.family_members');expect(sql).not.toMatch(/auth\.users[\s\S]*delete|delete[\s\S]*from auth\.users/i)})
  it('keeps platform administrators outside family roles and client writes',()=>{expect(sql).toContain('create table public.platform_admins');expect(sql).toContain("role text not null default 'superadmin'");expect(sql).toContain('revoke all on public.platform_admins from public, anon, authenticated');expect(sql).not.toMatch(/insert into public\.platform_admins/)})
  it('uses guarded RPCs with safe search paths',()=>{for(const name of ['update_family_name','manage_family_member','create_additional_family','get_platform_admin_overview','platform_manage_membership'])expect(sql).toContain(`public.${name}`);expect(sql.match(/set search_path = ''/g)?.length).toBeGreaterThanOrEqual(8)})
  it('retains tenant isolation and audit vocabulary',()=>{expect(sql).toContain('public.has_family_role');for(const action of ['family.updated','family.member.role_changed','family.member.blocked','family.member.unblocked','family.member.removed','platform.member.blocked'])expect(sql).toContain(action)})
  it('allows authenticated users with no active membership while rejecting child-only users',()=>{const fn=sql.slice(sql.indexOf('create or replace function public.create_additional_family'),sql.indexOf('create or replace function public.get_platform_admin_overview'));expect(fn).toContain("if (select auth.uid()) is null then raise exception 'not authenticated'");expect(fn).toMatch(/if exists \([\s\S]*status='active'[\s\S]*\) and not exists \([\s\S]*role in \('owner','admin','adult'\)[\s\S]*\) then raise exception/);expect(fn).not.toContain('if not exists (\n    select 1 from public.family_members')})
})
