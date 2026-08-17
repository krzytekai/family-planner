import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import type { NewTaskInput, TaskMember, TaskPriority } from '../types'

interface QuickTaskModalProps {
  familyId: string
  members: TaskMember[]
  saving: boolean
  onClose: () => void
  onCreate: (input: NewTaskInput) => Promise<void>
}

export function QuickTaskModal({ familyId, members, saving, onClose, onCreate }: QuickTaskModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('normal')
  const [assignedTo, setAssignedTo] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !saving) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, saving])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    try {
      await onCreate({
        familyId,
        title,
        description,
        dueAt: new Date(dueAt).toISOString(),
        priority,
        assignedTo: assignedTo || null,
      })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać zadania.')
    }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-end bg-black/75 p-0 backdrop-blur-sm sm:place-items-center sm:p-6" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="quick-task-title" className="surface max-h-[92vh] w-full overflow-y-auto rounded-t-3xl p-5 sm:max-w-xl sm:rounded-3xl sm:p-6">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[.18em] text-brand-gold">Szybkie dodawanie</p>
            <h2 id="quick-task-title" className="mt-1 text-xl font-semibold">Nowe zadanie</h2>
          </div>
          <button type="button" onClick={onClose} disabled={saving} aria-label="Zamknij" className="rounded-xl p-2 text-brand-muted hover:bg-white/5 hover:text-brand-text disabled:cursor-not-allowed disabled:opacity-50"><X className="h-5 w-5" /></button>
        </header>

        <form onSubmit={submit} className="space-y-4">
          <label className="block text-xs text-brand-muted">Tytuł<input autoFocus required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none focus:border-brand-gold/50" /></label>
          <label className="block text-xs text-brand-muted">Opis <span className="text-white/35">(opcjonalnie)</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1 w-full resize-none rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none focus:border-brand-gold/50" /></label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-xs text-brand-muted">Termin<input required type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-[#101017] px-3 py-2.5 text-sm text-brand-text outline-none focus:border-brand-gold/50" /></label>
            <label className="block text-xs text-brand-muted">Priorytet<select value={priority} onChange={(event) => setPriority(event.target.value as TaskPriority)} className="mt-1 w-full rounded-xl border border-white/10 bg-[#101017] px-3 py-2.5 text-sm text-brand-text outline-none focus:border-brand-gold/50"><option value="low">Niski</option><option value="normal">Normalny</option><option value="high">Wysoki</option></select></label>
          </div>
          <label className="block text-xs text-brand-muted">Przypisz do członka rodziny<select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} className="mt-1 w-full rounded-xl border border-white/10 bg-[#101017] px-3 py-2.5 text-sm text-brand-text outline-none focus:border-brand-gold/50"><option value="">Nieprzypisane</option>{members.map((member) => <option key={member.userId} value={member.userId}>{member.displayName} ({member.role})</option>)}</select></label>
          {error ? <p role="alert" className="rounded-xl border border-red-400/15 bg-red-400/5 px-3 py-2 text-sm text-red-300">{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-brand-muted hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50">Anuluj</button>
            <button disabled={saving} className="rounded-xl bg-brand-gold px-5 py-2.5 text-sm font-semibold text-black transition hover:brightness-105 disabled:cursor-wait disabled:opacity-60">{saving ? 'Zapisywanie…' : 'Zapisz zadanie'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
