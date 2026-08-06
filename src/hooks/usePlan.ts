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
  | 'boardReport'
  | 'receipts'
  | 'reconciliation'
  | 'teamInvites'
  | 'customDistributionRules'
  | 'dynamicReports'
  | 'bulkReallocation'
  | 'adjustments'
  | 'bankMovement'
  | 'changeLog'
  | 'backupRestore'
  | 'ocrImport'

export const FEATURE_TIERS: Record<PlanFeature, PlanTier> = {
  import:                   'free',
  multiBank:                'level1',
  fx:                       'level1',
  reports:                  'level1',
  boardReport:              'full',
  receipts:                 'level1',
  reconciliation:           'level1',
  teamInvites:              'level1',
  customDistributionRules:  'level1',
  dynamicReports:           'full',
  bulkReallocation:         'full',
  adjustments:              'full',
  bankMovement:             'full',
  changeLog:                'full',
  backupRestore:            'full',
  ocrImport:                'full',
}

// Which gated feature a given inflow/outflow `transaction_type` value
// requires, if any — the underlying data model has no plan check of its own
// (RLS allows any authenticated org member to write any transaction_type),
// so every UI surface that lets a user pick one (Import, ImportModal,
// AddInflowModal, AddOutflowModal) must filter its options through this so
// a Free/Growth org can't create refund/reversal/bank_deposit/
// intrabank_transfer rows the Adjustments/Bank Movement pages exist to
// manage, just by not going through those pages.
export const TXN_TYPE_FEATURE: Partial<Record<string, PlanFeature>> = {
  refund:             'adjustments',
  reversal:           'adjustments',
  bank_deposit:       'bankMovement',
  intrabank_transfer: 'bankMovement',
}

// Some features aren't simply on/off per tier — they're available starting a
// given tier but capped at a smaller quantity until a higher tier removes the
// cap. `null` = unlimited. Only meaningful once `hasFeature()` is already true.
export const QUANTITY_LIMITS: Partial<Record<PlanFeature, Record<PlanTier, number | null>>> = {
  customDistributionRules: { free: 0, level1: 2, full: null },
  multiBank:               { free: 1, level1: null, full: null },
}

export const IMPORT_ROWS_PER_MONTH = 100

export const TIER_DISPLAY_NAME: Record<PlanTier, string> = {
  free:   'Clariva Start',
  level1: 'Clariva Growth',
  full:   'Clariva Impact',
}

// Short form for inline use ("Move to Growth", a nav chip) — TIER_DISPLAY_NAME
// carries the "Clariva" prefix, which reads well as a plan name but not
// packed next to other UI text.
export const TIER_SHORT_NAME: Record<PlanTier, string> = { free: 'Start', level1: 'Growth', full: 'Impact' }

// NGN, whole-naira monthly/annual list prices. No payment processor is wired
// up yet — these are display-only until Billing tab checkout exists.
export const TIER_PRICING: Record<PlanTier, { monthly: number; annual: number }> = {
  free:   { monthly: 0,     annual: 0 },
  level1: { monthly: 10000, annual: 100000 },
  full:   { monthly: 25000, annual: 250000 },
}

export const TIER_RANK: Record<PlanTier, number> = { free: 0, level1: 1, full: 2 }

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

// Non-hook version of the import-cap resolution — mirrors the DB's
// increment_import_count() rollover check (date_trunc('month', now()) <>
// date_trunc('month', periodStart)): once the calendar month has turned
// over since the tracked period started, the count reads as 0 client-side
// even before the next import actually writes the reset. For callbacks/
// utils reading store state directly instead of subscribing via usePlan().
export function resolveEffectiveImportCount(count: number, periodStart: string | null): number {
  if (!periodStart) return count
  const now = new Date()
  const start = new Date(periodStart)
  const rolledOver = now.getUTCFullYear() !== start.getUTCFullYear() || now.getUTCMonth() !== start.getUTCMonth()
  return rolledOver ? 0 : count
}

// First of the next calendar month after `periodStart` — the date the
// import counter will next roll over. Used for "resets on <date>" copy.
export function importCapResetDate(periodStart: string | null): Date {
  const base = periodStart ? new Date(periodStart) : new Date()
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1))
}

export function usePlan() {
  const user          = useAuthStore((s) => s.user)
  const loading        = useAuthStore((s) => s.loading)
  const storedTier      = useOrgStore((s) => s.planTier)
  const planExpiresAt   = useOrgStore((s) => s.planExpiresAt)
  const storedImportedRowsCount = useOrgStore((s) => s.importedRowsCount)
  const importedRowsPeriodStart = useOrgStore((s) => s.importedRowsPeriodStart)

  const resolved = !loading && !!user
  const tier = resolveEffectiveTier(storedTier, planExpiresAt)
  const importedRowsCount = resolveEffectiveImportCount(storedImportedRowsCount, importedRowsPeriodStart)

  const hasFeature = (feature: PlanFeature): boolean => {
    if (!resolved) return true // avoid flashing a locked state during hydration
    return tierAtLeast(tier, FEATURE_TIERS[feature])
  }

  // Returns the org's current quantity ceiling for a capped feature — null
  // means unlimited (either the feature has no cap defined, or this tier's
  // limit is explicitly null).
  const quantityLimit = (feature: PlanFeature): number | null => {
    return QUANTITY_LIMITS[feature]?.[tier] ?? null
  }

  return {
    tier,
    isFree:          (): boolean => resolved && tier === 'free',
    isLevel1OrAbove: (): boolean => !resolved || tierAtLeast(tier, 'level1'),
    isFull:          (): boolean => resolved && tier === 'full',
    hasFeature,
    quantityLimit,
    importedRowsCount,
    importCapReached: (): boolean => resolved && tier === 'free' && importedRowsCount >= IMPORT_ROWS_PER_MONTH,
    importRowsRemaining: (): number => Math.max(0, IMPORT_ROWS_PER_MONTH - importedRowsCount),
    importResetDate: (): Date => importCapResetDate(importedRowsPeriodStart),
  }
}
