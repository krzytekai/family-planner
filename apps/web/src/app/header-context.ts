import type { AppView } from './navigation'

export type HeaderContext = AppView | 'notifications' | 'admin'

const headerSubtitles: Record<Exclude<HeaderContext, 'dashboard'>, string> = {
  calendar: 'Kalendarz rodzinny',
  tasks: 'Zadania',
  shopping: 'Zakupy',
  budget: 'Budżet',
  properties: 'Nieruchomości i opłaty',
  notifications: 'Powiadomienia',
  admin: 'Administracja',
}

export function getHeaderSubtitle(context: HeaderContext, displayName: string) {
  return context === 'dashboard' ? `Dzień dobry, ${displayName}` : headerSubtitles[context]
}
