import { useAuthStore } from '../store/authStore'
import { useOrgStore }  from '../store/orgStore'
import type { PlanTier } from '../types'

// Single source of truth for which tier unlocks which feature — the Billing
// tab's comparison table and every gate in the app both read this map, so
// they can never drift from what's actually enforced.
export type PlanFeature =
  | 'import'
  | 'multiBank'
  | 'fx'
  | 'reports'
  | 'receipts'
  | 'reconciliation'
  | 'teamInvites'
  | 'specialConfigs'
  | 'dynamicReports'
  | 'bulkReallocation'
  | 'adjustments'
  | 'bankMovement'
  | 'changeLog'
  | 'backupRestore'
  | 'ocrImport'

export const FEATURE_TIERS: Record<PlanFeature, PlanTier> = {
  import:           'free',
  multiBank:        'level1',
  fx:               'level1',
  reports:          'level1',
  receipts:         'level1',
  reconciliation:   'level1',
  teamInvites:      'level1',
  specialConfigs:   'full',
  dynamicReports:   'full',
  bulkReallocation: 'full',
  adjustments:      'full',
  bankMovement:     'full',
  changeLog:        'full',
  backupRestore:    'full',
  ocrImport:        'full',
}

const TIER_RANK: Record<PlanTier, number> = { free: 0, level1: 1, full: 2 }

export function tierAtLeast(tier: PlanTier, min: PlanTier): boolean {
  return TIER_RANK[tier] >= TIER_RANK[min]
}

// Non-hook version of the tier resolution below — for callbacks/utils that
// read store state directly (`useOrgStore.getState()`) instead of subscribing.
// Lazy expiry check, mirrors org_effective_plan_tier() in the DB — a
// grandfathered/expired plan reverts to 'free' the moment it lapses.
// `storedTier === null` covers both "not loaded yet" and "DB not migrated
// yet" — fail open to 'full' rather than flash-locking a working org out of
// features it already had.
export function resolveEffectiveTier(storedTier: PlanTier | null, planExpiresAt: string | null): PlanTier {
  if (storedTier === null) return 'full'
  const expired = !!planExpiresAt && new Date(planExpiresAt).getTime() < Date.now()
  return expired ? 'free' : storedTier
}

export function usePlan() {
  const user          = useAuthStore((s) => s.user)
  const loading        = useAuthStore((s) => s.loading)
  const storedTier      = useOrgStore((s) => s.planTier)
  const planExpiresAt   = useOrgStore((s) => s.planExpiresAt)
  const importedRowsCount = useOrgStore((s) => s.importedRowsCount)

  const resolved = !loading && !!user
  const tier = resolveEffectiveTier(storedTier, planExpiresAt)

  const hasFeature = (feature: PlanFeature): boolean => {
    if (!resolved) return true // avoid flashing a locked state during hydration
    return tierAtLeast(tier, FEATURE_TIERS[feature])
  }

  return {
    tier,
    isFree:          (): boolean => resolved && tier === 'free',
    isLevel1OrAbove: (): boolean => !resolved || tierAtLeast(tier, 'level1'),
    isFull:          (): boolean => resolved && tier === 'full',
    hasFeature,
    importedRowsCount,
    importCapReached: (): boolean => resolved && tier === 'free' && importedRowsCount >= 100,
    importRowsRemaining: (): number => Math.max(0, 100 - importedRowsCount),
  }
}
