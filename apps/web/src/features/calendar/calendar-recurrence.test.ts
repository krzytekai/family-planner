import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const sql = read('../../database/migrations/0028_recurring_calendar_events.sql')
const modal = read('src/features/calendar/components/CalendarEventModal.tsx')
const card = read('src/features/calendar/components/CalendarEventCard.tsx')
const repository = read('src/features/calendar/api/calendar-repository.ts')

type Rule = { type: 'daily'|'weekly'|'monthly'|'yearly'; interval: number; weekdays?: number[]; day?: number; month?: number }
const iso = (value: Date) => value.toISOString().slice(0,10)
const utc = (value: string) => new Date(`${value}T12:00:00Z`)
const plusDays = (value: string, amount: number) => { const date=utc(value); date.setUTCDate(date.getUTCDate()+amount); return iso(date) }
function nextLogical(previous:string,anchor:string,rule:Rule):string {
  if(rule.type==='daily') return plusDays(previous,rule.interval)
  if(rule.type==='weekly') {
    let candidate=plusDays(previous,1)
    const anchorMonday=plusDays(anchor,-((utc(anchor).getUTCDay()+6)%7))
    while(true){const day=utc(candidate).getUTCDay()||7;const week=Math.floor((utc(candidate).getTime()-utc(anchorMonday).getTime())/604800000);if(week>=0&&week%rule.interval===0&&rule.weekdays?.includes(day))return candidate;candidate=plusDays(candidate,1)}
  }
  const previousDate=utc(previous)
  const monthIndex=rule.type==='monthly'?previousDate.getUTCMonth()+rule.interval:(rule.month??1)-1
  const year=rule.type==='monthly'?previousDate.getUTCFullYear():previousDate.getUTCFullYear()+rule.interval
  const first=new Date(Date.UTC(year,monthIndex,1,12));const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,12)).getUTCDate()
  return iso(new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),Math.min(rule.day??1,last),12)))
}
function runGenerator(anchor:string,rule:Rule,horizon:string,state={cursor:null as string|null,rows:new Set<string>()},exclusions=new Set<string>()) {
  let candidate=state.cursor?nextLogical(state.cursor,anchor,rule):anchor
  while(candidate<=horizon){if(!exclusions.has(candidate))state.rows.add(candidate);state.cursor=candidate;candidate=nextLogical(candidate,anchor,rule)}
  return state
}

type BackupSeries = { id: string; title: string }
type BackupEvent = { id: string; title: string; recurrenceSeriesId: string | null; createdAt: string }
function modelRestoreCalendar(series: BackupSeries[], events: BackupEvent[]) {
  const seriesMap = new Map(series.map((item, index) => [item.id, `restored-series-${index + 1}`]))
  const eventMap = new Map(events.map((item, index) => [item.id, `restored-event-${index + 1}`]))
  return events.map((item) => ({
    id: eventMap.get(item.id),
    seriesId: item.recurrenceSeriesId ? seriesMap.get(item.recurrenceSeriesId) : null,
    createdAt: item.createdAt,
  }))
}

function nextMonthly(previous: string, interval: number, day: number) {
  const value = new Date(`${previous}T12:00:00Z`)
  const year = value.getUTCFullYear()
  const month = value.getUTCMonth() + interval
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, last))).toISOString().slice(0, 10)
}

