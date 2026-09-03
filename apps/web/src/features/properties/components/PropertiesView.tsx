import{useMemo,useState}from'react'
import{ChevronLeft,ChevronRight,Plus}from'lucide-react'
import type{FamilyContext}from'../../../types/domain'
import{amountModeLabels,chargeRecurrenceLabels,chargeStatusLabels}from'../property-labels'
import{chargeForMonth,chargesForMonth,effectiveAmount,filterMonthlyCharges,formatPropertyMoney,isOverdue,monthKey,propertySummary,shiftMonth}from'../property-utils'
import{useProperties}from'../hooks/useProperties'
import type{ChargeDefinition,Property,PropertyCharge,PropertiesTab}from'../types'
import{ChargeDefinitionModal}from'./ChargeDefinitionModal'
import{DeletePropertyModal}from'./DeletePropertyModal'
import{PayChargeModal}from'./PayChargeModal'
import{PropertyModal}from'./PropertyModal'

const tabs:Array<{id:PropertiesTab;label:string}>=[{id:'overview',label:'Przegląd'},{id:'year',label:'Rok'},{id:'history',label:'Historia'},{id:'settings',label:'Ustawienia'}]
const months=['Sty','Lut','Mar','Kwi','Maj','Cze','Lip','Sie','Wrz','Paź','Lis','Gru']
const monthFormatter=new Intl.DateTimeFormat('pl-PL',{month:'long',year:'numeric'})
const dueFormatter=new Intl.DateTimeFormat('pl-PL',{day:'numeric',month:'short'})
type MonthFilter='all'|'pending'|'paid'

