import { useEffect, useState } from 'react'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import type { CalendarEvent } from '../types'

interface Props { event: CalendarEvent; deleting: boolean; onClose: () => void; onDelete: (event: CalendarEvent) => Promise<void> }

export function DeleteCalendarEventModal({ event, deleting, onClose, onDelete }: Props) {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const close = (keyboardEvent: KeyboardEvent) => { if (keyboardEvent.key === 'Escape' && !deleting) onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [deleting, onClose])

  async function confirm() {
    setError(null)
    try { await onDelete(event); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się usunąć wydarzenia.') }
  }

  return <div className="fixed inset-0 z-[90] grid place-items-end bg-black/75 backdrop-blur-sm sm:place-items-center sm:p-6" role="presentation"><section role="alertdialog" aria-modal="true" aria-labelledby="delete-event-title" aria-describedby="delete-event-description" className="surface w-full rounded-t-3xl p-5 sm:max-w-lg sm:rounded-3xl sm:p-6"><header className="flex items-start justify-between"><div className="grid h-11 w-11 place-items-center rounded-2xl border border-red-400/15 bg-red-400/10 text-red-300"><AlertTriangle className="h-5 w-5"/></div><button type="button" disabled={deleting} onClick={onClose} aria-label="Zamknij" className="rounded-xl p-2 text-brand-muted hover:bg-white/5 disabled:opacity-40"><X className="h-5 w-5"/></button></header><h2 id="delete-event-title" className="mt-5 text-xl font-semibold">Usunąć wydarzenie „{event.title}”?</h2><p id="delete-event-description" className="mt-2 text-sm text-brand-muted">Tej operacji nie można cofnąć.</p>{error ? <p role="alert" className="mt-4 rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-sm text-red-300">{error}</p> : null}<div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={deleting} onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-brand-muted hover:bg-white/5 disabled:opacity-40">Anuluj</button><button type="button" disabled={deleting} onClick={() => void confirm()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-500/15 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-500/25 disabled:cursor-wait disabled:opacity-60">{deleting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"/> : <Trash2 className="h-4 w-4"/>}{deleting ? 'Usuwanie…' : 'Usuń wydarzenie'}</button></div></section></div>
}
