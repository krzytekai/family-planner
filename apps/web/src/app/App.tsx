import { useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Bell, CalendarDays, Check, CheckSquare, Circle, CloudSun, LogOut, Plus, Search, ShoppingCart, WalletCards } from 'lucide-react'
import { Sidebar } from '../components/Sidebar'
import { MobileNav } from '../components/MobileNav'
import { StatCard } from '../components/StatCard'
import { AuthGate } from '../features/auth/AuthGate'
import { FamilySetup } from '../features/family/FamilySetup'
import { useFamilyContext } from '../features/family/useFamilyContext'
import { AdminPanel } from '../features/admin/AdminPanel'
import { getSupabaseClient } from '../lib/supabase'

const tasks = [
  { title: 'Odebrać paczkę z paczkomatu', meta: '10:00', done: true },
  { title: 'Zakupy spożywcze', meta: '16:00', done: false },
  { title: 'Opłacić rachunek za prąd', meta: '20:00', done: false },
  { title: 'Lekarz — wizyta kontrolna', meta: '17:30', done: false },
]

function Planner({ session }: { session: Session }) {
  const { family, loading, error } = useFamilyContext(session.user.id)
  const [adminOpen, setAdminOpen] = useState(false)

  if (loading) return <div className="grid min-h-screen place-items-center bg-brand-bg text-brand-muted">Ładowanie rodziny…</div>
  if (error) return <div className="grid min-h-screen place-items-center bg-brand-bg p-6 text-center text-red-300">Błąd konfiguracji bazy: {error}</div>
  if (!family) return <FamilySetup onDone={() => window.location.reload()} />

  const canAdmin = family.role === 'owner' || family.role === 'admin'
  const displayName = family.displayName

  return (
    <div className="min-h-screen bg-brand-bg text-brand-text">
      <Sidebar familyName={family.familyName} canAdmin={canAdmin} onAdmin={()=>setAdminOpen(true)} />
      <MobileNav />
      <main className="pb-24 lg:ml-64 lg:pb-8">
        <header className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-white/5 bg-brand-bg/85 px-4 backdrop-blur-xl md:px-7">
          <div className="relative hidden max-w-md flex-1 md:block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted"/><input aria-label="Szukaj w planerze" placeholder="Szukaj w planerze..." className="w-full rounded-xl border border-white/10 bg-white/[0.025] py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-gold/40"/></div>
          <div className="ml-auto flex items-center gap-2"><button aria-label="Powiadomienia" className="relative rounded-xl p-2 hover:bg-white/5"><Bell className="h-5 w-5"/><span className="absolute right-1 top-0 grid h-4 min-w-4 place-items-center rounded-full bg-brand-gold px-1 text-[9px] font-bold text-black">3</span></button><div className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.025] px-2.5 py-2"><div className="grid h-8 w-8 place-items-center rounded-full bg-brand-gold/15 text-xs font-bold text-brand-gold">{displayName.slice(0,1).toUpperCase()}</div><span className="hidden text-sm font-medium sm:block">{displayName}</span></div><button aria-label="Wyloguj" title="Wyloguj" onClick={()=>void getSupabaseClient()?.auth.signOut()} className="rounded-xl p-2 text-brand-muted hover:bg-white/5 hover:text-brand-text"><LogOut className="h-4 w-4"/></button></div>
        </header>
        <div className="mx-auto max-w-[1500px] p-4 md:p-7">
          <section className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="mb-1 text-xs uppercase tracking-[.18em] text-brand-gold">{family.familyName}</p><h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Dzień dobry, {displayName}! 👋</h1><p className="mt-1 text-sm text-brand-muted">Twoje rodzinne centrum organizacji • rola: {family.role}</p></div><button className="gold-glow inline-flex items-center justify-center gap-2 rounded-xl bg-brand-gold px-4 py-2.5 text-sm font-semibold text-black transition hover:brightness-105"><Plus className="h-4 w-4"/>Dodaj szybkie zadanie</button></section>
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-4"><StatCard icon={CheckSquare} label="Zadania" value="12" detail="5 do zrobienia"/><StatCard icon={ShoppingCart} label="Zakupy" value="8" detail="3 w trakcie"/><StatCard icon={WalletCards} label="Wydatki" value="1 245 zł" detail="z 3 000 zł"/><StatCard icon={Bell} label="Powiadomienia" value="3" detail="2 nowe"/></section>
          <section className="mt-4 grid gap-4 xl:grid-cols-[1.05fr_1.15fr_.8fr]">
            <article className="surface overflow-hidden rounded-2xl"><div className="border-b border-white/5 px-5 py-4 font-semibold">Zadania na dziś</div><div className="divide-y divide-white/5">{tasks.map((task)=><div key={task.title} className="flex items-center gap-3 px-5 py-4"><span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${task.done?'border-brand-green bg-brand-green text-black':'border-white/20'}`}>{task.done?<Check className="h-4 w-4"/>:null}</span><div><div className="text-sm font-medium">{task.title}</div><div className="mt-1 text-xs text-brand-muted">{displayName} • {task.meta}</div></div></div>)}</div></article>
            <article className="surface rounded-2xl p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Kalendarz — najbliższe wydarzenia</h2><CalendarDays className="h-5 w-5 text-brand-gold"/></div><div className="scrollbar-none mb-4 flex gap-2 overflow-x-auto">{['Pon 20','Wt 21','Śr 22','Czw 23','Pt 24','Sob 25','Nd 26'].map((d,i)=><div key={d} className={`min-w-14 rounded-xl px-2 py-3 text-center text-xs ${i===1?'bg-brand-gold font-semibold text-black':'bg-white/[.035] text-brand-muted'}`}>{d}</div>)}</div><div className="space-y-2">{[['10:00','Dentysta — kontrola'],['14:30','Spotkanie w szkole'],['18:00','Trening']].map(([time,title])=><div key={title} className="flex gap-4 rounded-xl bg-black/20 p-3"><span className="w-12 text-sm font-semibold">{time}</span><div className="text-sm">{title}</div></div>)}</div></article>
            <div className="space-y-4"><article className="surface rounded-2xl p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">Lista zakupów</h2><ShoppingCart className="h-4 w-4 text-brand-gold"/></div><div className="space-y-3 text-sm">{['Mleko','Chleb','Jajka','Pomidory','Ser żółty'].map(x=><div key={x} className="flex items-center gap-3"><Circle className="h-4 w-4 text-white/25"/>{x}</div>)}</div></article><article className="surface rounded-2xl p-5"><div className="flex items-center justify-between"><div><div className="text-sm font-semibold">Pogoda</div><div className="mt-4 text-xs text-brand-muted">Lublin</div><div className="mt-1 text-3xl font-semibold">22°C</div></div><CloudSun className="h-14 w-14 text-brand-gold"/></div></article></div>
          </section>
          <footer className="mt-8 text-center text-xs text-brand-muted lg:hidden">Designed & developed by Krzytek</footer>
        </div>
      </main>
      {adminOpen && canAdmin ? <AdminPanel family={family} onClose={()=>setAdminOpen(false)}/> : null}
    </div>
  )
}

export function App() {
  return <AuthGate>{(session)=><Planner session={session}/>}</AuthGate>
}
