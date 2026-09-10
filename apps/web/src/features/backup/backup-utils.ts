import type{BackupModule,BackupPayload,BackupRecord,CsvDataset}from'./types'

const polish:Record<string,string>={ł:'l',Ł:'L',đ:'d',Đ:'D'}
export function sanitizeFamilySlug(value:string){const slug=value.replace(/[łŁđĐ]/g,character=>polish[character]??character).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[\\/:*?"<>|]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,48).replace(/-$/,'');return slug||'rodzina'}
export function localFilenameTimestamp(date=new Date()){const part=(value:number)=>String(value).padStart(2,'0');return`${date.getFullYear()}-${part(date.getMonth()+1)}-${part(date.getDate())}_${part(date.getHours())}-${part(date.getMinutes())}`}
export function backupFilename(family:string,date=new Date()){return`planer-rodzinny_${sanitizeFamilySlug(family)}_${localFilenameTimestamp(date)}.json`}
export function csvFilename(module:string,family:string,date=new Date()){return`planer-rodzinny_${sanitizeFamilySlug(module)}_${sanitizeFamilySlug(family)}_${localFilenameTimestamp(date)}.csv`}
export function jsonExport(payload:BackupPayload){return JSON.stringify(payload,null,2)}

const csvDefinitions:Record<CsvDataset,{module:BackupModule;headers:Array<[string,string]>;rows:(payload:BackupPayload)=>BackupRecord[]}>= {
 tasks:{module:'tasks',headers:[['id','ID'],['title','Tytuł'],['description','Opis'],['status','Status'],['priority','Priorytet'],['assignedTo','Przypisano'],['dueAt','Termin'],['createdBy','Utworzył'],['completedAt','Ukończono']],rows:p=>p.modules.tasks?.items??[]},
 calendarEvents:{module:'calendar',headers:[['id','ID'],['title','Tytuł'],['description','Opis'],['eventType','Typ'],['location','Miejsce'],['allDay','Cały dzień'],['startsAt','Początek'],['endsAt','Koniec'],['startDate','Data początku'],['endDate','Data końca'],['createdBy','Utworzył']],rows:p=>p.modules.calendar?.events??[]},
 shoppingItems:{module:'shopping',headers:[['id','ID'],['listId','ID listy'],['name','Nazwa'],['quantity','Ilość'],['unit','Jednostka'],['category','Kategoria'],['note','Notatka'],['isPurchased','Kupiono'],['createdBy','Utworzył'],['purchasedBy','Kupił'],['purchasedAt','Data zakupu']],rows:p=>p.modules.shopping?.items??[]},
 budgetTransactions:{module:'budget',headers:[['id','ID'],['transactionType','Typ'],['title','Tytuł'],['description','Opis'],['amount','Kwota'],['currency','Waluta'],['category','Kategoria'],['transactionDate','Data'],['paidBy','Zapłacił'],['isShared','Wspólny'],['createdBy','Utworzył']],rows:p=>p.modules.budget?.transactions??[]},
 fixedCharges:{module:'fixedCharges',headers:[['id','ID'],['propertyId','ID grupy'],['chargeDefinitionId','ID definicji'],['dueDate','Termin'],['plannedAmount','Kwota planowana'],['actualAmount','Kwota faktyczna'],['currency','Waluta'],['status','Status'],['paidAt','Data zapłaty'],['notes','Notatka'],['budgetTransactionId','ID transakcji budżetu']],rows:p=>p.modules.fixedCharges?.charges??[]}
}
export function csvModule(dataset:CsvDataset){return csvDefinitions[dataset].module}
function cell(value:unknown){const raw=value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);const safe=/^[\s]*[=+\-@]/.test(raw)?`'${raw}`:raw;return`"${safe.replace(/"/g,'""')}"`}
export function csvExport(payload:BackupPayload,dataset:CsvDataset){const definition=csvDefinitions[dataset];const rows=definition.rows(payload);return '\uFEFF'+[definition.headers.map(([,label])=>cell(label)).join(';'),...rows.map(row=>definition.headers.map(([key])=>cell(row[key])).join(';'))].join('\r\n')}
export function selectedModules(values:Iterable<BackupModule>){const selected=new Set(values);return(['family','members','tasks','calendar','shopping','budget','fixedCharges','reminders']as BackupModule[]).filter(module=>selected.has(module))}
