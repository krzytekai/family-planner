interface Props { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; required?: boolean }

/** Native hour/minute control, shared by tasks and events; no UTC conversion. */
export function LocalTimePicker({ label, value, onChange, disabled, required }: Props) {
  return <label className="block min-w-0 text-xs text-brand-muted">{label}{required ? ' *' : ''}
    <input type="time" step="60" required={required} disabled={disabled} value={value} onChange={event => onChange(event.target.value)}
      className="mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-brand-text outline-none focus:border-brand-gold/40 disabled:opacity-50" />
  </label>
}
