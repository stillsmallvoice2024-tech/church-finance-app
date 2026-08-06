import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Mail, AlertCircle, Check } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { useOrgStore } from '../../store/orgStore'
import { useSpecialConfigGroups } from '../../hooks/useSpecialConfigGroups'
import {
  usePlan, FEATURE_TIERS, TIER_DISPLAY_NAME, TIER_SHORT_NAME, TIER_PRICING, QUANTITY_LIMITS, TIER_RANK,
  type PlanFeature,
} from '../../hooks/usePlan'
import type { PlanTier } from '../../types'
import { formatDate } from '../../utils/formatters'

const TIERS: PlanTier[] = ['free', 'level1', 'full']

// Short labels for the "you tried to open X" banner — kept separate from the
// per-card marketing copy below since this needs to name the specific route
// a user bounced off of, not sell the tier.
const FEATURE_LABEL: Record<PlanFeature, string> = {
  import:                  'Bank statement import',
  multiBank:               'Multiple bank accounts',
  fx:                      'Foreign currency & FX tracking',
  reports:                 'Report Centre',
  receipts:                'Receipt attachments',
  reconciliation:          'Reconciliation Centre',
  teamInvites:             'Team invites',
  customDistributionRules: 'Custom distribution rules',
  dynamicReports:          'Custom report builder',
  bulkReallocation:        'Bulk reallocation',
  adjustments:             'Refunds, reversals & pending deductions',
  bankMovement:            'Bank movement tracking',
  changeLog:               'Change log / audit trail',
  backupRestore:           'Backup & restore',
  ocrImport:               'Scanned PDF import (OCR)',
}

const CONTACT_EMAIL = 'stillsmallvoice2024@gmail.com'

