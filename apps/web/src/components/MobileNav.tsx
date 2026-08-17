import { CalendarDays, CheckSquare, Home, Plus, ShoppingCart } from 'lucide-react'
import type { AppView } from '../app/navigation'

interface MobileNavProps {
  activeView: AppView
  canQuickAdd: boolean
  onNavigate: (view: AppView) => void
  onQuickAdd: () => void
}

export function MobileNav({ activeView, canQuickAdd, onNavigate, onQuickAdd }: MobileNavProps) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t border-white/10 bg-[#0d0d13]/95 px-3 py-2 backdrop-blur lg:hidden">
      <button type="button" onClick={() => onNavigate('dashboard')} className={`grid place-items-center gap-1 text-[10px] ${activeView === 'dashboard' ? 'text-brand-gold' : 'text-brand-muted'}`}><Home className="h-5 w-5" />Start</button>
      <button type="button" onClick={() => onNavigate('calendar')} className={`grid place-items-center gap-1 text-[10px] ${activeView === 'calendar' ? 'text-brand-gold' : 'text-brand-muted'}`}><CalendarDays className="h-5 w-5" />Kalendarz</button>
      <button type="button" disabled={!canQuickAdd} onClick={onQuickAdd} aria-label={activeView === 'calendar' ? 'Dodaj wydarzenie' : 'Dodaj szybkie zadanie'} title={canQuickAdd ? (activeView === 'calendar' ? 'Dodaj wydarzenie' : 'Dodaj szybkie zadanie') : 'Tworzenie jest dostępne dla dorosłych i administratorów'} className="grid h-12 w-12 place-items-center rounded-full bg-brand-gold text-black shadow-lg shadow-yellow-500/20 disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-6 w-6" /></button>
      <button type="button" onClick={() => onNavigate('tasks')} className={`grid place-items-center gap-1 text-[10px] ${activeView === 'tasks' ? 'text-brand-gold' : 'text-brand-muted'}`}><CheckSquare className="h-5 w-5" />Zadania</button>
      <button type="button" disabled title="Zakupy — w przygotowaniu" className="grid cursor-not-allowed place-items-center gap-1 text-[10px] text-brand-muted/40"><ShoppingCart className="h-5 w-5" />Zakupy</button>
    </nav>
  )
}
