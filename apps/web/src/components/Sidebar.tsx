import { CalendarDays, Car, CheckSquare, FileText, Gauge, Home, PawPrint, Settings, ShieldCheck, ShoppingCart, Users, WalletCards } from 'lucide-react'
import type { AppView } from '../app/navigation'

const items = [
  { icon: Gauge, label: 'Dashboard', view: 'dashboard' },
  { icon: CalendarDays, label: 'Kalendarz', view: 'calendar' },
  { icon: CheckSquare, label: 'Zadania', view: 'tasks' },
  { icon: ShoppingCart, label: 'Zakupy' },
  { icon: WalletCards, label: 'Budżet' },
  { icon: FileText, label: 'Dokumenty' },
  { icon: Car, label: 'Garaż' },
  { icon: PawPrint, label: 'Zwierzęta' },
  { icon: ShieldCheck, label: 'Backup' },
  { icon: Users, label: 'Rodzina' },
  { icon: Settings, label: 'Ustawienia' },
] satisfies Array<{ icon: typeof Gauge; label: string; view?: AppView }>

interface SidebarProps {
  familyName: string
  canAdmin: boolean
  activeView: AppView
  onNavigate: (view: AppView) => void
  onAdmin: () => void
}

export function Sidebar({ familyName, canAdmin, activeView, onNavigate, onAdmin }: SidebarProps) {
  return <aside className="fixed inset-y-0 left-0 hidden w-64 overflow-hidden border-r border-white/5 bg-[#0d0d13] p-4 lg:flex lg:flex-col"><div className="flex shrink-0 items-center gap-3 px-2 py-4"><div className="grid h-10 w-10 place-items-center rounded-xl border border-brand-gold/30 bg-brand-gold/10 text-brand-gold"><Home className="h-5 w-5"/></div><div><div className="font-semibold text-brand-gold">Planer rodzinny</div><div className="max-w-36 truncate text-xs text-brand-muted">{familyName}</div></div></div><div className="mt-5 flex min-h-0 flex-1 flex-col"><nav className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 [scrollbar-color:rgba(255,255,255,0.14)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/15 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1">{items.map(({ icon: Icon, label, view }) => { const active = view === activeView; return <button key={label} type="button" disabled={!view} title={view ? label : `${label} — w przygotowaniu`} onClick={() => view && onNavigate(view)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active?'border border-brand-gold/15 bg-brand-gold/10 text-brand-gold':view?'text-brand-text/80 hover:bg-white/5':'cursor-not-allowed text-brand-muted/45'}`}><Icon className="h-4 w-4"/>{label}{!view?<span className="ml-auto text-[9px] uppercase tracking-wide">wkrótce</span>:null}</button> })}</nav>{canAdmin?<button onClick={onAdmin} className="mt-2 flex w-full shrink-0 items-center gap-3 rounded-xl border border-brand-gold/15 bg-brand-gold/[.04] px-3 py-2.5 text-sm text-brand-gold hover:bg-brand-gold/10"><ShieldCheck className="h-4 w-4"/>Administracja</button>:null}</div><div className="surface mt-4 shrink-0 rounded-2xl p-4"><div className="flex items-center gap-2 font-medium"><ShieldCheck className="h-5 w-5 text-brand-green"/>Security Center</div><p className="mt-2 text-xs leading-5 text-brand-muted">RLS: aktywne<br/>Sesja: chroniona</p></div><p className="mt-4 shrink-0 px-2 text-xs text-brand-muted">Designed & developed by Krzytek</p></aside>
}
