import { create } from 'zustand'
import type { UserRole } from '../types'

export interface OrgMembership {
  org_id:   string
  org_name: string
  role:     UserRole
}

const activeOrgKey = (userId: string) => `org-active-${userId}`

interface OrgState {
  orgId:       string | null
  orgName:     string | null
  orgRole:     UserRole | null
  memberships: OrgMembership[]
  switching:   boolean

  setOrg:            (m: OrgMembership) => void
  setMemberships:    (ms: OrgMembership[]) => void
  setSwitching:      (v: boolean) => void
  clearOrg:          () => void
  persistActive:     (userId: string, orgId: string) => void
  getPersistedOrgId: (userId: string) => string | null
}

export const useOrgStore = create<OrgState>((set) => ({
  orgId:       null,
  orgName:     null,
  orgRole:     null,
  memberships: [],
  switching:   false,

  setOrg: (m) => set({ orgId: m.org_id, orgName: m.org_name, orgRole: m.role }),

  setMemberships: (ms) => set({ memberships: ms }),

  setSwitching: (v) => set({ switching: v }),

  clearOrg: () => set({ orgId: null, orgName: null, orgRole: null, memberships: [], switching: false }),

  persistActive: (userId, orgId) => {
    try { localStorage.setItem(activeOrgKey(userId), orgId) } catch { /* storage unavailable */ }
  },

  getPersistedOrgId: (userId) => {
    try { return localStorage.getItem(activeOrgKey(userId)) } catch { return null }
  },
}))
