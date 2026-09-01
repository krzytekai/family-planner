import type{FamilyRole}from'../../types/domain'
export function canManageFamilyMember(actor:FamilyRole,target:FamilyRole){return target!=='owner'&&(actor==='owner'||(actor==='admin'&&(target==='adult'||target==='child')))}
