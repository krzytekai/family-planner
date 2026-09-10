import{getSupabaseClient}from'../../../lib/supabase'
import type{BackupModule,BackupPayload}from'../types'
export function createBackupRepository(){return{async exportFamily(familyId:string,modules:BackupModule[]){const client=getSupabaseClient();if(!client)throw new Error('Brak konfiguracji Supabase.');const{data,error}=await client.rpc('export_family_data',{target_family_id:familyId,selected_modules:modules});if(error)throw new Error(error.message);return data as BackupPayload}}}
