import { useState } from 'react'
import { CalendarDays, CheckSquare, Home, MoreHorizontal, Plus, ShoppingCart, WalletCards, X } from 'lucide-react'
import type { AppView } from '../app/navigation'

interface Props {
  activeView: AppView
  canBudget: boolean
  canQuickAdd: boolean
  onNavigate: (view: AppView) => void
  onQuickAdd: () => void
}

export function MobileNav({ activeView, canBudget, canQuickAdd, onNavigate, onQuickAdd }: Props) {
  const [more, setMore] = useState(false)
  const go = (view: AppView) => { onNavigate(view); setMore(false) }
  const item = (view: AppView, label: string, Icon: typeof Home) => <button type="button" onClick={() => go(view)} className={`grid h-full min-w-0 place-items-center content-center gap-px text-[9.5px] leading-none ${activeView === view ? 'text-brand-gold/85' : 'text-brand-muted/90'}`}><Icon className="h-[18px] w-[18px]"/><span className="max-w-full truncate px-0.5">{label}</span></button>
  const quickAddLabel = activeView === 'budget' ? 'Dodaj wydatek' : activeView === 'calendar' ? 'Dodaj wydarzenie' : activeView === 'shopping' ? 'Dodaj produkt' : 'Dodaj szybkie zadanie'

  return <>
    {more ? <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMore(false)}><div className="mobile-more-menu absolute right-3 w-52 rounded-2xl border border-white/10 bg-[#13131b] p-2" onClick={(event) => event.stopPropagation()}><div className="flex justify-end"><button type="button" onClick={() => setMore(false)} aria-label="Zamknij menu" className="grid h-10 w-10 place-items-center rounded-xl"><X className="h-4 w-4"/></button></div><button type="button" onClick={() => go('shopping')} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm"><ShoppingCart className="h-4 w-4"/>Zakupy</button>{canBudget ? <button type="button" onClick={() => go('budget')} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm"><WalletCards className="h-4 w-4"/>Budżet</button> : null}</div></div> : null}
    <nav className="mobile-nav fixed inset-x-0 bottom-0 z-50 border-t border-white/[.07] bg-[#0d0d13]/92 backdrop-blur lg:hidden" aria-label="Nawigacja mobilna"><div className="grid h-[54px] grid-cols-5 items-center px-1">{item('dashboard', 'Start', Home)}{item('calendar', 'Kalendarz', CalendarDays)}<button type="button" disabled={!canQuickAdd} onClick={onQuickAdd} aria-label={quickAddLabel} className="grid h-full min-w-0 place-items-center disabled:opacity-40"><span className="grid h-11 w-11 place-items-center rounded-full bg-brand-gold text-black shadow-[0_4px_14px_rgba(255,216,77,.10)]"><Plus className="h-[18px] w-[18px]"/></span></button>{item('tasks', 'Zadania', CheckSquare)}<button type="button" onClick={() => setMore((value) => !value)} aria-expanded={more} className={`grid h-full min-w-0 place-items-center content-center gap-px text-[9.5px] leading-none ${activeView === 'shopping' || activeView === 'budget' ? 'text-brand-gold/85' : 'text-brand-muted/90'}`}><MoreHorizontal className="h-[18px] w-[18px]"/><span className="max-w-full truncate px-0.5">Więcej</span></button></div></nav>
  </>
}
