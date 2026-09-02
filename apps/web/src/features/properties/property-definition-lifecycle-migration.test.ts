import{readFileSync}from'node:fs'
import{resolve}from'node:path'
import{describe,expect,it}from'vitest'

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8').toLowerCase()
const migration=read('../../database/migrations/0019_property_charge_definition_lifecycle.sql')
const original=read('../../database/migrations/0013_properties_and_charges.sql')
const repository=read('src/features/properties/api/property-repository.ts')

describe('0019 property charge definition lifecycle',()=>{
  it('routes edit and activation through narrow security-definer RPCs',()=>{for(const name of ['update_property_charge_definition','set_property_charge_definition_active'])expect(migration).toContain(`function public.${name}`);expect(migration.match(/security definer/g)).toHaveLength(4);expect(migration.match(/set search_path\s*=\s*''/g)).toHaveLength(4);expect(repository).toContain("rpc('update_property_charge_definition'");expect(repository).toContain("rpc('set_property_charge_definition_active'")})
  it('removes the direct update path that failed on the private trigger',()=>{expect(migration).toContain('revoke update on table public.property_charge_definitions from authenticated');expect(repository).not.toContain("from('property_charge_definitions').update")})
  it('does not grant broad private schema access',()=>{expect(migration).not.toMatch(/grant\s+usage\s+on\s+schema\s+private/);expect(migration).not.toMatch(/grant[^;]+private\./)})
  it('keeps tenant and adult-role authorization inside every replaced RPC',()=>{expect(migration.match(/private\.can_manage_properties\(target_family_id\)/g)).toHaveLength(4);expect(migration.match(/family_id = target_family_id/g)?.length).toBeGreaterThanOrEqual(5)})
  it('deactivation preserves definitions charges payments and history',()=>{expect(migration).toContain('set active = next_active');expect(migration).not.toMatch(/delete\s+from\s+public\.(property_charge_definitions|property_charges|audit_logs)/);expect(migration).not.toMatch(/update\s+public\.property_charges/)})
  it('backfills existing definitions with their original start boundary',()=>{expect(migration).toContain('add column generation_resume_date date');expect(migration).toContain('set generation_resume_date = start_date');expect(migration).toContain('alter column generation_resume_date set not null')})
  it('sets the resume boundary explicitly for every new definition',()=>{expect(migration).toContain('start_date,generation_resume_date');expect(migration).toContain('charge_start_date,charge_start_date')})
  it('prevents inactive definitions from generating future charges',()=>{expect(migration).toContain('where x.family_id=target_family_id and x.active and x.auto_generate')})
  it('moves the boundary only on a real inactive-to-active transition',()=>{expect(migration).toContain('when next_active and not target_definition.active then current_date');expect(migration).toContain('else target_definition.generation_resume_date')})
  it('does not change the boundary during definition edits',()=>{const edit=migration.slice(migration.indexOf('function public.update_property_charge_definition'),migration.indexOf('function public.set_property_charge_definition_active'));expect(edit).not.toContain('generation_resume_date =')})
  it('applies the resume boundary to every recurrence branch',()=>{expect(migration.match(/candidate>=greatest\(d\.start_date,d\.generation_resume_date\)/g)).toHaveLength(3)})
  it('does not backfill an inactive monthly gap after reactivation',()=>{const candidates=['2026-10-05','2026-11-05','2026-12-05','2027-01-05','2027-02-05'];const generated=candidates.filter(date=>date>='2027-01-20');expect(generated).toEqual(['2027-02-05'])})
  it('allows a future due date in the reactivation month',()=>{const candidates=['2027-01-05','2027-01-25','2027-02-05'];expect(candidates.filter(date=>date>='2027-01-20')).toEqual(['2027-01-25','2027-02-05'])})
  it('reactivation cannot duplicate existing charge occurrences',()=>{expect(original).toContain('property_charges_cycle_unique unique(charge_definition_id,due_date)');expect(migration).toContain('on conflict do nothing')})
  it('editing cannot rewrite historical paid or pending charge rows',()=>{expect(migration).toContain('update public.property_charge_definitions');expect(migration).not.toContain('update public.property_charges');expect(migration).not.toContain('delete from public.property_charges')})
  it('protects archived properties from definition reactivation',()=>{expect(migration).toMatch(/if next_active and not exists[\s\S]*?from public\.properties/);expect(migration).toContain('charge definition cannot be active for an archived property')})
  it('grants only authenticated execution of the public RPCs',()=>{expect(migration.match(/from public, anon, authenticated/g)).toHaveLength(2);expect(migration.match(/to authenticated/g)?.length).toBeGreaterThanOrEqual(4);expect(migration).not.toContain('to anon')})
})
