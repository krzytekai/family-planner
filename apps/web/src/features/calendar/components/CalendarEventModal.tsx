import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarPlus, X } from 'lucide-react'
import { CalendarDatePicker } from '../../../components/CalendarDatePicker'
import { LocalTimePicker } from '../../../components/LocalTimePicker'
import { parseDateTimeLocal } from '../../../lib/date-time-local'
import { normalizeRecurrenceIntervalInput, parseRecurrenceInterval, recurrenceIntervalError, serializeRecurrence, validateRecurrenceRule } from '../../tasks/task-utils'
import type { RecurrenceType } from '../../tasks/types'
import { formatDateTimeLocal, toDateKey } from '../calendar-utils'
import type { CalendarEvent, CalendarEventInput, CalendarEventType } from '../types'

const eventTypes: Array<{ value: CalendarEventType; label: string }> = [
  { value: 'family', label: 'Rodzinne' }, { value: 'appointment', label: 'Wizyta' },
  { value: 'school', label: 'Szkoła' }, { value: 'work', label: 'Praca' },
  { value: 'birthday', label: 'Urodziny' }, { value: 'other', label: 'Inne' },
]
const weekdays = [{id:1,label:'Pn'},{id:2,label:'Wt'},{id:3,label:'Śr'},{id:4,label:'Cz'},{id:5,label:'Pt'},{id:6,label:'So'},{id:7,label:'Nd'}]

interface Props {
  familyId: string
  event?: CalendarEvent | null
  initialDate: Date
  saving: boolean
  onSave: (input: CalendarEventInput, eventId?: string) => Promise<void>
  onClose: () => void
}

