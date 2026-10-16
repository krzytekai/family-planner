import { useEffect, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { decimalToCents } from '../budget-utils'
import type { BudgetMember, SettlementInput, SuggestedTransfer } from '../types'

export function SettlementModal({
  familyId, members, suggestion, settlementDate, settlementMonthLabel, defaultDate, saving, onSave, onClose,
}: {
  familyId: string; members: BudgetMember[]; suggestion?: SuggestedTransfer; settlementDate: string
  settlementMonthLabel: string; defaultDate: string; saving: boolean
  onSave: (input: SettlementInput) => Promise<void>; onClose: () => void
}) {
  const [from, setFrom] = useState(suggestion?.fromUserId ?? '')
  const [to, setTo] = useState(suggestion?.toUserId ?? '')
  const [amount, setAmount] = useState(suggestion ? (suggestion.amountCents / 100).toFixed(2) : '')
  const [date, setDate] = useState(defaultDate)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) onClose() }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close) }, [onClose, saving])
  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await onSave({ familyId, fromUserId: from, toUserId: to, amountCents: decimalToCents(amount), settlementDate, date, note })
      onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się zapisać.') }
  }
  const field = 'mt-1.5 w-full rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-base'
  return <div className="fixed inset-0 z-[80] grid place-items-end bg-black/75 sm:place-items-center sm:p-5"><section role="dialog" aria-modal="true" className="surface w-full rounded-t-3xl p-5 sm:max-w-lg sm:rounded-3xl"><header className="flex justify-between"><h2 className="text-xl font-semibold">Rozlicz wspólne wydatki</h2><button onClick={onClose} aria-label="Zamknij"><X /></button></header><form onSubmit={(event) => void submit(event)} className="mt-5 space-y-4"><p className="rounded-xl border border-brand-gold/15 bg-brand-gold/[.035] px-3 py-2 text-sm"><span className="text-brand-muted">Rozliczany miesiąc:</span> <strong className="font-medium text-brand-text">{settlementMonthLabel}</strong></p><label className="block text-sm text-brand-muted">Od<select required value={from} onChange={(event) => setFrom(event.target.value)} className={`${field} budget-dark-select`}><option value="" />{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><label className="block text-sm text-brand-muted">Do<select required value={to} onChange={(event) => setTo(event.target.value)} className={`${field} budget-dark-select`}><option value="" />{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label><div className="grid grid-cols-2 gap-3"><label className="text-sm text-brand-muted">Kwota<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={field} /></label><label className="text-sm text-brand-muted">Data<input required type="date" value={date} onChange={(event) => setDate(event.target.value)} className={field} /></label></div><label className="block text-sm text-brand-muted">Notatka<textarea value={note} onChange={(event) => setNote(event.target.value)} className={field} /></label>{error ? <p className="text-sm text-red-300">{error}</p> : null}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-4 py-3">Anuluj</button><button disabled={saving || from === to} className="rounded-xl bg-brand-gold px-5 py-3 font-semibold text-black disabled:opacity-50">{saving ? 'Zapisywanie…' : 'Zapisz rozliczenie'}</button></div></form></section></div>
}
