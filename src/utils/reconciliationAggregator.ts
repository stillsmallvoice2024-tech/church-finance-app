import type { ReconciliationIssue, ReconciliationSeverity } from './reconciliationEngine'

export type HealthStatus = 'healthy' | 'warning' | 'critical'

export interface BankHealthSummary {
  bankName: string
  issueCount: number
  criticalCount: number
  warningCount: number
  infoCount: number
  status: HealthStatus
  bookBalance?: number
  referenceBalance?: number
  difference?: number
  possibleCauses: string[]
}

export interface ReconciliationDiagnostics {
  totalIssues: number
  criticalIssues: number
  warningIssues: number
  infoIssues: number
  affectedBanks: string[]
  affectedCategories: string[]
  totalImbalance: number
  healthStatus: HealthStatus
  bankSummaries: BankHealthSummary[]
  issuesByBank: Map<string, ReconciliationIssue[]>
  issuesByCategory: Map<string, ReconciliationIssue[]>
  issuesByTransaction: Map<string, ReconciliationIssue[]>
  bySeverity: {
    critical: ReconciliationIssue[]
    warning: ReconciliationIssue[]
    info: ReconciliationIssue[]
  }
}

function severityWeight(s: ReconciliationSeverity): number {
  if (s === 'critical') return 3
  if (s === 'warning')  return 2
  return 1
}

function bankStatus(critical: number, warning: number): HealthStatus {
  if (critical > 0) return 'critical'
  if (warning > 0)  return 'warning'
  return 'healthy'
}

const BALANCE_MISMATCH_RULE = 'balance_mismatch'

function possibleCausesForBank(issues: ReconciliationIssue[]): string[] {
  const causes: string[] = []
  const ruleIds = new Set(issues.map(i => i.ruleId))
  if (ruleIds.has('missing_transfer_pair'))    causes.push('possible double-counted deposit')
  if (ruleIds.has('duplicate_import'))          causes.push('duplicate import detected')
  if (ruleIds.has('pending_deduction'))         causes.push('stale pending deduction')
  if (ruleIds.has('orphan_transfer'))           causes.push('transfer to unknown bank')
  if (ruleIds.has('incomplete_reversal'))       causes.push('unlinked reversal')
  if (ruleIds.has('allocation_inconsistency')) causes.push('allocation config mismatch')
  return causes
}

export function aggregateDiagnostics(issues: ReconciliationIssue[]): ReconciliationDiagnostics {
  const issuesByBank       = new Map<string, ReconciliationIssue[]>()
  const issuesByCategory   = new Map<string, ReconciliationIssue[]>()
  const issuesByTransaction = new Map<string, ReconciliationIssue[]>()
  const bySeverity = { critical: [] as ReconciliationIssue[], warning: [] as ReconciliationIssue[], info: [] as ReconciliationIssue[] }

  let criticalIssues = 0
  let warningIssues  = 0
  let infoIssues     = 0
  let totalImbalance = 0

  for (const issue of issues) {
    // Severity buckets
    if (issue.severity === 'critical') { criticalIssues++; bySeverity.critical.push(issue) }
    else if (issue.severity === 'warning') { warningIssues++; bySeverity.warning.push(issue) }
    else { infoIssues++; bySeverity.info.push(issue) }

    // Group by bank
    if (issue.bankName) {
      if (!issuesByBank.has(issue.bankName)) issuesByBank.set(issue.bankName, [])
      issuesByBank.get(issue.bankName)!.push(issue)
    }

    // Group by category
    if (issue.categoryName) {
      if (!issuesByCategory.has(issue.categoryName)) issuesByCategory.set(issue.categoryName, [])
      issuesByCategory.get(issue.categoryName)!.push(issue)
    }

    // Group by transaction
    if (issue.transactionId) {
      if (!issuesByTransaction.has(issue.transactionId)) issuesByTransaction.set(issue.transactionId, [])
      issuesByTransaction.get(issue.transactionId)!.push(issue)
    }

    // Total imbalance from balance_mismatch rule
    if (issue.ruleId === BALANCE_MISMATCH_RULE && typeof issue.evidence.difference === 'number') {
      totalImbalance += Math.abs(issue.evidence.difference as number)
    }
  }

  // Build bank summaries — include all banks mentioned in any issue
  const allBanks = new Set<string>()
  for (const issue of issues) { if (issue.bankName) allBanks.add(issue.bankName) }

  const bankSummaries: BankHealthSummary[] = [...allBanks].map(bankName => {
    const bankIssues = issuesByBank.get(bankName) ?? []
    const critCount  = bankIssues.filter(i => i.severity === 'critical').length
    const warnCount  = bankIssues.filter(i => i.severity === 'warning').length
    const infoCount  = bankIssues.filter(i => i.severity === 'info').length

    // Extract balance data from balance_mismatch evidence if present
    const mismatch = bankIssues.find(i => i.ruleId === BALANCE_MISMATCH_RULE && typeof i.evidence.bookBalance === 'number')
    const bookBalance      = mismatch ? (mismatch.evidence.bookBalance as number) : undefined
    const referenceBalance = mismatch ? (mismatch.evidence.referenceBalance as number | undefined) : undefined
    const difference       = mismatch ? (mismatch.evidence.difference as number | undefined) : undefined

    return {
      bankName,
      issueCount:       bankIssues.length,
      criticalCount:    critCount,
      warningCount:     warnCount,
      infoCount,
      status:           bankStatus(critCount, warnCount),
      bookBalance,
      referenceBalance,
      difference,
      possibleCauses:   possibleCausesForBank(bankIssues),
    }
  }).sort((a, b) => severityWeight(a.status) - severityWeight(b.status) || a.bankName.localeCompare(b.bankName))
  bankSummaries.reverse() // highest severity first

  const overallStatus: HealthStatus =
    criticalIssues > 0 ? 'critical' :
    warningIssues  > 0 ? 'warning'  :
    'healthy'

  return {
    totalIssues:        issues.length,
    criticalIssues,
    warningIssues,
    infoIssues,
    affectedBanks:      [...issuesByBank.keys()],
    affectedCategories: [...issuesByCategory.keys()],
    totalImbalance,
    healthStatus:       overallStatus,
    bankSummaries,
    issuesByBank,
    issuesByCategory,
    issuesByTransaction,
    bySeverity,
  }
}

export function healthStatusLabel(status: HealthStatus): string {
  if (status === 'critical') return 'Critical'
  if (status === 'warning')  return 'Warning'
  return 'Healthy'
}

export function healthStatusColor(status: HealthStatus): string {
  if (status === 'critical') return 'text-red-600'
  if (status === 'warning')  return 'text-amber-600'
  return 'text-green-600'
}

export function healthStatusBg(status: HealthStatus): string {
  if (status === 'critical') return 'bg-red-50 border-red-200'
  if (status === 'warning')  return 'bg-amber-50 border-amber-200'
  return 'bg-green-50 border-green-200'
}

export function healthStatusDot(status: HealthStatus): string {
  if (status === 'critical') return 'bg-red-500'
  if (status === 'warning')  return 'bg-amber-400'
  return 'bg-green-400'
}
