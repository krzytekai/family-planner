import{describe,expect,it}from'vitest';import{canAccessProperties,chargeForMonth,effectiveAmount,isOverdue,propertySummary,sortDueCharges}from'./property-utils';import type{ChargeDefinition,PropertyCharge}from'./types'
const charge=(o:Partial<PropertyCharge>={}):PropertyCharge=>({id:'c1',familyId:'f1',propertyId:'p1',unitId:null,definitionId:'d1',dueDate:'2026-08-15',plannedAmountCents:10000,actualAmountCents:null,currency:'PLN',status:'pending',paidAt:null,notes:null,budgetTransactionId:null,...o});const definition={id:'d1'}as ChargeDefinition
describe('property charge logic',()=>{
 it('calculates overdue without persisting another status',()=>{expect(isOverdue(charge(), '2026-08-16')).toBe(true);expect(isOverdue(charge({status:'paid'}),'2026-08-16')).toBe(false)})
 it('uses actual amount before planned amount',()=>expect(effectiveAmount(charge({actualAmountCents:12345}))).toBe(12345))
 it('sorts overdue before upcoming charges',()=>expect(sortDueCharges([charge({id:'future',dueDate:'2026-08-20'}),charge({id:'late',dueDate:'2026-08-10'})],'2026-08-15').map(x=>x.id)).toEqual(['late','future']))
 it('summarizes paid, pending and overdue amounts',()=>expect(propertySummary([charge({status:'paid',actualAmountCents:9000,paidAt:'2026-08-01'}),charge({id:'late',dueDate:'2020-01-01'})])).toEqual({paid:9000,pending:10000,overdue:10000}))
 it('finds irregular occurrences only in their actual month',()=>{expect(chargeForMonth([charge()],definition,2026,8)?.id).toBe('c1');expect(chargeForMonth([charge()],definition,2026,9)).toBeNull()})
 it.each([['owner',true],['admin',true],['adult',true],['child',false]])('enforces %s module access',(role,allowed)=>expect(canAccessProperties(role)).toBe(allowed))
})
