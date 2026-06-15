import { useEffect, useState, useCallback, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, ShieldAlert, ShieldX, RefreshCw, AlertCircle,
  ChevronDown, ChevronUp, CheckCircle, Clock, Info,
  ExternalLink, BookOpen, FileSearch, ArrowRightLeft, Landmark, Pencil, X,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { usePageTitle } from '../hooks/usePageTitle'
import { useReconciliation } from '../hooks/useReconciliation'
import { useFirstVisitTour } from '../hooks/useFirstVisitTour'
import { HelpButton }        from '../components/onboarding/HelpButton'
import { PageHelpBanner }    from '../components/ui/PageHelpBanner'
import { useBanks } from '../hooks/useBanks'
import { formatCurrency, formatDate, formatWithTimezone } from '../utils/formatters'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { useOrgStore } from '../store/orgStore'
import { getOrgTimezone } from '../utils/timezones'
import type { ReconciliationIssue } from '../utils/reconciliationEngine'
import {
  type HealthStatus,
  type BankHealthSummary,
  healthStatusLabel,
  healthStatusColor,
  healthStatusBg,
  healthStatusDot,
} from '../utils/reconciliationAggregator'

// ── Plain-language issue explanations ─────────────────────────────────────────

const RULE_PLAIN: Record<string, { headline: string; why: ReactNode }> = {
  orphan_transfer: {
    headline: 'A transfer was recorded but has no matching deposit.',
    why: 'Until this is resolved, your bank balance and book records will be out of sync. Check bank movements for an unmatched entry.',
  },
  missing_transfer_pair: {
    headline: 'A deposit exists without a corresponding transfer record.',
    why: 'This usually means a transaction was imported on one side but not the other. Your bank balance may appear incorrect.',
  },
  duplicate_import: {
    headline: 'This transaction ID appears more than once in your records.',
    why: 'A duplicate entry means the same income or expense is being counted twice, overstating your totals.',
  },
  balance_mismatch: {
    headline: 'Your recorded balance does not match your reference bank statement.',
    why: (
      <>
        This difference means your reports are showing an inaccurate balance.{' '}
        Review <Link to="/bank-ledger" className="underline text-primary hover:text-primary-light">recent transactions</Link>,{' '}
        update your <Link to="/setup" className="underline text-primary hover:text-primary-light">bank opening balance</Link>,{' '}
        or <a href="#account-status" className="underline text-primary hover:text-primary-light">review your statement balance</a> to find the gap.
      </>
    ),
  },
  allocation_inconsistency: {
    headline: 'A transaction\'s fund allocation does not match the active distribution rule.',
    why: 'Fund category totals may be off. This can cause incorrect balances in Regular Funds, Designated Gifts, or Savings Funds.',
  },
  negative_balance: {
    headline: 'This bank account is showing a negative balance.',
    why: 'A negative balance usually means an outflow was recorded before the corresponding inflow arrived, or a transaction amount is incorrect.',
  },
  incomplete_reversal: {
    headline: 'A reversal was started but the original transaction has not been fully reversed.',
    why: 'Partial reversals leave your records in an inconsistent state. The affected amount may be double-counted.',
  },
  pending_deduction: {
    headline: 'There are outflow transactions that have not yet been deducted from the account.',
    why: 'Your bank ledger balance is higher than it should be until these deductions are processed.',
  },
}


// Plain-language suggested-fix overrides — shown in the expanded Technical details
// panel in place of the raw suggestedFix string from reconciliationRules.ts.
const RULE_FIX: Record<string, string> = {
  allocation_inconsistency: 'Open Distribution Rules, unlock the relevant config, and correct the row percentages or fund types.',
  orphan_transfer:          'Open Bank Deposits & Transfers, locate this transfer, and verify the bank name matches a current account.',
  missing_transfer_pair:    'Open Bank Deposits & Transfers and check whether both a deposit record and an inflow transaction exist for this entry.',
  balance_mismatch:         'Open the Bank Ledger for this account and compare recent entries against your bank statement.',
  negative_balance:         'Open the Bank Ledger for this account and review recent outflows for missing inflows or incorrect amounts.',
  incomplete_reversal:      'Open the relevant transactions page, edit the record, and link it to its counterpart transaction.',
  pending_deduction:        'Open Upcoming Deductions, locate this transaction, and either clear it or mark it resolved.',
  duplicate_import:         'Open the relevant transactions page, filter by this reference number, and delete the duplicate entry.',
}

// ── Evidence display ───────────────────────────────────────────────────────────
// Maps well-known evidence keys to human labels so the facts needed for action
// (transaction ID, description, date, amount, bank) are visible on the card
// itself — not buried in raw JSON.

const EVIDENCE_LABELS: Record<string, string> = {
  description:      'Description',
  date:             'Date',
  statementDate:    'Statement date',
  amount:           'Amount',
  bank:             'Bank',
  fromBank:         'From bank',
  toBank:           'To bank',
  ref:              'Transaction ref',
  transactionId:    'Record ID',
  transferId:       'Transfer ID',
  depositId:        'Deposit ID',
  matchedInflowId:  'Matched inflow ID',
  count:            'Times it appears',
  bookBalance:      'Book balance',
  referenceBalance: 'Statement balance',
  difference:       'Difference',
  computedBalance:  'Computed balance',
  configName:       'Distribution rule',
  percentageTotal:  'Percentage total',
  missingCount:     'Rows missing fund type',
  rowCount:         'Rows',
  totalRows:        'Total rows',
  transactionType:  'Transaction type',
}

const EVIDENCE_CURRENCY_KEYS = new Set(['amount', 'bookBalance', 'referenceBalance', 'difference', 'computedBalance'])
const EVIDENCE_DATE_KEYS     = new Set(['date', 'statementDate'])

// Ordered for scanning: identity first, then what/when/where, then numbers.
const EVIDENCE_KEY_ORDER = [
  'description', 'ref', 'transactionId', 'transferId', 'depositId', 'matchedInflowId',
  'date', 'statementDate', 'bank', 'fromBank', 'toBank', 'transactionType',
  'amount', 'count', 'bookBalance', 'referenceBalance', 'difference', 'computedBalance',
  'configName', 'percentageTotal', 'missingCount', 'rowCount', 'totalRows',
]

function EvidenceFacts({ evidence, currency }: { evidence: Record<string, unknown>; currency: string }) {
  const entries = EVIDENCE_KEY_ORDER
    .filter(k => k in evidence && evidence[k] !== null && evidence[k] !== undefined && evidence[k] !== '')
    .map(k => {
      const raw = evidence[k]
      let display: string
      if (EVIDENCE_CURRENCY_KEYS.has(k) && typeof raw === 'number') display = formatCurrency(raw, currency)
      else if (EVIDENCE_DATE_KEYS.has(k) && typeof raw === 'string') display = formatDate(raw)
      else if (k === 'percentageTotal' && typeof raw === 'number')   display = `${raw}%`
      else display = String(raw)
      return { key: k, label: EVIDENCE_LABELS[k], value: display }
    })

  if (entries.length === 0) return null

  return (
    <div className="mt-2.5 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Affected record</p>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1.5">
        {entries.map(({ key, label, value }) => (
          <div key={key} className="min-w-0">
            <dt className="text-xs text-gray-500">{label}</dt>
            <dd className={`text-xs text-gray-700 break-words ${
              key === 'transactionId' || key === 'transferId' || key === 'depositId' || key === 'matchedInflowId' || key === 'ref'
                ? 'font-mono select-all' : 'font-medium'
            }`}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ── Small helpers ──────────────────────────────────────────────────────────────

function HealthIcon({ status, size = 'md' }: { status: HealthStatus; size?: 'sm' | 'md' | 'lg' }) {
  const cls = size === 'lg' ? 'w-10 h-10' : size === 'md' ? 'w-6 h-6' : 'w-4 h-4'
  if (status === 'critical') return <ShieldX   className={`${cls} text-red-500`} />
  if (status === 'warning')  return <ShieldAlert className={`${cls} text-amber-500`} />
  return <ShieldCheck className={`${cls} text-green-500`} />
}

function SeverityIcon({ severity }: { severity: ReconciliationIssue['severity'] }) {
  if (severity === 'critical') return <ShieldX      className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
  if (severity === 'warning')  return <AlertCircle  className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
  return <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
}

function severityBadge(s: ReconciliationIssue['severity']) {
  if (s === 'critical') return 'bg-red-100 text-red-700'
  if (s === 'warning')  return 'bg-amber-100 text-amber-700'
  return 'bg-blue-100 text-blue-700'
}

function RuleActionLink({ issue }: { issue: ReconciliationIssue }) {
  const isOutflow = issue.evidence.table === 'outflow_transactions'
  const links: Record<string, { label: string; href: string; icon: React.ElementType }> = {
    orphan_transfer:           { label: 'View Transfers',     href: '/bank-movement?tab=transfers', icon: ArrowRightLeft },
    missing_transfer_pair:     { label: 'View Deposits',      href: '/bank-movement?tab=deposits',  icon: Landmark },
    duplicate_import:          isOutflow
                                 ? { label: 'View Outflows', href: '/outflows', icon: FileSearch }
                                 : { label: 'View Inflows',  href: '/inflows',  icon: FileSearch },
    pending_deduction:         { label: 'View Deductions',    href: '/pending-deductions',           icon: Clock },
    balance_mismatch:          { label: 'View Bank Ledger',   href: '/bank-ledger',                  icon: BookOpen },
    allocation_inconsistency:  { label: 'View Configs',       href: '/percentage-allocations',       icon: FileSearch },
    negative_balance:          { label: 'View Bank Ledger',   href: '/bank-ledger',                  icon: BookOpen },
    incomplete_reversal:       { label: 'View Reversals',     href: '/reversals',                    icon: FileSearch },
  }
  const action = links[issue.ruleId]
  if (!action) return null
  const Icon = action.icon
  return (
    <Link
      to={action.href}
      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
    >
      <Icon className="w-3 h-3" />
      {action.label}
      <ExternalLink className="w-3 h-3" />
    </Link>
  )
}

// ── Issue card ─────────────────────────────────────────────────────────────────

function getIncompleteReversalHeadline(evidence: Record<string, unknown>, issueId: string): string {
  const txnType = evidence.transactionType as string | undefined

  if (txnType === 'bank_deposit') {
    return 'A bank deposit was recorded but the corresponding cash on hand reduction has not been indicated.'
  }

  if (txnType === 'intrabank_transfer') {
    return issueId.includes('-inflow-')
      ? 'An intra-bank transfer inflow was recorded but the initiating bank outflow has not been indicated.'
      : 'An intra-bank transfer outflow was recorded but the associated bank inflow has not been indicated.'
  }

  if (txnType === 'reversal') return 'A reversal was recorded but the original transaction has not been indicated.'
  if (txnType === 'refund')   return 'A refund was recorded but the original transaction has not been indicated.'

  return 'A transaction was marked as an offset but the original transaction it relates to has not been linked.'
}

function IssueCard({ issue, currency }: { issue: ReconciliationIssue; currency: string }) {
  const [expanded, setExpanded] = useState(false)
  const plain = RULE_PLAIN[issue.ruleId]
  const headline = issue.ruleId === 'incomplete_reversal'
    ? getIncompleteReversalHeadline(issue.evidence, issue.id)
    : (plain?.headline ?? issue.message)
  const hasFacts = EVIDENCE_KEY_ORDER.some(
    k => k in issue.evidence && issue.evidence[k] !== null && issue.evidence[k] !== undefined && issue.evidence[k] !== '',
  )
  return (
    <div className={`rounded-xl border border-gray-100 bg-white p-4 border-l-4 shadow-sm ${
      issue.severity === 'critical' ? 'border-l-red-400' :
      issue.severity === 'warning'  ? 'border-l-amber-400' :
      'border-l-blue-400'
    }`}>
      <div className="flex items-start gap-3">
        <SeverityIcon severity={issue.severity} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-800">
            {headline}
            {hasFacts && (
              <span className="font-normal text-gray-400"> — the affected record is shown below.</span>
            )}
          </p>
          {plain?.why && (
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{plain.why}</p>
          )}
          {!plain?.why && issue.suggestedFix && (
            <p className="text-xs text-gray-500 mt-1">{issue.suggestedFix}</p>
          )}

          {/* The facts needed to act — always visible, no expand required */}
          <EvidenceFacts evidence={issue.evidence} currency={currency} />

          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <RuleActionLink issue={issue} />
            <button
              onClick={() => setExpanded(v => !v)}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-600"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Technical details
            </button>
          </div>
          {expanded && (
            <div className="mt-2 space-y-1">
              {(RULE_FIX[issue.ruleId] ?? (plain && issue.suggestedFix)) && (
                <p className="text-xs text-gray-500 italic">{RULE_FIX[issue.ruleId] ?? issue.suggestedFix}</p>
              )}
              <pre className="text-xs text-gray-500 bg-white/70 border border-gray-200 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(issue.evidence, null, 2)}
              </pre>
            </div>
          )}
        </div>
        <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${severityBadge(issue.severity)}`}>
          {issue.severity}
        </span>
      </div>
    </div>
  )
}

// ── Bank status table row (with inline reference-balance edit) ────────────────

interface BankSummaryRowProps {
  summary:    BankHealthSummary
  currency:   string
  bankId:     string | null
  refBalance: { balance: number; date: string } | undefined
  onSave:     (bankId: string | null, bankName: string, balance: number, date: string) => Promise<void>
}

function BankSummaryRow({ summary, currency, bankId, refBalance, onSave }: BankSummaryRowProps) {
  const [editing,      setEditing]      = useState(false)
  const [inputBalance, setInputBalance] = useState('')
  const [inputDate,    setInputDate]    = useState('')
  const [saving,       setSaving]       = useState(false)

  const startEdit = () => {
    setInputBalance(refBalance ? String(refBalance.balance) : '')
    setInputDate(refBalance?.date ?? new Date().toISOString().slice(0, 10))
    setEditing(true)
  }

  const cancelEdit = () => setEditing(false)

  const handleSave = async () => {
    const val = parseFloat(inputBalance)
    if (isNaN(val)) return
    setSaving(true)
    await onSave(bankId, summary.bankName, val, inputDate)
    setSaving(false)
    setEditing(false)
  }

  return (
    <tr className="border-t border-gray-100 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors group">
      {/* Account */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${healthStatusDot(summary.status)}`} />
          <span className="text-sm font-medium text-gray-800">{summary.bankName}</span>
        </div>
      </td>
      {/* Status */}
      <td className="px-4 py-3">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
          summary.status === 'critical' ? 'bg-red-100 text-red-700' :
          summary.status === 'warning'  ? 'bg-amber-100 text-amber-700' :
          'bg-green-100 text-green-700'
        }`}>
          {healthStatusLabel(summary.status)}
        </span>
      </td>
      {/* Book Balance */}
      <td className="px-4 py-3 text-sm text-gray-600 tabular-nums">
        {summary.bookBalance !== undefined ? formatCurrency(summary.bookBalance, currency) : '—'}
      </td>
      {/* Reference Balance — click the pencil to edit inline */}
      <td className="px-4 py-3">
        {editing ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <input
              type="text" inputMode="decimal"
              value={inputBalance}
              onChange={e => setInputBalance(e.target.value)}
              autoFocus
              placeholder="Amount"
              className="w-32 px-2 py-1 text-xs border border-primary/40 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            />
            <input
              type="date"
              value={inputDate}
              onChange={e => setInputDate(e.target.value)}
              className="px-2 py-1 text-xs border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            />
            <button
              onClick={handleSave}
              disabled={saving || !inputBalance}
              className="px-2 py-1 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-50 transition-colors"
            >
              {saving ? '…' : 'Save'}
            </button>
            <button onClick={cancelEdit} className="touch-target p-1 rounded text-gray-400 hover:text-gray-600 transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <div>
              <span className="text-sm text-gray-600 tabular-nums">
                {refBalance !== undefined ? formatCurrency(refBalance.balance, currency) : <span className="text-gray-400">—</span>}
              </span>
              {refBalance && (
                <div className="text-xs text-gray-500">as of {formatDate(refBalance.date)}</div>
              )}
            </div>
            <button
              onClick={startEdit}
              className="opacity-0 group-hover:opacity-100 ml-1 p-0.5 rounded text-gray-400 hover:text-primary transition-all"
              title="Edit reference balance"
            >
              <Pencil className="w-3 h-3" />
            </button>
          </div>
        )}
      </td>
      {/* Difference — prefer live calculation so a just-imported balance is
          reflected immediately without needing to re-run reconciliation. */}
      {(() => {
        const liveDiff =
          summary.bookBalance !== undefined && refBalance !== undefined
            ? summary.bookBalance - refBalance.balance
            : summary.difference
        return (
          <td className={`px-4 py-3 text-sm font-semibold tabular-nums ${
            liveDiff !== undefined && liveDiff < 0 ? 'text-red-600' :
            liveDiff !== undefined && liveDiff > 0 ? 'text-amber-600' :
            'text-gray-400'
          }`}>
            {liveDiff !== undefined
              ? (liveDiff > 0 ? '+' : '') + formatCurrency(liveDiff, currency)
              : '—'}
          </td>
        )
      })()}
      {/* Issues */}
      <td className="px-4 py-3">
        <span className="text-xs text-red-600 font-medium">{summary.criticalCount > 0 ? `${summary.criticalCount} critical` : ''}</span>
        {summary.criticalCount > 0 && summary.warningCount > 0 && <span className="text-gray-300 mx-1">·</span>}
        <span className="text-xs text-amber-600 font-medium">{summary.warningCount > 0 ? `${summary.warningCount} warning` : ''}</span>
      </td>
    </tr>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ReconciliationCenter() {
  usePageTitle('Reconciliation Center')
  useFirstVisitTour('reconciliation')
  const { baseCurrencyCode } = useOrgCurrency()
  const storedTz    = useOrgStore(s => s.timezone)
  const orgTimezone = getOrgTimezone(storedTz, baseCurrencyCode)
  const { banks } = useBanks()
  const {
    result, diagnostics, loading, error,
    history, historyLoading,
    runCheck, fetchHistory,
    saveReferenceBalance, fetchReferenceBalances,
  } = useReconciliation()

  const [refBalances, setRefBalances] = useState<Map<string, { balance: number; date: string }>>(new Map())
  const [showAccountStatus, setShowAccountStatus] = useState(true)
  const [showHistory,       setShowHistory]       = useState(false)
  const [showCritical,   setShowCritical]   = useState(true)
  const [showWarning,    setShowWarning]    = useState(true)
  const [showInfo,       setShowInfo]       = useState(false)

  const loadRefs = useCallback(async () => {
    const map = await fetchReferenceBalances()
    setRefBalances(map)
  }, [fetchReferenceBalances])

  useEffect(() => { loadRefs() }, [loadRefs])

  const handleSaveRef = async (bankId: string | null, bankName: string, balance: number, date: string) => {
    await saveReferenceBalance(bankName, bankId, balance, date)
    await loadRefs()
  }

  const handleRun = async () => {
    await runCheck()
    await fetchHistory()
  }

  const diag = diagnostics

  return (
    <div className="space-y-6">

      {/* Header */}
      <div data-tour="recon-header" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-gray-100">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Reconciliation Center</h1>
          <p className="text-sm text-gray-500 mt-0.5">Verify your app records match your actual bank records</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <HelpButton tourId="reconciliationTour" size="sm" />
          <button
            data-tour="recon-run-button"
            onClick={handleRun}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Running check…' : 'Run Reconciliation'}
          </button>
        </div>
      </div>

      <PageHelpBanner storageKey="help-dismissed-reconciliation" title="About Reconciliation">
        Checks that your app's running bank balances match your actual bank statements. Run it after
        importing to catch discrepancies. If a balance doesn't match, look for missing transactions,
        duplicate imports, or an incorrect opening balance.
      </PageHelpBanner>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* ── Section A: Health Summary ──────────────────────────────────────── */}
      {loading ? (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center" aria-busy="true">
            <div className="w-14 h-14 rounded-full bg-primary-50 flex items-center justify-center animate-pulse">
              <ShieldCheck className="w-8 h-8 text-primary/40" />
            </div>
            <div className="space-y-2 w-full max-w-xs">
              <div className="animate-pulse bg-gray-200 rounded h-4 w-2/3 mx-auto" />
              <div className="animate-pulse bg-gray-200 rounded h-3 w-full" />
            </div>
            <p className="text-xs text-gray-500">Checking your records…</p>
          </div>
        </Card>
      ) : diag ? (
        <div data-tour="recon-health-summary" className={`rounded-xl border p-6 shadow-md ${healthStatusBg(diag.healthStatus)}`}>
          <div className="flex items-start gap-4">
            <HealthIcon status={diag.healthStatus} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className={`text-xl font-bold ${healthStatusColor(diag.healthStatus)}`}>
                  {healthStatusLabel(diag.healthStatus)}
                </h2>
                {result && (
                  <span className="text-xs text-gray-500">
                    Last checked {formatWithTimezone(result.runAt, orgTimezone)}{result.durationMs > 0 ? ` · ${result.durationMs}ms` : ''}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                {[
                  { label: 'Total Issues',     value: diag.totalIssues,        color: 'text-gray-800' },
                  { label: 'Critical',          value: diag.criticalIssues,     color: 'text-red-600' },
                  { label: 'Warnings',          value: diag.warningIssues,      color: 'text-amber-600' },
                  { label: 'Affected Accounts', value: diag.affectedBanks.length, color: 'text-gray-800' },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
                  </div>
                ))}
              </div>
              {diag.totalImbalance > 0 && (
                <p className="text-sm text-gray-600 mt-3">
                  Total identified imbalance: <span className="font-semibold text-red-600">{formatCurrency(diag.totalImbalance, baseCurrencyCode)}</span>
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <Card>
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="w-14 h-14 rounded-full bg-gray-50 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-gray-300" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">Records not yet verified</p>
              <p className="text-xs text-gray-500 mt-1">
                Run a reconciliation check to confirm your records are accurate and complete.
              </p>
            </div>
            <button
              onClick={handleRun}
              disabled={loading}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              Run Reconciliation Check
            </button>
          </div>
        </Card>
      )}

      {/* ── Section B: Account Status Table ───────────────────────────────── */}
      {diag && diag.bankSummaries.length > 0 && (
        <div id="account-status" data-tour="recon-account-status">
          <button
            onClick={() => setShowAccountStatus(v => !v)}
            className="flex items-center gap-2 w-full text-left"
          >
            <Landmark className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-semibold text-gray-700">Account Status</span>
            {showAccountStatus ? <ChevronUp className="w-4 h-4 text-gray-400 ml-auto" /> : <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" />}
          </button>
          {showAccountStatus && (
            <Card padding={false} className="mt-3">
              <div className="overflow-x-auto scroll-x-fade">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b-2 border-black/[0.06] dark:border-white/[0.07]">
                      {['Account', 'Status', 'Book Balance', 'Reference Balance', 'Difference', 'Issues'].map(h => (
                        <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {diag.bankSummaries.map(s => (
                      <BankSummaryRow
                        key={s.bankName}
                        summary={s}
                        currency={baseCurrencyCode}
                        bankId={banks.find(b => b.name === s.bankName)?.id ?? null}
                        refBalance={refBalances.get(s.bankName)}
                        onSave={handleSaveRef}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Section C: Diagnostics Feed ───────────────────────────────────── */}
      {diag && diag.totalIssues > 0 && (
        <div data-tour="recon-issues" className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-sm font-semibold text-gray-700">Issues to Resolve</h2>
            {diag.criticalIssues > 0 && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                {diag.criticalIssues} critical
              </span>
            )}
            {diag.warningIssues > 0 && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                {diag.warningIssues} warning
              </span>
            )}
            {diag.bySeverity.info.length > 0 && (
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                {diag.bySeverity.info.length} info
              </span>
            )}
          </div>
          {diag.criticalIssues > 0 && (
            <p className="text-xs text-gray-500">
              Start with critical issues — they have the biggest effect on your balances.
              Each issue includes a link to the page where it can be fixed.
            </p>
          )}

          {/* Critical */}
          {diag.bySeverity.critical.length > 0 && (
            <div>
              <button
                onClick={() => setShowCritical(v => !v)}
                className="flex items-center gap-2 w-full text-left mb-2"
              >
                <ShieldX className="w-4 h-4 text-red-500" />
                <span className="text-sm font-semibold text-red-700">Critical Issues ({diag.bySeverity.critical.length})</span>
                {showCritical ? <ChevronUp className="w-4 h-4 text-gray-400 ml-auto" /> : <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" />}
              </button>
              {showCritical && (
                <div className="space-y-2">
                  {diag.bySeverity.critical.map(issue => <IssueCard key={issue.id} issue={issue} currency={baseCurrencyCode} />)}
                </div>
              )}
            </div>
          )}

          {/* Warning */}
          {diag.bySeverity.warning.length > 0 && (
            <div>
              <button
                onClick={() => setShowWarning(v => !v)}
                className="flex items-center gap-2 w-full text-left mb-2"
              >
                <AlertCircle className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-amber-700">Warnings ({diag.bySeverity.warning.length})</span>
                {showWarning ? <ChevronUp className="w-4 h-4 text-gray-400 ml-auto" /> : <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" />}
              </button>
              {showWarning && (
                <div className="space-y-2">
                  {diag.bySeverity.warning.map(issue => <IssueCard key={issue.id} issue={issue} currency={baseCurrencyCode} />)}
                </div>
              )}
            </div>
          )}

          {/* Info */}
          {diag.bySeverity.info.length > 0 && (
            <div>
              <button
                onClick={() => setShowInfo(v => !v)}
                className="flex items-center gap-2 w-full text-left mb-2"
              >
                <Info className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-semibold text-blue-700">Informational ({diag.bySeverity.info.length})</span>
                {showInfo ? <ChevronUp className="w-4 h-4 text-gray-400 ml-auto" /> : <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" />}
              </button>
              {showInfo && (
                <div className="space-y-2">
                  {diag.bySeverity.info.map(issue => <IssueCard key={issue.id} issue={issue} currency={baseCurrencyCode} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {diag && diag.totalIssues === 0 && (
        <Card>
          <div className="flex flex-col sm:flex-row items-center gap-4 py-8 text-center sm:text-left">
            <div className="shrink-0 w-14 h-14 rounded-full bg-green-50 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-900">Everything looks good</p>
              <p className="text-sm text-gray-500 mt-0.5">
                All records are reconciled and consistent. No action needed.
              </p>
              {result && (
                <p className="text-xs text-gray-500 mt-1">
                  Verified {formatWithTimezone(result.runAt, orgTimezone)}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ── Run History ───────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => { setShowHistory(v => !v); if (!showHistory) fetchHistory() }}
          className="flex items-center gap-2 w-full text-left"
        >
          <Clock className="w-4 h-4 text-gray-500" />
          <span className="text-sm font-semibold text-gray-700">Verification History</span>
          {showHistory ? <ChevronUp className="w-4 h-4 text-gray-400 ml-auto" /> : <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" />}
        </button>
        {showHistory && (
          <Card padding={false} className="mt-3">
            {historyLoading ? (
              <p className="text-sm text-gray-400 px-6 py-4">Loading…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-gray-400 px-6 py-4">No previous runs recorded.</p>
            ) : (
              <div className="overflow-x-auto scroll-x-fade">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b-2 border-black/[0.06] dark:border-white/[0.07]">
                      {['Run Time', 'Status', 'Critical', 'Warnings', 'Info', 'Total'].map(h => (
                        <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 text-left">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map(run => (
                      <tr key={run.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm text-gray-600">{formatDate(run.run_at.slice(0, 10))}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${
                            run.health_status === 'critical' ? 'bg-red-100 text-red-700' :
                            run.health_status === 'warning'  ? 'bg-amber-100 text-amber-700' :
                            'bg-green-100 text-green-700'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${healthStatusDot(run.health_status)}`} />
                            {healthStatusLabel(run.health_status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-red-600 font-semibold tabular-nums">{run.critical_count || '—'}</td>
                        <td className="px-4 py-3 text-sm text-amber-600 font-semibold tabular-nums">{run.warning_count || '—'}</td>
                        <td className="px-4 py-3 text-sm text-blue-600 tabular-nums">{run.info_count || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 tabular-nums font-medium">{run.issue_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
