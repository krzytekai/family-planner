import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createNotificationRepository } from './api/notification-repository'
import { generateInstallationSecret, NativePushController, type NativePushState } from './native-push'
import { NativePushContext, type NativePushContextValue } from './native-push-context'

const repository = createNotificationRepository()
const controller = new NativePushController({
  isNativeAndroid: () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android',
  plugin: PushNotifications,
  storage: window.localStorage,
  createUuid: () => crypto.randomUUID(),
  createInstallationSecret: generateInstallationSecret,
  getAppVersion: async () => { try { return (await CapacitorApp.getInfo()).version } catch { return null } },
  registerDevice: (input) => repository.registerDevice(input),
  disableDevice: (installationId) => repository.disableDevice(installationId),
})

const initialState: NativePushState = { permission: 'unavailable', showPreprompt: false, registering: false, error: null }

export function NativePushProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialState)
  useEffect(() => {
    const unsubscribe = controller.subscribe(setState)
    void controller.start()
    return () => { unsubscribe(); void controller.stop() }
  }, [])
  const value = useMemo<NativePushContextValue>(() => ({
    ...state,
    bindSession: (binding) => controller.bindSession(binding),
    unbindSession: () => controller.unbindSession(),
    dismissPreprompt: () => controller.dismissPreprompt(),
    acceptPreprompt: () => controller.acceptPreprompt(),
    ensureRegistered: () => controller.ensureRegistered(),
    disableForLogout: () => controller.disableForLogout(),
    completePendingAction: (notificationId) => controller.completePendingAction(notificationId),
  }), [state])
  return <NativePushContext.Provider value={value}>{children}</NativePushContext.Provider>
}
