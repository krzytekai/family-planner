import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { chargesForProperty, definitionsForProperty, chargeForMonth } from './property-utils'
import type { ChargeDefinition, PropertyCharge } from './types'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const sql = read('../../database/migrations/0020_property_charge_definition_group.sql')
const historical = read('../../database/migrations/0013_properties_and_charges.sql')
const lifecycle = read('../../database/migrations/0019_property_charge_definition_lifecycle.sql')
const modal = read('src/features/properties/components/ChargeDefinitionModal.tsx')
const repository = read('src/features/properties/api/property-repository.ts')
const view = read('src/features/properties/components/PropertiesView.tsx')
const rpc = sql.slice(sql.indexOf('create or replace function public.update_property_charge_definition'))

describe('charge definition group edit contract', () => {
  it('enables group editing, preselects current group and sends the selected id', () => {
    expect(modal).toContain("useState(editing?.propertyId??properties[0]?.id??'')")
    expect(modal).not.toContain('disabled={Boolean(editing)}')
    expect(modal).toContain('setPropertyId(event.target.value)')
    expect(modal).toContain('definitionId:editing.id,propertyId,name')
    expect(repository).toContain('target_property_id:i.propertyId,charge_name')
  })
  it('retains create payload and active-only target options', () => {
    expect(modal).toContain('await onSave({familyId,propertyId,unitId:null')
    expect(view).toContain('properties={data.properties.filter(p=>p.active)}')
    expect(sql).not.toContain('function public.create_property_charge_definition')
  })
  it('keeps old RPC compatibility and exposes only the new narrow definer RPC', () => {
    expect(sql).not.toMatch(/drop function/i)
    expect(rpc).toContain('target_property_id uuid')
    expect(rpc).toContain("security definer set search_path = ''")
    expect(rpc).toContain('from public, anon, authenticated;')
    expect(rpc).toContain('to authenticated;')
    expect(sql).not.toMatch(/grant\s+(?:update|usage)/i)
  })
  it('validates membership and locks an active same-family destination before definition', () => {
    expect(rpc).toContain('if not private.can_manage_properties(target_family_id)')
    expect(rpc).toContain('where id = target_property_id and family_id = target_family_id')
    expect(rpc).toContain('if destination.id is null or not destination.active then')
    expect(rpc.indexOf('for share;')).toBeLessThan(rpc.indexOf('for update;'))
    expect(rpc).toContain('where id = target_definition_id and family_id = target_family_id')
  })
  it('changes only definition group, clearing the old unit only on a move', () => {
    expect(rpc).toContain('set property_id = target_property_id')
    expect(rpc).toContain('case when property_id = target_property_id then property_unit_id else null end')
    expect(sql).toContain('new.family_id <> old.family_id or new.created_by <> old.created_by')
    expect(sql).toContain('where p.id = new.property_id and p.family_id = new.family_id and p.active')
  })
  it('keeps stored charge snapshots and payment/history records untouched', () => {
    expect(historical).toContain('foreign key(charge_definition_id,family_id)')
    expect(historical).toContain('property_charges_property_family_fkey')
    expect(sql).not.toMatch(/(?:update|delete from|insert into)\s+public\.(?:property_charges|budget_transactions|reminders|notifications)/i)
  })
  it('preserves generation resume, active state and recurrence while retaining audit trigger', () => {
    expect(rpc).not.toMatch(/\b(?:generation_resume_date|active|start_date|recurrence_type)\s*=/)
    expect(sql).not.toContain('drop trigger')
    expect(sql).not.toContain('function private.audit_property_change')
    expect(sql).not.toContain('function public.set_property_charge_definition_active')
    expect(lifecycle).toContain('when next_active and not target_definition.active then current_date')
  })
  it('existing generator uses the new definition snapshot only for new occurrences', () => {
    expect(lifecycle.match(/values\(d.family_id,d.property_id,d.property_unit_id,d.id,candidate/g)).toHaveLength(3)
    expect(lifecycle.match(/on conflict do nothing returning id/g)).toHaveLength(3)
    expect(sql).not.toContain('function public.ensure_property_charges')
  })
  it('uses snapshot filtering in the year view as well as individual cards', () => {
    expect(view).toContain('chargesForProperty(data.activeCharges,selectedProperty)')
    expect(view).toContain('chargeForMonth(yearCharges,definition,year,index+1)')
    expect(view).toContain('propertyNames.get(charge.propertyId)')
  })
})

describe('history after moving Internet from old group to new group', () => {
  const definition = { id: 'internet', propertyId: 'new', active: true } as ChargeDefinition
  const old = Object.freeze({ id: 'old-charge', definitionId: 'internet', propertyId: 'old', dueDate: '2026-08-15', status: 'paid', paidAt: '2026-08-15T10:00:00Z', budgetTransactionId: 'payment' } as PropertyCharge)
  const fresh = { id: 'new-charge', definitionId: 'internet', propertyId: 'new', dueDate: '2026-09-15', status: 'pending' } as PropertyCharge
  const charges = [old, fresh]
  it('shows the historical paid charge only in the old group', () => {
    expect(definitionsForProperty([definition], charges, 'old')).toEqual([definition])
    expect(chargeForMonth(chargesForProperty(charges, 'old'), definition, 2026, 8)).toBe(old)
    expect(chargeForMonth(chargesForProperty(charges, 'new'), definition, 2026, 8)).toBeNull()
    expect(old.propertyId).toBe('old')
    expect(old.budgetTransactionId).toBe('payment')
  })
  it('shows the new charge only in the destination, without altering history', () => {
    expect(chargesForProperty(charges, 'new')).toEqual([fresh])
    expect(chargesForProperty(charges, 'all')).toEqual(charges)
    expect(definitionsForProperty([definition], charges, 'unrelated')).toEqual([])
    expect(old.paidAt).toBe('2026-08-15T10:00:00Z')
  })
})
