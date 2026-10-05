import { useEffect, useState } from 'react'
import { formatTimeInput, isValidTimeInput } from './local-time-utils'

interface Props { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; required?: boolean }

/** Keyboard-friendly local wall-clock input shared by tasks and events; no UTC conversion. */
export function LocalTimePicker({ label, value, onChange, disabled, required }: Props) {
  const [draft, setDraft] = useState(() => formatTimeInput(value))
  useEffect(() => setDraft(formatTimeInput(value)), [value])
  const invalid = draft.length === 5 && !isValidTimeInput(draft)

  return <label className="block min-w-0 text-xs text-brand-muted">{label}{required ? ' *' : ''}
    <input type="text" inputMode="numeric" autoComplete="off" maxLength={5} placeholder="HH:mm" pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]" required={required} disabled={disabled} value={draft} aria-invalid={invalid || undefined}
      onFocus={event => event.currentTarget.select()}
      onChange={event => { const next = formatTimeInput(event.target.value); setDraft(next); if (!next || isValidTimeInput(next)) onChange(next) }}
      className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-brand-text outline-none focus:border-brand-gold/40 disabled:opacity-50" />
    {invalid ? <span role="alert" className="mt-1 block text-[11px] text-red-300">Podaj godzinę od 00:00 do 23:59.</span> : null}
  </label>
}
