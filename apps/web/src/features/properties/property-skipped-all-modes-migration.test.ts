import{readFileSync}from'node:fs'
import{resolve}from'node:path'
import{describe,expect,it}from'vitest'

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8')
const sql=read('../../database/migrations/0027_allow_skipped_for_all_property_charges.sql')
const previousSql=read('../../database/migrations/0026_optional_property_charge_occurrences.sql')
const historicalSchema=read('../../database/migrations/0013_properties_and_charges.sql')
const exporter=read('../../database/migrations/0022_family_data_export.sql')
const detailsModal=read('src/features/properties/components/ChargeDetailsModal.tsx')
const definitionModal=read('src/features/properties/components/ChargeDefinitionModal.tsx')
const view=read('src/features/properties/components/PropertiesView.tsx')
const restoreSql=previousSql.slice(previousSql.indexOf('create or replace function private.validate_family_restore'))
type AmountMode='fixed'|'variable'|'optional'
type Status='pending'|'paid'|'cancelled'|'skipped'
const canUpdate=(current:Status,next:Status)=>current==='skipped'?next==='skipped'||next==='pending':next!=='skipped'||current==='pending'
const canPay=(status:Status)=>!(['cancelled','skipped']as Status[]).includes(status)
const canCancel=(status:Status)=>!(['paid','skipped']as Status[]).includes(status)
const canSkip=(amountMode:AmountMode)=>(['fixed','variable','optional']as AmountMode[]).includes(amountMode)

describe('0027 skipped for every property charge type',()=>{
 it.each<AmountMode>(['fixed','variable','optional'])('allows a pending %s charge to become skipped',mode=>{expect(canSkip(mode)).toBe(true);expect(canUpdate('pending','skipped')).toBe(true)})
 it('removes only the amount-mode restriction from the replacement RPC',()=>{expect(previousSql).toContain("definition_row.amount_mode <> 'optional'");expect(sql).not.toContain("definition_row.amount_mode <> 'optional'");expect(sql).not.toContain('only optional charges can be skipped')})
 it('keeps skipped transitions limited to skipped and pending',()=>{expect(canUpdate('skipped','skipped')).toBe(true);expect(canUpdate('skipped','pending')).toBe(true);expect(canUpdate('skipped','paid')).toBe(false);expect(canUpdate('skipped','cancelled')).toBe(false);expect(sql).toContain("charge_row.status = 'skipped' and next_status not in ('skipped','pending')")})
 it('rejects paid to skipped before budget cleanup can run',()=>{expect(canUpdate('paid','skipped')).toBe(false);expect(sql).toContain("next_status = 'skipped' and charge_row.status not in ('pending','skipped')");expect(sql).toContain("raise exception 'only pending charges can be skipped'")})
 it('rejects cancelled to skipped',()=>{expect(canUpdate('cancelled','skipped')).toBe(false);expect(sql).toContain("next_status = 'skipped' and charge_row.status not in ('pending','skipped')")})
 it('keeps pay and cancel RPCs blocking skipped',()=>{expect(canPay('skipped')).toBe(false);expect(canCancel('skipped')).toBe(false);expect(previousSql).toContain("c.status in ('cancelled','skipped')");expect(previousSql).toContain("c.status in ('paid','skipped')")})
 it('allows payment and cancellation after restoring skipped to pending',()=>{let status:Status='skipped';status='pending';expect(canPay(status)).toBe(true);expect(canCancel(status)).toBe(true)})
 it('keeps payment, budget and reminder fields empty when skipped',()=>{expect(sql).toMatch(/set planned_amount=next_planned_amount,status=next_status,actual_amount=null,paid_at=null,notes=normalized_notes,budget_transaction_id=null/);expect(sql).toContain('delete from public.budget_transactions where id=transaction_id and family_id=charge_row.family_id');expect(sql).toMatch(/else\s+update public\.reminders set status='cancelled'/)})
 it('resynchronizes reminders when restored to pending',()=>{expect(sql).toContain("if next_status = 'pending' then");expect(sql).toContain('private.resync_property_charge_reminders(charge_row.id)')})
 it('preserves authorization, family locking and RPC grants',()=>{expect(sql).toContain('private.can_manage_properties(target_family_id)');expect(sql).toContain('where id = target_charge_id and family_id = target_family_id for update');expect(sql).toContain("security definer set search_path = ''");expect(sql).toContain('revoke all on function public.update_property_charge(uuid,uuid,numeric,text,numeric,timestamptz,text,boolean) from public,anon,authenticated');expect(sql).toContain('grant execute on function public.update_property_charge(uuid,uuid,numeric,text,numeric,timestamptz,text,boolean) to authenticated')})
 it('keeps fixed amounts required and positive',()=>{expect(historicalSchema).toContain("(amount_mode='fixed' and planned_amount is not null)");expect(historicalSchema).toContain('planned_amount is null or planned_amount > 0');expect(definitionModal).toContain("required={amountMode==='fixed'}");expect(definitionModal).toContain("min={amountMode==='fixed'?'0.01':undefined}")})
 it('keeps variable and optional planned amounts nullable',()=>{expect(historicalSchema).toContain("amount_mode in ('variable','optional')");expect(definitionModal).toContain("amountMode==='optional'");expect(definitionModal).toContain("amountMode==='variable'");expect(definitionModal).toContain('Kwotę planowaną możesz zostawić pustą.');expect(definitionModal).not.toContain('Jeśli opłata nie wystąpi w danym miesiącu')})
 it.each<AmountMode>(['fixed','variable','optional'])('shows Nie wystąpiła for pending %s charges',mode=>{expect(canSkip(mode)).toBe(true);expect(detailsModal).toContain("const canSkip=charge.status==='pending'");expect(detailsModal).toContain('Nie wystąpiła');expect(view).not.toContain("canSkip={definitionMap.get(selectedCharge.definitionId)?.amountMode==='optional'}")})
 it('keeps existing skipped UI limited to skipped and pending',()=>{expect(detailsModal).toContain("charge.status==='skipped'?<option value=\"skipped\">Nie wystąpiła</option>");expect(detailsModal).toContain('<option value="pending">Oczekująca</option>');expect(detailsModal).toContain('Przywróć do zapłaty')})
 it('keeps summaries from counting skipped as paid, pending or overdue',()=>{expect(view).toContain("charge.status==='skipped'?'—'");expect(view).toContain("c.status==='paid'||c.status==='cancelled'||c.status==='skipped'");expect(view).toContain("charge.status==='cancelled'||charge.status==='skipped'")})
 it('keeps backup export and restore compatible with skipped across amount modes',()=>{expect(exporter).toContain('c.currency,c.status');expect(restoreSql).toContain("status' not in ('pending','paid','cancelled','skipped')");expect(restoreSql).toContain("status'='skipped' and item->>'budgetTransactionId' is not null");expect(restoreSql).not.toMatch(/status'='skipped'[\s\S]{0,200}amountMode/)})
 it('reloads the PostgREST schema without changing pay or cancel RPCs',()=>{expect(sql).toContain("notify pgrst, 'reload schema'");expect(sql).not.toContain('create or replace function public.pay_property_charge');expect(sql).not.toContain('create or replace function public.cancel_property_charge')})
})
