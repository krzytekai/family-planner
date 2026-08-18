import type { FamilyRole } from '../../types/domain'

export type ShoppingFilter = 'all' | 'unpurchased' | 'purchased' | 'mine'

export interface ShoppingPerson { id: string; displayName: string }

export interface ShoppingList {
  id: string
  familyId: string
  name: string
  description: string | null
  isArchived: boolean
  createdBy: ShoppingPerson
  createdAt: string
  updatedAt: string
}

export interface ShoppingItem {
  id: string
  familyId: string
  listId: string
  name: string
  quantity: number | null
  unit: string | null
  category: string | null
  note: string | null
  isPurchased: boolean
  createdBy: ShoppingPerson
  purchasedBy: ShoppingPerson | null
  purchasedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ShoppingListInput { familyId: string; name: string; description: string }
export interface ShoppingItemInput { familyId: string; listId: string; name: string; quantity: number | null; unit: string; category: string; note: string }
export interface ShoppingContext { userId: string; role: FamilyRole }
export interface ShoppingPreview { count: number; items: ShoppingItem[] }
