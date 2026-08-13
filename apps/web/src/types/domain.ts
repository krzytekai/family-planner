export type FamilyRole = 'owner' | 'admin' | 'adult' | 'child'

export interface FamilyContext {
  familyId: string
  familyName: string
  userId: string
  displayName: string
  role: FamilyRole
}

export interface PlannerTask {
  id: string
  title: string
  createdBy: string
  assignee: string
  time: string
  completed: boolean
}
