import { ChevronDown } from 'lucide-react'
import type { FamilyContext } from '../../../types/domain'

export function FamilySwitcher({ current, families, onChange, compact=false }: { current: FamilyContext; families: FamilyContext[]; onChange: (id:string)=>void; compact?:boolean }) {
  const compactBranding='text-[11.5px] font-medium uppercase leading-[1.2] tracking-[.17em] text-[#FFD84D]'
  if (families.length < 2) return <span className={`block truncate ${compact?compactBranding:''}`} title={current.familyName}>{current.familyName}</span>
  return <label className="relative block min-w-0"><span className="sr-only">Aktywna rodzina</span><select aria-label="Aktywna rodzina" value={current.familyId} onChange={(event)=>onChange(event.target.value)} className={`w-full appearance-none truncate bg-transparent pr-5 outline-none ${compact?compactBranding:'text-xs text-brand-muted'}`}>{families.map((family)=><option key={family.familyId} value={family.familyId} className="bg-[#13131b] text-brand-text">{family.familyName}</option>)}</select><ChevronDown className="pointer-events-none absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 text-brand-gold"/></label>
}
