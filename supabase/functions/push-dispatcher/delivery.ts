import type { FcmErrorBody, PushDelivery } from './types.ts'

const retryDelays = [60, 300, 900, 3600, 21600] as const
const transientErrors = new Set(['QUOTA_EXCEEDED', 'UNAVAILABLE', 'INTERNAL'])

export function routeForDelivery(delivery: Pick<PushDelivery, 'notification_type' | 'source_type'>) {
  if (delivery.source_type === 'task' || delivery.notification_type === 'task_assigned' || delivery.notification_type === 'task_reminder') return 'tasks'
  if (delivery.source_type === 'calendar_event' || delivery.notification_type === 'calendar_reminder') return 'calendar'
  return 'dashboard'
}

export function buildFcmMessage(delivery: PushDelivery) {
  const reminder = delivery.notification_type === 'task_reminder' || delivery.notification_type === 'calendar_reminder'
  return {
    message: {
      token: delivery.push_token,
      notification: { title: delivery.title, body: delivery.body ?? '' },
      data: {
        notification_id: delivery.notification_id,
        family_id: delivery.family_id,
        notification_type: delivery.notification_type,
        source_type: delivery.source_type ?? 'system',
        source_id: delivery.source_id ?? '',
        route: routeForDelivery(delivery),
      },
      android: {
        priority: reminder ? 'HIGH' : 'NORMAL',
        collapse_key: delivery.notification_id,
        notification: {
          channel_id: reminder ? 'reminders' : 'general',
          tag: delivery.notification_id,
          icon: 'ic_stat_notification',
          color: '#FFD84D',
        },
      },
    },
  }
}

export function retryDelaySeconds(attemptCount: number) {
  return retryDelays[Math.min(Math.max(attemptCount - 1, 0), retryDelays.length - 1)]
}

export function parseRetryAfterSeconds(value: string | null, now = Date.now()) {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds)
  const retryAt = Date.parse(value)
  if (!Number.isFinite(retryAt)) return null
  const delay = Math.ceil((retryAt - now) / 1000)
  return delay > 0 ? delay : null
}

export function classifyFcmFailure(httpStatus: number, body: FcmErrorBody) {
  const details = body.error?.details ?? []
  const fcmDetail = details.find((detail) => detail['@type']?.includes('google.firebase.fcm.v1.FcmError'))
  const hasFieldViolations = details.some((detail) => detail['@type']?.includes('google.rpc.BadRequest') && (detail.fieldViolations?.length ?? 0) > 0)
  const fcmCode = fcmDetail?.errorCode
    ?? body.error?.status
    ?? `HTTP_${httpStatus}`

  if (fcmCode === 'UNREGISTERED') return { code: 'UNREGISTERED', permanent: true, disableDevice: true }
  if (fcmCode === 'INVALID_ARGUMENT') {
    const tokenSpecific = fcmDetail?.errorCode === 'INVALID_ARGUMENT' && !hasFieldViolations
    return {
      code: tokenSpecific ? 'INVALID_ARGUMENT_TOKEN' : 'INVALID_ARGUMENT_REQUEST',
      permanent: true,
      disableDevice: tokenSpecific,
    }
  }
  if (fcmCode === 'SENDER_ID_MISMATCH') return { code: 'SENDER_ID_MISMATCH', permanent: true, disableDevice: false }
  if (transientErrors.has(fcmCode) || httpStatus === 429 || httpStatus >= 500) return { code: fcmCode, permanent: false, disableDevice: false }
  return { code: fcmCode, permanent: httpStatus >= 400 && httpStatus < 500, disableDevice: false }
}
