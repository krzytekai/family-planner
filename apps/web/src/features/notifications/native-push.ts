import type { PluginListenerHandle } from '@capacitor/core'
import type { ActionPerformed, PermissionStatus, PushNotificationsPlugin, RegistrationError, Token } from '@capacitor/push-notifications'
import type { AppView } from '../../app/navigation'

const INSTALLATION_ID_KEY = 'family-planner.push.installation-id'
const INSTALLATION_SECRET_KEY = 'family-planner.push.installation-secret'
const PREPROMPT_SEEN_KEY = 'family-planner.push.preprompt-seen'
const PENDING_ACTION_KEY = 'family-planner.push.pending-action'

export type SystemPushPermission = 'unavailable' | 'prompt' | 'granted' | 'denied'

export interface NativePushAction {
  notificationId: string
  familyId: string
  notificationType: string
  sourceType: string
  sourceId: string | null
  route: AppView
}

export interface NativePushState {
  permission: SystemPushPermission
  showPreprompt: boolean
  registering: boolean
  error: string | null
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

interface SessionBinding {
  familyId: string
  pushEnabled: boolean
  onForeground: () => void
  onAction: (action: NativePushAction) => void
}

export interface NativePushDependencies {
  isNativeAndroid: () => boolean
  plugin: Pick<PushNotificationsPlugin, 'addListener' | 'checkPermissions' | 'requestPermissions' | 'register' | 'createChannel'>
  storage: StorageLike
  createUuid: () => string
  createInstallationSecret: () => string
  getAppVersion: () => Promise<string | null>
  registerDevice: (input: { installationId: string; installationSecret: string; pushToken: string; appVersion: string | null; deviceLabel: string }) => Promise<void>
  disableDevice: (installationId: string) => Promise<void>
}

export function encodeInstallationSecret(bytes: Uint8Array) {
  if (bytes.byteLength < 32) throw new Error('Installation secret requires at least 256 bits')
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function generateInstallationSecret() {
  return encodeInstallationSecret(crypto.getRandomValues(new Uint8Array(32)))
}

function permissionState(status: PermissionStatus): SystemPushPermission {
  if (status.receive === 'granted') return 'granted'
  if (status.receive === 'denied') return 'denied'
  return 'prompt'
}

export function pushRoute(data: Record<string, unknown>): AppView {
  const route = typeof data.route === 'string' ? data.route : null
  if (route === 'tasks' || route === 'calendar' || route === 'properties' || route === 'dashboard') return route
  const sourceType = typeof data.source_type === 'string' ? data.source_type : ''
  const notificationType = typeof data.notification_type === 'string' ? data.notification_type : ''
  if (sourceType === 'task' || notificationType === 'task_assigned' || notificationType === 'task_reminder') return 'tasks'
  if (sourceType === 'calendar_event' || notificationType === 'calendar_reminder') return 'calendar'
  if (sourceType === 'property_charge' || notificationType === 'property_charge_reminder') return 'properties'
  return 'dashboard'
}

export function parseNativePushAction(data: unknown): NativePushAction | null {
  if (!data || typeof data !== 'object') return null
  const values = data as Record<string, unknown>
  if (typeof values.notification_id !== 'string' || typeof values.family_id !== 'string') return null
  return {
    notificationId: values.notification_id,
    familyId: values.family_id,
    notificationType: typeof values.notification_type === 'string' ? values.notification_type : 'system',
    sourceType: typeof values.source_type === 'string' ? values.source_type : 'system',
    sourceId: typeof values.source_id === 'string' && values.source_id ? values.source_id : null,
    route: pushRoute(values),
  }
}

export class NativePushController {
  private state: NativePushState = { permission: 'unavailable', showPreprompt: false, registering: false, error: null }
  private started = false
  private starting: Promise<void> | null = null
  private handles: PluginListenerHandle[] = []
  private listeners = new Set<(state: NativePushState) => void>()
  private binding: SessionBinding | null = null
  private lastToken: string | null = null
  private registrationAttempted = false

  constructor(private readonly deps: NativePushDependencies) {}

  subscribe(listener: (state: NativePushState) => void) {
    this.listeners.add(listener)
    listener(this.state)
    return () => this.listeners.delete(listener)
  }

  private update(next: Partial<NativePushState>) {
    this.state = { ...this.state, ...next }
    this.listeners.forEach((listener) => listener(this.state))
  }

  private installationId() {
    const existing = this.deps.storage.getItem(INSTALLATION_ID_KEY)
    if (existing) return existing
    const created = this.deps.createUuid()
    this.deps.storage.setItem(INSTALLATION_ID_KEY, created)
    return created
  }

  private installationSecret() {
    const existing = this.deps.storage.getItem(INSTALLATION_SECRET_KEY)
    if (existing) return existing
    const created = this.deps.createInstallationSecret()
    this.deps.storage.setItem(INSTALLATION_SECRET_KEY, created)
    return created
  }

  async start() {
    if (this.started || !this.deps.isNativeAndroid()) return
    if (this.starting) return this.starting
    this.starting = this.startInternal()
    try { await this.starting } finally { this.starting = null }
  }

  private async startInternal() {
    if (this.started) return
    this.started = true
    try {
      this.handles = await Promise.all([
        this.deps.plugin.addListener('registration', (token: Token) => { void this.handleRegistration(token) }),
        this.deps.plugin.addListener('registrationError', (error: RegistrationError) => this.update({ registering: false, error: error.error || 'Rejestracja powiadomień nie powiodła się.' })),
        this.deps.plugin.addListener('pushNotificationReceived', () => this.binding?.onForeground()),
        this.deps.plugin.addListener('pushNotificationActionPerformed', (event: ActionPerformed) => this.handleAction(event.notification.data)),
      ])
      await Promise.all([
        this.deps.plugin.createChannel({ id: 'reminders', name: 'Przypomnienia', description: 'Przypomnienia o zadaniach i wydarzeniach', importance: 4, vibration: true }),
        this.deps.plugin.createChannel({ id: 'general', name: 'Pozostałe powiadomienia', description: 'Przypisania zadań i komunikaty systemowe', importance: 3 }),
      ])
      const status = await this.deps.plugin.checkPermissions()
      this.update({ permission: permissionState(status), error: null })
    } catch (cause) {
      const handles = this.handles
      this.handles = []
      await Promise.all(handles.map((handle) => handle.remove()))
      this.started = false
      this.update({ error: cause instanceof Error ? cause.message : 'Nie udało się uruchomić powiadomień systemowych.' })
    }
  }

  bindSession(binding: SessionBinding) {
    this.binding = binding
    const pending = this.readPendingAction()
    if (pending?.familyId === binding.familyId) binding.onAction(pending)
    if (!this.deps.isNativeAndroid()) return
    if (binding.pushEnabled && this.state.permission === 'prompt' && !this.deps.storage.getItem(PREPROMPT_SEEN_KEY)) {
      this.deps.storage.setItem(PREPROMPT_SEEN_KEY, 'true')
      this.update({ showPreprompt: true })
    }
    if (binding.pushEnabled && this.state.permission === 'granted') void this.ensureRegistered()
  }

  unbindSession() {
    this.binding = null
  }

  dismissPreprompt() {
    this.update({ showPreprompt: false })
  }

  async acceptPreprompt() {
    this.update({ showPreprompt: false, error: null })
    const status = await this.deps.plugin.requestPermissions()
    const permission = permissionState(status)
    this.update({ permission })
    if (permission === 'granted') await this.ensureRegistered()
  }

  async ensureRegistered() {
    if (!this.deps.isNativeAndroid() || !this.binding?.pushEnabled || this.state.permission !== 'granted' || this.state.registering || this.lastToken || this.registrationAttempted) return
    this.registrationAttempted = true
    this.update({ registering: true, error: null })
    try {
      await this.deps.plugin.register()
    } catch (cause) {
      this.update({ registering: false, error: cause instanceof Error ? cause.message : 'Rejestracja powiadomień nie powiodła się.' })
    }
  }

  private async handleRegistration(token: Token) {
    if (!this.binding?.pushEnabled) {
      this.registrationAttempted = false
      this.update({ registering: false })
      return
    }
    try {
      await this.deps.registerDevice({
        installationId: this.installationId(),
        installationSecret: this.installationSecret(),
        pushToken: token.value,
        appVersion: await this.deps.getAppVersion(),
        deviceLabel: 'Android',
      })
      this.lastToken = token.value
      this.update({ registering: false, error: null })
    } catch (cause) {
      this.update({ registering: false, error: cause instanceof Error ? cause.message : 'Nie udało się zapisać urządzenia.' })
    }
  }

  private handleAction(data: unknown) {
    const action = parseNativePushAction(data)
    if (!action) return
    this.deps.storage.setItem(PENDING_ACTION_KEY, JSON.stringify(action))
    if (this.binding?.familyId === action.familyId) this.binding.onAction(action)
  }

  readPendingAction() {
    const raw = this.deps.storage.getItem(PENDING_ACTION_KEY)
    if (!raw) return null
    try { return JSON.parse(raw) as NativePushAction } catch { this.deps.storage.removeItem(PENDING_ACTION_KEY); return null }
  }

  completePendingAction(notificationId: string) {
    const pending = this.readPendingAction()
    if (pending?.notificationId === notificationId) this.deps.storage.removeItem(PENDING_ACTION_KEY)
  }

  async disableForLogout() {
    if (!this.deps.isNativeAndroid()) return
    const installationId = this.deps.storage.getItem(INSTALLATION_ID_KEY)
    if (!installationId) return
    try { await this.deps.disableDevice(installationId) } catch { /* Offline logout must remain possible. */ }
    this.binding = null
    this.lastToken = null
    this.registrationAttempted = false
  }

  async stop() {
    const handles = this.handles
    this.handles = []
    await Promise.all(handles.map((handle) => handle.remove()))
    this.started = false
    this.binding = null
    this.registrationAttempted = false
  }
}
