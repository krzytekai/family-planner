import { CalendarDays, CheckSquare, Home, Plus, ShoppingCart } from 'lucide-react'

export function MobileNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t border-white/10 bg-[#0d0d13]/95 px-3 py-2 backdrop-blur lg:hidden">
      <button className="grid place-items-center gap-1 text-[10px] text-brand-gold"><Home className="h-5 w-5" />Start</button>
      <button className="grid place-items-center gap-1 text-[10px] text-brand-muted"><CalendarDays className="h-5 w-5" />Kalendarz</button>
      <button aria-label="Dodaj" className="grid h-12 w-12 place-items-center rounded-full bg-brand-gold text-black shadow-lg shadow-yellow-500/20"><Plus className="h-6 w-6" /></button>
      <button className="grid place-items-center gap-1 text-[10px] text-brand-muted"><CheckSquare className="h-5 w-5" />Zadania</button>
      <button className="grid place-items-center gap-1 text-[10px] text-brand-muted"><ShoppingCart className="h-5 w-5" />Zakupy</button>
    </nav>
  )
}
