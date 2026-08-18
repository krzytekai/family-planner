import { useCallback, useEffect, useMemo, useState } from 'react'
import { createShoppingRepository } from '../api/shopping-repository'
import type { ShoppingItem, ShoppingItemInput, ShoppingList, ShoppingListInput, ShoppingPreview } from '../types'

export function useShopping(familyId: string) {
  const repository = useMemo(() => createShoppingRepository(), [])
  const [lists, setLists] = useState<ShoppingList[]>([])
  const [selectedListId, setSelectedListId] = useState<string | null>(null)
  const [items, setItems] = useState<ShoppingItem[]>([])
  const [loadingLists, setLoadingLists] = useState(true)
  const [loadingItems, setLoadingItems] = useState(false)
  const [saving, setSaving] = useState(false)
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set())
  const [deletingIds, setDeletingIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadLists = useCallback(async () => repository.listShoppingLists(familyId), [familyId, repository])
  const loadItems = useCallback(async (listId: string) => repository.listShoppingItems(familyId, listId), [familyId, repository])

  useEffect(() => {
    let cancelled = false
    setLoadingLists(true)
    void loadLists().then((next) => {
      if (cancelled) return
      setLists(next)
      setSelectedListId((current) => current && next.some((list) => list.id === current) ? current : next.find((list) => !list.isArchived)?.id ?? null)
    }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Nie udało się pobrać list zakupów.') }).finally(() => { if (!cancelled) setLoadingLists(false) })
    return () => { cancelled = true }
  }, [loadLists])

  useEffect(() => {
    if (!selectedListId) { setItems([]); return }
    let cancelled = false
    setLoadingItems(true)
    void loadItems(selectedListId).then((next) => { if (!cancelled) setItems(next) }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Nie udało się pobrać produktów.') }).finally(() => { if (!cancelled) setLoadingItems(false) })
    return () => { cancelled = true }
  }, [loadItems, selectedListId])

  const refresh = useCallback(async () => {
    const nextLists = await loadLists()
    setLists(nextLists)
    const nextSelected = selectedListId && nextLists.some((list) => list.id === selectedListId) ? selectedListId : nextLists.find((list) => !list.isArchived)?.id ?? null
    setSelectedListId(nextSelected)
    setItems(nextSelected ? await loadItems(nextSelected) : [])
  }, [loadItems, loadLists, selectedListId])

  async function save(action: () => Promise<void>) { setSaving(true); setActionError(null); try { await action(); await refresh() } catch (reason) { const message = reason instanceof Error ? reason.message : 'Operacja nie powiodła się.'; setActionError(message); throw new Error(message) } finally { setSaving(false) } }
  async function remove(id: string, action: () => Promise<void>) { setDeletingIds((value) => new Set(value).add(id)); setActionError(null); try { await action(); await refresh() } catch (reason) { const message = reason instanceof Error ? reason.message : 'Nie udało się usunąć.'; setActionError(message); throw new Error(message) } finally { setDeletingIds((value) => { const next = new Set(value); next.delete(id); return next }) } }

  const togglePurchased = useCallback(async (item: ShoppingItem) => {
    setUpdatingIds((value) => new Set(value).add(item.id)); setActionError(null)
    try { await repository.setShoppingItemPurchased(familyId, item.id, !item.isPurchased); setItems(await loadItems(item.listId)) }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : 'Nie udało się zmienić statusu produktu.') }
    finally { setUpdatingIds((value) => { const next = new Set(value); next.delete(item.id); return next }) }
  }, [familyId, loadItems, repository])

  async function archiveList(id: string, archived: boolean) {
    await save(() => repository.archiveShoppingList(familyId, id, archived))
    if (archived && selectedListId === id) setSelectedListId(lists.find((list) => list.id !== id && !list.isArchived)?.id ?? null)
  }

  return {
    lists, selectedListId, selectedList: lists.find((list) => list.id === selectedListId) ?? null, items,
    loadingLists, loadingItems, saving, updatingIds, deletingIds, error, actionError, selectList: setSelectedListId, refresh,
    createList: (input: ShoppingListInput) => save(() => repository.createShoppingList(input)),
    updateList: (id: string, input: ShoppingListInput) => save(() => repository.updateShoppingList(familyId, id, input)),
    archiveList,
    deleteList: (list: ShoppingList) => remove(list.id, () => repository.deleteShoppingList(familyId, list.id)),
    createItem: (input: ShoppingItemInput) => save(() => repository.createShoppingItem(input)),
    updateItem: (id: string, input: ShoppingItemInput) => save(() => repository.updateShoppingItem(familyId, id, input)),
    togglePurchased,
    deleteItem: (item: ShoppingItem) => remove(item.id, () => repository.deleteShoppingItem(familyId, item.id)),
  }
}

export function useShoppingPreview(familyId: string) {
  const repository = useMemo(() => createShoppingRepository(), [])
  const [preview, setPreview] = useState<ShoppingPreview>({ count: 0, items: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { let cancelled = false; void repository.getShoppingPreview(familyId).then((value) => { if (!cancelled) setPreview(value) }).catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Nie udało się pobrać zakupów.') }).finally(() => { if (!cancelled) setLoading(false) }); return () => { cancelled = true } }, [familyId, repository])
  return { ...preview, loading, error }
}
