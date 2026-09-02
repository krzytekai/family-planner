import { createClient } from '@supabase/supabase-js'

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

function env() {
  const url = process.env.SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !publishableKey || !secretKey) throw new Error('Server Supabase environment variables are missing')
  return { url, publishableKey, secretKey }
}

type AdminClient = ReturnType<typeof createClient>

async function findAuthUserByEmail(admin: AdminClient, normalizedEmail: string) {
  const perPage = 200
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error('auth_user_lookup_failed')
    const user = data.users.find(candidate => candidate.email?.trim().toLowerCase() === normalizedEmail)
    if (user) return user
    if (data.users.length < perPage) return null
  }
  throw new Error('auth_user_lookup_limit_exceeded')
}

async function cleanupCreatedAuthUser(admin: AdminClient, userId: string) {
  const { error } = await admin.auth.admin.deleteUser(userId, false)
  if (!error) await admin.from('profiles').delete().eq('id', userId)
}

async function authorize(request: Request, familyId: string) {
  const { url, publishableKey, secretKey } = env()
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return { error: json({ error: 'Brak autoryzacji.' }, 401) }

  const authClient = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: userData, error: userError } = await authClient.auth.getUser(token)
  if (userError || !userData.user) return { error: json({ error: 'Sesja jest nieprawidłowa.' }, 401) }

  const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: membership } = await admin.from('family_members').select('role,status').eq('family_id', familyId).eq('user_id', userData.user.id).maybeSingle()
  if (!membership || membership.status !== 'active' || !['owner','admin'].includes(membership.role)) return { error: json({ error: 'Brak uprawnień administratora.' }, 403) }
  return { admin, actor: userData.user, actorRole: membership.role as 'owner' | 'admin' }
}

