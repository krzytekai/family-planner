import { Bell } from 'lucide-react'

export function NotificationBell({ unreadCount, onClick }: { unreadCount: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label={`Powiadomienia: ${unreadCount} nieprzeczytanych`} className="relative rounded-xl p-2 text-brand-muted transition hover:bg-white/5 hover:text-brand-gold"><Bell className="h-5 w-5"/>{unreadCount > 0 ? <span className="absolute right-0 top-0 grid min-h-4 min-w-4 place-items-center rounded-full bg-brand-gold px-1 text-[9px] font-bold text-black">{unreadCount > 99 ? '99+' : unreadCount}</span> : null}</button>
}
