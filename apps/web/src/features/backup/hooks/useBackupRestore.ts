import{useMemo,useRef,useState}from'react'
import type{BackupPayload,RestoreModule,RestorePreflight,RestoreResult,RestoreUserMapping}from'../types'
import{createBackupRepository}from'../api/backup-repository'

export function useBackupRestore(familyId:string,onRestored:()=>void){const repo=useMemo(()=>createBackupRepository(),[]),inFlight=useRef(false);const[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[preflight,setPreflight]=useState<RestorePreflight|null>(null),[result,setResult]=useState<RestoreResult|null>(null)
 async function run<T>(work:()=>Promise<T>){if(inFlight.current)throw new Error('Operacja jest już wykonywana.');inFlight.current=true;setBusy(true);setError(null);try{return await work()}catch(reason){const message=reason instanceof Error?reason.message:'Nie udało się przywrócić kopii.';setError(message);throw reason}finally{inFlight.current=false;setBusy(false)}}
 return{busy,error,preflight,result,clear(){setError(null);setPreflight(null);setResult(null)},async check(backup:BackupPayload,modules:RestoreModule[],mapping:RestoreUserMapping){return run(async()=>{const report=await repo.preflightRestore(familyId,backup,modules,mapping);setPreflight(report);return report})},async restore(backup:BackupPayload,modules:RestoreModule[],mapping:RestoreUserMapping,confirmation:string){return run(async()=>{const response=await repo.restoreFamily(familyId,backup,modules,mapping,confirmation);setResult(response);window.dispatchEvent(new CustomEvent('family-data-restored',{detail:{familyId,modules}}));onRestored();return response})}}
}
