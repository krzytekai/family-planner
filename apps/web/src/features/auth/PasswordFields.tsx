import { Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'

export function PasswordFields({password,confirmation,onPassword,onConfirmation}:{password:string;confirmation:string;onPassword:(value:string)=>void;onConfirmation:(value:string)=>void}){
  const[visible,setVisible]=useState(false)
  const type=visible?'text':'password'
  return <div className="space-y-3"><label className="block text-xs text-brand-muted">Nowe hasło<input required minLength={8} autoComplete="new-password" type={type} value={password} onChange={event=>onPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text"/></label><label className="block text-xs text-brand-muted">Powtórz nowe hasło<input required minLength={8} autoComplete="new-password" type={type} value={confirmation} onChange={event=>onConfirmation(event.target.value)} className="mt-1.5 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text"/></label><button type="button" onClick={()=>setVisible(value=>!value)} className="min-h-10 rounded-xl px-2 text-xs text-brand-muted">{visible?<EyeOff className="mr-1 inline h-4 w-4"/>:<Eye className="mr-1 inline h-4 w-4"/>}{visible?'Ukryj hasło':'Pokaż hasło'}</button></div>
}
