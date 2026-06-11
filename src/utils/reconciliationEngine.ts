// Reconciliation engine — types and rule runner.
// Rules execute independently; a failed rule never crashes the engine.

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

export interface ReconciliationResult {
  issues: ReconciliationIssue[]
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
  for (const r of settled) {
    if (r.status === 'fulfilled') issues.push(...r.value)
    // rejected rules are silently skipped — engine must not crash
  }
  return {
    issues,
    runAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  }
}
