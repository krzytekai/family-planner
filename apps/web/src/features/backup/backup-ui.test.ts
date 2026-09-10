import{readFileSync}from'node:fs'
import{resolve}from'node:path'
import{describe,expect,it}from'vitest'
const read=(path:string)=>readFileSync(resolve(process.cwd(),path),'utf8')
const admin=read('src/features/admin/AdminPanel.tsx'),ui=read('src/features/backup/components/BackupExportSection.tsx'),restoreUi=read('src/features/backup/components/BackupRestoreWizard.tsx'),adapter=read('src/features/backup/export-file.ts'),repo=read('src/features/backup/api/backup-repository.ts')
describe('backup export UI contract',()=>{
 it('is integrated only after the owner/admin guard in family administration',()=>{expect(admin).toContain("const canAdmin=['owner','admin'].includes(family.role)");expect(admin.indexOf('if(!canAdmin)return')).toBeLessThan(admin.indexOf('<BackupExportSection family={family}/>'))})
 it('offers module JSON selection and only approved CSV datasets',()=>{for(const label of ['Backup i eksport danych','Pełna kopia danych','Utwórz kopię JSON','Eksport danych','Eksportuj CSV'])expect(ui).toContain(label);for(const label of ['Zadania','Wydarzenia kalendarza','Produkty zakupowe','Transakcje budżetowe','Wygenerowane opłaty'])expect(ui).toContain(label)})
 it('shows the secret exclusion notice and prevents empty or duplicate submission',()=>{expect(ui).toContain('Kopia nie zawiera haseł, danych logowania ani kluczy dostępu.');expect(ui).toContain('state.busy||selected.length===0');const hook=read('src/features/backup/hooks/useBackupExport.ts');expect(hook).toContain('if(inFlight.current)return');expect(hook).toContain('inFlight.current=true');expect(hook).toContain('inFlight.current=false')})
 it('routes all data through the authorized RPC',()=>{expect(repo).toContain("rpc('export_family_data'");expect(repo).toContain('target_family_id:familyId,selected_modules:modules')})
 it('uses Blob URL cleanup on web and private cache plus Share Sheet on native',()=>{expect(adapter).toContain('new Blob');expect(adapter).toContain('URL.createObjectURL');expect(adapter).toContain('URL.revokeObjectURL(url)');expect(adapter).toContain('Directory.Cache');expect(adapter).toContain('Filesystem.writeFile');expect(adapter).toContain('Share.share');expect(adapter).toContain('Filesystem.deleteFile')})
 it('keeps mobile controls touchable without changing navigation',()=>{expect(ui).toContain('min-h-11');expect(ui).toContain('grid-cols-2');expect(ui).toContain('sm:grid-cols-3')})
 it('does not allow none for required identities and translates server diagnostics',()=>{expect(restoreUi).toContain('requiredUsers.has(id)');expect(restoreUi).toContain("mapping[id]==='none'");expect(restoreUi).toContain('restoreErrorMessage(value)');expect(restoreUi).toContain('data-error-code={value}')})
})
