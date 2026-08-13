import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, Home, LockKeyhole, Mail } from 'lucide-react'
import { getSupabaseClient } from '../../lib/supabase'

export function LoginScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const supabase = getSupabaseClient()
    if (!supabase) {
      setError('Brak konfiguracji Supabase. Uzupełnij zmienne środowiskowe w Vercel.')
      return
    }
    setBusy(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (signInError) setError('Nieprawidłowy e-mail lub hasło.')
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-brand-bg px-4 py-10 text-brand-text">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(255,216,77,.11),transparent_34%)]" />
      <section className="surface relative w-full max-w-md rounded-[28px] p-6 sm:p-8">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl border border-brand-gold/25 bg-brand-gold/10 text-brand-gold gold-glow"><Home className="h-7 w-7" /></div>
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Planer rodzinny</h1>
          <p className="mt-2 text-sm text-brand-muted">Zaloguj się do swojego centrum rodziny</p>
        </div>
        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm text-brand-muted">E-mail
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 focus-within:border-brand-gold/40">
              <Mail className="h-4 w-4" />
              <input required type="email" autoComplete="email" value={email} onChange={(e)=>setEmail(e.target.value)} className="w-full bg-transparent py-3 text-brand-text outline-none" placeholder="twoj@email.pl" />
            </div>
          </label>
          <label className="block text-sm text-brand-muted">Hasło
            <div className="mt-2 flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-3 focus-within:border-brand-gold/40">
              <LockKeyhole className="h-4 w-4" />
              <input required minLength={8} type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e)=>setPassword(e.target.value)} className="w-full bg-transparent py-3 text-brand-text outline-none" placeholder="••••••••••••" />
              <button type="button" aria-label="Pokaż lub ukryj hasło" onClick={()=>setShowPassword((x)=>!x)} className="text-brand-muted hover:text-brand-text">{showPassword ? <EyeOff className="h-4 w-4"/> : <Eye className="h-4 w-4"/>}</button>
            </div>
          </label>
          {error ? <div className="rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
          <button disabled={busy} className="gold-glow w-full rounded-xl bg-brand-gold px-4 py-3 font-semibold text-black transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Logowanie…' : 'Zaloguj się'}</button>
        </form>
        <p className="mt-8 text-center text-xs text-brand-muted">Designed & developed by Krzytek</p>
      </section>
    </main>
  )
}
