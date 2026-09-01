import { useState, type FormEvent } from 'react'
import { KeyRound, X } from 'lucide-react'
import type { FamilyMember } from '../../types/domain'
import { PasswordFields } from '../auth/PasswordFields'
import { validatePasswordChange } from '../auth/password-utils'

export function MemberPasswordModal({member,busy,onSave,onClose}:{member:FamilyMember;busy:boolean;onSave:(password:string)=>Promise<void>;onClose:()=>void}){
  const[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[error,setError]=useState<string|null>(null)
  async function submit(event:FormEvent){event.preventDefault();const validation=validatePasswordChange(password,confirmation);if(validation){setError(validation);return}setError(null);await onSave(password)}
  return <div className="fixed inset-0 z-[95] grid place-items-end bg-black/75 sm:place-items-center sm:p-5"><section role="dialog" aria-modal="true" aria-labelledby="member-password-title" className="surface w-full rounded-t-3xl p-5 sm:max-w-md sm:rounded-3xl"><header className="flex items-center justify-between"><div><div className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-brand-gold"/><h3 id="member-password-title" className="font-semibold">Zmień hasło członka</h3></div><p className="mt-1 text-xs text-brand-muted">{member.displayName}</p></div><button onClick={onClose} disabled={busy} aria-label="Zamknij" className="grid h-10 w-10 place-items-center"><X className="h-5 w-5"/></button></header><form onSubmit={event=>void submit(event)} className="mt-5"><PasswordFields password={password} confirmation={confirmation} onPassword={setPassword} onConfirmation={setConfirmation}/>{error?<p role="alert" className="mt-3 text-xs text-red-300">{error}</p>:null}<div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="min-h-11 rounded-xl border border-white/10 px-4">Anuluj</button><button disabled={busy} className="min-h-11 rounded-xl bg-brand-gold px-4 font-semibold text-black disabled:opacity-50">{busy?'Zapisywanie…':'Zmień hasło'}</button></div></form></section></div>
}
