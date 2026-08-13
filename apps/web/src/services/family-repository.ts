import type { FamilyContext } from '../types/domain'

export interface FamilyRepository {
  getCurrentFamily(): Promise<FamilyContext | null>
}

// Sprint 1: implementacja Supabase będzie ukryta za tym interfejsem.
// UI nie będzie zależne bezpośrednio od dostawcy backendu.
