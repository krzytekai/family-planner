import type { SystemPushPermission } from '../native-push'
import type { NotificationPreferences as Preferences } from '../types'

const options: Array<{ key: keyof Preferences; label: string; hint: string }> = [
  { key: 'inAppEnabled', label: 'Powiadomienia w aplikacji', hint: 'Główny kanał centrum powiadomień.' },
  { key: 'taskAssignedEnabled', label: 'Przypisanie zadania', hint: 'Gdy ktoś przypisze Ci zadanie.' },
  { key: 'taskRemindersEnabled', label: 'Przypomnienia o zadaniach', hint: 'Osobiste przypomnienia ustawione przy zadaniach.' },
  { key: 'calendarRemindersEnabled', label: 'Przypomnienia kalendarza', hint: 'Osobiste przypomnienia ustawione przy wydarzeniach.' },
  { key: 'pushEnabled', label: 'Android Push', hint: 'Systemowe powiadomienia dla tej rodziny, także gdy aplikacja jest zamknięta.' },
]

function permissionLabel(permission: SystemPushPermission) {
  if (permission === 'granted') return 'Włączone'
  if (permission === 'denied') return 'Brak zgody'
  if (permission === 'prompt') return 'Wyłączone'
  return 'Niedostępne w przeglądarce'
}

export function NotificationPreferences({ value, saving, systemPermission, onChange }: { value: Preferences; saving: boolean; systemPermission: SystemPushPermission; onChange: (next: Preferences) => void }) {
  return <section><h3 className="text-sm font-semibold">Preferencje</h3><div className="mt-3 rounded-xl border border-brand-gold/10 bg-brand-gold/[.025] p-3"><span className="text-xs text-brand-muted">Powiadomienia systemowe</span><strong className="ml-2 text-xs font-semibold text-brand-gold">{permissionLabel(systemPermission)}</strong></div><div className="mt-3 space-y-2">{options.map((option) => <label key={option.key} className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-white/5 bg-white/[.02] p-3"><span><span className="block text-sm">{option.label}</span><span className="mt-0.5 block text-[11px] leading-relaxed text-brand-muted">{option.hint}</span></span><input type="checkbox" disabled={saving} checked={value[option.key]} onChange={(event) => onChange({ ...value, [option.key]: event.target.checked })} className="mt-1 accent-[#d4af37]"/></label>)}</div></section>
}
