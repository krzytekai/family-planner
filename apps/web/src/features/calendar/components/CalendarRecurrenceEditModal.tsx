import { useState, type FormEvent } from 'react'
import { Repeat2, X } from 'lucide-react'
import { normalizeRecurrenceIntervalInput, parseRecurrenceInterval, recurrenceIntervalError, serializeRecurrence } from '../../tasks/task-utils'
import type { RecurrenceRule, RecurrenceType } from '../../tasks/types'
import { calendarEventAnchorDate, parseDateKey } from '../calendar-utils'
import type { CalendarEvent } from '../types'

const weekdays = [
  { id: 1, label: 'Pn' }, { id: 2, label: 'Wt' }, { id: 3, label: 'Śr' },
  { id: 4, label: 'Cz' }, { id: 5, label: 'Pt' }, { id: 6, label: 'So' }, { id: 7, label: 'Nd' },
]

interface Props {
  event: CalendarEvent
  saving: boolean
  onSave: (rule: RecurrenceRule) => Promise<void>
  onClose: () => void
}

function sameWeekdays(first: number[] | undefined, second: number[]): boolean {
  return JSON.stringify([...(first ?? [])].sort((a, b) => a - b)) === JSON.stringify([...second].sort((a, b) => a - b))
}

export function CalendarRecurrenceEditModal({ event, saving, onSave, onClose }: Props) {
  const currentRule = event.recurrence!.rule
  const anchorDate = calendarEventAnchorDate(event)
  const anchorWeekday = new Date(`${anchorDate}T12:00:00Z`).getUTCDay() || 7
  const [type, setType] = useState<RecurrenceType>(currentRule.type)
  const [interval, setInterval] = useState(String(currentRule.interval))
  const [days, setDays] = useState<number[]>(currentRule.weekdays ?? [anchorWeekday])
  const [error, setError] = useState<string | null>(null)

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault()
    setError(null)
    const parsedInterval = parseRecurrenceInterval(interval)
    if (parsedInterval === null) return setError(recurrenceIntervalError)
    if (type === 'weekly' && days.length === 0) return setError('Wybierz co najmniej jeden dzień tygodnia.')

    const unchanged = type === currentRule.type
      && parsedInterval === currentRule.interval
      && (type !== 'weekly' || sameWeekdays(currentRule.weekdays, days))
    const nextRule = unchanged
      ? currentRule
      : serializeRecurrence(type, parsedInterval, days, `${anchorDate}T12:00:00`)
    if (!nextRule) return setError('Podaj poprawną regułę powtarzania.')

    try {
      await onSave(nextRule)
      onClose()
    } catch {
      setError('Nie udało się zmienić powtarzania wydarzenia. Spróbuj ponownie.')
    }
  }

  const boundaryLabel = new Intl.DateTimeFormat('pl-PL', {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(parseDateKey(event.recurrence!.occurrenceDate))
  const fieldClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-gold/40 disabled:opacity-50'

  return <div className="fixed inset-0 z-[90] grid place-items-end bg-black/75 backdrop-blur-sm sm:place-items-center sm:p-6" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="calendar-recurrence-edit-title" className="surface max-h-[92vh] w-full overflow-y-auto rounded-t-3xl p-5 sm:max-w-xl sm:rounded-3xl sm:p-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-gold/10 text-brand-gold"><Repeat2 className="h-5 w-5"/></div><div className="min-w-0"><h2 id="calendar-recurrence-edit-title" className="font-semibold">Zmień powtarzanie</h2><p className="text-xs text-brand-muted">Zmiana od tego wystąpienia</p></div></div>
        <button type="button" disabled={saving} onClick={onClose} aria-label="Zamknij" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-brand-muted hover:bg-white/5 disabled:opacity-40"><X className="h-5 w-5"/></button>
      </header>
      <p className="mt-4 rounded-xl border border-brand-gold/15 bg-brand-gold/[.04] px-3 py-2 text-xs text-brand-muted">Nowa częstotliwość od: <span className="font-medium text-brand-text">{boundaryLabel}</span></p>
      <form onSubmit={(formEvent) => void submit(formEvent)} className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-brand-muted">Reguła<select value={type} disabled={saving} onChange={(event) => setType(event.target.value as RecurrenceType)} className={fieldClass}><option value="daily">Codziennie / co X dni</option><option value="weekly">Co tydzień / wybrane dni</option><option value="monthly">Co miesiąc</option><option value="yearly">Co rok</option></select></label>
          <label className="text-xs text-brand-muted">Co ile okresów<input type="text" inputMode="numeric" pattern="[0-9]*" disabled={saving} value={interval} onChange={(event) => setInterval(normalizeRecurrenceIntervalInput(event.target.value))} className={fieldClass}/></label>
        </div>
        {type === 'weekly' ? <fieldset><legend className="text-xs text-brand-muted">Dni tygodnia</legend><div className="mt-2 flex flex-wrap gap-2">{weekdays.map((day) => <button key={day.id} type="button" disabled={saving} aria-pressed={days.includes(day.id)} onClick={() => setDays((current) => current.includes(day.id) ? current.filter((id) => id !== day.id) : [...current, day.id])} className={`min-h-11 min-w-11 rounded-lg border text-xs ${days.includes(day.id) ? 'border-brand-gold bg-brand-gold text-black' : 'border-white/10 text-brand-muted'}`}>{day.label}</button>)}</div></fieldset> : null}
        <p className="text-xs leading-relaxed text-brand-muted">Wcześniejsze wystąpienia pozostaną bez zmian. To i kolejne wystąpienia zostaną przebudowane według nowej częstotliwości.</p>
        {error ? <p role="alert" className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-sm text-red-300">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" disabled={saving} onClick={onClose} className="min-h-11 rounded-xl border border-white/10 px-4 text-sm text-brand-muted hover:bg-white/5 disabled:opacity-50">Anuluj</button><button disabled={saving} className="min-h-11 rounded-xl bg-brand-gold px-5 text-sm font-semibold text-black disabled:cursor-wait disabled:opacity-60">{saving ? 'Zapisywanie…' : 'Zapisz od tego wystąpienia'}</button></div>
      </form>
    </section>
  </div>
}
