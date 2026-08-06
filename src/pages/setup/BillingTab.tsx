import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Mail, AlertCircle, Check, Loader2, Settings } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { ContactEmailModal, type EmailDraft } from '../../components/modals/ContactEmailModal'
import { supabase } from '../../lib/supabase'
import { useOrgStore } from '../../store/orgStore'
import { useToastStore } from '../../store/toastStore'
import { useSpecialConfigGroups } from '../../hooks/useSpecialConfigGroups'
import { useBanks } from '../../hooks/useBanks'
import {
  usePlan, FEATURE_TIERS, TIER_DISPLAY_NAME, TIER_SHORT_NAME, TIER_PRICING, QUANTITY_LIMITS, TIER_RANK,
  type PlanFeature,
} from '../../hooks/usePlan'
import type { PlanTier } from '../../types'
import { formatDate } from '../../utils/formatters'

type PayableTier = 'level1' | 'full'
const isPayableTier = (t: PlanTier): t is PayableTier => t === 'level1' || t === 'full'

const TIERS: PlanTier[] = ['free', 'level1', 'full']

// Short labels for the "you tried to open X" banner — kept separate from the
// per-card marketing copy below since this needs to name the specific route
// a user bounced off of, not sell the tier.
const FEATURE_LABEL: Record<PlanFeature, string> = {
  import:                  'Bank statement import',
  multiBank:               'Multiple bank accounts',
  fx:                      'Foreign currency & FX tracking',
  reports:                 'Standard Reports',
  boardReport:             'Board Report',
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

// Stripe checkout/portal endpoints already exist (create-checkout-session,
// create-portal-session below) but aren't fully wired up yet — every plan
// change (upgrade, downgrade, manage billing) routes through a support
// email until this flips to true. Flip it once Stripe is actually live;
// the permanent "prefer email" contact link at the bottom of this tab stays
// either way, so email keeps working as a fallback even after Stripe is on.
const STRIPE_BILLING_ENABLED = false

function planChangeEmail(orgName: string | null, currentTier: PlanTier, targetTier: PlanTier): EmailDraft {
  const action = TIER_RANK[targetTier] > TIER_RANK[currentTier] ? 'Upgrade' : 'Downgrade'
  return {
    to:      CONTACT_EMAIL,
    subject: `${action} to ${TIER_DISPLAY_NAME[targetTier]} — ${orgName ?? 'my organisation'}`,
    body:
      `Hi,\n\nI'd like to ${action.toLowerCase()} our organisation from ${TIER_DISPLAY_NAME[currentTier]} to ` +
      `${TIER_DISPLAY_NAME[targetTier]}.\n\nOrganisation: ${orgName ?? ''}\n`,
  }
}

function manageBillingEmail(orgName: string | null, currentTier: PlanTier): EmailDraft {
  return {
    to:      CONTACT_EMAIL,
    subject: `Manage billing — ${orgName ?? 'my organisation'}`,
    body:
      `Hi,\n\nI'd like to manage our organisation's billing (update payment method, view invoices, change plan, etc.).\n\n` +
      `Organisation: ${orgName ?? ''}\nCurrent plan: ${TIER_DISPLAY_NAME[currentTier]}\n`,
  }
}

function formatNaira(amount: number): string {
  return amount === 0 ? '₦0' : `₦${amount.toLocaleString('en-NG')}`
}

type BillingCycle = 'monthly' | 'annual'

interface FeatureItem { label: string; sub?: string }

export function BillingTab() {
  const [searchParams, setSearchParams] = useSearchParams()
  const lockedFeature = searchParams.get('locked') as PlanFeature | null
  const checkoutResult = searchParams.get('checkout')
  const [cycle, setCycle] = useState<BillingCycle>('monthly')
  const [pendingTier, setPendingTier] = useState<PlanTier | null>(null)
  const [portalPending, setPortalPending] = useState(false)
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null)

  const orgId          = useOrgStore(s => s.orgId)
  const orgName        = useOrgStore(s => s.orgName)
  const planExpiresAt  = useOrgStore(s => s.planExpiresAt)
  const planStatus     = useOrgStore(s => s.planStatus)
  const trialEndsAt    = useOrgStore(s => s.trialEndsAt)
  const defaultCurrency = useOrgStore(s => s.defaultCurrency)
  const { tier, importedRowsCount, importRowsRemaining, importResetDate } = usePlan()
  const resetDateLabel = formatDate(importResetDate())
  const { groups: customRuleGroups } = useSpecialConfigGroups()
  const customRuleCap = QUANTITY_LIMITS.customDistributionRules?.level1 ?? 2
  const { banks } = useBanks()
  const fxCurrencyCap = QUANTITY_LIMITS.fx?.level1 ?? 1
  const fxCurrenciesUsed = new Set(
    banks.filter(b => b.currency && b.currency !== (defaultCurrency ?? 'NGN')).map(b => b.currency)
  ).size
  const { push: toast } = useToastStore()

  useEffect(() => {
    if (!checkoutResult) return
    if (checkoutResult === 'success') toast('Payment received — your plan is updating now.', 'success')
    if (checkoutResult === 'cancelled') toast('Checkout was cancelled — no changes were made.', 'info')
    const next = new URLSearchParams(searchParams)
    next.delete('checkout')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkoutResult])

  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
    : null

  async function startCheckout(targetTier: PayableTier) {
    if (!orgId || pendingTier) return
    setPendingTier(targetTier)
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout-session', {
        body: { org_id: orgId, tier: targetTier, cycle },
      })
      if (error) throw error
      const result = data as { ok: boolean; url?: string; error?: string }
      if (!result.ok || !result.url) throw new Error(result.error ?? 'Checkout could not be started')
      window.location.href = result.url
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not start checkout', 'error')
      setPendingTier(null)
    }
  }

  async function openBillingPortal() {
    if (!orgId || portalPending) return
    setPortalPending(true)
    try {
      const { data, error } = await supabase.functions.invoke('create-portal-session', {
        body: { org_id: orgId },
      })
      if (error) throw error
      const result = data as { ok: boolean; url?: string; error?: string }
      if (!result.ok || !result.url) throw new Error(result.error ?? 'Billing portal is unavailable')
      window.location.href = result.url
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not open billing portal', 'error')
      setPortalPending(false)
    }
  }

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
      {
        label: `Foreign currency & FX tracking — up to ${fxCurrencyCap}`,
        sub: tier === 'level1'
          ? `${fxCurrenciesUsed} of ${fxCurrencyCap} currencies used · unlimited banks in it`
          : 'One foreign currency, unlimited banks in it',
      },
      { label: 'Unlimited statement import', sub: 'No monthly row cap' },
      { label: 'Standard Reports' },
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
      { label: 'Unlimited custom distribution rules', sub: `No cap — Growth is limited to ${customRuleCap}` },
      { label: 'Unlimited foreign currencies', sub: `No cap — Growth is limited to ${fxCurrencyCap}` },
      { label: 'Board Report' },
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
              {planStatus === 'trialing' && trialDaysLeft !== null && (
                <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide text-primary bg-primary-50 dark:bg-primary/15 dark:text-primary-dm px-1.5 py-0.5 rounded-full">
                  Trial · {trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'} left
                </span>
              )}
              {planStatus === 'past_due' && (
                <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wide text-red-700 bg-red-50 dark:bg-red-900/30 dark:text-red-300 px-1.5 py-0.5 rounded-full">
                  Payment failed
                </span>
              )}
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

        {planStatus === 'trialing' && trialEndsAt && (
          <p className="text-xs text-gray-400 mt-3">Trial ends {formatDate(trialEndsAt)} — add a card in billing to keep {TIER_DISPLAY_NAME[tier]} after that.</p>
        )}
        {planStatus !== 'trialing' && planExpiresAt && (
          <p className="text-xs text-gray-400 mt-3">Plan valid until {formatDate(planExpiresAt)}</p>
        )}

        {tier !== 'free' && (
          STRIPE_BILLING_ENABLED ? (
            <button
              type="button"
              onClick={openBillingPortal}
              disabled={portalPending}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary dark:text-primary-dm hover:underline disabled:opacity-60"
            >
              {portalPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Settings className="w-3.5 h-3.5" />}
              Manage billing
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEmailDraft(manageBillingEmail(orgName, tier))}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-primary dark:text-primary-dm hover:underline"
            >
              <Mail className="w-3.5 h-3.5" />
              Manage billing
            </button>
          )
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
                ) : TIER_RANK[t] > TIER_RANK[tier] && isPayableTier(t) ? (
                  STRIPE_BILLING_ENABLED ? (
                    <button
                      type="button"
                      onClick={() => startCheckout(t)}
                      disabled={pendingTier !== null}
                      className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-lg py-2.5 bg-primary text-white hover:opacity-90 transition-opacity disabled:opacity-60"
                    >
                      {pendingTier === t ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      Move to {TIER_SHORT_NAME[t]}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEmailDraft(planChangeEmail(orgName, tier, t))}
                      className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-lg py-2.5 bg-primary text-white hover:opacity-90 transition-opacity"
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Move to {TIER_SHORT_NAME[t]}
                    </button>
                  )
                ) : t === 'free' && STRIPE_BILLING_ENABLED ? (
                  <button
                    type="button"
                    onClick={openBillingPortal}
                    disabled={portalPending}
                    className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-lg py-2.5 border border-gray-300 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors disabled:opacity-60"
                  >
                    {portalPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Switch to {TIER_SHORT_NAME[t]}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEmailDraft(planChangeEmail(orgName, tier, t))}
                    className="w-full inline-flex items-center justify-center gap-2 text-sm font-semibold rounded-lg py-2.5 border border-gray-300 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Switch to {TIER_SHORT_NAME[t]}
                  </button>
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

      {/* Permanent fallback — stays even once Stripe checkout/portal is live. */}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Prefer email? Reach us at{' '}
        <button
          type="button"
          onClick={() => setEmailDraft(manageBillingEmail(orgName, tier))}
          className="underline hover:text-primary dark:hover:text-primary-dm"
        >
          {CONTACT_EMAIL}
        </button>{' '}
        any time for help with your plan or billing.
      </p>

      {emailDraft && (
        <ContactEmailModal
          open
          onClose={() => setEmailDraft(null)}
          draft={emailDraft}
          description="No email app set up? Use Gmail or copy the message below into whatever you use."
        />
      )}
    </div>
  )
}
