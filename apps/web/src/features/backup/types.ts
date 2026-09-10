export const backupModules=['family','members','tasks','calendar','shopping','budget','fixedCharges','reminders']as const
export type BackupModule=typeof backupModules[number]
export type CsvDataset='tasks'|'calendarEvents'|'shoppingItems'|'budgetTransactions'|'fixedCharges'
export type BackupRecord=Record<string,unknown>
export interface BackupPayload{format:'family-planner-backup';backupVersion:1;schemaVersion:1;createdAt:string;scope:{familyId:string;exportedBy:string;modules:BackupModule[]};family:{id:string;name:string};modules:{family?:BackupRecord;members?:BackupRecord[];tasks?:{items:BackupRecord[];recurrenceSeries:BackupRecord[]};calendar?:{events:BackupRecord[]};shopping?:{lists:BackupRecord[];items:BackupRecord[]};budget?:{transactions:BackupRecord[];expenseParticipants:BackupRecord[];settlementMembers:BackupRecord[];settlements:BackupRecord[];plans:BackupRecord[]};fixedCharges?:{properties:BackupRecord[];units:BackupRecord[];definitions:BackupRecord[];scheduleDates:BackupRecord[];reminderRules:BackupRecord[];charges:BackupRecord[]};reminders?:{scope:'current_user';items:BackupRecord[];preferences:BackupRecord[]}};recordCounts:BackupRecord}

export const restoreModules=['tasks','calendar','shopping','budget','fixedCharges','reminders']as const
export type RestoreModule=typeof restoreModules[number]
export type RestoreUserMapping=Record<string,string|'none'>
export interface RestorePreflight{valid:boolean;errors:string[];warnings:string[];source?:{familyId:string;familyName:string;createdAt:string};destination?:{familyId:string;familyName:string};normalizedModules:RestoreModule[];moduleCounts:BackupRecord;recordsToRemove:BackupRecord;dependentRecordsAffected:BackupRecord;requiredUserMappings:string[];payloadBytes:number;fingerprint?:string}
export interface RestoreResult{success:boolean;operationId:string;modules:RestoreModule[];importedCounts:BackupRecord;removedCounts:BackupRecord;clearedBudgetLinks:number;ignoredReminders:number;warnings:string[];fingerprint?:string}
