import { LogOut, Search } from 'lucide-react'
import { NotificationBell } from '../features/notifications/components/NotificationBell'
import { getSupabaseClient } from '../lib/supabase'

interface Props {
  familyName: string
  subtitle: string
  displayName: string
  unreadCount: number
  onOpenNotifications: () => void
}

export function AppHeader({ familyName, subtitle, displayName, unreadCount, onOpenNotifications }: Props) {
  return <header className="app-topbar sticky top-0 z-30 flex h-20 items-center gap-2 border-b border-white/[.045] bg-brand-bg/88 px-4 backdrop-blur-xl md:px-7">
    <div className="app-mobile-header-copy min-w-0 flex-1 md:hidden">
      <p className="truncate text-[10.5px] font-semibold uppercase leading-[1.2] tracking-[.075em] text-brand-gold" title={familyName}>{familyName}</p>
      <p className="mt-px truncate text-[13.5px] font-semibold leading-[1.2] text-brand-text" title={subtitle}>{subtitle}</p>
    </div>
    <div className="relative hidden max-w-md flex-1 md:block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted/50"/><input disabled aria-label="Wyszukiwanie — w przygotowaniu" placeholder="Wyszukiwanie — w przygotowaniu" className="w-full cursor-not-allowed rounded-xl border border-white/5 bg-white/[0.015] py-2.5 pl-10 pr-4 text-sm text-brand-muted/50 outline-none"/></div>
    <div className="app-topbar-actions ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
      <NotificationBell unreadCount={unreadCount} onClick={onOpenNotifications}/>
      <div className="app-avatar-shell flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.025] px-2.5 py-2"><div className="app-avatar grid h-8 w-8 place-items-center rounded-full bg-brand-gold/15 text-xs font-bold text-brand-gold">{displayName.slice(0, 1).toUpperCase()}</div><span className="hidden text-sm font-medium md:block">{displayName}</span></div>
      <button aria-label="Wyloguj" title="Wyloguj" onClick={() => void getSupabaseClient()?.auth.signOut()} className="grid h-10 w-10 place-items-center rounded-xl text-brand-muted hover:bg-white/5 hover:text-brand-text"><LogOut className="h-4 w-4"/></button>
    </div>
  </header>
}
