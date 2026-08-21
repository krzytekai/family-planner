import { useState } from 'react'
import { Building2, CalendarDays, CheckSquare, Home, MoreHorizontal, Plus, ShieldCheck, ShoppingCart, UserRoundCog, WalletCards, X } from 'lucide-react'
import type { AppView } from '../app/navigation'
import { useNativeBackDismiss } from '../app/native-platform'

interface Props {
  activeView: AppView
  canBudget: boolean
  canProperties: boolean
  canQuickAdd: boolean
  onNavigate: (view: AppView) => void
  onQuickAdd: () => void
  canAdmin: boolean
  isPlatformAdmin: boolean
  onAdmin: () => void
  onPlatformAdmin: () => void
  canCreateFamily: boolean
  onCreateFamily: () => void
}

export function MobileNav({ activeView, canBudget, canProperties, canQuickAdd, onNavigate, onQuickAdd, canAdmin, isPlatformAdmin, onAdmin, onPlatformAdmin, canCreateFamily, onCreateFamily }: Props) {
  const [more, setMore] = useState(false)
  useNativeBackDismiss(more, () => setMore(false))
  const go = (view: AppView) => { onNavigate(view); setMore(false) }
  const item = (view: AppView, label: string, Icon: typeof Home) => {
    const active = activeView === view
    return <button type="button" onClick={() => go(view)} aria-label={label} aria-current={active ? 'page' : undefined} className={`grid h-full min-w-0 place-items-center content-center gap-px leading-none ${active ? 'text-brand-gold/85' : 'text-brand-muted/75'}`}><Icon className="h-[18px] w-[18px]"/>{active ? <span className="max-w-full truncate px-0.5 text-[9px]">{label}</span> : null}</button>
  }
  const moreActive = activeView === 'shopping' || activeView === 'budget' || activeView === 'properties'
  const quickAddLabel = activeView === 'budget' ? 'Dodaj wydatek' : activeView === 'calendar' ? 'Dodaj wydarzenie' : activeView === 'shopping' ? 'Dodaj produkt' : 'Dodaj szybkie zadanie'

  return <>
    {more ? <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setMore(false)}><div className="mobile-more-menu absolute right-3 w-60 rounded-2xl border border-white/10 bg-[#13131b] p-2" onClick={(event) => event.stopPropagation()}><div className="flex justify-end"><button type="button" onClick={() => setMore(false)} aria-label="Zamknij menu" className="grid h-10 w-10 place-items-center rounded-xl"><X className="h-4 w-4"/></button></div><button type="button" onClick={() => go('shopping')} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm"><ShoppingCart className="h-4 w-4"/>Zakupy</button>{canBudget ? <button type="button" onClick={() => go('budget')} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm"><WalletCards className="h-4 w-4"/>Budżet</button> : null}{canProperties?<button type="button" onClick={()=>go('properties')} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm"><Building2 className="h-4 w-4"/>Nieruchomości</button>:null}{canAdmin?<button type="button" onClick={()=>{setMore(false);onAdmin()}} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-brand-gold"><UserRoundCog className="h-4 w-4"/>Rodzina i administracja</button>:null}{canCreateFamily?<button type="button" onClick={()=>{setMore(false);onCreateFamily()}} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm"><Plus className="h-4 w-4"/>Utwórz rodzinę</button>:null}{isPlatformAdmin?<button type="button" onClick={()=>{setMore(false);onPlatformAdmin()}} className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-brand-gold"><ShieldCheck className="h-4 w-4"/>Administracja platformy</button>:null}</div></div> : null}
    <nav className="mobile-nav fixed inset-x-0 bottom-0 z-50 border-t border-white/[.05] bg-[#0d0d13]/88 backdrop-blur-sm lg:hidden" aria-label="Nawigacja mobilna"><div className="grid h-12 grid-cols-5 items-center px-1">{item('dashboard', 'Start', Home)}{item('calendar', 'Kalendarz', CalendarDays)}<button type="button" disabled={!canQuickAdd} onClick={onQuickAdd} aria-label={quickAddLabel} className="grid h-full min-w-0 place-items-center disabled:opacity-40"><span className="grid h-10 w-10 place-items-center rounded-full bg-brand-gold text-black shadow-[0_3px_10px_rgba(255,216,77,.06)]"><Plus className="h-[18px] w-[18px]"/></span></button>{item('tasks', 'Zadania', CheckSquare)}<button type="button" onClick={() => setMore((value) => !value)} aria-label="Więcej" aria-current={moreActive ? 'page' : undefined} aria-expanded={more} className={`grid h-full min-w-0 place-items-center content-center gap-px leading-none ${moreActive ? 'text-brand-gold/85' : 'text-brand-muted/75'}`}><MoreHorizontal className="h-[18px] w-[18px]"/>{moreActive ? <span className="max-w-full truncate px-0.5 text-[9px]">Więcej</span> : null}</button></div></nav>
  </>
}
