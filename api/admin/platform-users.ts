import { createClient } from '@supabase/supabase-js'

const BACKEND_TIMEOUT_MS = 20_000
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

function env() {
  const url = process.env.SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !publishableKey || !secretKey) throw new Error('Server Supabase environment variables are missing')
  return { url, publishableKey, secretKey }
}

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, { ...init, signal: AbortSignal.timeout(BACKEND_TIMEOUT_MS) })
}

function authUserIsMissing(error: { status?: number; code?: string; message?: string } | null, user: unknown) {
  if (!error) return !user
  return error.status === 404 || error.code === 'user_not_found' || /user not found/i.test(error.message ?? '')
}

async function handler(request: Request) {
  try {
    if (request.method !== 'DELETE') return json({ error: 'Metoda niedozwolona.' }, 405)
    const authHeader = request.headers.get('authorization')
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token) return json({ error: 'Brak autoryzacji.' }, 401)

    const { url, publishableKey, secretKey } = env()
    const options = { global: { fetch: fetchWithTimeout }, auth: { persistSession: false, autoRefreshToken: false } }
    const userClient = createClient(url, publishableKey, { ...options, global: { ...options.global, headers: { Authorization: `Bearer ${token}` } } })
    const admin = createClient(url, secretKey, options)
    const { data: userData, error: userError } = await userClient.auth.getUser(token)
    if (userError || !userData.user) return json({ error: 'Sesja jest nieprawidłowa.' }, 401)
    const actorUserId = userData.user.id

    const { data: platformAdmin, error: platformAdminError } = await admin.from('platform_admins').select('active').eq('user_id', actorUserId).maybeSingle()
    if (platformAdminError) return json({ error: 'Nie udało się zweryfikować administratora platformy.' }, 500)
    if (!platformAdmin?.active) return json({ error: 'Wymagany administrator platformy.' }, 403)

    const body = await request.json()
    const targetUserId = body?.targetUserId
    if (typeof targetUserId !== 'string' || !targetUserId) return json({ error: 'Brak identyfikatora użytkownika.' }, 400)
    if (targetUserId === actorUserId) return json({ error: 'Nie możesz usunąć własnego konta platformowego.' }, 403)

    const { data: profile, error: profileError } = await admin.from('profiles').select('deleted_at').eq('id', targetUserId).maybeSingle()
    if (profileError) return json({ error: 'Nie udało się zweryfikować profilu.' }, 500)
    if (profile?.deleted_at) return json({ ok: true, alreadyDeleted: true })

    const { data: preflight, error: preflightError } = await userClient.rpc('get_platform_user_deletion_preflight', { target_user_id: targetUserId })
    if (preflightError) return json({ error: 'Nie udało się zweryfikować możliwości usunięcia konta.' }, 400)
    if (!preflight?.allowed) return json({ error: preflight?.reason === 'active_memberships' ? 'Nie można usunąć konta, ponieważ użytkownik należy do aktywnej rodziny.' : 'Nie można usunąć tego konta.' }, 409)
    const membershipCount = Number(preflight.membershipCount ?? 0)

    const { data: authTarget, error: getTargetError } = await admin.auth.admin.getUserById(targetUserId)
    const authMissing = authUserIsMissing(getTargetError, authTarget?.user)
    if (getTargetError && !authMissing) return json({ error: 'Nie udało się zweryfikować konta Auth.' }, 500)
    if (!authMissing) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(targetUserId, false)
      if (deleteError && !authUserIsMissing(deleteError, null)) return json({ error: 'Nie udało się usunąć konta logowania.' }, 400)
    }

    const { error: finalizeError } = await admin.rpc('finalize_platform_user_deletion', { actor_user_id: actorUserId, target_user_id: targetUserId, previous_membership_count: membershipCount })
    if (finalizeError) return json({ error: 'Konto Auth usunięto, ale finalizacja profilu wymaga ponowienia.' }, 500)
    return json({ ok: true })
  } catch (reason) {
    console.error('Platform user deletion endpoint failed', reason instanceof Error ? reason.name : 'unknown')
    return json({ error: reason instanceof DOMException && reason.name === 'TimeoutError' ? 'Operacja przekroczyła limit czasu. Możesz ją bezpiecznie ponowić.' : 'Błąd serwera.' }, 500)
  }
}

export default {
  async fetch(request: Request) {
    const origin = request.headers.get('origin')
    const allowedOrigin = origin === 'https://localhost' || origin === 'capacitor://localhost' ? origin : null
    const corsHeaders: Record<string, string> = allowedOrigin ? {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
      'Vary': 'Origin',
    } : {}
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    const response = await handler(request)
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(corsHeaders)) headers.set(key, value)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
}
