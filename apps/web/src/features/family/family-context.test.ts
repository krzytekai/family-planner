import { describe, expect, it } from 'vitest'
import type { FamilyContext } from '../../types/domain'
import { activeFamilyStorageKey, canCreateAdditionalFamily, canCreateFamilyForMemberships, chooseActiveFamily } from './family-context'

const family=(id:string,role:FamilyContext['role']='adult'):FamilyContext=>({familyId:id,familyName:id,userId:'u1',displayName:'User',role,status:'active'})

describe('multi-family context',()=>{
  it('restores an active family and falls back when it disappears',()=>{const list=[family('a'),family('b')];expect(chooseActiveFamily(list,'b')?.familyId).toBe('b');expect(chooseActiveFamily(list,'missing')?.familyId).toBe('a');expect(chooseActiveFamily([], 'a')).toBeNull()})
  it('scopes persistence to the authenticated user',()=>expect(activeFamilyStorageKey('u1')).toBe('family-planner:active-family:u1'))
  it('allows owner/admin/adult but not child to create another family',()=>{expect(canCreateAdditionalFamily('owner')).toBe(true);expect(canCreateAdditionalFamily('admin')).toBe(true);expect(canCreateAdditionalFamily('adult')).toBe(true);expect(canCreateAdditionalFamily('child')).toBe(false)})
  it('allows a user without memberships to create a family',()=>expect(canCreateFamilyForMemberships([])).toBe(true))
  it.each(['owner','admin','adult'] as const)('allows an active %s to create an additional family',(role)=>expect(canCreateFamilyForMemberships([role])).toBe(true))
  it('denies a child-only user',()=>expect(canCreateFamilyForMemberships(['child'])).toBe(false))
  it('allows child in one family when adult in another',()=>expect(canCreateFamilyForMemberships(['child','adult'])).toBe(true))
  it('allows a user removed from the last family to create a replacement',()=>expect(canCreateFamilyForMemberships([])).toBe(true))
})
