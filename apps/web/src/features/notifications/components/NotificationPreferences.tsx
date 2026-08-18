import type { NotificationPreferences as Preferences } from '../types'

const options: Array<{ key: keyof Preferences; label: string; hint: string; disabled?: boolean }> = [
  { key: 'inAppEnabled', label: 'Powiadomienia w aplikacji', hint: 'Główny kanał centrum powiadomień.' },
  { key: 'taskAssignedEnabled', label: 'Przypisanie zadania', hint: 'Gdy ktoś przypisze Ci zadanie.' },
  { key: 'taskRemindersEnabled', label: 'Przypomnienia o zadaniach', hint: 'Osobiste przypomnienia ustawione przy zadaniach.' },
  { key: 'calendarRemindersEnabled', label: 'Przypomnienia kalendarza', hint: 'Osobiste przypomnienia ustawione przy wydarzeniach.' },
  { key: 'pushEnabled', label: 'Android Push — w przygotowaniu', hint: 'Preferencja jest gotowa w modelu, ale Sprint 5 nie wysyła jeszcze systemowych powiadomień FCM.', disabled: true },
]

export function NotificationPreferences({ value, saving, onChange }: { value: Preferences; saving: boolean; onChange: (next: Preferences) => void }) {
  return <section><h3 className="text-sm font-semibold">Preferencje</h3><div className="mt-3 space-y-2">{options.map((option) => <label key={option.key} className={`flex items-start justify-between gap-3 rounded-xl border border-white/5 bg-white/[.02] p-3 ${option.disabled ? 'cursor-not-allowed opacity-65' : 'cursor-pointer'}`}><span><span className="block text-sm">{option.label}</span><span className="mt-0.5 block text-[11px] leading-relaxed text-brand-muted">{option.hint}</span></span><input type="checkbox" disabled={saving || option.disabled} checked={value[option.key]} onChange={(event) => onChange({ ...value, [option.key]: event.target.checked })} className="mt-1 accent-[#d4af37]"/></label>)}</div></section>
}
