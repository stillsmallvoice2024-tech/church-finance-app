import { create } from 'zustand'
import type { OrgStatus, PlanStatus, PlanTier, UserRole } from '../types'

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
  plan_tier?:           PlanTier | null
  plan_expires_at?:     string | null
  imported_rows_count?: number | null
  imported_rows_period_start?: string | null
  plan_status?:         PlanStatus | null
  trial_ends_at?:       string | null
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
  planTier:            PlanTier | null
  planExpiresAt:       string | null
  importedRowsCount:   number
  importedRowsPeriodStart: string | null
  planStatus:          PlanStatus | null
  trialEndsAt:         string | null
  /**
   * True once a membership row has actually been applied, so `planTier`
   * reflects the database rather than "we haven't asked yet". usePlan()
   * needs the distinction: since enforcement now fails CLOSED, an unknown
   * tier must render as "still loading", not as the free tier — otherwise
   * a paid org flashes locked on every page load.
   */
  planLoaded:          boolean
  memberships:         OrgMembership[]
  switching:           boolean

  setOrg:               (m: OrgMembership) => void
  setMemberships:       (ms: OrgMembership[]) => void
  setOnboardingComplete:(v: boolean | null) => void
  setOrgStatus:         (status: OrgStatus, deletedAt?: string | null, purgeAt?: string | null) => void
  setTimezone:          (tz: string | null) => void
  setOrgType:           (type: string | null) => void
  setImportedRowsCount: (count: number, periodStart?: string | null) => void
  setPlanTier:          (tier: PlanTier, expiresAt?: string | null) => void
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
  planTier:           null,
  planExpiresAt:      null,
  importedRowsCount:  0,
  importedRowsPeriodStart: null,
  planStatus:         null,
  trialEndsAt:        null,
  planLoaded:         false,
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
    // null = schema not yet migrated, or column not selected. Enforcement
    // lives in RLS now, so usePlan() resolves this to the free tier rather
    // than failing open to full access — see resolveEffectiveTier().
    planTier:           m.plan_tier !== undefined ? (m.plan_tier ?? null) : null,
    planExpiresAt:      m.plan_expires_at !== undefined ? (m.plan_expires_at ?? null) : null,
    importedRowsCount:  m.imported_rows_count ?? 0,
    importedRowsPeriodStart: m.imported_rows_period_start ?? null,
    planStatus:         m.plan_status !== undefined ? (m.plan_status ?? null) : null,
    trialEndsAt:        m.trial_ends_at !== undefined ? (m.trial_ends_at ?? null) : null,
    planLoaded:         true,
  }),

  setMemberships: (ms) => set({ memberships: ms }),

  setOnboardingComplete: (v) => set({ onboardingComplete: v }),

  setOrgStatus: (status, deletedAt = null, purgeAt = null) =>
    set({ orgStatus: status, orgDeletedAt: deletedAt, orgPurgeAt: purgeAt }),

  setTimezone: (tz) => set({ timezone: tz }),

  setOrgType: (type) => set({ orgType: type }),

  setImportedRowsCount: (count, periodStart) => set(periodStart !== undefined
    ? { importedRowsCount: count, importedRowsPeriodStart: periodStart }
    : { importedRowsCount: count }),

  setPlanTier: (tier, expiresAt = null) => set({ planTier: tier, planExpiresAt: expiresAt, planLoaded: true }),

  setSwitching: (v) => set({ switching: v }),

  clearOrg: () => set({
    orgId: null, orgName: null, orgRole: null,
    onboardingComplete: null, defaultCurrency: null, timezone: null,
    orgStatus: null, orgDeletedAt: null, orgPurgeAt: null,
    orgType: null, planTier: null, planExpiresAt: null, importedRowsCount: 0,
    importedRowsPeriodStart: null,
    planStatus: null, trialEndsAt: null, planLoaded: false,
    memberships: [], switching: false,
  }),

  persistActive: (userId, orgId) => {
    try { localStorage.setItem(activeOrgKey(userId), orgId) } catch { /* storage unavailable */ }
  },

  getPersistedOrgId: (userId) => {
    try { return localStorage.getItem(activeOrgKey(userId)) } catch { return null }
  },
}))
