// Reconciliation engine — types and rule runner.
// Rules execute independently; a failed rule never crashes the engine, but it
// is never silently discarded either — every failure is reported back so the
// caller can refuse to claim a clean bill of health it did not actually verify.

export type ReconciliationSeverity = 'critical' | 'warning' | 'info'

export interface ReconciliationIssue {
  id: string                          // deterministic composite key (ruleId + context)
  ruleId: string
  severity: ReconciliationSeverity
  message: string
  evidence: Record<string, unknown>
  suggestedFix: string
  bankName?: string
  categoryName?: string
  transactionId?: string
}

/** A rule that could not complete — its checks were NOT performed. */
export interface FailedRule {
  ruleId: string
  ruleName: string
  message: string
}

export interface ReconciliationResult {
  issues: ReconciliationIssue[]
  /** Rules that threw. Non-empty means the run verified less than it should have. */
  failedRules: FailedRule[]
  /** True when at least one rule failed — results are incomplete, not clean. */
  partial: boolean
  runAt: string     // ISO timestamp
  durationMs: number
}

export interface ReconciliationRule {
  id: string
  name: string
  description: string
  run(orgId: string): Promise<ReconciliationIssue[]>
}

export async function runReconciliation(
  orgId: string,
  rules: ReconciliationRule[],
): Promise<ReconciliationResult> {
  const start = Date.now()
  const settled = await Promise.allSettled(rules.map(r => r.run(orgId)))
  const issues: ReconciliationIssue[] = []
  const failedRules: FailedRule[] = []

  settled.forEach((outcome, i) => {
    const rule = rules[i]
    if (outcome.status === 'fulfilled') {
      issues.push(...outcome.value)
      return
    }
    // A rejected rule did not run its checks. Record it — never treat the
    // absence of issues from a broken rule as evidence that nothing is wrong.
    failedRules.push({
      ruleId:   rule.id,
      ruleName: rule.name,
      message:  outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
    })
  })

  return {
    issues,
    failedRules,
    partial: failedRules.length > 0,
    runAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  }
}
