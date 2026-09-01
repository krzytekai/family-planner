import { createClient } from '@supabase/supabase-js'

const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })

function env() {
  const url = process.env.SUPABASE_URL
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !publishableKey || !secretKey) throw new Error('Server Supabase environment variables are missing')
  return { url, publishableKey, secretKey }
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
      const { data, error } = await auth.admin.from('family_members').select('family_id,user_id,display_name,role,status,created_at,profiles(email)').eq('family_id', familyId).order('created_at')
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
      const { data: created, error: createError } = await auth.admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: displayName } })
      if (createError || !created.user) return json({ error: createError?.message ?? 'Nie udało się utworzyć konta.' }, 400)
      const userId = created.user.id
      const { error: profileError } = await auth.admin.from('profiles').upsert({ id: userId, email, display_name: displayName })
      const { error: memberError } = await auth.admin.from('family_members').insert({ family_id: familyId, user_id: userId, display_name: displayName, role, status: 'active', created_by: auth.actor.id })
      if (profileError || memberError) {
        await auth.admin.auth.admin.deleteUser(userId)
        return json({ error: profileError?.message ?? memberError?.message }, 400)
      }
      await auth.admin.from('audit_logs').insert({ family_id: familyId, actor_user_id: auth.actor.id, action: 'family.member.created', entity_type: 'family_member', entity_id: userId, metadata: { role } })
      return json({ ok: true, userId }, 201)
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
  fetch: handler,
}
