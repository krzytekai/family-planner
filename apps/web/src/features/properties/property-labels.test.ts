import{describe,expect,it}from'vitest';import{amountModeLabels,chargeCategoryLabels,chargeRecurrenceLabels,chargeStatusLabels,propertyUnitTypeLabels}from'./property-labels'
describe('property Polish labels',()=>{
 it('translates every charge category',()=>expect(chargeCategoryLabels).toEqual({rent:'Czynsz',electricity:'Prąd',gas:'Gaz',water:'Woda',internet:'Internet',tax:'Podatek',insurance:'Ubezpieczenie',parking:'Parking',service:'Usługa',other:'Inne'}))
 it('translates every recurrence and amount mode',()=>{expect(Object.values(chargeRecurrenceLabels)).toEqual(['Jednorazowo','Co miesiąc','Co X miesięcy','Co roku','Wybrane daty']);expect(Object.values(amountModeLabels)).toEqual(['Stała','Zmienna','Opcjonalna'])})
 it('translates statuses and unit types',()=>{expect(Object.values(chargeStatusLabels)).toEqual(['Oczekuje','Zapłacone','Anulowane']);expect(Object.values(propertyUnitTypeLabels)).toEqual(['Mieszkanie','Garaż','Miejsce postojowe','Lokal użytkowy','Działka','Inne'])})
})