async function handler(request: Request) {
  try {
    const url = new URL(request.url)
    if (request.method === 'GET') {
      const familyId = url.searchParams.get('familyId') ?? ''
      if (!familyId) return json({ error: 'Brak familyId.' }, 400)
      const auth = await authorize(request, familyId)
      if ('error' in auth) return auth.error
      const { data, error } = await auth.admin.from('family_members').select('family_id,user_id,display_name,role,status,created_at,profiles!family_members_user_id_profiles_fkey(email)').eq('family_id', familyId).order('created_at')
      if (error) return json({ error: error.message }, 400)
      const members = (data ?? []).map((m: any) => ({ userId:m.user_id, familyId:m.family_id, displayName:m.display_name, role:m.role, status:m.status, createdAt:m.created_at, email:Array.isArray(m.profiles)?m.profiles[0]?.email:m.profiles?.email ?? null }))
      return json({ members })
    }

    if (request.method === 'POST') {
      const body = await request.json()
      const { familyId, email, password, displayName, role } = body ?? {}
      if (!familyId || !email || !password || !displayName || !['admin','adult','child'].includes(role)) return json({ error: 'Nieprawidłowe dane użytkownika.' }, 400)
      if (String(password).length < 8) return json({ error: 'Hasło musi mieć co najmniej 8 znaków.' }, 400)
      const auth = await authorize(request, familyId)
      if ('error' in auth) return auth.error
      if (auth.actorRole === 'admin' && role === 'admin') return json({ error: 'Administrator może dodawać tylko dorosłych i dzieci.' }, 403)

      const normalizedEmail = String(email).trim().toLowerCase()
      const normalizedDisplayName = String(displayName).trim()
      let authUser = await findAuthUserByEmail(auth.admin, normalizedEmail)
      let createdAuthUser = false

      if (!authUser) {
        const { data: created, error: createError } = await auth.admin.auth.admin.createUser({ email: normalizedEmail, password, email_confirm: true, user_metadata: { display_name: normalizedDisplayName } })
        if (createError || !created.user) return json({ error: createError?.message ?? 'Nie udało się utworzyć konta.' }, 400)
        authUser = created.user
        createdAuthUser = true
      }

      const userId = authUser.id
      const { data: platformAdmin } = await auth.admin.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle()
      if (platformAdmin) {
        if (createdAuthUser) await cleanupCreatedAuthUser(auth.admin, userId)
        return json({ error: 'Konto administratora platformy nie może zostać dodane jako członek rodziny.', code: 'platform_admin_protected' }, 409)
      }

      const { data: profile, error: profileLookupError } = await auth.admin.from('profiles').select('id,deleted_at').eq('id', userId).maybeSingle()
      if (profileLookupError) {
        if (createdAuthUser) await cleanupCreatedAuthUser(auth.admin, userId)
        return json({ error: 'Nie udało się sprawdzić profilu użytkownika.' }, 400)
      }
      if (profile?.deleted_at) return json({ error: 'To konto zostało wcześniej usunięte i nie może zostać ponownie dodane.', code: 'profile_deleted' }, 409)

      const profileWrite = createdAuthUser
        ? await auth.admin.from('profiles').upsert({ id: userId, email: normalizedEmail, display_name: normalizedDisplayName })
        : profile
          ? { error: null }
          : await auth.admin.from('profiles').insert({ id: userId, email: normalizedEmail, display_name: normalizedDisplayName })
      if (profileWrite.error) {
        if (createdAuthUser) await cleanupCreatedAuthUser(auth.admin, userId)
        return json({ error: 'Nie udało się przygotować profilu użytkownika.' }, 400)
      }

      const { data: membership, error: membershipLookupError } = await auth.admin.from('family_members').select('status').eq('family_id', familyId).eq('user_id', userId).maybeSingle()
      if (membershipLookupError) {
        if (createdAuthUser) await cleanupCreatedAuthUser(auth.admin, userId)
        return json({ error: 'Nie udało się sprawdzić członkostwa użytkownika.' }, 400)
      }
      if (membership?.status === 'active') {
        if (createdAuthUser) await cleanupCreatedAuthUser(auth.admin, userId)
        return json({ error: 'Ten użytkownik już należy do tej rodziny.', code: 'already_member' }, 409)
      }

      const memberWrite = membership
        ? await auth.admin.from('family_members').update({ display_name: normalizedDisplayName, role, status: 'active', updated_at: new Date().toISOString() }).eq('family_id', familyId).eq('user_id', userId)
        : await auth.admin.from('family_members').insert({ family_id: familyId, user_id: userId, display_name: normalizedDisplayName, role, status: 'active', created_by: auth.actor.id })
      if (memberWrite.error) {
        if (createdAuthUser) await cleanupCreatedAuthUser(auth.admin, userId)
        if (memberWrite.error.code === '23505') return json({ error: 'Ten użytkownik już należy do tej rodziny.', code: 'already_member' }, 409)
        return json({ error: 'Nie udało się dodać użytkownika do rodziny.' }, 400)
      }

      const result = createdAuthUser ? 'new_user_created' : membership ? 'membership_reactivated' : 'existing_user_added'
      await auth.admin.from('audit_logs').insert({ family_id: familyId, actor_user_id: auth.actor.id, action: membership ? 'family.member.reactivated' : 'family.member.created', entity_type: 'family_member', entity_id: userId, metadata: { role } })
      return json({ ok: true, userId, result }, createdAuthUser ? 201 : 200)
    }

    if (request.method === 'PATCH') {
      const body = await request.json()
      const { familyId, userId, password } = body ?? {}
      if (!familyId || !userId || typeof password !== 'string' || password.length < 8) return json({ error: 'Nieprawidłowe dane zmiany hasła.' }, 400)
      const auth = await authorize(request, familyId)
      if ('error' in auth) return auth.error
      if (userId === auth.actor.id) return json({ error: 'Własne hasło zmień w sekcji Moje konto.' }, 400)
      const { data: target } = await auth.admin.from('family_members').select('role,status').eq('family_id', familyId).eq('user_id', userId).maybeSingle()
      if (!target || target.status !== 'active') return json({ error: 'Nie znaleziono aktywnego członka tej rodziny.' }, 404)
      const allowed = auth.actorRole === 'owner' ? ['admin','adult','child'].includes(target.role) : ['adult','child'].includes(target.role)
      if (!allowed) return json({ error: 'Brak uprawnień do zmiany hasła tego członka.' }, 403)
      const { error: updateError } = await auth.admin.auth.admin.updateUserById(userId, { password })
      if (updateError) return json({ error: 'Nie udało się zmienić hasła.' }, 400)
      await auth.admin.from('audit_logs').insert({ family_id: familyId, actor_user_id: auth.actor.id, action: 'family.member.password_changed', entity_type: 'family_member', entity_id: userId, metadata: { target_role: target.role } })
      return json({ ok: true })
    }

    return json({ error: 'Metoda niedozwolona.' }, 405)
  } catch {
    console.error('Admin users endpoint failed')
    return json({ error: 'Błąd serwera.' }, 500)
  }
}

export default {
  async fetch(request: Request) {
    const origin = request.headers.get('origin')
    const allowedOrigin = origin === 'https://localhost' || origin === 'capacitor://localhost' ? origin : null
    const corsHeaders: Record<string,string> = allowedOrigin ? {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
      'Vary': 'Origin',
    } : {}
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    const response = await handler(request)
    const headers = new Headers(response.headers)
    for (const [key,value] of Object.entries(corsHeaders)) headers.set(key,value)
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  },
}