export function CalendarEventModal({ familyId, event, initialDate, saving, onSave, onClose }: Props) {
  const initial = useMemo(() => {
    const date = toDateKey(initialDate)
    const timedStart = new Date(initialDate.getFullYear(), initialDate.getMonth(), initialDate.getDate(), 9)
    const startValue = formatDateTimeLocal(event?.startsAt ?? timedStart.toISOString())
    const endValue = formatDateTimeLocal(event?.endsAt ?? null)
    return {
      title: event?.title ?? '', description: event?.description ?? '', eventType: event?.eventType ?? 'family' as CalendarEventType,
      location: event?.location ?? '', allDay: event?.allDay ?? false,
      timedStartDate: startValue.slice(0, 10), timedStartTime: startValue.slice(11, 16),
      timedEndDate: endValue.slice(0, 10), timedEndTime: endValue.slice(11, 16),
      startDate: event?.startDate ?? date, endDate: event?.endDate ?? '',
      recurrenceType: event?.recurrence?.rule.type ?? 'none' as RecurrenceType | 'none',
      recurrenceInterval: String(event?.recurrence?.rule.interval ?? 1),
      recurrenceDays: event?.recurrence?.rule.weekdays ?? [timedStart.getDay() || 7],
    }
  }, [event, initialDate])
  const [form, setForm] = useState(initial)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const close = (keyboardEvent: KeyboardEvent) => { if (keyboardEvent.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose, saving])

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault()
    setError(null)
    if (!form.title.trim()) return setError('Podaj tytuł wydarzenia.')
    if (form.allDay && !form.startDate) return setError('Podaj datę rozpoczęcia.')
    if (!form.allDay && (!form.timedStartDate || !form.timedStartTime)) return setError('Podaj datę i godzinę rozpoczęcia.')
    if (form.allDay && form.endDate && form.endDate < form.startDate) return setError('Data zakończenia nie może być wcześniejsza niż rozpoczęcie.')
    if (!form.allDay && Boolean(form.timedEndDate) !== Boolean(form.timedEndTime)) return setError('Podaj zarówno datę, jak i godzinę zakończenia albo pozostaw oba pola puste.')

    const startsAt = form.allDay ? null : parseDateTimeLocal(`${form.timedStartDate}T${form.timedStartTime}`).toISOString()
    const endsAt = !form.allDay && form.timedEndDate && form.timedEndTime ? parseDateTimeLocal(`${form.timedEndDate}T${form.timedEndTime}`).toISOString() : null
    if (startsAt && endsAt && endsAt < startsAt) return setError('Koniec wydarzenia nie może być wcześniejszy niż początek.')
    const anchor = form.allDay ? `${form.startDate}T12:00` : `${form.timedStartDate}T${form.timedStartTime}`
    const recurrenceInterval = parseRecurrenceInterval(form.recurrenceInterval)
    if (form.recurrenceType !== 'none' && recurrenceInterval === null) return setError(recurrenceIntervalError)
    const recurrenceRule = serializeRecurrence(form.recurrenceType, recurrenceInterval ?? 1, form.recurrenceDays, anchor)
    if (recurrenceRule && !validateRecurrenceRule(recurrenceRule)) return setError('Uzupełnij poprawnie regułę powtarzania.')
    try {
      await onSave({
        familyId, title: form.title, description: form.description, eventType: form.eventType, location: form.location,
        allDay: form.allDay, startsAt, endsAt, startDate: form.allDay ? form.startDate : null,
        endDate: form.allDay ? form.endDate || null : null,
        recurrence: recurrenceRule ? { rule: recurrenceRule, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } : null,
      }, event?.id)
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać wydarzenia.') }
  }

  const fieldClass = 'mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-gold/40 disabled:opacity-50'
  return <div className="fixed inset-0 z-[80] grid place-items-end bg-black/75 backdrop-blur-sm sm:place-items-center sm:p-6" role="presentation">
    <section role="dialog" aria-modal="true" aria-labelledby="calendar-event-title" className="surface max-h-[92vh] w-full overflow-y-auto rounded-t-3xl p-5 sm:max-w-2xl sm:rounded-3xl sm:p-6">
      <header className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-gold/10 text-brand-gold"><CalendarPlus className="h-5 w-5"/></div><div><h2 id="calendar-event-title" className="font-semibold">{event ? 'Edytuj wydarzenie' : 'Dodaj wydarzenie'}</h2><p className="text-xs text-brand-muted">Rodzinny kalendarz</p></div></div><button type="button" disabled={saving} onClick={onClose} aria-label="Zamknij" className="rounded-xl p-2 text-brand-muted hover:bg-white/5 disabled:opacity-40"><X className="h-5 w-5"/></button></header>
      <form onSubmit={(value) => void submit(value)} className="mt-5 space-y-4">
        <label className="block text-sm text-brand-muted">Tytuł *<input autoFocus maxLength={200} disabled={saving} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={fieldClass}/></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm text-brand-muted">Typ<select disabled={saving} value={form.eventType} onChange={(e) => setForm({ ...form, eventType: e.target.value as CalendarEventType })} className={fieldClass}>{eventTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label className="flex items-center gap-3 self-end rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-muted"><input type="checkbox" checked={form.allDay} disabled={saving} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} className="h-4 w-4 accent-[#ffd84d]"/>Cały dzień</label></div>
        {form.allDay ? <div className="grid gap-4 sm:grid-cols-2"><CalendarDatePicker label="Data rozpoczęcia" required disabled={saving} value={form.startDate} onChange={value => setForm({ ...form, startDate: value })}/><CalendarDatePicker label="Data zakończenia" disabled={saving} value={form.endDate} onChange={value => setForm({ ...form, endDate: value })}/></div> : <div className="grid gap-4 sm:grid-cols-2"><CalendarDatePicker label="Data rozpoczęcia" required disabled={saving} value={form.timedStartDate} onChange={value => setForm({ ...form, timedStartDate: value })}/><LocalTimePicker label="Godzina rozpoczęcia" required disabled={saving} value={form.timedStartTime} onChange={value => setForm({ ...form, timedStartTime: value })}/><CalendarDatePicker label="Data zakończenia" disabled={saving} value={form.timedEndDate} onChange={value => setForm({ ...form, timedEndDate: value })}/><LocalTimePicker label="Godzina zakończenia" disabled={saving} value={form.timedEndTime} onChange={value => setForm({ ...form, timedEndTime: value })}/></div>}
        <fieldset className="rounded-2xl border border-white/[.07] p-3"><legend className="px-1 text-xs font-medium text-brand-gold">Powtarzanie</legend><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-brand-muted">Reguła<select value={form.recurrenceType} disabled={saving || Boolean(event)} onChange={(e)=>setForm({...form,recurrenceType:e.target.value as RecurrenceType|'none'})} className={fieldClass}><option value="none">Nie powtarzaj</option><option value="daily">Codziennie / co X dni</option><option value="weekly">Co tydzień / wybrane dni</option><option value="monthly">Co miesiąc</option><option value="yearly">Co rok</option></select></label>{form.recurrenceType!=='none'?<label className="text-xs text-brand-muted">Co ile okresów<input type="text" inputMode="numeric" pattern="[0-9]*" disabled={saving||Boolean(event)} value={form.recurrenceInterval} onChange={(e)=>setForm({...form,recurrenceInterval:normalizeRecurrenceIntervalInput(e.target.value)})} className={fieldClass}/></label>:null}</div>{form.recurrenceType==='weekly'?<div className="mt-3 flex flex-wrap gap-2">{weekdays.map(day=><button key={day.id} type="button" disabled={saving||Boolean(event)} aria-pressed={form.recurrenceDays.includes(day.id)} onClick={()=>setForm({...form,recurrenceDays:form.recurrenceDays.includes(day.id)?form.recurrenceDays.filter(id=>id!==day.id):[...form.recurrenceDays,day.id]})} className={`h-9 min-w-9 rounded-lg border text-xs ${form.recurrenceDays.includes(day.id)?'border-brand-gold bg-brand-gold text-black':'border-white/10 text-brand-muted'}`}>{day.label}</button>)}</div>:null}{event?<p className="mt-2 text-[11px] text-brand-muted">Edycja dotyczy tylko tego wystąpienia. Serię można zakończyć na karcie wydarzenia.</p>:null}</fieldset>
        <label className="block text-sm text-brand-muted">Lokalizacja<input disabled={saving} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className={fieldClass}/></label>
        <label className="block text-sm text-brand-muted">Opis<textarea rows={3} disabled={saving} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={fieldClass}/></label>
        {error ? <p role="alert" className="rounded-xl border border-red-400/15 bg-red-400/5 p-3 text-sm text-red-300">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end"><button type="button" disabled={saving} onClick={onClose} className="rounded-xl border border-white/10 px-4 py-2.5 text-sm text-brand-muted hover:bg-white/5 disabled:opacity-50">Anuluj</button><button disabled={saving} className="rounded-xl bg-brand-gold px-5 py-2.5 text-sm font-semibold text-black hover:brightness-105 disabled:cursor-wait disabled:opacity-60">{saving ? 'Zapisywanie…' : 'Zapisz wydarzenie'}</button></div>
      </form>
    </section>
  </div>
}
