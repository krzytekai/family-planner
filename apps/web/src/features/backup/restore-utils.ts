import type{BackupModule,BackupPayload,BackupRecord,RestoreModule}from'./types'

export const MAX_BACKUP_BYTES=8*1024*1024
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const allowed=new Set<BackupModule>(['family','members','tasks','calendar','shopping','budget','fixedCharges','reminders'])
export const restoreLabels:Record<RestoreModule,string>={tasks:'Zadania',calendar:'Kalendarz',shopping:'Zakupy',budget:'Budżet',fixedCharges:'Opłaty stałe',reminders:'Przypomnienia'}

export function validateBackupPayload(value:unknown):BackupPayload{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Plik nie zawiera poprawnego obiektu kopii.')
 const backup=value as BackupPayload
 if(backup.format!=='family-planner-backup'||backup.backupVersion!==1||backup.schemaVersion!==1)throw new Error('Nieobsługiwany format lub wersja kopii.')
 if(!backup.family||!uuid.test(backup.family.id)||typeof backup.family.name!=='string'||!backup.family.name.trim())throw new Error('Kopia nie zawiera poprawnego manifestu rodziny.')
 if(!backup.scope||!uuid.test(backup.scope.familyId)||!uuid.test(backup.scope.exportedBy)||!Array.isArray(backup.scope.modules)||backup.scope.modules.some(module=>!allowed.has(module)))throw new Error('Kopia ma niepoprawny zakres danych.')
 if(!backup.modules||typeof backup.modules!=='object'||!backup.recordCounts||typeof backup.recordCounts!=='object')throw new Error('Kopia nie zawiera modułów lub liczników.')
 return backup
}
export async function readBackupFile(file:File){if(!file.name.toLowerCase().endsWith('.json'))throw new Error('Wybierz plik JSON.');if(file.size>MAX_BACKUP_BYTES)throw new Error('Kopia przekracza limit 8 MiB.');const text=await file.text();if(new TextEncoder().encode(text).byteLength>MAX_BACKUP_BYTES)throw new Error('Kopia przekracza limit 8 MiB.');try{return validateBackupPayload(JSON.parse(text))}catch(error){if(error instanceof SyntaxError)throw new Error('Plik nie zawiera poprawnego JSON.');throw error}}
export function availableRestoreModules(backup:BackupPayload){return(['tasks','calendar','shopping','budget','fixedCharges','reminders']as RestoreModule[]).filter(module=>backup.scope.modules.includes(module)&&module in backup.modules)}
function add(set:Set<string>,value:unknown){if(typeof value==='string'&&uuid.test(value))set.add(value)}
function rows(value:unknown){return Array.isArray(value)?value as BackupRecord[]:[]}
export function sourceUsers(backup:BackupPayload,modules:RestoreModule[]){const found=new Set<string>();const selected=new Set(modules);const m=backup.modules
 if(selected.has('tasks')){rows(m.tasks?.items).forEach(x=>{add(found,x.createdBy);add(found,x.assignedTo)});rows(m.tasks?.recurrenceSeries).forEach(x=>add(found,x.createdBy))}
 if(selected.has('calendar'))rows(m.calendar?.events).forEach(x=>add(found,x.createdBy))
 if(selected.has('shopping')){rows(m.shopping?.lists).forEach(x=>add(found,x.createdBy));rows(m.shopping?.items).forEach(x=>{add(found,x.createdBy);add(found,x.purchasedBy)})}
 if(selected.has('budget')){for(const key of['transactions','expenseParticipants','settlementMembers','settlements','plans']as const)rows(m.budget?.[key]).forEach(x=>{for(const field of['createdBy','paidBy','userId','fromUserId','toUserId'])add(found,x[field])})}
 if(selected.has('fixedCharges')){for(const key of['properties','units','definitions','reminderRules']as const)rows(m.fixedCharges?.[key]).forEach(x=>{add(found,x.createdBy);add(found,x.recipientUserId)})}
 if(selected.has('reminders'))add(found,backup.scope.exportedBy)
 return[...found].sort()
}
export function sourceUserLabel(backup:BackupPayload,id:string){const member=backup.modules.members?.find(row=>row.userId===id);return typeof member?.displayName==='string'?member.displayName:`${id.slice(0,8)}…`}
