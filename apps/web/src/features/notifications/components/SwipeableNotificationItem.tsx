import { useRef, useState, type PointerEvent } from 'react'
import { ChevronRight, Trash2 } from 'lucide-react'
import { formatNotificationDate } from '../notification-utils'
import type { AppNotification } from '../types'

const swipeThreshold = 56
const actionWidth = 76

export function SwipeableNotificationItem({ item, saving, onOpen, onToggleRead, onDismiss }: {
  item: AppNotification
  saving: boolean
  onOpen: () => void
  onToggleRead: () => void
  onDismiss: () => void
}) {
  const start = useRef<{x:number;y:number}|null>(null)
  const [offset, setOffset] = useState(0)
  function pointerDown(event: PointerEvent<HTMLDivElement>) { start.current={x:event.clientX,y:event.clientY}; event.currentTarget.setPointerCapture(event.pointerId) }
  function pointerMove(event: PointerEvent<HTMLDivElement>) { if(!start.current)return;const dx=event.clientX-start.current.x,dy=event.clientY-start.current.y;if(Math.abs(dy)>Math.abs(dx))return;setOffset(Math.max(-actionWidth,Math.min(0,dx))) }
  function pointerUp() { setOffset(offset<=-swipeThreshold?-actionWidth:0);start.current=null }
  return <article className="relative overflow-hidden rounded-2xl">
    <button type="button" disabled={saving} onClick={onDismiss} aria-label={`Usuń powiadomienie: ${item.title}`} className="absolute inset-y-0 right-0 grid w-[76px] place-items-center bg-red-500/20 text-red-200 sm:hidden"><span className="grid place-items-center gap-1 text-[10px]"><Trash2 className="h-4 w-4"/>Usuń</span></button>
    <div onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} style={{transform:`translateX(${offset}px)`}} className={`relative touch-pan-y rounded-2xl border p-3 transition-transform ${item.readAt?'border-white/5 bg-[#101017]':'border-brand-gold/15 bg-[#17160f]'}`}>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 text-left"><span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.readAt?'bg-white/15':'bg-brand-gold'}`}/><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{item.title}</span>{item.body?<span className="mt-1 block text-xs text-brand-muted">{item.body}</span>:null}<span className="mt-2 block text-[10px] text-brand-muted">{formatNotificationDate(item.createdAt)}</span></span><ChevronRight className="mt-1 h-4 w-4 text-brand-muted"/></button>
      <div className="mt-2 flex items-center justify-between gap-3"><button type="button" disabled={saving} onClick={onToggleRead} className="text-[10px] text-brand-gold hover:underline disabled:opacity-50">{item.readAt?'Oznacz jako nieprzeczytane':'Oznacz jako przeczytane'}</button><button type="button" disabled={saving} onClick={onDismiss} aria-label={`Usuń powiadomienie: ${item.title}`} className="hidden h-9 w-9 place-items-center rounded-lg text-red-300 hover:bg-red-400/10 disabled:opacity-50 sm:grid"><Trash2 className="h-4 w-4"/></button></div>
    </div>
  </article>
}
