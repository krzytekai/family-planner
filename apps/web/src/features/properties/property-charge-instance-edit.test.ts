import{readFileSync}from'node:fs'
import{resolve}from'node:path'
import{describe,expect,it}from'vitest'

const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8')
const sql=read('../../database/migrations/0021_update_property_charge_instance.sql')
const historical=read('../../database/migrations/0013_properties_and_charges.sql')
const repository=read('src/features/properties/api/property-repository.ts')
const hook=read('src/features/properties/hooks/useProperties.ts')
const view=read('src/features/properties/components/PropertiesView.tsx')
const modal=read('src/features/properties/components/ChargeDetailsModal.tsx')

describe('generated property charge instance editing',()=>{
 it('opens details from a charge and shows the complete note without entering edit mode',()=>{expect(view).toContain('setSelectedChargeId(charge.id)');for(const label of ['Szczegóły opłaty','Grupa opłat','Termin','Status','Planowana kwota','Faktyczna kwota','Data zapłaty','Notatka','Brak notatki'])expect(modal).toContain(label);expect(modal).toContain('whitespace-pre-wrap');expect(modal).toContain('charge.notes?.trim()')})
 it('uses one repository and hook mutation backed by a narrow RPC',()=>{expect(repository).toContain("rpc('update_property_charge'");expect(hook).toContain('updateCharge:(i:ChargeUpdateInput)=>mutate(()=>repo.updateCharge(i))');expect(sql).toContain('security definer');expect(sql).toContain("set search_path = ''")})
 it('edits only the generated occurrence, never its recurring definition or future charges',()=>{expect(sql).toContain('update public.property_charges');expect(sql).not.toContain('update public.property_charge_definitions');expect(sql).not.toContain('update public.property_charge_schedule_dates');expect(sql).not.toContain('public.ensure_property_charges(')})
 it('supports all requested status transitions and keeps the paid shape valid',()=>{for(const status of ['pending','paid','cancelled'])expect(modal).toContain(`<option value="${status}">`);expect(sql).toContain("next_status = 'paid'");expect(sql).toContain("next_status <> 'paid'");expect(sql).toMatch(/status=next_status,actual_amount=null,paid_at=null/);expect(historical).toContain('property_charges_paid_shape_check')})
 it('defaults a new payment to the occurrence amount and local now, then stores UTC',()=>{expect(modal).toContain("setActual((charge.plannedAmountCents/100).toFixed(2))");expect(modal).toContain('formatDateTimeLocal(new Date())');expect(modal).toContain('parseDateTimeLocal(paidAt).toISOString()')})
 it('allows adding changing and clearing notes',()=>{expect(modal).toContain('<textarea value={notes}');expect(sql).toContain("normalized_notes := nullif(pg_catalog.btrim(next_notes),'')");expect(sql).toContain('notes=normalized_notes')})
 it('blocks cross-family updates under the existing active-adult permission model',()=>{expect(sql).toContain('private.can_manage_properties(target_family_id)');expect(sql).toContain('where id = target_charge_id and family_id = target_family_id for update');expect(sql).toContain('where id = charge_row.charge_definition_id and family_id = charge_row.family_id')})
 it('updates or creates a linked budget expense atomically when paid',()=>{expect(sql).toContain('insert into public.budget_transactions');expect(sql).toContain('update public.budget_transactions');expect(sql).toContain("definition_row.budget_sync_mode = 'automatic' or sync_budget");expect(sql).toContain('amount=next_actual_amount');expect(sql).toContain('transaction_date=next_paid_at::date')})
 it('removes the linked budget expense before returning to pending or cancelled',()=>{expect(sql).toContain('budget_transaction_id=null');expect(sql).toContain('delete from public.budget_transactions');expect(sql).toContain("if next_status = 'pending' then")})
 it('resynchronizes future reminders when paid or cancelled returns to pending',()=>{expect(sql).toContain('private.resync_property_charge_reminders(charge_row.id)');expect(sql).toContain("charge_row.status<>'pending'");expect(sql).toContain("reminder_time>pg_catalog.now()")})
 it('reactivates matching cancelled reminders using current rule timing',()=>{expect(sql).toContain("r.status='cancelled'");expect(sql).toContain("set title='Opłata: '||definition_row.name,remind_at=reminder_time");expect(sql).toContain("timezone=definition_row.recurrence_timezone,status='pending'")})
 it('does not reactivate expired or removed reminder rules',()=>{expect(sql).toContain('for rule_row in');expect(sql).toContain('where r.definition_id=definition_row.id and r.family_id=charge_row.family_id');expect(sql).toMatch(/update public\.reminders[\s\S]*status='cancelled'[\s\S]*for rule_row in/);expect(sql).not.toMatch(/reminder_time\s*<=\s*pg_catalog\.now\(\)[\s\S]*status='pending'/)})
 it('creates newly configured reminder rules without duplicate pending reminders',()=>{expect(sql).toContain('insert into public.reminders');expect(sql).toContain('on conflict do nothing');expect(historical).toContain('reminders_one_pending_property_offset_unique')})
 it('keeps repeated pending to pending updates idempotent',()=>{expect(sql).toContain("and status='pending'");expect(sql).toContain("and r.status='cancelled'");expect(sql).toContain('limit 1 for update')})
 it('keeps the reminder helper private with no client schema access',()=>{expect(sql).toContain("security definer set search_path = ''");expect(sql).toContain('revoke all on function private.resync_property_charge_reminders(uuid) from public,anon,authenticated');expect(sql).not.toMatch(/grant[^;]*private\.resync_property_charge_reminders/i)})
 it('audits status and amount edits while retaining existing pay and cancel RPCs',()=>{for(const action of ['property.charge.paid','property.charge.cancelled','property.charge.updated','property.charge.budget_linked'])expect(sql).toContain(action);expect(repository).toContain("rpc('pay_property_charge'");expect(repository).toContain("rpc('cancel_property_charge'")})
 it('does not grant direct charge writes to authenticated',()=>{expect(sql).not.toMatch(/grant\s+update[^;]*property_charges/i);expect(sql).toContain('grant execute on function public.update_property_charge')})
})
