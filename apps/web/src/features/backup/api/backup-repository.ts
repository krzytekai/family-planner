import{getSupabaseClient}from'../../../lib/supabase'
import type{BackupModule,BackupPayload,RestoreModule,RestorePreflight,RestoreResult,RestoreUserMapping}from'../types'
function client(){const value=getSupabaseClient();if(!value)throw new Error('Brak konfiguracji Supabase.');return value}
export function createBackupRepository(){return{
 async exportFamily(familyId:string,modules:BackupModule[]){const{data,error}=await client().rpc('export_family_data',{target_family_id:familyId,selected_modules:modules});if(error)throw new Error(error.message);return data as BackupPayload},
 async preflightRestore(familyId:string,backup:BackupPayload,modules:RestoreModule[],mapping:RestoreUserMapping){const{data,error}=await client().rpc('preflight_family_restore',{target_family_id:familyId,backup,selected_modules:modules,user_mapping:mapping});if(error)throw new Error(error.message);return data as RestorePreflight},
 async restoreFamily(familyId:string,backup:BackupPayload,modules:RestoreModule[],mapping:RestoreUserMapping,confirmation:string){const{data,error}=await client().rpc('restore_family_data',{target_family_id:familyId,backup,selected_modules:modules,user_mapping:mapping,restore_mode:'replace_selected',confirmation_family_name:confirmation});if(error)throw new Error(error.message);return data as RestoreResult}
}}
