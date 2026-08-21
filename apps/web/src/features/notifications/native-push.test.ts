import { describe, expect, it, vi } from 'vitest'
import { encodeInstallationSecret, NativePushController, parseNativePushAction, pushRoute, type NativePushDependencies, type NativePushState } from './native-push'

class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function harness(permission: 'prompt' | 'granted' | 'denied' = 'granted', native = true) {
  const handlers = new Map<string, (value: never) => void>()
  const storage = new MemoryStorage()
  const addListener = vi.fn(async (name: string, handler: (value: never) => void) => {
    handlers.set(name, handler)
    return { remove: vi.fn(async () => undefined) }
  })
  const registerDevice = vi.fn(async () => undefined)
  const disableDevice = vi.fn(async () => undefined)
  const register = vi.fn(async () => undefined)
  const requestPermissions = vi.fn(async () => ({ receive: permission === 'prompt' ? 'granted' as const : permission }))
  const deps: NativePushDependencies = {
    isNativeAndroid: () => native,
    plugin: {
      addListener: addListener as NativePushDependencies['plugin']['addListener'],
      checkPermissions: vi.fn(async () => ({ receive: permission })),
      requestPermissions,
      register,
      createChannel: vi.fn(async () => undefined),
    },
    storage,
    createUuid: () => '11111111-1111-4111-8111-111111111111',
    createInstallationSecret: () => 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    getAppVersion: async () => '0.2.0',
    registerDevice,
    disableDevice,
  }
  return { controller: new NativePushController(deps), handlers, storage, addListener, registerDevice, disableDevice, register, requestPermissions }
}

async function settle() { await new Promise((resolve) => setTimeout(resolve, 0)) }

