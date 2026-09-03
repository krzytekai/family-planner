import { useId, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { formatMonthYear, getMonthGrid, parseDateKey, toDateKey } from '../features/calendar/calendar-utils'

interface Props {
  label: string
  value: string
  onChange: (date: string) => void
  disabled?: boolean
  required?: boolean
}

/** Date-only picker. Reuses the calendar module's Monday-first month grid. */
export function CalendarDatePicker({ label, value, onChange, disabled = false, required = false }: Props) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => value ? parseDateKey(value) : new Date())
  const today = toDateKey(new Date())
  const control = 'grid min-h-11 min-w-0 place-items-center rounded-lg border border-transparent text-sm focus-visible:outline-2 focus-visible:outline-brand-gold disabled:opacity-50'
  return <div className="min-w-0">
    <span id={`${id}-label`} className="block text-xs text-brand-muted">{label}{required ? ' *' : ''}</span>
    <button type="button" style={{ minHeight: 44 }} disabled={disabled} aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-controls={`${id}-calendar`}
      onClick={() => { if (!open) setMonth(value ? parseDateKey(value) : new Date()); setOpen(!open) }}
      className="mt-1.5 flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/25 px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-brand-gold disabled:opacity-50">
      <span id={`${id}-value`} className="min-w-0">{value ? new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(parseDateKey(value)) : 'Wybierz datę'}</span><CalendarDays className="h-4 w-4 shrink-0 text-brand-gold" />
    </button>
    {open ? <section id={`${id}-calendar`} aria-label={`Kalendarz: ${label}`} className="mt-2 min-w-0 rounded-xl border border-white/10 bg-[#101017] p-1"
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }}>
      <div className="flex items-center justify-between gap-1">
        <button type="button" style={{ minHeight: 44 }} disabled={disabled} aria-label="Poprzedni miesiąc" className={`${control} w-11`} onClick={() => setMonth(current => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></button>
        <p aria-live="polite" className="text-sm font-medium capitalize">{formatMonthYear(month)}</p>
        <button type="button" style={{ minHeight: 44 }} disabled={disabled} aria-label="Następny miesiąc" className={`${control} w-11`} onClick={() => setMonth(current => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-7 text-center">
        {['Pn', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob', 'Nd'].map(day => <span key={day} className="py-2 text-[11px] text-brand-muted">{day}</span>)}
        {getMonthGrid(month).map(day => {
          const key = toDateKey(day)
          return <button key={key} type="button" style={{ minHeight: 44 }} disabled={disabled} aria-label={new Intl.DateTimeFormat('pl-PL', { dateStyle: 'full' }).format(day)} aria-pressed={value === key} aria-current={today === key ? 'date' : undefined}
            className={`${control} ${value === key ? 'bg-[#ffd84d] text-black' : day.getMonth() === month.getMonth() ? 'text-brand-text hover:bg-white/10' : 'text-brand-muted hover:bg-white/5'}`}
            onClick={() => { onChange(key); setOpen(false) }}>{day.getDate()}</button>
        })}
      </div>
      {!required && value ? <button type="button" disabled={disabled} onClick={() => { onChange(''); setOpen(false) }} className="min-h-11 px-3 text-xs text-brand-muted">Wyczyść datę</button> : null}
    </section> : null}
  </div>
}
