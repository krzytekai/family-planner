import { useState, type FormEvent } from 'react'
import { Home } from 'lucide-react'
import { getSupabaseClient } from '../../lib/supabase'

export function FamilySetup({ onDone }: { onDone: () => void }) {
  const [familyName, setFamilyName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null)
    const supabase = getSupabaseClient()!
    const { error: rpcError } = await supabase.rpc('bootstrap_family', { family_name: familyName, owner_display_name: displayName })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else onDone()
  }

  return <main className="grid min-h-screen place-items-center bg-brand-bg p-4 text-brand-text"><section className="surface w-full max-w-lg rounded-3xl p-6"><div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-brand-gold/10 text-brand-gold"><Home/></div><h1 className="text-2xl font-semibold">Utwórz swoją rodzinę</h1><p className="mt-2 text-sm text-brand-muted">To jednorazowa konfiguracja konta właściciela.</p><form onSubmit={submit} className="mt-6 space-y-4"><input required minLength={2} maxLength={80} placeholder="Nazwa rodziny, np. Rodzina Kowalskich" value={familyName} onChange={(e)=>setFamilyName(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-brand-gold/40"/><input required minLength={1} maxLength={80} placeholder="Twoja nazwa, np. Krzysztof" value={displayName} onChange={(e)=>setDisplayName(e.target.value)} className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 outline-none focus:border-brand-gold/40"/>{error?<p className="text-sm text-red-300">{error}</p>:null}<button disabled={busy} className="w-full rounded-xl bg-brand-gold px-4 py-3 font-semibold text-black">{busy?'Tworzenie…':'Utwórz rodzinę'}</button></form><p className="mt-8 text-center text-xs text-brand-muted">Designed & developed by Krzytek</p></section></main>
}
