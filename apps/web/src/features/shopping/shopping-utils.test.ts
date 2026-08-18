import { describe, expect, it } from 'vitest'
import { canCreateShoppingList, canDeleteShoppingItem, canEditShoppingItem, canManageShoppingList, filterShoppingItems, formatQuantity, sortShoppingItems } from './shopping-utils'
import type { ShoppingItem, ShoppingList } from './types'

function item(overrides: Partial<ShoppingItem> = {}): ShoppingItem { return { id: 'item-1', familyId: 'family-1', listId: 'list-1', name: 'Mleko', quantity: 1, unit: 'l', category: 'Nabiał', note: null, isPurchased: false, createdBy: { id: 'creator-1', displayName: 'Olek' }, purchasedBy: null, purchasedAt: null, createdAt: '2026-08-18T08:00:00Z', updatedAt: '2026-08-18T08:00:00Z', ...overrides } }
function list(overrides: Partial<ShoppingList> = {}): ShoppingList { return { id: 'list-1', familyId: 'family-1', name: 'Spożywcze', description: null, isArchived: false, createdBy: { id: 'creator-1', displayName: 'Olek' }, createdAt: '2026-08-18T08:00:00Z', updatedAt: '2026-08-18T08:00:00Z', ...overrides } }

describe('shopping item permissions', () => {
  const candidate = item()
  it('allows owner to edit another user item', () => expect(canEditShoppingItem(candidate, 'owner', 'owner')).toBe(true))
  it('allows admin to edit another user item', () => expect(canEditShoppingItem(candidate, 'admin', 'admin')).toBe(true))
  it('allows adult to edit own item', () => expect(canEditShoppingItem(candidate, 'creator-1', 'adult')).toBe(true))
  it('denies adult editing another item', () => expect(canEditShoppingItem(candidate, 'adult', 'adult')).toBe(false))
  it('allows child to edit own item', () => expect(canEditShoppingItem(candidate, 'creator-1', 'child')).toBe(true))
  it('denies child editing another item', () => expect(canEditShoppingItem(candidate, 'child', 'child')).toBe(false))
})

describe('shopping deletion permissions', () => {
  const purchased = item({ purchasedBy: { id: 'buyer', displayName: 'Ala' }, purchasedAt: '2026-08-18T09:00:00Z', isPurchased: true })
  it('allows owner to delete another item', () => expect(canDeleteShoppingItem(purchased, 'owner', 'owner')).toBe(true))
  it('allows admin to delete another item', () => expect(canDeleteShoppingItem(purchased, 'admin', 'admin')).toBe(true))
  it('allows creator to delete own item', () => expect(canDeleteShoppingItem(purchased, 'creator-1', 'child')).toBe(true))
  it('does not grant delete to purchaser', () => expect(canDeleteShoppingItem(purchased, 'buyer', 'adult')).toBe(false))
})

describe('shopping list permissions', () => {
  it('allows owner, admin and creator to manage a list', () => { expect(canManageShoppingList(list(), 'owner', 'owner')).toBe(true); expect(canManageShoppingList(list(), 'admin', 'admin')).toBe(true); expect(canManageShoppingList(list(), 'creator-1', 'adult')).toBe(true) })
  it('denies an adult managing another list', () => expect(canManageShoppingList(list(), 'adult', 'adult')).toBe(false))
  it('does not allow a child to create lists', () => expect(canCreateShoppingList('child')).toBe(false))
})

describe('shopping filters', () => {
  const values = [item({ id: 'open-mine', createdBy: { id: 'me', displayName: 'Ja' } }), item({ id: 'open-other', createdBy: { id: 'other', displayName: 'Inny' }, category: 'Dom' }), item({ id: 'bought-mine', isPurchased: true, purchasedBy: { id: 'me', displayName: 'Ja' }, purchasedAt: '2026-08-18T10:00:00Z', createdBy: { id: 'other', displayName: 'Inny' } })]
  it('supports all, unpurchased and purchased', () => { expect(filterShoppingItems(values, 'all', 'me')).toHaveLength(3); expect(filterShoppingItems(values, 'unpurchased', 'me').map(({ id }) => id)).toEqual(['open-mine', 'open-other']); expect(filterShoppingItems(values, 'purchased', 'me').map(({ id }) => id)).toEqual(['bought-mine']) })
  it('defines mine as created or purchased by current user', () => expect(filterShoppingItems(values, 'mine', 'me').map(({ id }) => id)).toEqual(['open-mine', 'bought-mine']))
  it('filters by category', () => expect(filterShoppingItems(values, 'all', 'me', 'Dom').map(({ id }) => id)).toEqual(['open-other']))
})

describe('shopping sorting and formatting', () => {
  it('sorts unpurchased before purchased and purchased newest first', () => { const result = sortShoppingItems([item({ id: 'old', isPurchased: true, purchasedAt: '2026-08-18T09:00:00Z' }), item({ id: 'new', isPurchased: true, purchasedAt: '2026-08-18T11:00:00Z' }), item({ id: 'open' })]); expect(result.map(({ id }) => id)).toEqual(['open', 'new', 'old']) })
  it('formats decimal quantity and unit', () => { expect(formatQuantity(1.25, 'kg')).toBe('1,25 kg'); expect(formatQuantity(null, 'opak.')).toBe('opak.'); expect(formatQuantity(null, null)).toBeNull() })
})