function planChangeMailto(orgName: string | null, currentTier: PlanTier, targetTier: PlanTier): string {
  const action = TIER_RANK[targetTier] > TIER_RANK[currentTier] ? 'Upgrade' : 'Downgrade'
  const subject = encodeURIComponent(`${action} to ${TIER_DISPLAY_NAME[targetTier]} — ${orgName ?? 'my organisation'}`)
  const body = encodeURIComponent(
    `Hi,\n\nI'd like to ${action.toLowerCase()} our organisation from ${TIER_DISPLAY_NAME[currentTier]} to ` +
    `${TIER_DISPLAY_NAME[targetTier]}.\n\nOrganisation: ${orgName ?? ''}\n`,
  )
  return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`
}

function formatNaira(amount: number): string {
  return amount === 0 ? '₦0' : `₦${amount.toLocaleString('en-NG')}`
}

type BillingCycle = 'monthly' | 'annual'

interface FeatureItem { label: string; sub?: string }

export function BillingTab() {
  const [searchParams] = useSearchParams()
  const lockedFeature = searchParams.get('locked') as PlanFeature | null
  const [cycle, setCycle] = useState<BillingCycle>('monthly')

  const orgName       = useOrgStore(s => s.orgName)
  const planExpiresAt = useOrgStore(s => s.planExpiresAt)
  const { tier, importedRowsCount, importRowsRemaining, importResetDate } = usePlan()
  const resetDateLabel = formatDate(importResetDate())
  const { groups: customRuleGroups } = useSpecialConfigGroups()
  const customRuleCap = QUANTITY_LIMITS.customDistributionRules?.level1 ?? 2

  const FEATURES_BY_TIER: Record<PlanTier, FeatureItem[]> = {
    free: [
      { label: 'Single bank account' },
      { label: 'Manual inflow & outflow entry' },
      {
        label: 'Bank statement import',
        sub: tier === 'free'
          ? `${importedRowsCount} of 100 used this month · resets ${resetDateLabel}`
          : 'Up to 100 transactions/month, from Excel, CSV or PDF',
      },
      { label: 'General distribution rule', sub: 'One default percentage split for every inflow' },
      { label: 'Funds & Bank Ledger' },
      { label: 'Dashboard overview' },
    ],
    level1: [
      { label: 'Unlimited bank accounts' },
      { label: 'Foreign currency & FX tracking' },
      { label: 'Unlimited statement import', sub: 'No monthly row cap' },
      { label: 'Report Centre' },
      { label: 'Receipt attachments' },
      { label: 'Reconciliation Centre' },
      {
        label: `Custom distribution rules — up to ${customRuleCap}`,
        sub: tier === 'level1'
          ? `${customRuleGroups.length} of ${customRuleCap} used`
          : `Named split rules per income type, e.g. an Easter Offering`,
      },
      { label: 'Invite your team', sub: 'Admin, accountant & viewer roles' },
    ],
    full: [
      { label: 'Unlimited custom distribution rules', sub: `No cap — Level 1 is limited to ${customRuleCap}` },
      { label: 'Custom report builder' },
      { label: 'Bulk fund reallocation' },
      { label: 'Refunds, reversals & pending deductions' },
      { label: 'Bank movement tracking' },
      { label: 'Change log & audit trail' },
      { label: 'Backup & restore' },
      { label: 'Scanned PDF import (OCR)' },
    ],
  }

  const PITCH: Record<PlanTier, string> = {
    free:   'Everything a single-bank church needs to start tracking finances properly.',
    level1: 'Multiple accounts, real reporting, and a team you can bring in.',
    full:   'Complete financial control — special funds, audit trail, full accountability.',
  }

  const PLUS_LINE: Partial<Record<PlanTier, PlanTier>> = { level1: 'free', full: 'level1' }

  const bandClasses: Record<PlanTier, string> = {
    free:   'bg-nav dark:bg-surface-3 text-white',
    level1: 'bg-gradient-to-br from-primary to-primary-dark dark:from-[#10725F] dark:to-[#0B4E41] text-white',
    full:   'bg-gradient-to-br from-accent to-[#A87F2C] dark:from-[#8A6E24] dark:to-[#5E4A18] text-white',
  }

  const iconClasses: Record<PlanTier, string> = {
    free:   'text-gray-400',
    level1: 'text-primary dark:text-primary-dm',
    full:   'text-accent dark:text-accent-dm',
  }

  const discountPct = Math.round((1 - TIER_PRICING.level1.annual / (TIER_PRICING.level1.monthly * 12)) * 100)

  return (
    <div className="space-y-6">
      {lockedFeature && FEATURE_LABEL[lockedFeature] && (
        <Card variant="outlined" className="flex items-start gap-3 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            You tried to open <strong>{FEATURE_LABEL[lockedFeature]}</strong> — that needs the{' '}
            {TIER_DISPLAY_NAME[FEATURE_TIERS[lockedFeature]]} plan.
          </p>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Current plan</p>
            <span className="text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1 block">
              {TIER_DISPLAY_NAME[tier]}
            </span>
          </div>

          {/* Monthly / Annual toggle */}
          <div className="inline-flex items-center rounded-lg border border-gray-200 dark:border-white/10 p-1 bg-gray-50 dark:bg-white/5">
            <button
              type="button"
              onClick={() => setCycle('monthly')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                cycle === 'monthly'
                  ? 'bg-white dark:bg-surface-2 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCycle('annual')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors flex items-center gap-1.5 ${
                cycle === 'annual'
                  ? 'bg-white dark:bg-surface-2 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              Annual
              <span className="text-[10px] font-bold text-success bg-success-light dark:bg-success/20 px-1.5 py-0.5 rounded-full">
                {discountPct}% off
              </span>
            </button>
          </div>
        </div>

        {planExpiresAt && (
          <p className="text-xs text-gray-400 mt-3">Plan valid until {formatDate(planExpiresAt)}</p>
        )}
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-stretch">
        {TIERS.map(t => {
          const isCurrent = t === tier
          const price = TIER_PRICING[t]
          const plusFrom = PLUS_LINE[t]
          return (
            <div
              key={t}
              className={`rounded-2xl overflow-hidden bg-white dark:bg-[#141416] border flex flex-col ${
                isCurrent
                  ? 'border-primary ring-2 ring-primary shadow-card-md'
                  : 'border-black/[0.07] dark:border-white/[0.07] shadow-card'
              }`}
            >
              <div className={`relative px-5 py-5 ${bandClasses[t]}`}>
                {isCurrent && (
                  <span className="absolute top-2 right-2.5 text-[8px] font-bold uppercase tracking-wide bg-white/25 px-1.5 py-0.5 rounded-full">
                    Current plan
                  </span>
                )}
                <div className="text-base font-bold">{TIER_DISPLAY_NAME[t]}</div>
                <div className="text-xs opacity-85 mt-1">
                  {t === 'free'
                    ? 'Free · get started'
                    : cycle === 'monthly'
                      ? `${formatNaira(price.monthly)}/mo`
                      : `${formatNaira(price.annual)}/yr`}
                </div>
                <p className="text-[11px] opacity-80 mt-2.5 leading-relaxed">{PITCH[t]}</p>
              </div>

              {plusFrom && (
                <div className="px-5 py-2.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-white/[0.03] border-b border-black/[0.06] dark:border-white/[0.06]">
                  Everything in <span className="text-gray-800 dark:text-gray-100">{TIER_DISPLAY_NAME[plusFrom]}</span>, plus:
                </div>
              )}

              <ul className="px-5 py-4 flex flex-col gap-3 text-[13px] text-gray-700 dark:text-gray-200 flex-1">
                {FEATURES_BY_TIER[t].map(item => (
                  <li key={item.label} className="flex gap-2.5 items-start">
                    <Check className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${iconClasses[t]}`} />
                    <span>
                      {item.label}
                      {item.sub && (
                        <span className="block text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{item.sub}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="px-5 pb-5">
                {isCurrent ? (
                  <div className="w-full text-center text-sm font-semibold rounded-lg py-2.5 bg-primary-50 dark:bg-primary/15 text-primary dark:text-primary-dm">
                    Your current plan
                  </div>
                ) : TIER_RANK[t] > TIER_RANK[tier] ? (
                  <a
                    href={planChangeMailto(orgName, tier, t)}
                    className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-lg py-2.5 bg-primary text-white hover:opacity-90 transition-opacity"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Move to {TIER_SHORT_NAME[t]}
                  </a>
                ) : (
                  <a
                    href={planChangeMailto(orgName, tier, t)}
                    className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-lg py-2.5 border border-gray-300 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    Switch to {TIER_SHORT_NAME[t]}
                  </a>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {tier === 'free' && importRowsRemaining() === 0 && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          You've used this month's free import allowance — it resets {resetDateLabel}, or upgrade to keep importing now.
        </p>
      )}
    </div>
  )
}
