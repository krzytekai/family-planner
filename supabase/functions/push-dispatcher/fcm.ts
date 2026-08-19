import { GoogleAuth } from 'google-auth-library'
import { buildFcmMessage, parseRetryAfterSeconds } from './delivery.ts'
import type { FcmErrorBody, FcmServiceAccount, PushDelivery } from './types.ts'

export interface FcmResult {
  ok: boolean
  status: number
  messageId: string | null
  error: FcmErrorBody
  retryAfterSeconds: number | null
}

export function decodeServiceAccount(encoded: string): FcmServiceAccount {
  const compact = encoded.replace(/\s/g, '')
  const bytes = Uint8Array.from(atob(compact), (character) => character.charCodeAt(0))
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<FcmServiceAccount>
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) throw new Error('Invalid FCM service account configuration')
  return parsed as FcmServiceAccount
}

export async function createFcmAccessToken(credentials: FcmServiceAccount) {
  const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] })
  const token = await auth.getAccessToken()
  if (!token) throw new Error('FCM OAuth token unavailable')
  return token
}

export async function sendFcmDelivery(credentials: FcmServiceAccount, accessToken: string, delivery: PushDelivery): Promise<FcmResult> {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.project_id)}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(buildFcmMessage(delivery)),
  })
  const body = await response.json().catch(() => ({})) as FcmErrorBody & { name?: string }
  return {
    ok: response.ok,
    status: response.status,
    messageId: response.ok && typeof body.name === 'string' ? body.name : null,
    error: response.ok ? {} : body,
    retryAfterSeconds: parseRetryAfterSeconds(response.headers.get('retry-after')),
  }
}
