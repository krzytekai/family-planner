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

export interface PlannerTask {
  id: string
  title: string
  createdBy: string
  assignee: string
  time: string
  completed: boolean
}
