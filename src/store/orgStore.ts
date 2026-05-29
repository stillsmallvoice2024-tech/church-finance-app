import { create } from 'zustand'
import type { UserRole } from '../types'

export interface OrgMembership {
  org_id:   string
  org_name: string
  role:     UserRole
}

interface OrgState {
  orgId:    string | null
  orgName:  string | null
  orgRole:  UserRole | null
  setOrg:   (m: OrgMembership) => void
  clearOrg: () => void
}

export const useOrgStore = create<OrgState>((set) => ({
  orgId:   null,
  orgName: null,
  orgRole: null,

  setOrg: (m) => set({ orgId: m.org_id, orgName: m.org_name, orgRole: m.role }),

  clearOrg: () => set({ orgId: null, orgName: null, orgRole: null }),
}))
