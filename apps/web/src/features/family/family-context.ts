import type { FamilyContext } from '../../types/domain'

export const activeFamilyStorageKey = (userId: string) => `family-planner:active-family:${userId}`

export function chooseActiveFamily(families: FamilyContext[], storedFamilyId: string | null) {
  return families.find((family) => family.familyId === storedFamilyId) ?? families[0] ?? null
}

export function canCreateAdditionalFamily(role: FamilyContext['role']) {
  return role === 'owner' || role === 'admin' || role === 'adult'
}

export function canCreateFamilyForMemberships(roles: FamilyContext['role'][]) {
  return roles.length === 0 || roles.some(canCreateAdditionalFamily)
}
