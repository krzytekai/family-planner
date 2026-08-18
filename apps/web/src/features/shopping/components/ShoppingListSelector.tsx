import { Archive, ShoppingBasket } from 'lucide-react'
import type { ShoppingList } from '../types'

interface Props { lists: ShoppingList[]; selectedId: string | null; showArchived: boolean; onSelect: (id: string) => void; onShowArchived: (value: boolean) => void }
export function ShoppingListSelector({ lists, selectedId, showArchived, onSelect, onShowArchived }: Props) {
  const visible = lists.filter((list) => showArchived || !list.isArchived)
  return <section className="surface min-w-0 rounded-2xl p-1.5 sm:p-3"><div className="scrollbar-none flex min-w-0 gap-1 overflow-x-auto lg:flex-col lg:gap-2">{visible.map((list) => <button key={list.id} type="button" onClick={() => onSelect(list.id)} className="flex h-11 min-w-40 shrink-0 items-center p-0 text-left lg:min-w-0"><span className={`flex h-9 w-full items-center gap-2 rounded-lg border px-2.5 text-[13px] ${selectedId === list.id ? 'border-brand-gold/30 bg-brand-gold/10 text-brand-gold' : 'border-white/5 bg-black/15 text-brand-muted hover:text-brand-text'}`}><ShoppingBasket className="h-4 w-4 shrink-0"/><span className="truncate">{list.name}</span>{list.isArchived ? <Archive className="ml-auto h-3.5 w-3.5"/> : null}</span></button>)}</div><label className="mt-1 flex h-11 items-center gap-2 px-2 text-[11px] text-brand-muted sm:mt-3 sm:text-xs"><input type="checkbox" checked={showArchived} onChange={(event) => onShowArchived(event.target.checked)} className="accent-[#ffd84d]"/>Pokaż archiwalne</label></section>
}
