import type { FamilyRole } from '../../types/domain'
import type { ShoppingFilter, ShoppingItem, ShoppingList } from './types'

export function canCreateShoppingList(role: FamilyRole): boolean { return role !== 'child' }
export function canManageShoppingList(list: ShoppingList, userId: string, role: FamilyRole): boolean {
  return role === 'owner' || role === 'admin' || list.createdBy.id === userId
}
export function canEditShoppingItem(item: ShoppingItem, userId: string, role: FamilyRole): boolean {
  return role === 'owner' || role === 'admin' || item.createdBy.id === userId
}
export const canDeleteShoppingItem = canEditShoppingItem

export function filterShoppingItems(items: ShoppingItem[], filter: ShoppingFilter, userId: string, category = ''): ShoppingItem[] {
  return items.filter((item) => {
    if (category && item.category !== category) return false
    if (filter === 'unpurchased') return !item.isPurchased
    if (filter === 'purchased') return item.isPurchased
    if (filter === 'mine') return item.createdBy.id === userId || item.purchasedBy?.id === userId
    return true
  })
}

export function sortShoppingItems(items: ShoppingItem[]): ShoppingItem[] {
  return [...items].sort((first, second) => {
    if (first.isPurchased !== second.isPurchased) return first.isPurchased ? 1 : -1
    if (first.isPurchased) return new Date(second.purchasedAt ?? 0).getTime() - new Date(first.purchasedAt ?? 0).getTime()
    const category = (first.category ?? '').localeCompare(second.category ?? '', 'pl')
    if (category !== 0) return category
    return new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
  })
}

export function formatQuantity(quantity: number | null, unit: string | null): string | null {
  if (quantity === null && !unit) return null
  const value = quantity === null ? '' : new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 }).format(quantity)
  return [value, unit].filter(Boolean).join(' ')
}

export function shoppingCounts(items: ShoppingItem[]) {
  return { unpurchased: items.filter((item) => !item.isPurchased).length, purchased: items.filter((item) => item.isPurchased).length }
}
