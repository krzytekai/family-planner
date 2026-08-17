import { useEffect, useState } from 'react'
import { AlertTriangle, Trash2, X } from 'lucide-react'
import type { Task } from '../types'

interface DeleteTaskModalProps {
  task: Task
  deleting: boolean
  onClose: () => void
  onDelete: (task: Task) => Promise<void>
}

export function DeleteTaskModal({ task, deleting, onClose, onDelete }: DeleteTaskModalProps) {
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !deleting) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [deleting, onClose])

  async function confirmDelete() {
    setError(null)
    try {
      await onDelete(task)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się usunąć zadania.')
    }
  }

  return (
    <div className="fixed inset-0 z-[90] grid place-items-end bg-black/75 p-0 backdrop-blur-sm sm:place-items-center sm:p-6" role="presentation">
      <section role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title" aria-describedby="delete-task-description" className="surface w-full rounded-t-3xl p-5 sm:max-w-lg sm:rounded-3xl sm:p-6">
        <header className="flex items-start justify-between gap-4">
          <div className="grid h-11 w-11 place-items-center rounded-2xl border border-red-400/15 bg-red-400/10 text-red-300"><AlertTriangle className="h-5 w-5" /></div>
          <button type="button" onClick={onClose} disabled={deleting} aria-label="Zamknij" className="rounded-xl p-2 text-brand-muted hover:bg-white/5 hover:text-brand-text disabled:cursor-not-allowed disabled:opacity-40"><X className="h-5 w-5" /></button>
        </header>

        <h2 id="delete-task-title" className="mt-5 text-xl font-semibold">Usunąć zadanie „{task.title}”?</h2>
        <p id="delete-task-description" className="mt-2 text-sm text-brand-muted">Tej operacji nie można cofnąć.</p>
        {error ? <p role="alert" className="mt-4 rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-sm text-red-300">{error}</p> : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={deleting} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-brand-muted hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40">Anuluj</button>
          <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/20 bg-red-500/15 px-4 py-2.5 text-sm font-semibold text-red-200 transition hover:bg-red-500/25 disabled:cursor-wait disabled:opacity-60">{deleting ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Trash2 className="h-4 w-4" />}{deleting ? 'Usuwanie…' : 'Usuń zadanie'}</button>
        </div>
      </section>
    </div>
  )
}
