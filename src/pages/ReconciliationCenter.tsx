import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck, ShieldAlert, ShieldX, RefreshCw, AlertCircle,
  ChevronDown, ChevronUp, CheckCircle, Clock, Info,
  ExternalLink, BookOpen, FileSearch, ArrowRightLeft, Landmark, Pencil, X,
} from 'lucide-react'
import { Card } from '../components/ui/Card'
import { usePageTitle } from '../hooks/usePageTitle'
import { useReconciliation } from '../hooks/useReconciliation'
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

function IssueCard({ issue }: { issue: ReconciliationIssue }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`rounded-xl border p-4 ${
      issue.severity === 'critical' ? 'border-red-200 bg-red-50/40' :
      issue.severity === 'warning'  ? 'border-amber-200 bg-amber-50/40' :
      'border-blue-200 bg-blue-50/40'
    }`}>
      <div className="flex items-start gap-3">
        <SeverityIcon severity={issue.severity} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-800">{issue.message}</p>
          <p className="text-xs text-gray-500 mt-1">{issue.suggestedFix}</p>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <RuleActionLink issue={issue} />
            <button
              onClick={() => setExpanded(v => !v)}
              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Evidence
            </button>
          </div>
          {expanded && (
            <pre className="mt-2 text-xs text-gray-500 bg-white/70 border border-gray-200 rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(issue.evidence, null, 2)}
            </pre>
          )}
        </div>
        <span className={`shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${severityBadge(issue.severity)}`}>
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
    <tr className="border-t border-gray-100 hover:bg-gray-50 transition-colors group">
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
              type="number"
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
            <button onClick={cancelEdit} className="p-1 rounded text-gray-400 hover:text-gray-600 transition-colors">
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
                <div className="text-xs text-gray-400">as of {formatDate(refBalance.date)}</div>
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
      {/* Difference */}
      <td className={`px-4 py-3 text-sm font-semibold tabular-nums ${
        summary.difference !== undefined && summary.difference < 0 ? 'text-red-600' :
        summary.difference !== undefined && summary.difference > 0 ? 'text-amber-600' :
        'text-gray-400'
      }`}>
        {summary.difference !== undefined
          ? (summary.difference > 0 ? '+' : '') + formatCurrency(summary.difference, currency)
          : '—'}
      </td>
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reconciliation Center</h1>
          <p className="text-sm text-gray-500 mt-0.5">Verify your app records match your actual bank records</p>
        </div>
        <button
          onClick={handleRun}
          disabled={loading}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? 'Running check…' : 'Run Reconciliation'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* ── Section A: Health Summary ──────────────────────────────────────── */}
      {diag ? (
        <div className={`rounded-xl border p-6 ${healthStatusBg(diag.healthStatus)}`}>
          <div className="flex items-start gap-4">
            <HealthIcon status={diag.healthStatus} size="lg" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className={`text-xl font-bold ${healthStatusColor(diag.healthStatus)}`}>
                  {healthStatusLabel(diag.healthStatus)}
                </h2>
                {result && (
                  <span className="text-xs text-gray-400">
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
            <ShieldCheck className="w-12 h-12 text-gray-200" />
            <p className="text-sm font-medium text-gray-600">No reconciliation run yet</p>
            <p className="text-xs text-gray-400">Press "Run Reconciliation" to check your records.</p>
          </div>
        </Card>
      )}

      {/* ── Section B: Account Status Table ───────────────────────────────── */}
      {diag && diag.bankSummaries.length > 0 && (
        <div>
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
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['Account', 'Status', 'Book Balance', 'Reference Balance', 'Difference', 'Issues'].map(h => (
                        <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left">{h}</th>
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
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-gray-700">Diagnostics</h2>

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
                  {diag.bySeverity.critical.map(issue => <IssueCard key={issue.id} issue={issue} />)}
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
                  {diag.bySeverity.warning.map(issue => <IssueCard key={issue.id} issue={issue} />)}
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
                  {diag.bySeverity.info.map(issue => <IssueCard key={issue.id} issue={issue} />)}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {diag && diag.totalIssues === 0 && (
        <Card>
          <div className="flex items-center gap-3 py-6">
            <CheckCircle className="w-8 h-8 text-green-500 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-800">No issues found</p>
              <p className="text-xs text-gray-500">All reconciliation rules passed. Your records appear consistent.</p>
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
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {['Run Time', 'Status', 'Critical', 'Warnings', 'Info', 'Total'].map(h => (
                        <th key={h} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left">{h}</th>
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
