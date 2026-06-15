import { create } from 'zustand'
import type { OrgStatus, UserRole } from '../types'

export interface OrgMembership {
  org_id:               string
  org_name:             string
  role:                 UserRole
  onboarding_complete?: boolean | null
  default_currency?:    string | null
  timezone?:            string | null
  org_status?:          OrgStatus | null
  org_deleted_at?:      string | null
  org_purge_at?:        string | null
  org_type?:            string | null
}

const activeOrgKey = (userId: string) => `org-active-${userId}`

interface OrgState {
  orgId:               string | null
  orgName:             string | null
  orgRole:             UserRole | null
  onboardingComplete:  boolean | null
  defaultCurrency:     string | null
  timezone:            string | null
  orgStatus:           OrgStatus | null
  orgDeletedAt:        string | null
  orgPurgeAt:          string | null
  orgType:             string | null
  memberships:         OrgMembership[]
  switching:           boolean

  setOrg:               (m: OrgMembership) => void
  setMemberships:       (ms: OrgMembership[]) => void
  setOnboardingComplete:(v: boolean | null) => void
  setOrgStatus:         (status: OrgStatus, deletedAt?: string | null, purgeAt?: string | null) => void
  setTimezone:          (tz: string | null) => void
  setOrgType:           (type: string | null) => void
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
  timezone:           null,
  orgStatus:          null,
  orgDeletedAt:       null,
  orgPurgeAt:         null,
  orgType:            null,
  memberships:        [],
  switching:          false,

  setOrg: (m) => set({
    orgId:              m.org_id,
    orgName:            m.org_name,
    orgRole:            m.role,
    onboardingComplete: m.onboarding_complete !== undefined ? (m.onboarding_complete ?? null) : null,
    defaultCurrency:    m.default_currency !== undefined ? (m.default_currency ?? null) : null,
    timezone:           m.timezone !== undefined ? (m.timezone ?? null) : null,
    orgStatus:          m.org_status ?? 'active',
    orgDeletedAt:       m.org_deleted_at ?? null,
    orgPurgeAt:         m.org_purge_at ?? null,
    orgType:            m.org_type !== undefined ? (m.org_type ?? null) : null,
  }),

  setMemberships: (ms) => set({ memberships: ms }),

  setOnboardingComplete: (v) => set({ onboardingComplete: v }),

  setOrgStatus: (status, deletedAt = null, purgeAt = null) =>
    set({ orgStatus: status, orgDeletedAt: deletedAt, orgPurgeAt: purgeAt }),

  setTimezone: (tz) => set({ timezone: tz }),

  setOrgType: (type) => set({ orgType: type }),

  setSwitching: (v) => set({ switching: v }),

  clearOrg: () => set({
    orgId: null, orgName: null, orgRole: null,
    onboardingComplete: null, defaultCurrency: null, timezone: null,
    orgStatus: null, orgDeletedAt: null, orgPurgeAt: null,
    orgType: null, memberships: [], switching: false,
  }),

  persistActive: (userId, orgId) => {
    try { localStorage.setItem(activeOrgKey(userId), orgId) } catch { /* storage unavailable */ }
  },

  getPersistedOrgId: (userId) => {
    try { return localStorage.getItem(activeOrgKey(userId)) } catch { return null }
  },
}))
