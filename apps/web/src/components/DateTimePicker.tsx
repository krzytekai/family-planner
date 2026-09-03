import { useState } from 'react'
import { formatDateTimeLocal, parseDateTimeLocal } from '../lib/date-time-local'
import { CalendarDatePicker } from './CalendarDatePicker'
import { LocalTimePicker } from './LocalTimePicker'

interface Props { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; required?: boolean }

export function DateTimePicker({ label, value, onChange, disabled, required = false }: Props) {
  // Keep a time draft even before a date is chosen. Date/time edits never reset the other half.
  const [draftTime, setDraftTime] = useState(() => value.slice(11, 16) || formatDateTimeLocal(new Date()).slice(11, 16))
  const date = value.slice(0, 10)
  const time = value ? value.slice(11, 16) : draftTime
  return <fieldset className="min-w-0 space-y-2">
    <CalendarDatePicker label={label} value={date} disabled={disabled} required={required} onChange={nextDate => onChange(nextDate ? `${nextDate}T${time}` : '')} />
    <LocalTimePicker label="Godzina" value={time} disabled={disabled} required={Boolean(date)} onChange={nextTime => { setDraftTime(nextTime); if (date) onChange(`${date}T${nextTime}`) }} />
    <p aria-live="polite" className="text-xs text-brand-muted">{value && !Number.isNaN(parseDateTimeLocal(value).getTime()) ? new Intl.DateTimeFormat('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(parseDateTimeLocal(value)) : 'Brak terminu'}</p>
    {!required && value ? <button type="button" disabled={disabled} onClick={() => { setDraftTime(time); onChange('') }} className="min-h-11 text-xs text-brand-muted">Usuń termin</button> : null}
  </fieldset>
}
