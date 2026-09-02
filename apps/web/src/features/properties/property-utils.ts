import type{ChargeDefinition,PropertyCharge}from'./types'
export const isOverdue=(charge:Pick<PropertyCharge,'status'|'dueDate'>,today=new Date().toISOString().slice(0,10))=>charge.status==='pending'&&charge.dueDate<today
export const effectiveAmount=(charge:PropertyCharge)=>charge.actualAmountCents??charge.plannedAmountCents
export const formatPropertyMoney=(cents:number|null,currency='PLN')=>cents===null?'—':new Intl.NumberFormat('pl-PL',{style:'currency',currency}).format(cents/100)
export function sortDueCharges(charges:PropertyCharge[],today=new Date().toISOString().slice(0,10)){return charges.filter(c=>c.status==='pending').sort((a,b)=>Number(isOverdue(b,today))-Number(isOverdue(a,today))||a.dueDate.localeCompare(b.dueDate))}
export function propertySummary(charges:PropertyCharge[]){return charges.reduce((r,c)=>{const amount=effectiveAmount(c)??0;if(c.status==='paid')r.paid+=amount;else if(c.status==='pending'){r.pending+=amount;if(isOverdue(c))r.overdue+=amount}return r},{paid:0,pending:0,overdue:0})}
export const monthKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`
export const chargesForMonth=(charges:PropertyCharge[],date:Date)=>charges.filter(charge=>charge.dueDate.startsWith(`${monthKey(date)}-`))
export const filterMonthlyCharges=(charges:PropertyCharge[],filter:'all'|'pending'|'paid')=>filter==='all'?charges:charges.filter(charge=>charge.status===filter)
export const shiftMonth=(date:Date,amount:number)=>new Date(date.getFullYear(),date.getMonth()+amount,1)
export function chargeForMonth(charges:PropertyCharge[],definition:ChargeDefinition,year:number,month:number){return charges.find(c=>c.definitionId===definition.id&&c.dueDate.startsWith(`${year}-${String(month).padStart(2,'0')}-`))??null}
export const canAccessProperties=(role:string)=>role==='owner'||role==='admin'||role==='adult'
