import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

interface PushDelivery { delivery_id: string; notification_id: string; device_id: string; push_token: string; attempt_count: number; family_id: string; recipient_user_id: string; notification_type: 'task_assigned' | 'task_reminder' | 'calendar_reminder' | 'system'; title: string; body: string | null; source_type: 'task' | 'calendar_event' | 'system' | null; source_id: string | null }
interface DeliveryModule { buildFcmMessage: (delivery: PushDelivery) => { message: { notification: unknown; data: Record<string, string>; android: { priority: string; collapse_key: string; notification: { channel_id: string; tag: string } } } }; classifyFcmFailure: (status: number, body: object) => { code: string; permanent: boolean; disableDevice: boolean }; retryDelaySeconds: (attempt: number) => number; parseRetryAfterSeconds: (value: string | null, now?: number) => number | null }
let deliveryModule: DeliveryModule

beforeAll(async () => {
  const moduleUrl = pathToFileURL(resolve(process.cwd(), '../../supabase/functions/push-dispatcher/delivery.ts')).href
  deliveryModule = await import(/* @vite-ignore */ moduleUrl) as DeliveryModule
})

const delivery = (overrides: Partial<PushDelivery> = {}): PushDelivery => ({
  delivery_id: 'd1', notification_id: 'n1', device_id: 'dev1', push_token: 'secret-token', attempt_count: 1,
  family_id: 'f1', recipient_user_id: 'u1', notification_type: 'task_reminder', title: 'Przypomnienie', body: 'Zadanie', source_type: 'task', source_id: 't1', ...overrides,
})

describe('FCM delivery utilities', () => {
  it('builds a notification+data payload with stable tag and reminder channel', () => {
    const message = deliveryModule.buildFcmMessage(delivery()).message
    expect(message.notification).toEqual({ title: 'Przypomnienie', body: 'Zadanie' })
    expect(message.data).toMatchObject({ notification_id: 'n1', route: 'tasks' })
    expect(message.android).toMatchObject({ priority: 'HIGH', collapse_key: 'n1', notification: { channel_id: 'reminders', tag: 'n1' } })
  })
  it('uses normal priority and general channel for system notifications', () => expect(deliveryModule.buildFcmMessage(delivery({ notification_type: 'system', source_type: 'system' })).message.android).toMatchObject({ priority: 'NORMAL', notification: { channel_id: 'general' } }))
  it('classifies an UNREGISTERED token as permanent and disables the device', () => expect(deliveryModule.classifyFcmFailure(404, { error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } })).toEqual({ code: 'UNREGISTERED', permanent: true, disableDevice: true }))
  it('disables a token-specific FcmError INVALID_ARGUMENT', () => expect(deliveryModule.classifyFcmFailure(400, { error: { status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'INVALID_ARGUMENT' }] } })).toEqual({ code: 'INVALID_ARGUMENT_TOKEN', permanent: true, disableDevice: true }))
  it('does not disable a device for generic INVALID_ARGUMENT with field violations', () => expect(deliveryModule.classifyFcmFailure(400, { error: { status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [{ field: 'message.android.ttl', description: 'Invalid TTL' }] }] } })).toEqual({ code: 'INVALID_ARGUMENT_REQUEST', permanent: true, disableDevice: false }))
  it('does not infer a dead token from HTTP 400 alone', () => expect(deliveryModule.classifyFcmFailure(400, { error: { status: 'INVALID_ARGUMENT' } })).toEqual({ code: 'INVALID_ARGUMENT_REQUEST', permanent: true, disableDevice: false }))
  it('keeps the device active for SENDER_ID_MISMATCH configuration errors', () => expect(deliveryModule.classifyFcmFailure(403, { error: { details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'SENDER_ID_MISMATCH' }] } })).toEqual({ code: 'SENDER_ID_MISMATCH', permanent: true, disableDevice: false }))
  it.each([
    ['QUOTA_EXCEEDED', 429],
    ['UNAVAILABLE', 503],
    ['INTERNAL', 500],
  ] as const)('retries transient %s errors', (code, status) => expect(deliveryModule.classifyFcmFailure(status, { error: { status: code } })).toEqual({ code, permanent: false, disableDevice: false }))
  it('uses bounded deterministic backoff through and beyond the maximum attempt count', () => expect([1, 2, 3, 4, 5, 6, 100].map(deliveryModule.retryDelaySeconds)).toEqual([60, 300, 900, 3600, 21600, 21600, 21600]))
  it('parses Retry-After seconds and HTTP dates without accepting stale values', () => {
    const now = Date.parse('2026-08-19T12:00:00Z')
    expect(deliveryModule.parseRetryAfterSeconds('120', now)).toBe(120)
    expect(deliveryModule.parseRetryAfterSeconds('Wed, 19 Aug 2026 12:05:00 GMT', now)).toBe(300)
    expect(deliveryModule.parseRetryAfterSeconds('Wed, 19 Aug 2026 11:59:00 GMT', now)).toBeNull()
  })
})
