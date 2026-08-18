import { Archive, ShoppingBasket } from 'lucide-react'
import type { ShoppingList } from '../types'

interface Props { lists: ShoppingList[]; selectedId: string | null; showArchived: boolean; onSelect: (id: string) => void; onShowArchived: (value: boolean) => void }
export function ShoppingListSelector({ lists, selectedId, showArchived, onSelect, onShowArchived }: Props) {
  const visible = lists.filter((list) => showArchived || !list.isArchived)
  return <section className="surface rounded-2xl p-3"><div className="scrollbar-none flex gap-2 overflow-x-auto lg:flex-col">{visible.map((list) => <button key={list.id} type="button" onClick={() => onSelect(list.id)} className={`flex min-w-44 items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm lg:min-w-0 ${selectedId === list.id ? 'border-brand-gold/30 bg-brand-gold/10 text-brand-gold' : 'border-white/5 bg-black/15 text-brand-muted hover:text-brand-text'}`}><ShoppingBasket className="h-4 w-4 shrink-0"/><span className="truncate">{list.name}</span>{list.isArchived ? <Archive className="ml-auto h-3.5 w-3.5"/> : null}</button>)}</div><label className="mt-3 flex items-center gap-2 px-2 text-xs text-brand-muted"><input type="checkbox" checked={showArchived} onChange={(event) => onShowArchived(event.target.checked)} className="accent-[#ffd84d]"/>Pokaż archiwalne</label></section>
}
