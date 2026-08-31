import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql=readFileSync(resolve(process.cwd(),'../../database/migrations/0015_notification_center_lifecycle.sql'),'utf8')
const repository=readFileSync(resolve(process.cwd(),'src/features/notifications/api/notification-repository.ts'),'utf8')
const app=readFileSync(resolve(process.cwd(),'src/app/App.tsx'),'utf8')
const center=readFileSync(resolve(process.cwd(),'src/features/notifications/components/NotificationCenter.tsx'),'utf8')
const swipe=readFileSync(resolve(process.cwd(),'src/features/notifications/components/SwipeableNotificationItem.tsx'),'utf8')
const fcm=readFileSync(resolve(process.cwd(),'../../database/migrations/0009_fcm_push_delivery.sql'),'utf8')

describe('0015 notification center lifecycle',()=>{
  it('adds persistent soft dismissal without deleting canonical notifications',()=>{expect(sql).toContain('add column dismissed_at timestamptz');expect(sql).not.toContain('delete from public.notifications')})
  it('persists unread to read and read to unread through narrow RPCs',()=>{expect(sql).toContain('public.mark_notification_read');expect(sql).toContain('set read_at=coalesce(read_at,pg_catalog.now())');expect(sql).toContain('public.mark_notification_unread');expect(sql).toContain('set read_at=null');expect(repository).toContain("read ? 'mark_notification_read' : 'mark_notification_unread'")})
  it('fixes the UI read toggle direction',()=>expect(app).toContain('item.readAt === null'))
  it('dismisses one notification or only read notifications',()=>{expect(sql).toContain('public.dismiss_notification');expect(sql).toMatch(/dismiss_read_notifications[\s\S]*read_at is not null and dismissed_at is null/);expect(sql).not.toMatch(/dismiss_read_notifications[\s\S]*read_at is null and dismissed_at is null/)})
  it('isolates mutations by authenticated recipient and family membership',()=>{expect(sql.match(/recipient_user_id=current_user_id/g)?.length).toBeGreaterThanOrEqual(5);expect(sql.match(/public\.is_family_member\(target_family_id\)/g)?.length).toBe(5);expect(sql).toContain('family_id=target_family_id')})
  it('denies anon and removes direct notification updates',()=>{for(const signature of ['mark_notification_read(uuid,uuid)','mark_notification_unread(uuid,uuid)','mark_all_notifications_read(uuid)','dismiss_notification(uuid,uuid)','dismiss_read_notifications(uuid)'])expect(sql).toContain(`revoke all on function public.${signature} from public,anon`);expect(sql).toContain('revoke update(read_at) on public.notifications from authenticated')})
  it('keeps dismissed rows outside normal reads and badge reloads',()=>{expect(sql).toMatch(/notifications_select_own[\s\S]*dismissed_at is null/);expect(repository).toContain(".is('dismissed_at', null)");expect(repository).toContain('.limit(100)')})
  it('does not touch sources or push delivery history',()=>{for(const table of ['public.tasks','public.calendar_events','public.property_charges','private.notification_push_deliveries'])expect(sql).not.toContain(`delete from ${table}`);expect(fcm).toContain('private.notification_push_deliveries')})
})

describe('notification center interaction regression',()=>{
  it('provides desktop delete and guarded mobile swipe',()=>{expect(swipe).toContain('sm:hidden');expect(swipe).toContain('hidden h-9 w-9');expect(swipe).toContain('swipeThreshold = 56');expect(swipe).toContain('touch-pan-y')})
  it('provides confirmed remove-read action',()=>{expect(center).toContain('Usuń przeczytane');expect(center).toContain('alertdialog');expect(center).toContain('onDismissRead')})
  it('keeps task calendar and property routing intact',()=>{expect(app).toContain('notificationDestination(item)');expect(fcm).toContain('notification_id uuid not null references public.notifications')})
  it('filters stale notifications synchronously when the active family changes',()=>expect(readFileSync(resolve(process.cwd(),'src/features/notifications/hooks/useNotifications.ts'),'utf8')).toContain('notifications.filter(item=>item.familyId===familyId)'))
})
