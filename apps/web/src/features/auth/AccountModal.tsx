import { useState, type FormEvent } from 'react'
import { KeyRound, X } from 'lucide-react'
import { getSupabaseClient } from '../../lib/supabase'
import { PasswordFields } from './PasswordFields'
import { validatePasswordChange } from './password-utils'

export function AccountModal({onClose}:{onClose:()=>void}){
  const[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null)
  async function submit(event:FormEvent){event.preventDefault();const validation=validatePasswordChange(password,confirmation);if(validation){setMessage(validation);return}setBusy(true);setMessage(null);const{error}=await getSupabaseClient()!.auth.updateUser({password});setBusy(false);if(error){setMessage(error.message);return}setPassword('');setConfirmation('');setMessage('Hasło zostało zmienione.')}
  return <div className="fixed inset-0 z-[80] grid place-items-end bg-black/75 sm:place-items-center sm:p-5"><section role="dialog" aria-modal="true" aria-labelledby="account-title" className="surface w-full rounded-t-3xl p-5 sm:max-w-md sm:rounded-3xl"><header className="flex items-center justify-between"><div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-brand-gold"/><h2 id="account-title" className="font-semibold">Moje konto</h2></div><button onClick={onClose} aria-label="Zamknij" className="grid h-10 w-10 place-items-center"><X className="h-5 w-5"/></button></header><form onSubmit={event=>void submit(event)} className="mt-5"><PasswordFields password={password} confirmation={confirmation} onPassword={setPassword} onConfirmation={setConfirmation}/>{message?<p role="status" className="mt-3 text-xs text-brand-muted">{message}</p>:null}<button disabled={busy} className="mt-4 min-h-11 w-full rounded-xl bg-brand-gold px-4 text-sm font-semibold text-black disabled:opacity-50">{busy?'Zapisywanie…':'Zmień moje hasło'}</button></form></section></div>
}
