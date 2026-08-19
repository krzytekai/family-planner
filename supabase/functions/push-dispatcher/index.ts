import { createClient } from '@supabase/supabase-js'
import { classifyFcmFailure, retryDelaySeconds } from './delivery.ts'
import { createFcmAccessToken, decodeServiceAccount, sendFcmDelivery } from './fcm.ts'
import type { PushDelivery } from './types.ts'

async function secretMatches(actual: string, expected: string) {
  const encoder = new TextEncoder()
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(actual)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ])
  const left = new Uint8Array(actualHash)
  const right = new Uint8Array(expectedHash)
  let difference = left.length ^ right.length
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!
  return difference === 0
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function backendSupabaseSecretKey() {
  const serializedSecretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (serializedSecretKeys) {
    let secretKeys: unknown
    try {
      secretKeys = JSON.parse(serializedSecretKeys)
    } catch {
      throw new Error('Invalid SUPABASE_SECRET_KEYS')
    }
    const defaultSecretKey = typeof secretKeys === 'object' && secretKeys !== null
      ? (secretKeys as Record<string, unknown>).default
      : undefined
    if (typeof defaultSecretKey !== 'string' || !defaultSecretKey) {
      throw new Error('Missing SUPABASE_SECRET_KEYS default')
    }
    return defaultSecretKey
  }

  // Compatibility only for projects that have not enabled the new sb_secret_ keys yet.
  return requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const workerSecret = requiredEnv('PUSH_WORKER_SECRET')
    const suppliedSecret = request.headers.get('x-push-worker-secret') ?? ''
    if (!await secretMatches(suppliedSecret, workerSecret)) return new Response('Unauthorized', { status: 401 })

    const supabase = createClient(requiredEnv('SUPABASE_URL'), backendSupabaseSecretKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const credentials = decodeServiceAccount(requiredEnv('FCM_SERVICE_ACCOUNT_JSON_B64'))
    const accessToken = await createFcmAccessToken(credentials)
    const { data, error } = await supabase.rpc('claim_notification_push_deliveries', { batch_size: 100 })
    if (error) throw new Error(`Claim failed: ${error.code ?? 'database_error'}`)

    const deliveries = (data ?? []) as PushDelivery[]
    let sent = 0
    let retried = 0
    let failed = 0

    for (let start = 0; start < deliveries.length; start += 10) {
      const chunk = deliveries.slice(start, start + 10)
      await Promise.all(chunk.map(async (delivery) => {
        try {
          const result = await sendFcmDelivery(credentials, accessToken, delivery)
          if (result.ok) {
            const { error: completeError } = await supabase.rpc('complete_notification_push_delivery', {
              target_delivery_id: delivery.delivery_id,
              target_provider_message_id: result.messageId,
            })
            if (completeError) throw new Error(`Complete failed: ${completeError.code ?? 'database_error'}`)
            sent += 1
            return
          }

          const classification = classifyFcmFailure(result.status, result.error)
          const { error: failError } = await supabase.rpc('fail_notification_push_delivery', {
            target_delivery_id: delivery.delivery_id,
            target_error_code: classification.code,
            permanent_failure: classification.permanent,
            retry_after_seconds: result.retryAfterSeconds ?? retryDelaySeconds(delivery.attempt_count),
            disable_device: classification.disableDevice,
          })
          if (failError) throw new Error(`Failure update failed: ${failError.code ?? 'database_error'}`)
          if (classification.permanent) failed += 1
          else retried += 1
        } catch {
          const { error: retryError } = await supabase.rpc('fail_notification_push_delivery', {
            target_delivery_id: delivery.delivery_id,
            target_error_code: 'dispatcher_transport_error',
            permanent_failure: false,
            retry_after_seconds: retryDelaySeconds(delivery.attempt_count),
            disable_device: false,
          })
          if (!retryError) retried += 1
        }
      }))
    }

    return Response.json({ claimed: deliveries.length, sent, retried, failed })
  } catch (cause) {
    const message = cause instanceof Error && cause.message.startsWith('Missing ') ? cause.message : 'Push dispatcher failed'
    return Response.json({ error: message }, { status: 500 })
  }
})
