import {
  Bell, CalendarDays, Car, CheckSquare, FileText, Gauge, Home, PawPrint,
  Settings, ShieldCheck, ShoppingCart, Users, WalletCards
} from 'lucide-react'

const items = [
  [Gauge, 'Dashboard'], [CalendarDays, 'Kalendarz'], [CheckSquare, 'Zadania'],
  [ShoppingCart, 'Zakupy'], [WalletCards, 'Budżet'], [FileText, 'Dokumenty'],
  [Car, 'Garaż'], [PawPrint, 'Zwierzęta'], [ShieldCheck, 'Backup'],
  [Users, 'Rodzina'], [Settings, 'Ustawienia'],
] as const

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-64 border-r border-white/5 bg-[#0d0d13] p-4 lg:flex lg:flex-col">
      <div className="flex items-center gap-3 px-2 py-4">
        <div className="grid h-10 w-10 place-items-center rounded-xl border border-brand-gold/30 bg-brand-gold/10 text-brand-gold">
          <Home className="h-5 w-5" />
        </div>
        <div>
          <div className="font-semibold text-brand-gold">Planer rodzinny</div>
          <div className="text-xs text-brand-muted">Rodzina Krzytek</div>
        </div>
      </div>

      <nav className="mt-5 space-y-1">
        {items.map(([Icon, label], index) => (
          <button key={label} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${index === 0 ? 'border border-brand-gold/15 bg-brand-gold/10 text-brand-gold' : 'text-brand-text/80 hover:bg-white/5'}`}>
            <Icon className="h-4 w-4" />{label}
          </button>
        ))}
      </nav>

      <div className="surface mt-auto rounded-2xl p-4">
        <div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-5 w-5 text-brand-green" /> Backup Center</div>
        <p className="mt-2 text-xs leading-5 text-brand-muted">Wszystko w porządku<br/>Ostatnia kopia: dziś, 02:15</p>
      </div>

      <p className="mt-4 px-2 text-xs text-brand-muted">Designed & developed by Krzytek</p>
    </aside>
  )
}
