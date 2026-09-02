import{readFileSync}from'node:fs'
import{resolve}from'node:path'
import{describe,expect,it}from'vitest'

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8')
const view=read('src/features/properties/components/PropertiesView.tsx')
const definition=read('src/features/properties/components/ChargeDefinitionModal.tsx')
const labels=read('src/features/properties/property-labels.ts')
const pay=read('src/features/properties/components/PayChargeModal.tsx')
const app=read('src/app/App.tsx')
const mobile=read('src/components/MobileNav.tsx')
const primaryTabs=view.slice(view.indexOf('const tabs:'),view.indexOf('const months='))

describe('properties month-first UI contract',()=>{
  it('contains exactly four primary module tabs',()=>{for(const label of ['Przegląd','Rok','Historia','Ustawienia'])expect(primaryTabs).toContain(`label:'${label}'`);for(const label of ['Pulpit','Opłaty','Do zapłaty','Tabela roku'])expect(primaryTabs).not.toContain(`label:'${label}'`)})
  it('uses overview and the current month as defaults',()=>{expect(view).toContain("useState<PropertiesTab>('overview')");expect(view).toContain('new Date(now.getFullYear(),now.getMonth(),1)')})
  it('supports previous next and direct month selection',()=>{expect(view).toContain('shiftMonth(value,-1)');expect(view).toContain('shiftMonth(value,1)');expect(view).toContain('type="month"');expect(view).toContain('Wybierz miesiąc')})
  it('summarizes and filters only selected-month charges',()=>{expect(view).toContain('chargesForMonth(data.activeCharges,selectedMonth)');expect(view).toContain('propertySummary(monthlyCharges)');expect(view).toContain('filterMonthlyCharges(monthlyCharges,monthFilter)');for(const label of ['Wszystkie','Do zapłaty','Zapłacone'])expect(view).toContain(label)})
  it('keeps annual information secondary and links to the year view',()=>{expect(view).toContain('Do końca {selectedMonth.getFullYear()}');expect(view).toContain('Zobacz cały rok →');expect(view).toContain("setTab('year')")})
  it('provides annual totals and the existing scrollable status table',()=>{for(const label of ['Zapłacono w roku','Pozostało','Po terminie'])expect(view).toContain(label);expect(view).toContain('overflow-x-auto');expect(view).toContain('sticky left-0');expect(view).toContain('chargeForMonth')})
  it('shows history as paid or cancelled operations for a chosen month',()=>{expect(view).toContain("c.status==='paid'||c.status==='cancelled'");expect(view).toContain("c.paidAt?.slice(0,7)??c.dueDate.slice(0,7)");expect(view).toContain('Miesiąc historii');expect(view).toContain('Historia operacji')})
  it('keeps add-property in settings instead of every module view',()=>{expect(view.match(/Dodaj nieruchomość/g)).toHaveLength(1);expect(view).toMatch(/tab==='settings'[\s\S]*Dodaj nieruchomość/)})
  it('does not expose property parts in the primary UI',()=>{expect(view).not.toContain("setModal('unit')");expect(view).not.toContain('Nieruchomości i części');expect(definition).not.toContain('Część (opcjonalnie)');expect(definition).toContain('unitId:null')})
  it('uses four equal columns without horizontal module navigation scrolling',()=>{expect(view).toContain('grid grid-cols-4');const navigation=view.slice(view.indexOf('<nav'),view.indexOf('</nav>'));expect(navigation).not.toContain('overflow-x-auto')})
  it('retains all payment amount and recurrence semantics',()=>{for(const value of ['fixed','variable','optional','one_time','monthly','interval_months','yearly','selected_dates'])expect(definition+labels).toContain(value);for(const label of ['Kwota','Data płatności','Notatka','Dodaj do Budżetu'])expect(pay).toContain(label)})
  it('retains reminders, budget sync and property lifecycle controls',()=>{for(const label of ['7 dni przed','2 dni przed','w dniu','dzień po','Automatycznie dodawaj'])expect(definition).toContain(label);for(const label of ['Archiwizuj','Przywróć','Usuń trwale'])expect(view).toContain(label)})
  it('keeps child out and reloads on active-family changes',()=>{expect(app).toContain("activeView === 'properties' && canProperties");expect(mobile).toContain("item('properties','Opłaty stałe',ReceiptText,canProperties)");expect(app).toContain('<PropertiesView key={family.familyId} family={family}/>')})
  it('limits permanent delete UI to owner/admin and confirms destructive deletion',()=>{expect(view).toContain("family.role==='owner'||family.role==='admin'");expect(read('src/features/properties/components/DeletePropertyModal.tsx')).toContain('Usunięcie jest nieodwracalne')})
})
