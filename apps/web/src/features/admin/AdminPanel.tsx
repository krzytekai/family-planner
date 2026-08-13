import { useEffect, useState, type FormEvent } from 'react'
import { Plus, ShieldCheck, UserRound, X } from 'lucide-react'
import { getSupabaseClient } from '../../lib/supabase'
import type { FamilyContext, FamilyMember, FamilyRole } from '../../types/domain'

const roles: FamilyRole[] = ['admin', 'adult', 'child']

type MemberFieldConfig = {
  name: 'displayName' | 'email' | 'password'
  label: string
  value: string
  setValue: (value: string) => void
  type: 'text' | 'email' | 'password'
  minLength?: number
}

export function AdminPanel({ family, onClose }: { family: FamilyContext; onClose: () => void }) {
  const [members, setMembers] = useState<FamilyMember[]>([])
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<FamilyRole>('adult')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const memberFields: MemberFieldConfig[] = [
    { name: 'displayName', label: 'Nazwa', value: displayName, setValue: setDisplayName, type: 'text' },
    { name: 'email', label: 'E-mail', value: email, setValue: setEmail, type: 'email' },
    { name: 'password', label: 'Hasło tymczasowe', value: password, setValue: setPassword, type: 'password', minLength: 8 },
  ]

  async function token() {
    const supabase = getSupabaseClient()
    const { data } = await supabase!.auth.getSession()
    return data.session?.access_token
  }

  async function loadMembers() {
    const accessToken = await token()
    if (!accessToken) return
    const response = await fetch(`/api/admin/users?familyId=${encodeURIComponent(family.familyId)}`, { headers: { Authorization: `Bearer ${accessToken}` } })
    const body = await response.json()
    if (response.ok) setMembers(body.members)
    else setMessage(body.error ?? 'Nie udało się pobrać użytkowników.')
  }

  useEffect(() => { void loadMembers() }, [])

  async function createMember(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setMessage(null)
    const accessToken = await token()
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ familyId: family.familyId, email, password, displayName, role }),
    })
    const body = await response.json()
    setBusy(false)
    if (!response.ok) { setMessage(body.error ?? 'Nie udało się dodać użytkownika.'); return }
    setEmail(''); setPassword(''); setDisplayName(''); setRole('adult'); setMessage('Użytkownik został dodany.'); await loadMembers()
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 p-3 backdrop-blur-sm sm:p-6">
      <section className="surface mx-auto flex h-full max-w-5xl flex-col overflow-hidden rounded-3xl">
        <header className="flex items-center justify-between border-b border-white/5 px-5 py-4"><div><div className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-5 w-5 text-brand-gold"/>Administracja rodziny</div><p className="mt-1 text-xs text-brand-muted">{family.familyName}</p></div><button onClick={onClose} className="rounded-xl p-2 hover:bg-white/5"><X className="h-5 w-5"/></button></header>
        <div className="grid flex-1 gap-5 overflow-auto p-5 lg:grid-cols-[1fr_.85fr]">
          <div><h2 className="mb-3 font-semibold">Użytkownicy</h2><div className="space-y-2">{members.map((m)=><div key={m.userId} className="flex items-center justify-between rounded-2xl border border-white/5 bg-black/20 p-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-full bg-brand-gold/10 text-brand-gold"><UserRound className="h-5 w-5"/></div><div><div className="text-sm font-medium">{m.displayName}</div><div className="text-xs text-brand-muted">{m.email ?? '—'} • {m.role}</div></div></div><span className={`rounded-full px-2 py-1 text-[11px] ${m.status==='active'?'bg-brand-green/10 text-brand-green':'bg-red-500/10 text-red-300'}`}>{m.status}</span></div>)}</div></div>
          <form onSubmit={createMember} className="rounded-2xl border border-brand-gold/10 bg-brand-gold/[.03] p-4">
            <div className="mb-4 flex items-center gap-2 font-semibold"><Plus className="h-4 w-4 text-brand-gold"/>Dodaj użytkownika</div>
            <div className="space-y-3">
              {memberFields.map((field) => (
                <label key={field.name} className="block text-xs text-brand-muted">
                  {field.label}
                  <input
                    required
                    minLength={field.minLength}
                    type={field.type}
                    value={field.value}
                    onChange={(event) => field.setValue(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none focus:border-brand-gold/40"
                  />
                </label>
              ))}
              <label className="block text-xs text-brand-muted">Rola<select value={role} onChange={(e)=>setRole(e.target.value as FamilyRole)} className="mt-1 w-full rounded-xl border border-white/10 bg-[#101017] px-3 py-2.5 text-sm text-brand-text">{roles.map((r)=><option key={r} value={r}>{r}</option>)}</select></label>{message?<p className="text-xs text-brand-muted">{message}</p>:null}<button disabled={busy} className="w-full rounded-xl bg-brand-gold px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-60">{busy?'Dodawanie…':'Dodaj użytkownika'}</button>
            </div>
          </form>
        </div>
      </section>
    </div>
  )
}
