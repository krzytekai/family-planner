import { createContext, useContext } from 'react'
import type { NativePushAction, NativePushState } from './native-push'

export interface NativePushContextValue extends NativePushState {
  bindSession: (binding: { familyId: string; pushEnabled: boolean; onForeground: () => void; onAction: (action: NativePushAction) => void }) => void
  unbindSession: () => void
  dismissPreprompt: () => void
  acceptPreprompt: () => Promise<void>
  ensureRegistered: () => Promise<void>
  disableForLogout: () => Promise<void>
  completePendingAction: (notificationId: string) => void
}

export const NativePushContext = createContext<NativePushContextValue | null>(null)

export function useNativePush() {
  const value = useContext(NativePushContext)
  if (!value) throw new Error('useNativePush must be used inside NativePushProvider')
  return value
}
