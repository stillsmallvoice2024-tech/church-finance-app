import { describe, it, expect } from 'vitest'
import { runReconciliation, type ReconciliationIssue, type ReconciliationRule } from '../reconciliationEngine'
import { aggregateDiagnostics } from '../reconciliationAggregator'

const ORG = 'org-1'

function rule(id: string, issues: ReconciliationIssue[]): ReconciliationRule {
  return { id, name: `Rule ${id}`, description: '', run: async () => issues }
}

function failingRule(id: string, message = 'JWT expired'): ReconciliationRule {
  return { id, name: `Rule ${id}`, description: '', run: async () => { throw new Error(message) } }
}

function issue(over: Partial<ReconciliationIssue> = {}): ReconciliationIssue {
  return {
    id: 'i1',
    ruleId: 'balance_mismatch',
    severity: 'critical',
    message: 'mismatch',
    evidence: {},
    suggestedFix: '',
    ...over,
  }
}

describe('runReconciliation — failed rules are reported, not swallowed', () => {
  it('reports a clean run as not partial', async () => {
    const res = await runReconciliation(ORG, [rule('a', []), rule('b', [])])
    expect(res.partial).toBe(false)
    expect(res.failedRules).toEqual([])
  })

  it('does not crash when a rule throws', async () => {
    const res = await runReconciliation(ORG, [failingRule('a'), rule('b', [])])
    expect(res.issues).toEqual([])
  })

  it('records the id, name and message of each failed rule', async () => {
    const res = await runReconciliation(ORG, [failingRule('a', 'network down'), rule('b', [])])
    expect(res.partial).toBe(true)
    expect(res.failedRules).toEqual([
      { ruleId: 'a', ruleName: 'Rule a', message: 'network down' },
    ])
  })

  it('attributes failures to the right rule when they are interleaved', async () => {
    const res = await runReconciliation(ORG, [
      rule('a', []),
      failingRule('b', 'boom-b'),
      rule('c', []),
      failingRule('d', 'boom-d'),
    ])
    expect(res.failedRules.map(f => f.ruleId)).toEqual(['b', 'd'])
    expect(res.failedRules.map(f => f.message)).toEqual(['boom-b', 'boom-d'])
  })

  it('still collects issues from the rules that did succeed', async () => {
    const res = await runReconciliation(ORG, [failingRule('a'), rule('b', [issue()])])
    expect(res.issues).toHaveLength(1)
    expect(res.partial).toBe(true)
  })

  it('marks the run partial when every rule fails', async () => {
    const res = await runReconciliation(ORG, [failingRule('a'), failingRule('b')])
    expect(res.issues).toEqual([])
    expect(res.failedRules).toHaveLength(2)
    expect(res.partial).toBe(true)
  })
})

describe('aggregateDiagnostics — "healthy" requires that every check ran', () => {
  it('reports healthy when all rules ran and found nothing', () => {
    const diag = aggregateDiagnostics([], [])
    expect(diag.healthStatus).toBe('healthy')
    expect(diag.partial).toBe(false)
  })

  it('REGRESSION: never reports healthy when a rule failed and found nothing', () => {
    const diag = aggregateDiagnostics([], [
      { ruleId: 'balance_mismatch', ruleName: 'Balance Mismatch', message: 'JWT expired' },
    ])
    expect(diag.healthStatus).toBe('incomplete')
    expect(diag.healthStatus).not.toBe('healthy')
  })

  it('REGRESSION: total failure of every rule is never healthy', async () => {
    const res  = await runReconciliation(ORG, [failingRule('a'), failingRule('b'), failingRule('c')])
    const diag = aggregateDiagnostics(res.issues, res.failedRules)
    expect(diag.totalIssues).toBe(0)
    expect(diag.healthStatus).toBe('incomplete')
  })

  it('exposes the failed rule names for display', () => {
    const diag = aggregateDiagnostics([], [
      { ruleId: 'a', ruleName: 'Balance Mismatch', message: 'x' },
      { ruleId: 'b', ruleName: 'Duplicate Import', message: 'y' },
    ])
    expect(diag.failedRuleNames).toEqual(['Balance Mismatch', 'Duplicate Import'])
  })

  it('keeps critical status when real problems were found alongside a failure', () => {
    const diag = aggregateDiagnostics([issue({ severity: 'critical' })], [
      { ruleId: 'b', ruleName: 'Duplicate Import', message: 'y' },
    ])
    // A confirmed critical issue outranks incompleteness — but the run is
    // still flagged partial so the user knows more may be undetected.
    expect(diag.healthStatus).toBe('critical')
    expect(diag.partial).toBe(true)
  })

  it('keeps warning status when a warning was found alongside a failure', () => {
    const diag = aggregateDiagnostics([issue({ severity: 'warning' })], [
      { ruleId: 'b', ruleName: 'Duplicate Import', message: 'y' },
    ])
    expect(diag.healthStatus).toBe('warning')
    expect(diag.partial).toBe(true)
  })

  it('treats info-only issues with a failed rule as incomplete, not healthy', () => {
    const diag = aggregateDiagnostics([issue({ severity: 'info' })], [
      { ruleId: 'b', ruleName: 'Duplicate Import', message: 'y' },
    ])
    expect(diag.healthStatus).toBe('incomplete')
  })

  it('defaults to a complete run when no failure list is supplied', () => {
    const diag = aggregateDiagnostics([])
    expect(diag.partial).toBe(false)
    expect(diag.healthStatus).toBe('healthy')
  })
})
