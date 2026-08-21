import type{AmountMode,ChargeCategory,ChargeRecurrence,ChargeStatus,PropertyUnitType}from'./types'

export const propertyUnitTypeLabels:Record<PropertyUnitType,string>={apartment:'Mieszkanie',garage:'Garaż',parking:'Miejsce postojowe',commercial:'Lokal użytkowy',land:'Działka',other:'Inne'}
export const chargeCategoryLabels:Record<ChargeCategory,string>={rent:'Czynsz',electricity:'Prąd',gas:'Gaz',water:'Woda',internet:'Internet',tax:'Podatek',insurance:'Ubezpieczenie',parking:'Parking',service:'Usługa',other:'Inne'}
export const amountModeLabels:Record<AmountMode,string>={fixed:'Stała',variable:'Zmienna',optional:'Opcjonalna'}
export const chargeRecurrenceLabels:Record<ChargeRecurrence,string>={one_time:'Jednorazowo',monthly:'Co miesiąc',interval_months:'Co X miesięcy',yearly:'Co roku',selected_dates:'Wybrane daty'}
export const chargeStatusLabels:Record<ChargeStatus,string>={pending:'Oczekuje',paid:'Zapłacone',cancelled:'Anulowane'}

export const entries=<T extends string>(labels:Record<T,string>)=>Object.entries(labels)as Array<[T,string]>
