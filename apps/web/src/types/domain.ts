export type FamilyRole = 'owner' | 'admin' | 'adult' | 'child'
export type MembershipStatus = 'active' | 'blocked'

export interface FamilyContext {
  familyId: string
  familyName: string
  userId: string
  displayName: string
  role: FamilyRole
  status: MembershipStatus
}

export interface FamilyMember {
  userId: string
  familyId: string
  displayName: string
  email: string | null
  role: FamilyRole
  status: MembershipStatus
  createdAt: string
}

export interface PlatformAdminOverview {
  authorized: boolean
  counts?: { families: number; users: number; activeMemberships: number; blockedMemberships: number; orphanUsers:number; withoutActiveMemberships:number }
  families?: Array<{ id: string; name: string; owner: string | null; memberCount: number; createdAt: string }>
  users?: Array<{ id: string; displayName: string; email: string | null; familyCount: number; activeMembershipCount:number; blockedMembershipCount:number; active: boolean }>
  memberships?: Array<{ familyId:string; familyName:string; userId:string; displayName:string; role:FamilyRole; status:MembershipStatus }>
}
