import { useSearchParams } from 'react-router-dom'
import { CheckCircle2, Circle, Mail, AlertCircle } from 'lucide-react'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { useOrgStore } from '../../store/orgStore'
import { usePlan, FEATURE_TIERS, type PlanFeature } from '../../hooks/usePlan'
import type { PlanTier } from '../../types'
import { formatDate } from '../../utils/formatters'

const TIER_LABEL: Record<PlanTier, string> = { free: 'Free', level1: 'Level 1', full: 'Full' }

const FEATURE_LABEL: Record<PlanFeature, string> = {
  import:           'Bank statement import (100 rows on Free)',
  multiBank:        'Multiple bank accounts',
  fx:               'Foreign currency & FX tracking',
  reports:          'Report Centre',
  receipts:         'Receipt attachments',
  reconciliation:   'Reconciliation Centre',
  teamInvites:      'Invite team members',
  specialConfigs:   'Special / percentage allocation configs',
  dynamicReports:   'Custom report builder',
  bulkReallocation: 'Bulk reallocation',
  adjustments:      'Refunds, reversals & pending deductions',
  bankMovement:     'Bank movement tracking',
  changeLog:        'Change log / audit trail',
  backupRestore:    'Backup & restore',
  ocrImport:        'Scanned PDF import (OCR)',
}

const TIERS: PlanTier[] = ['free', 'level1', 'full']

const CONTACT_EMAIL = 'stillsmallvoice2024@gmail.com'

function upgradeMailto(orgName: string | null, currentTier: PlanTier): string {
  const subject = encodeURIComponent(`Upgrade request — ${orgName ?? 'my organisation'}`)
  const body = encodeURIComponent(
    `Hi,\n\nI'd like to upgrade our plan from ${TIER_LABEL[currentTier]}.\n\nOrganisation: ${orgName ?? ''}\n`,
  )
  return `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`
}

export function BillingTab() {
  const [searchParams] = useSearchParams()
  const lockedFeature = searchParams.get('locked') as PlanFeature | null

  const orgName        = useOrgStore(s => s.orgName)
  const planExpiresAt  = useOrgStore(s => s.planExpiresAt)
  const { tier, importedRowsCount, importRowsRemaining } = usePlan()

  return (
    <div className="space-y-6">
      {lockedFeature && FEATURE_LABEL[lockedFeature] && (
        <Card variant="outlined" className="flex items-start gap-3 border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700">
          <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            You tried to open <strong>{FEATURE_LABEL[lockedFeature]}</strong> — that needs the{' '}
            {TIER_LABEL[FEATURE_TIERS[lockedFeature]]} plan.
          </p>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Current plan</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xl font-semibold text-gray-900 dark:text-gray-100">{TIER_LABEL[tier]}</span>
              <Badge label={TIER_LABEL[tier]} variant={tier === 'free' ? 'neutral' : tier === 'level1' ? 'primary' : 'success'} />
            </div>
          </div>
          <a
            href={upgradeMailto(orgName, tier)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <Mail className="w-4 h-4" />
            {tier === 'full' ? 'Contact support' : 'Upgrade'}
          </a>
        </div>

        {tier === 'free' && (
          <div className="mt-5">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="text-gray-600 dark:text-gray-300">Import usage</span>
              <span className="font-medium text-gray-800 dark:text-gray-100">{importedRowsCount} / 100 rows</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${Math.min(100, importedRowsCount)}%` }}
              />
            </div>
            {importRowsRemaining() === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                You've used your free import allowance — upgrade to keep importing.
              </p>
            )}
          </div>
        )}

        {planExpiresAt && (
          <p className="text-xs text-gray-400 mt-3">Plan valid until {formatDate(planExpiresAt)}</p>
        )}
      </Card>

      <Card padding={false} className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
          <thead>
            <tr className="border-b border-gray-100 dark:border-white/10">
              <th className="text-left font-medium text-gray-500 dark:text-gray-400 px-4 py-3">Feature</th>
              {TIERS.map(t => (
                <th key={t} className="text-center font-medium text-gray-500 dark:text-gray-400 px-4 py-3">
                  {TIER_LABEL[t]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(Object.keys(FEATURE_LABEL) as PlanFeature[]).map(feature => {
              const requiredTier = FEATURE_TIERS[feature]
              const requiredRank = TIERS.indexOf(requiredTier)
              return (
                <tr key={feature} className="border-b border-gray-50 dark:border-white/5 last:border-0">
                  <td className="px-4 py-2.5 text-gray-700 dark:text-gray-200">{FEATURE_LABEL[feature]}</td>
                  {TIERS.map((t, i) => (
                    <td key={t} className="text-center px-4 py-2.5">
                      {i >= requiredRank
                        ? <CheckCircle2 className="w-4 h-4 text-success inline" />
                        : <Circle className="w-3 h-3 text-gray-200 dark:text-white/10 inline" />}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
