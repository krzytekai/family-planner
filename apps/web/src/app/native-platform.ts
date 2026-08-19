import { useEffect, useRef } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'

export const NATIVE_BACK_EVENT = 'family-planner:native-back'

export function useNativeBackButton(onBack: () => void) {
  const callback = useRef(onBack)
  callback.current = onBack

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let disposed = false
    let listener: PluginListenerHandle | undefined
    void CapacitorApp.addListener('backButton', () => callback.current()).then((handle) => {
      if (disposed) void handle.remove()
      else listener = handle
    })

    return () => {
      disposed = true
      if (listener) void listener.remove()
    }
  }, [])
}

export function useNativeBackDismiss(open: boolean, dismiss: () => void) {
  const dismissRef = useRef(dismiss)
  dismissRef.current = dismiss

  useEffect(() => {
    if (!open) return
    const handleBack = (event: Event) => {
      event.preventDefault()
      dismissRef.current()
    }
    window.addEventListener(NATIVE_BACK_EVENT, handleBack)
    return () => window.removeEventListener(NATIVE_BACK_EVENT, handleBack)
  }, [open])
}