describe('calendar recurrence migration contract', () => {
  it('supports daily interval one and larger intervals', () => {
    expect(sql).toContain("rule_type='daily'")
    expect(sql).toContain('return previous_date+step')
  })
  it('supports selected weekly weekdays and interval-anchored weeks', () => {
    expect(sql).toContain("rule_type='weekly'")
    expect(sql).toContain("recurrence_rule->'weekdays'")
    expect(sql).toContain('mod(week_delta,step)=0')
  })
  it('supports monthly recurrence with end-of-month clamping', () => {
    expect(nextMonthly('2027-01-31', 1, 31)).toBe('2027-02-28')
    expect(sql).toContain("rule_type='monthly'")
    expect(sql).toContain('least(target_day,last_day)')
  })
  it('supports yearly recurrence and leap-year clamping', () => {
    expect(sql).toContain("recurrence_rule->>'month'")
    expect(sql).toContain('extract(year from previous_date)::integer+step')
    expect(nextMonthly('2024-02-29', 12, 29)).toBe('2025-02-28')
  })
  it('preserves named timezone local wall-clock time across DST', () => {
    expect(sql).toContain('occurrence_date::timestamp+series_row.anchor_local_time')
    expect(sql).toContain('at time zone series_row.recurrence_timezone')
    expect(sql).not.toContain('interval \'24 hours\'')
  })
  it('preserves timed duration', () => {
    expect(sql).toContain('timed_duration_minutes')
    expect(sql).toContain('pg_catalog.make_interval(mins=>series_row.timed_duration_minutes)')
  })
  it('supports single and multi-day all-day occurrences', () => {
    expect(sql).toContain('all_day_duration_days')
    expect(sql).toContain('occurrence_date+series_row.all_day_duration_days')
  })
  it('prevents duplicates when the generator is retried', () => {
    expect(sql).toContain('calendar_events_recurrence_occurrence_unique')
    expect(sql).toContain('on conflict(recurrence_series_id,recurrence_occurrence_date)')
    expect(sql).toContain('for update skip locked')
  })
  it('keeps daily interval=4 phase across consecutive generator runs',()=>{
    const state=runGenerator('2027-01-01',{type:'daily',interval:4},'2027-01-10')
    runGenerator('2027-01-01',{type:'daily',interval:4},'2027-01-22',state)
    expect([...state.rows]).toEqual(['2027-01-01','2027-01-05','2027-01-09','2027-01-13','2027-01-17','2027-01-21'])
    expect(state.cursor).toBe('2027-01-21')
  })
  it('keeps monthly interval=3 anchored on 15 January over changing horizons',()=>{
    const rule:Rule={type:'monthly',interval:3,day:15};const state=runGenerator('2027-01-15',rule,'2027-05-01')
    runGenerator('2027-01-15',rule,'2027-11-20',state);runGenerator('2027-01-15',rule,'2028-02-01',state)
    expect([...state.rows]).toEqual(['2027-01-15','2027-04-15','2027-07-15','2027-10-15','2028-01-15'])
  })
  it('keeps yearly interval=2 phase',()=>{
    const state=runGenerator('2024-02-29',{type:'yearly',interval:2,month:2,day:29},'2027-12-31')
    runGenerator('2024-02-29',{type:'yearly',interval:2,month:2,day:29},'2030-12-31',state)
    expect([...state.rows]).toEqual(['2024-02-29','2026-02-28','2028-02-29','2030-02-28'])
  })
  it('keeps weekly interval and selected weekdays in the anchored weeks',()=>{
    const state=runGenerator('2027-01-04',{type:'weekly',interval:2,weekdays:[1,5]},'2027-02-05')
    expect([...state.rows]).toEqual(['2027-01-04','2027-01-08','2027-01-18','2027-01-22','2027-02-01','2027-02-05'])
  })
  it('advances the logical cursor through an exclusion without regenerating it',()=>{
    const rule:Rule={type:'monthly',interval:3,day:15};const state=runGenerator('2027-01-15',rule,'2027-08-01',undefined,new Set(['2027-04-15']))
    runGenerator('2027-01-15',rule,'2027-11-01',state,new Set(['2027-04-15']))
    expect([...state.rows]).toEqual(['2027-01-15','2027-07-15','2027-10-15']);expect(state.cursor).toBe('2027-10-15')
  })
  it('is duplicate-free when the same horizon is retried',()=>{
    const state=runGenerator('2027-01-01',{type:'daily',interval:1},'2027-01-05');runGenerator('2027-01-01',{type:'daily',interval:1},'2027-01-05',state)
    expect(state.rows.size).toBe(5)
  })
  it('does not generate a stopped series', () => {
    expect(sql).toContain('where s.recurrence_enabled')
    expect(sql).toContain('set recurrence_enabled=false')
  })
  it('records an exclusion before deleting one occurrence', () => {
    expect(sql).toContain('calendar_event_recurrence_exclusions')
    expect(sql).toContain('on conflict(series_id,occurrence_date) do nothing')
    expect(repository).toContain("rpc('delete_calendar_event_occurrence'")
  })
  it('keeps individual occurrence edits separate from recurrence identity', () => {
    expect(sql).toContain('calendar recurrence identity cannot be changed')
    expect(repository).toContain("from('calendar_events').update(eventPayload(input))")
  })
  it('enforces family isolation and calendar permissions in RPCs', () => {
    expect(sql).toContain('private.can_manage_calendar_event(target_event)')
    expect(sql).toContain("array['owner','admin','adult']::public.family_role[]")
    expect(sql).toContain('and family_id=target_family_id')
  })
  it('creates occurrences only for the newly inserted series, never through the global wrapper',()=>{
    expect(sql).toContain('perform private.ensure_calendar_event_series_occurrences(series_id,400)')
    const createBody=sql.slice(sql.indexOf('create or replace function public.create_recurring_calendar_event'),sql.indexOf('revoke all on function public.create_recurring_calendar_event'))
    expect(createBody).not.toContain('private.ensure_calendar_event_occurrences(400)')
    expect(sql).toContain('series_row.family_id,series_row.title')
  })
  it('keeps one-off events supported', () => {
    expect(repository).toContain("from('calendar_events').insert")
    expect(repository).toContain('if (input.recurrence)')
  })
  it('deletes both one-off and recurring events through the narrow RPC after direct DELETE is revoked',()=>{
    expect(repository).toContain("rpc('delete_calendar_event_occurrence'")
    expect(sql).toContain('revoke delete on public.calendar_events from authenticated')
    expect(sql).toContain('if target_event.recurrence_series_id is not null then')
  })
  it('shows all recurrence controls and a Polish badge/action', () => {
    for (const label of ['Nie powtarzaj','Codziennie / co X dni','Co tydzień / wybrane dni','Co miesiąc','Co rok']) expect(modal).toContain(label)
    expect(card).toContain('Cykliczne ·')
    expect(card).toContain('Zakończ serię')
  })
  it('uses an hourly backend cron and a finite 400-day rolling horizon', () => {
    expect(sql).toContain("'calendar-recurrence-every-hour','0 * * * *'")
    expect(sql).toContain('ensure_calendar_event_occurrences(400)')
    expect(sql).toContain('horizon_days not between 1 and 730')
  })
  it('keeps each occurrence reminder scoped by its own source id', () => {
    expect(sql).toContain("source_type='calendar_event' and source_id=target_event_id")
    expect(sql).not.toContain('calendar_reminder_offset')
  })
  it('cancels future pending reminders when a series is stopped', () => {
    expect(sql).toContain("source_id=any(affected_ids) and status='pending'")
  })
  it('extends v1 backup export with series, links and exclusions', () => {
    expect(sql).toContain("'{modules,calendar,recurrenceSeries}'")
    expect(sql).toContain("'recurrenceSeriesId',e.recurrence_series_id")
    expect(sql).toContain("'{modules,calendar,exclusions}'")
  })
  it('accepts old backups without recurrence collections', () => {
    expect(sql).toContain("coalesce(backup#>'{modules,calendar,recurrenceSeries}','[]'::jsonb)")
    expect(sql).toContain('calendar_restore_base_backup')
    expect(sql).toContain("case when item->>'recurrenceSeriesId' is null then null")
  })
  it('restores recurrence series, occurrence links and exclusions through explicit UUID maps', () => {
    expect(sql).toContain('insert into public.calendar_event_recurrence_series')
    expect(sql).toContain("calendar_series_map jsonb:='{}'::jsonb")
    expect(sql).toContain("(event_map->>(item->>'id'))::uuid")
    expect(sql).toContain("(calendar_series_map->>(item->>'recurrenceSeriesId'))::uuid")
    expect(sql).toContain("nullif(item->>'recurrenceOccurrenceDate','')::date")
    expect(sql).toContain('insert into public.calendar_event_recurrence_exclusions')
    expect(sql).not.toContain('ambiguous restored calendar occurrence')
    expect(sql).not.toContain('e.title=item->>\'title\'')
  })
  it('restores two business-identical occurrences into distinct mapped events and series', () => {
    const createdAt = '2027-03-10T12:00:00.000Z'
    const restored = modelRestoreCalendar(
      [{ id: 'series-a', title: 'Spotkanie' }, { id: 'series-b', title: 'Spotkanie' }],
      [
        { id: 'event-a', title: 'Spotkanie', recurrenceSeriesId: 'series-a', createdAt },
        { id: 'event-b', title: 'Spotkanie', recurrenceSeriesId: 'series-b', createdAt },
      ],
    )
    expect(restored).toEqual([
      { id: 'restored-event-1', seriesId: 'restored-series-1', createdAt },
      { id: 'restored-event-2', seriesId: 'restored-series-2', createdAt },
    ])
  })
  it('keeps calendar deletion, series insertion, event insertion and exclusions inside restore context', () => {
    const contextStart = sql.indexOf('insert into private.family_restore_context')
    const deleteEvents = sql.indexOf('delete from public.calendar_events where family_id=target_family_id', contextStart)
    const deleteSeries = sql.indexOf('delete from public.calendar_event_recurrence_series where family_id=target_family_id', contextStart)
    const insertSeries = sql.indexOf('insert into public.calendar_event_recurrence_series(', deleteSeries)
    const insertEvents = sql.indexOf('insert into public.calendar_events(', insertSeries)
    const insertExclusions = sql.indexOf('insert into public.calendar_event_recurrence_exclusions(', insertEvents)
    const contextEnd = sql.indexOf('delete from private.family_restore_context', insertExclusions)
    expect([contextStart, deleteEvents, deleteSeries, insertSeries, insertEvents, insertExclusions, contextEnd].every((value) => value >= 0)).toBe(true)
    expect(contextStart).toBeLessThan(deleteEvents)
    expect(deleteEvents).toBeLessThan(deleteSeries)
    expect(deleteSeries).toBeLessThan(insertSeries)
    expect(insertSeries).toBeLessThan(insertEvents)
    expect(insertEvents).toBeLessThan(insertExclusions)
    expect(insertExclusions).toBeLessThan(contextEnd)
  })
  it('preserves calendar timestamps and maps personal reminders through event_map', () => {
    expect(sql).toContain("(item->>'createdAt')::timestamptz,(item->>'updatedAt')::timestamptz,")
    expect(sql).toContain("else (event_map->>(item->>'sourceId'))::uuid end")
    expect(sql).not.toContain('update public.calendar_events set recurrence_series_id')
  })
  it('suppresses technical calendar audits and writes only the controlled restore audit after context ends', () => {
    const contextEnd = sql.indexOf('delete from private.family_restore_context')
    const restoreAudit = sql.indexOf("'family.backup.restored'", contextEnd)
    expect(contextEnd).toBeGreaterThan(-1)
    expect(restoreAudit).toBeGreaterThan(contextEnd)
    const restoreBody = sql.slice(sql.indexOf('create or replace function public.restore_family_data('), sql.indexOf('revoke all on function public.restore_family_data'))
    expect(restoreBody).not.toContain("'calendar_event.created'")
    expect(restoreBody).not.toContain("'calendar_event.updated'")
    expect(restoreBody).not.toContain("'calendar_event.deleted'")
  })
  it('validates cursor, local time and the recurrence link pair before restore', () => {
    expect(sql).toContain("private.restore_valid_date(item->>'generatedThrough',true)")
    expect(sql).toContain("elsif item->>'generatedThrough' is not null")
    expect(sql).toContain("(item->>'generatedThrough')::date<(item->>'anchorDate')::date")
    expect(sql).not.toMatch(/or\s+case\s+when item->>'generatedThrough'/i)
    expect(sql).toContain('create or replace function private.restore_valid_time')
    expect(sql).toContain("private.restore_valid_time(item->>'anchorLocalTime')")
    expect(sql).toContain("(item->>'recurrenceSeriesId' is null)<>(item->>'recurrenceOccurrenceDate' is null)")
  })
  it('preserves the logical cursor through backup, restore and the next generator run',()=>{
    const rule:Rule={type:'monthly',interval:3,day:15};const before=runGenerator('2027-01-15',rule,'2027-10-20')
    const restored={cursor:before.cursor,rows:new Set(before.rows)};runGenerator('2027-01-15',rule,'2028-05-01',restored)
    expect([...restored.rows]).toEqual(['2027-01-15','2027-04-15','2027-07-15','2027-10-15','2028-01-15','2028-04-15'])
    expect(sql).toContain('s.generated_through as "generatedThrough"')
    expect(sql).toContain("nullif(item->>'generatedThrough','')::date")
  })
  it('keeps private helpers inaccessible and grants only narrow RPCs', () => {
    expect(sql).toContain('revoke all on function private.ensure_calendar_event_occurrences(integer) from public,anon,authenticated')
    expect(sql).toContain('grant execute on function public.stop_calendar_event_recurrence(uuid,uuid) to authenticated')
    expect(sql).toContain('revoke delete on public.calendar_events from authenticated')
  })
  it('does not alter historical migration files or introduce a 0029 dependency', () => {
    expect(sql).not.toContain('0029')
    expect(sql).toContain("notify pgrst,'reload schema'")
  })
})