describe('native push controller', () => {
  it('encodes at least 256 random bits as base64url without padding', () => {
    const secret = encodeInstallationSecret(Uint8Array.from({ length: 32 }, (_, index) => index))
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(() => encodeInstallationSecret(new Uint8Array(31))).toThrow('at least 256 bits')
  })

  it('does not initialize the native plugin on web', async () => {
    const test = harness('granted', false)
    await test.controller.start()
    expect(test.addListener).not.toHaveBeenCalled()
  })

  it('reports denied permission without registration or repeated preprompt', async () => {
    const test = harness('denied')
    let state: NativePushState | null = null
    test.controller.subscribe((next) => { state = next })
    await test.controller.start()
    test.controller.bindSession({ familyId: 'f1', pushEnabled: true, onForeground: vi.fn(), onAction: vi.fn() })
    expect(state!.permission).toBe('denied')
    expect(state!.showPreprompt).toBe(false)
    expect(test.register).not.toHaveBeenCalled()
  })

  it('registers when permission is granted and push is enabled', async () => {
    const test = harness()
    await test.controller.start()
    test.controller.bindSession({ familyId: 'f1', pushEnabled: true, onForeground: vi.fn(), onAction: vi.fn() })
    await settle()
    expect(test.register).toHaveBeenCalledOnce()
  })

  it('requests system permission only after accepting the authenticated preprompt', async () => {
    const test = harness('prompt')
    let state: NativePushState | null = null
    test.controller.subscribe((next) => { state = next })
    await test.controller.start()
    test.controller.bindSession({ familyId: 'f1', pushEnabled: true, onForeground: vi.fn(), onAction: vi.fn() })
    expect(state!.showPreprompt).toBe(true)
    expect(test.requestPermissions).not.toHaveBeenCalled()
    await test.controller.acceptPreprompt()
    expect(test.requestPermissions).toHaveBeenCalledOnce()
    expect(test.register).toHaveBeenCalledOnce()
  })

  it('stores the Android registration token through the guarded repository callback', async () => {
    const test = harness()
    await test.controller.start()
    test.controller.bindSession({ familyId: 'f1', pushEnabled: true, onForeground: vi.fn(), onAction: vi.fn() })
    test.handlers.get('registration')?.({ value: 'valid-fcm-registration-token' } as never)
    await settle()
    expect(test.registerDevice).toHaveBeenCalledWith(expect.objectContaining({ installationId: '11111111-1111-4111-8111-111111111111', installationSecret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', pushToken: 'valid-fcm-registration-token', appVersion: '0.2.0', deviceLabel: 'Android' }))
  })

  it('surfaces registrationError without exposing a token', async () => {
    const test = harness()
    let state: NativePushState | null = null
    test.controller.subscribe((next) => { state = next })
    await test.controller.start()
    test.handlers.get('registrationError')?.({ error: 'FCM unavailable' } as never)
    expect(state!.error).toBe('FCM unavailable')
  })

  it('refreshes canonical notifications for a foreground push', async () => {
    const test = harness()
    const onForeground = vi.fn()
    await test.controller.start()
    test.controller.bindSession({ familyId: 'f1', pushEnabled: false, onForeground, onAction: vi.fn() })
    test.handlers.get('pushNotificationReceived')?.({ data: {} } as never)
    expect(onForeground).toHaveBeenCalledOnce()
  })

  it('routes task and calendar actions', () => {
    expect(pushRoute({ source_type: 'task' })).toBe('tasks')
    expect(pushRoute({ notification_type: 'calendar_reminder' })).toBe('calendar')
    expect(parseNativePushAction({ notification_id: 'n1', family_id: 'f1', source_type: 'task', notification_type: 'task_reminder' })?.route).toBe('tasks')
  })

  it('routes property charge reminders to properties', () => {
    expect(pushRoute({ source_type: 'property_charge' })).toBe('properties')
    expect(pushRoute({ notification_type: 'property_charge_reminder' })).toBe('properties')
  })

  it('persists a cold-start action until an authenticated session binds', async () => {
    const test = harness()
    const onAction = vi.fn()
    await test.controller.start()
    test.handlers.get('pushNotificationActionPerformed')?.({ notification: { data: { notification_id: 'n1', family_id: 'f1', source_type: 'calendar_event', notification_type: 'calendar_reminder' } } } as never)
    test.controller.bindSession({ familyId: 'f1', pushEnabled: false, onForeground: vi.fn(), onAction })
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ notificationId: 'n1', route: 'calendar' }))
  })

  it('disables only the current installation before logout', async () => {
    const test = harness()
    await test.controller.start()
    test.controller.bindSession({ familyId: 'f1', pushEnabled: true, onForeground: vi.fn(), onAction: vi.fn() })
    test.handlers.get('registration')?.({ value: 'valid-fcm-registration-token' } as never)
    await settle()
    await test.controller.disableForLogout()
    expect(test.disableDevice).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111')
    expect(test.storage.values.has('family-planner.push.installation-secret')).toBe(true)
  })

  it('keeps the same installation proof across logout and the next account login', async () => {
    const test = harness()
    await test.controller.start()
    test.controller.bindSession({ familyId: 'f1', pushEnabled: true, onForeground: vi.fn(), onAction: vi.fn() })
    test.handlers.get('registration')?.({ value: 'first-valid-fcm-token' } as never)
    await settle()
    await test.controller.disableForLogout()
    test.controller.bindSession({ familyId: 'f2', pushEnabled: true, onForeground: vi.fn(), onAction: vi.fn() })
    test.handlers.get('registration')?.({ value: 'rotated-valid-fcm-token' } as never)
    await settle()
    expect(test.registerDevice).toHaveBeenNthCalledWith(2, expect.objectContaining({
      installationId: '11111111-1111-4111-8111-111111111111',
      installationSecret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      pushToken: 'rotated-valid-fcm-token',
    }))
  })

  it('does not register while push_enabled is false', async () => {
    const test = harness()
    await test.controller.start()
    test.controller.bindSession({ familyId: 'f1', pushEnabled: false, onForeground: vi.fn(), onAction: vi.fn() })
    expect(test.register).not.toHaveBeenCalled()
  })

  it('prevents duplicate listener registration', async () => {
    const test = harness()
    await Promise.all([test.controller.start(), test.controller.start()])
    expect(test.addListener).toHaveBeenCalledTimes(4)
  })
})