export function PropertiesView({family}:{family:FamilyContext}){
  const now=new Date()
  const[tab,setTab]=useState<PropertiesTab>('overview')
  const[selectedMonth,setSelectedMonth]=useState(()=>new Date(now.getFullYear(),now.getMonth(),1))
  const[year,setYear]=useState(now.getFullYear())
  const data=useProperties(family.familyId,tab==='year'?year:selectedMonth.getFullYear())
  const[monthFilter,setMonthFilter]=useState<MonthFilter>('all')
  const[modal,setModal]=useState<'property'|'definition'|null>(null)
  const[editing,setEditing]=useState<Property|null>(null)
  const[editingDefinition,setEditingDefinition]=useState<ChargeDefinition|null>(null)
  const[definitionView,setDefinitionView]=useState<'active'|'inactive'>('active')
  const[deleting,setDeleting]=useState<Property|null>(null)
  const[archiveView,setArchiveView]=useState<'active'|'archived'>('active')
  const[paying,setPaying]=useState<PropertyCharge|null>(null)
  const[selectedProperty,setSelectedProperty]=useState('all')
  const canDelete=family.role==='owner'||family.role==='admin'
  const propertyNames=useMemo(()=>new Map(data.properties.map(p=>[p.id,p.name])),[data.properties])
  const unitNames=useMemo(()=>new Map(data.units.map(u=>[u.id,u.name])),[data.units])
  const definitionMap=useMemo(()=>new Map(data.definitions.map(d=>[d.id,d])),[data.definitions])
  const visibleProperties=data.properties.filter(p=>p.active===(archiveView==='active'))
  const visibleDefinitions=data.definitions.filter(definition=>definition.active===(definitionView==='active')&&data.properties.find(property=>property.id===definition.propertyId)?.active)
  const monthlyCharges=chargesForMonth(data.activeCharges,selectedMonth)
  const visibleMonthlyCharges=filterMonthlyCharges(monthlyCharges,monthFilter)
  const monthlySummary=propertySummary(monthlyCharges)
  const yearSummary=propertySummary(data.activeCharges)
  const remainingYearCharges=data.activeCharges.filter(c=>c.status==='pending'&&c.dueDate>=`${monthKey(selectedMonth)}-01`)
  const remainingYearAmount=propertySummary(remainingYearCharges).pending
  const historyCharges=data.charges.filter(c=>(c.status==='paid'||c.status==='cancelled')&&(c.paidAt?.slice(0,7)??c.dueDate.slice(0,7))===monthKey(selectedMonth)).sort((a,b)=>(b.paidAt??b.dueDate).localeCompare(a.paidAt??a.dueDate))

  const chargeCard=(charge:PropertyCharge)=>{
    const definition=definitionMap.get(charge.definitionId)
    const overdue=isOverdue(charge)
    const status=charge.status==='pending'&&overdue?'Po terminie':chargeStatusLabels[charge.status]
    return <article key={charge.id} className="surface rounded-xl px-3 py-2.5 sm:flex sm:items-center sm:gap-4 sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3"><h3 className="truncate text-[13px] font-medium sm:text-sm">{definition?.name??'Opłata'}</h3><span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] ${charge.status==='paid'?'bg-brand-green/10 text-brand-green':overdue?'bg-red-400/10 text-red-300':charge.status==='cancelled'?'bg-white/5 text-brand-muted':'bg-brand-gold/10 text-brand-gold'}`}>{status}</span></div>
        <p className="mt-0.5 truncate text-[10px] text-brand-muted sm:text-xs">{propertyNames.get(charge.propertyId)}{charge.unitId?` · ${unitNames.get(charge.unitId)}`:''} · {dueFormatter.format(new Date(`${charge.dueDate}T12:00:00`))}</p>
        {charge.notes?<p className="mt-0.5 truncate text-[10px] text-brand-muted">{charge.notes}</p>:null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 sm:mt-0">
        <p className="text-sm font-semibold sm:text-base">{formatPropertyMoney(effectiveAmount(charge),charge.currency)}</p>
        {charge.status==='pending'?<div className="flex items-center gap-3 text-[11px]"><button onClick={()=>setPaying(charge)} className="min-h-10 text-brand-green">Oznacz jako zapłacone</button><button onClick={()=>void data.cancel(charge.id)} className="min-h-10 text-brand-muted">Anuluj</button></div>:charge.paidAt?<p className="text-[9px] text-brand-muted">{new Date(charge.paidAt).toLocaleDateString('pl-PL')}</p>:null}
      </div>
    </article>
  }

  return <div className="mx-auto max-w-[1500px] p-4 md:p-7">
    <header><div className="min-w-0"><p className="text-xs uppercase tracking-[.18em] text-brand-gold">{family.familyName}</p><h1 className="mt-1 text-2xl font-semibold md:text-3xl">Opłaty stałe</h1><p className="mt-1 hidden text-sm text-brand-muted sm:block">Miesięczne płatności i historia opłat.</p></div></header>
    <nav aria-label="Widoki opłat stałych" className="mt-4 grid grid-cols-4 gap-1 rounded-xl bg-white/[.025] p-1">{tabs.map(item=><button key={item.id} onClick={()=>setTab(item.id)} aria-pressed={tab===item.id} className="selection-control selection-tab">{item.label}</button>)}</nav>
    {data.error?<p role="alert" className="mt-4 rounded-xl border border-red-400/20 p-3 text-sm text-red-300">{data.error}</p>:null}
    {data.loading?<div className="mt-4 h-64 animate-pulse rounded-3xl bg-white/[.03]"/>:<>
      {tab==='overview'?<>
        <section className="mt-4 flex items-center justify-center gap-2" aria-label="Wybór miesiąca"><button onClick={()=>setSelectedMonth(value=>shiftMonth(value,-1))} aria-label="Poprzedni miesiąc" className="grid h-11 w-11 place-items-center"><ChevronLeft className="h-5 w-5"/></button><label className="relative min-w-44 cursor-pointer text-center"><strong className="capitalize">{monthFormatter.format(selectedMonth)}</strong><input aria-label="Wybierz miesiąc" type="month" value={monthKey(selectedMonth)} onChange={event=>{const[y,m]=event.target.value.split('-').map(Number);if(y&&m)setSelectedMonth(new Date(y,m-1,1))}} className="absolute inset-0 cursor-pointer opacity-0"/></label><button onClick={()=>setSelectedMonth(value=>shiftMonth(value,1))} aria-label="Następny miesiąc" className="grid h-11 w-11 place-items-center"><ChevronRight className="h-5 w-5"/></button></section>
        <section className="mt-3 grid grid-cols-3 gap-2">{[['Zapłacono',monthlySummary.paid,'green'],['Do zapłaty',monthlySummary.pending,'gold'],['Po terminie',monthlySummary.overdue,'red']].map(([label,value,tone])=><article key={String(label)} className="surface min-w-0 rounded-xl p-2.5 sm:p-4"><p className="truncate text-[9px] uppercase text-brand-muted sm:text-[10px]">{label}</p><p className={`mt-1 truncate text-xs font-semibold sm:text-xl ${tone==='red'?'text-red-300':tone==='green'?'text-brand-green':'text-brand-gold'}`}>{formatPropertyMoney(Number(value))}</p></article>)}</section>
        <section className="mt-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">Opłaty miesiąca</h2><div className="flex gap-1">{([{id:'all',label:'Wszystkie'},{id:'pending',label:'Do zapłaty'},{id:'paid',label:'Zapłacone'}] as Array<{id:MonthFilter;label:string}>).map(filter=><button key={filter.id} onClick={()=>setMonthFilter(filter.id)} aria-pressed={monthFilter===filter.id} className="selection-control selection-chip">{filter.label}</button>)}</div></div><div className="mt-2 space-y-1.5">{visibleMonthlyCharges.length?visibleMonthlyCharges.map(chargeCard):<p className="surface rounded-xl p-6 text-center text-xs text-brand-muted">Brak opłat dla wybranego filtra w tym miesiącu.</p>}</div></section>
        <section className="surface mt-4 rounded-xl p-3"><div className="flex items-center justify-between gap-3"><div><h2 className="text-xs font-semibold">Do końca {selectedMonth.getFullYear()}</h2><p className="mt-1 text-[10px] text-brand-muted">Pozostało: <span className="text-brand-gold">{formatPropertyMoney(remainingYearAmount)}</span> · zaplanowanych opłat: {remainingYearCharges.length}</p></div><button onClick={()=>{setYear(selectedMonth.getFullYear());setTab('year')}} className="min-h-10 shrink-0 text-[10px] text-brand-gold">Zobacz cały rok →</button></div></section>
      </>:null}
      {tab==='year'?<section className="mt-4"><div className="flex flex-wrap items-center justify-between gap-2"><select value={selectedProperty} onChange={event=>setSelectedProperty(event.target.value)} className="min-h-10 rounded-xl border border-white/10 bg-[#13131b] px-3 text-xs"><option value="all">Wszystkie grupy opłat</option>{data.properties.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="flex items-center gap-1"><button onClick={()=>setYear(value=>value-1)} aria-label="Poprzedni rok" className="grid h-11 w-11 place-items-center"><ChevronLeft/></button><strong>{year}</strong><button onClick={()=>setYear(value=>value+1)} aria-label="Następny rok" className="grid h-11 w-11 place-items-center"><ChevronRight/></button></div></div><div className="mt-3 grid grid-cols-3 gap-2">{[['Zapłacono w roku',yearSummary.paid,'green'],['Pozostało',yearSummary.pending,'gold'],['Po terminie',yearSummary.overdue,'red']].map(([label,value,tone])=><article key={String(label)} className="surface rounded-xl p-2.5"><p className="text-[9px] uppercase text-brand-muted">{label}</p><p className={`mt-1 truncate text-xs font-semibold sm:text-lg ${tone==='red'?'text-red-300':tone==='green'?'text-brand-green':'text-brand-gold'}`}>{formatPropertyMoney(Number(value))}</p></article>)}</div><div className="surface mt-3 overflow-x-auto rounded-xl"><table className="min-w-max border-collapse text-xs"><thead><tr><th className="sticky left-0 z-10 bg-[#15151d] p-3 text-left">Miesiąc</th>{data.definitions.filter(d=>d.active&&(selectedProperty==='all'||d.propertyId===selectedProperty)).map(d=><th key={d.id} className="max-w-32 p-3 text-left">{d.name}</th>)}</tr></thead><tbody>{months.map((month,index)=><tr key={month} className="border-t border-white/5"><th className="sticky left-0 bg-[#15151d] p-3 text-left">{month}</th>{data.definitions.filter(d=>d.active&&(selectedProperty==='all'||d.propertyId===selectedProperty)).map(definition=>{const charge=chargeForMonth(data.activeCharges,definition,year,index+1);return <td key={definition.id} className={`min-w-24 p-3 ${charge?.status==='paid'?'text-brand-green':charge&&isOverdue(charge)?'text-red-300':charge?'text-brand-gold':'text-brand-muted'}`}>{charge?<button onClick={()=>charge.status==='pending'&&setPaying(charge)} title={`${chargeStatusLabels[charge.status]} · ${charge.dueDate}`}>{formatPropertyMoney(effectiveAmount(charge),charge.currency)}</button>:'—'}</td>})}</tr>)}</tbody></table></div></section>:null}
      {tab==='history'?<section className="mt-4"><div className="flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">Historia operacji</h2><input aria-label="Miesiąc historii" type="month" value={monthKey(selectedMonth)} onChange={event=>{const[y,m]=event.target.value.split('-').map(Number);if(y&&m)setSelectedMonth(new Date(y,m-1,1))}} className="min-h-10 rounded-xl border border-white/10 bg-[#13131b] px-2 text-xs"/></div><div className="mt-2 space-y-1.5">{historyCharges.length?historyCharges.map(chargeCard):<p className="surface rounded-xl p-6 text-center text-xs text-brand-muted">Brak zapłaconych lub anulowanych opłat w tym miesiącu.</p>}</div></section>:null}
      {tab==='settings'?<section className="mt-4 grid gap-4 lg:grid-cols-2"><article className="surface rounded-xl p-3"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Grupy opłat</h2><button onClick={()=>setModal('property')} className="min-h-10 text-[11px] text-brand-gold"><Plus className="mr-1 inline h-4 w-4"/>Dodaj grupę</button></div><div className="mt-2 flex gap-1"><button onClick={()=>setArchiveView('active')} aria-pressed={archiveView==='active'} className="selection-control selection-chip">Aktywne</button><button onClick={()=>setArchiveView('archived')} aria-pressed={archiveView==='archived'} className="selection-control selection-chip">Zarchiwizowane</button></div>{visibleProperties.length?visibleProperties.map(property=><div key={property.id} className="mt-2 rounded-xl border border-white/5 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{property.name}</p><p className="truncate text-[10px] text-brand-muted">{property.address??'Bez adresu'}</p></div>{!property.active?<span className="rounded-full bg-white/5 px-2 py-1 text-[9px] text-brand-muted">Archiwalna</span>:null}</div><div className="mt-2 flex flex-wrap gap-4 text-[10px]"><button onClick={()=>{setEditing(property);setModal('property')}}>Edytuj</button>{property.active?<button onClick={()=>void data.archiveProperty(property.id)} className="text-brand-gold">Archiwizuj</button>:<button onClick={()=>void data.restoreProperty(property.id)} className="text-brand-green">Przywróć</button>}{canDelete?<button onClick={()=>setDeleting(property)} className="text-red-300">Usuń trwale</button>:null}</div></div>):<p className="mt-4 text-xs text-brand-muted">Brak grup opłat w tym widoku.</p>}</article><article className="surface rounded-xl p-3"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Opłaty cykliczne</h2>{data.properties.some(p=>p.active)?<button onClick={()=>{setEditingDefinition(null);setModal('definition')}} className="min-h-10 text-[11px] text-brand-gold"><Plus className="mr-1 inline h-4 w-4"/>Dodaj opłatę</button>:null}</div><div className="mt-2 flex gap-1"><button onClick={()=>setDefinitionView('active')} aria-pressed={definitionView==='active'} className="selection-control selection-chip">Aktywne</button><button onClick={()=>setDefinitionView('inactive')} aria-pressed={definitionView==='inactive'} className="selection-control selection-chip">Nieaktywne</button></div>{visibleDefinitions.length?visibleDefinitions.map(definition=><div key={definition.id} className="mt-2 rounded-xl border border-white/5 p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-medium">{definition.name}</p><p className="mt-0.5 text-[10px] text-brand-muted">{definition.active?`${chargeRecurrenceLabels[definition.recurrence]} · ${amountModeLabels[definition.amountMode]}`:'Nieaktywna'}</p><p className="text-[10px] text-brand-muted">{propertyNames.get(definition.propertyId)}</p></div></div><div className="mt-2 flex gap-4 text-[10px]"><button onClick={()=>{setEditingDefinition(definition);setModal('definition')}}>Edytuj</button><button onClick={()=>void data.setDefinitionActive(definition.id,!definition.active)} className={definition.active?'text-red-300':'text-brand-green'}>{definition.active?'Dezaktywuj':'Aktywuj'}</button></div></div>):<p className="mt-4 text-xs text-brand-muted">Brak {definitionView==='active'?'aktywnych':'nieaktywnych'} opłat.</p>}</article></section>:null}
    </>}
    {modal==='property'?<PropertyModal familyId={family.familyId} properties={data.properties.filter(p=>p.active)} mode="property" editing={editing} saving={data.saving} onProperty={data.createProperty} onUnit={data.createUnit} onClose={()=>{setModal(null);setEditing(null)}}/>:null}
    {modal==='definition'?<ChargeDefinitionModal familyId={family.familyId} properties={data.properties.filter(p=>p.active)} editing={editingDefinition} saving={data.saving} onSave={data.createDefinition} onUpdate={data.updateDefinition} onClose={()=>{setModal(null);setEditingDefinition(null)}}/>:null}
    {paying?<PayChargeModal familyId={family.familyId} charge={paying} defaultAmount={effectiveAmount(paying)} saving={data.saving} onSave={data.pay} onClose={()=>setPaying(null)}/>:null}
    {deleting?<DeletePropertyModal property={deleting} deleting={data.saving} onConfirm={async()=>{await data.deleteProperty(deleting.id);setDeleting(null)}} onClose={()=>setDeleting(null)}/>:null}
  </div>
}
