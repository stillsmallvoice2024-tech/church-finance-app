import { create } from 'zustand'
import type { UserRole } from '../types'

export interface OrgMembership {
  org_id:               string
  org_name:             string
  role:                 UserRole
  onboarding_complete?: boolean | null
  default_currency?:    string | null
}

const activeOrgKey = (userId: string) => `org-active-${userId}`

interface OrgState {
  orgId:               string | null
  orgName:             string | null
  orgRole:             UserRole | null
  onboardingComplete:  boolean | null
  defaultCurrency:     string | null
  memberships:         OrgMembership[]
  switching:           boolean

  setOrg:               (m: OrgMembership) => void
  setMemberships:       (ms: OrgMembership[]) => void
  setOnboardingComplete:(v: boolean | null) => void
  setSwitching:         (v: boolean) => void
  clearOrg:             () => void
  persistActive:        (userId: string, orgId: string) => void
  getPersistedOrgId:    (userId: string) => string | null
}

export const useOrgStore = create<OrgState>((set) => ({
  orgId:              null,
  orgName:            null,
  orgRole:            null,
  onboardingComplete: null,
  defaultCurrency:    null,
  memberships:        [],
  switching:          false,

  setOrg: (m) => set({
    orgId:              m.org_id,
    orgName:            m.org_name,
    orgRole:            m.role,
    onboardingComplete: m.onboarding_complete !== undefined ? (m.onboarding_complete ?? null) : null,
    defaultCurrency:    m.default_currency !== undefined ? (m.default_currency ?? null) : null,
  }),

  setMemberships: (ms) => set({ memberships: ms }),

  setOnboardingComplete: (v) => set({ onboardingComplete: v }),

  setSwitching: (v) => set({ switching: v }),

  clearOrg: () => set({ orgId: null, orgName: null, orgRole: null, onboardingComplete: null, defaultCurrency: null, memberships: [], switching: false }),

  persistActive: (userId, orgId) => {
    try { localStorage.setItem(activeOrgKey(userId), orgId) } catch { /* storage unavailable */ }
  },

  getPersistedOrgId: (userId) => {
    try { return localStorage.getItem(activeOrgKey(userId)) } catch { return null }
  },
}))
