import { getSupabaseClient } from '../../../lib/supabase'
import type { ShoppingItem, ShoppingItemInput, ShoppingList, ShoppingListInput, ShoppingPerson, ShoppingPreview } from '../types'

type ProfileRelation = { id: string; display_name: string } | Array<{ id: string; display_name: string }> | null
interface ListRow { id: string; family_id: string; name: string; description: string | null; is_archived: boolean; created_by: string; created_at: string; updated_at: string; creator: ProfileRelation }
interface ItemRow { id: string; family_id: string; list_id: string; name: string; quantity: number | string | null; unit: string | null; category: string | null; note: string | null; is_purchased: boolean; created_by: string; purchased_by: string | null; purchased_at: string | null; created_at: string; updated_at: string; creator: ProfileRelation; purchaser: ProfileRelation }

const itemSelect = `id, family_id, list_id, name, quantity, unit, category, note, is_purchased, created_by, purchased_by, purchased_at, created_at, updated_at, creator:profiles!shopping_items_created_by_fkey(id, display_name), purchaser:profiles!shopping_items_purchased_by_fkey(id, display_name)`

function client() { const value = getSupabaseClient(); if (!value) throw new Error('Brak konfiguracji Supabase.'); return value }
function person(value: ProfileRelation, fallback: string): ShoppingPerson { const profile = Array.isArray(value) ? value[0] : value; return profile ? { id: profile.id, displayName: profile.display_name } : { id: fallback, displayName: 'Nieaktywny użytkownik' } }
function mapList(row: ListRow): ShoppingList { return { id: row.id, familyId: row.family_id, name: row.name, description: row.description, isArchived: row.is_archived, createdBy: person(row.creator, row.created_by), createdAt: row.created_at, updatedAt: row.updated_at } }
function mapItem(row: ItemRow): ShoppingItem { return { id: row.id, familyId: row.family_id, listId: row.list_id, name: row.name, quantity: row.quantity === null ? null : Number(row.quantity), unit: row.unit, category: row.category, note: row.note, isPurchased: row.is_purchased, createdBy: person(row.creator, row.created_by), purchasedBy: row.purchased_by ? person(row.purchaser, row.purchased_by) : null, purchasedAt: row.purchased_at, createdAt: row.created_at, updatedAt: row.updated_at } }
function itemPayload(input: ShoppingItemInput) { return { name: input.name.trim(), quantity: input.quantity, unit: input.unit.trim() || null, category: input.category.trim() || null, note: input.note.trim() || null } }

export function createShoppingRepository() {
  return {
    async listShoppingLists(familyId: string): Promise<ShoppingList[]> {
      const { data, error } = await client().from('shopping_lists').select(`id, family_id, name, description, is_archived, created_by, created_at, updated_at, creator:profiles!shopping_lists_created_by_fkey(id, display_name)`).eq('family_id', familyId).order('created_at')
      if (error) throw new Error(error.message)
      return ((data ?? []) as unknown as ListRow[]).map(mapList)
    },
    async createShoppingList(input: ShoppingListInput) { const { error } = await client().from('shopping_lists').insert({ family_id: input.familyId, name: input.name.trim(), description: input.description.trim() || null }); if (error) throw new Error(error.message) },
    async updateShoppingList(familyId: string, id: string, input: ShoppingListInput) { const { data, error } = await client().from('shopping_lists').update({ name: input.name.trim(), description: input.description.trim() || null }).eq('family_id', familyId).eq('id', id).select('id').maybeSingle(); if (error) throw new Error(error.message); if (!data) throw new Error('Nie masz uprawnień do edycji tej listy.') },
    async archiveShoppingList(familyId: string, id: string, archived: boolean) { const { data, error } = await client().from('shopping_lists').update({ is_archived: archived }).eq('family_id', familyId).eq('id', id).select('id').maybeSingle(); if (error) throw new Error(error.message); if (!data) throw new Error('Nie masz uprawnień do archiwizacji tej listy.') },
    async deleteShoppingList(familyId: string, id: string) { const { data, error } = await client().from('shopping_lists').delete().eq('family_id', familyId).eq('id', id).select('id').maybeSingle(); if (error) throw new Error(error.message); if (!data) throw new Error('Nie masz uprawnień do usunięcia tej listy.') },
    async listShoppingItems(familyId: string, listId: string): Promise<ShoppingItem[]> { const { data, error } = await client().from('shopping_items').select(itemSelect).eq('family_id', familyId).eq('list_id', listId); if (error) throw new Error(error.message); return ((data ?? []) as unknown as ItemRow[]).map(mapItem) },
    async createShoppingItem(input: ShoppingItemInput) { const { error } = await client().from('shopping_items').insert({ family_id: input.familyId, list_id: input.listId, ...itemPayload(input) }); if (error) throw new Error(error.message) },
    async updateShoppingItem(familyId: string, id: string, input: ShoppingItemInput) { const { data, error } = await client().from('shopping_items').update(itemPayload(input)).eq('family_id', familyId).eq('id', id).select('id').maybeSingle(); if (error) throw new Error(error.message); if (!data) throw new Error('Nie masz uprawnień do edycji tego produktu.') },
    async setShoppingItemPurchased(familyId: string, id: string, purchased: boolean) { const { data, error } = await client().from('shopping_items').update({ is_purchased: purchased }).eq('family_id', familyId).eq('id', id).select('id').maybeSingle(); if (error) throw new Error(error.message); if (!data) throw new Error('Nie udało się zmienić statusu produktu.') },
    async deleteShoppingItem(familyId: string, id: string) { const { data, error } = await client().from('shopping_items').delete().eq('family_id', familyId).eq('id', id).select('id').maybeSingle(); if (error) throw new Error(error.message); if (!data) throw new Error('Nie masz uprawnień do usunięcia tego produktu.') },
    async getShoppingPreview(familyId: string): Promise<ShoppingPreview> {
      const base = () => client().from('shopping_items').select(`${itemSelect}, list:shopping_lists!inner(is_archived)`).eq('family_id', familyId).eq('is_purchased', false).eq('list.is_archived', false)
      const [itemsResult, countResult] = await Promise.all([base().order('created_at').limit(5), client().from('shopping_items').select('id, list:shopping_lists!inner(is_archived)', { count: 'exact', head: true }).eq('family_id', familyId).eq('is_purchased', false).eq('list.is_archived', false)])
      if (itemsResult.error) throw new Error(itemsResult.error.message)
      if (countResult.error) throw new Error(countResult.error.message)
      return { count: countResult.count ?? 0, items: ((itemsResult.data ?? []) as unknown as ItemRow[]).map(mapItem) }
    },
  }
}
