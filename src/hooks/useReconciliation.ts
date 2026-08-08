import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import { useAuth } from './useAuth'
import { runReconciliation, type ReconciliationResult, type ReconciliationIssue, type FailedRule } from '../utils/reconciliationEngine'
import { ALL_RULES } from '../utils/reconciliationRules'
import { aggregateDiagnostics, type HealthStatus } from '../utils/reconciliationAggregator'
import { useHealthStore } from '../store/healthStore'
import { useReconciliationStore } from '../store/reconciliationStore'

export interface ReconciliationRun {
  id: string
  run_at: string
  issue_count: number
  critical_count: number
  warning_count: number
  info_count: number
  health_status: HealthStatus
}

/** @deprecated — read from useHealthStore instead; kept for any legacy callers. */
export function getStoredHealthStatus(): { status: HealthStatus; runAt: string } | null {
  const { status, runAt } = useHealthStore.getState()
  return status && runAt ? { status, runAt } : null
}

export function useReconciliation() {
  const orgId    = useOrgStore(s => s.orgId)
  const { user } = useAuth()

  // result + diagnostics live in the store so they survive page navigation
  const storeResult      = useReconciliationStore(s => s.result)
  const storeDiagnostics = useReconciliationStore(s => s.diagnostics)
  const storedOrgId      = useReconciliationStore(s => s.orgId)
  const { setResults, clearResults } = useReconciliationStore.getState()

  const [loading,        setLoading]        = useState(false)
  const [error,          setError]          = useState<string | null>(null)
  const [history,        setHistory]        = useState<ReconciliationRun[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  // Clear cached results when the active org changes
  useEffect(() => {
    if (orgId && storedOrgId && orgId !== storedOrgId) clearResults()
  }, [orgId, storedOrgId, clearResults])

  // On first mount for this org (store is empty), restore last run from DB
  useEffect(() => {
    if (!orgId || storeResult) return       // already have results in memory
    ;(async () => {
      const { data, error } = await supabase
        .from('reconciliation_runs')
        .select('run_at, issues_json, health_status')
        .eq('org_id', orgId)
        .order('run_at', { ascending: false })
        .limit(1)
        .single()
      if (error || !data) return
      const row    = data as { run_at: string; issues_json: unknown; health_status: HealthStatus | null }
      const issues = (Array.isArray(row.issues_json) ? row.issues_json : []) as ReconciliationIssue[]

      // A run stored as incomplete must stay incomplete on restore. We no
      // longer know which rules failed, so carry a single placeholder — the
      // point is that the run must not be re-derived as "healthy".
      const failedRules: FailedRule[] = row.health_status === 'incomplete'
        ? [{ ruleId: 'unknown', ruleName: 'one or more checks', message: 'failed during the saved run' }]
        : []

      const restored: ReconciliationResult = {
        issues,
        failedRules,
        partial: failedRules.length > 0,
        runAt: row.run_at,
        durationMs: 0,
      }
      setResults(restored, aggregateDiagnostics(issues, failedRules), orgId)
    })()
  }, [orgId, storeResult, setResults])

  const runCheck = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const res  = await runReconciliation(orgId, ALL_RULES)
      const diag = aggregateDiagnostics(res.issues, res.failedRules)

      // Surface partial runs as an error banner too — the grey "Unverified"
      // badge alone is easy to mistake for "nothing to report".
      if (res.partial) {
        setError(
          `${res.failedRules.length} of ${ALL_RULES.length} checks could not run ` +
          `(${diag.failedRuleNames.join(', ')}). Results are incomplete — ` +
          `problems may exist that were not detected. Try again.`,
        )
      }

      useHealthStore.getState().setHealth(diag.healthStatus, res.runAt)
      setResults(res, diag, orgId)

      // Add to local history immediately so it's always visible regardless of
      // whether the DB persist succeeds.
      const newRun: ReconciliationRun = {
        id:             crypto.randomUUID(),
        run_at:         res.runAt,
        issue_count:    diag.totalIssues,
        critical_count: diag.criticalIssues,
        warning_count:  diag.warningIssues,
        info_count:     diag.infoIssues,
        health_status:  diag.healthStatus,
      }
      setHistory(prev => [newRun, ...prev.filter(r => r.run_at !== res.runAt)].slice(0, 20))

      // Best-effort persist to DB — silent if table doesn't exist yet
      await supabase.from('reconciliation_runs').insert({
        run_at:         res.runAt,
        issue_count:    diag.totalIssues,
        critical_count: diag.criticalIssues,
        warning_count:  diag.warningIssues,
        info_count:     diag.infoIssues,
        health_status:  diag.healthStatus,
        run_by:         user?.id ?? null,
        issues_json:    res.issues,
        org_id:         orgId,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reconciliation failed')
    } finally {
      setLoading(false)
    }
  }, [orgId, user?.id, setResults])

  const fetchHistory = useCallback(async () => {
    if (!orgId) return
    setHistoryLoading(true)
    const res = await supabase
      .from('reconciliation_runs')
      .select('id, run_at, issue_count, critical_count, warning_count, info_count, health_status')
      .eq('org_id', orgId)
      .order('run_at', { ascending: false })
      .limit(20)
    setHistoryLoading(false)
    if (!res.error && res.data && res.data.length > 0) {
      setHistory(res.data as ReconciliationRun[])
    }
    // On error or empty result we keep whatever is already in local history
    // (e.g. runs from the current session tracked via runCheck).
  }, [orgId])

  // Pre-load history when the org becomes available so the dropdown shows
  // data immediately without requiring the user to click first.
  useEffect(() => {
    if (orgId) fetchHistory()
  }, [orgId, fetchHistory])

  // Reference balance management
  const saveReferenceBalance = useCallback(async (bankName: string, bankId: string | null, referenceBalance: number, statementDate: string) => {
    if (!orgId) return { error: 'No org' }
    // Upsert latest reference per bank_name
    const { error } = await supabase
      .from('bank_statement_balances')
      .upsert(
        { bank_name: bankName, bank_id: bankId, reference_balance: referenceBalance, statement_date: statementDate, org_id: orgId, entered_by: user?.id ?? null },
        { onConflict: 'org_id,bank_name' },
      )
    return { error: error?.message ?? null }
  }, [orgId, user?.id])

  const fetchReferenceBalances = useCallback(async (): Promise<Map<string, { balance: number; date: string }>> => {
    if (!orgId) return new Map()
    const res = await supabase
      .from('bank_statement_balances')
      .select('bank_name, reference_balance, statement_date')
      .eq('org_id', orgId)
      .order('statement_date', { ascending: false })
    if (res.error) return new Map()

    const map = new Map<string, { balance: number; date: string }>()
    for (const r of res.data ?? []) {
      const row = r as { bank_name: string; reference_balance: number; statement_date: string }
      if (!map.has(row.bank_name)) map.set(row.bank_name, { balance: row.reference_balance, date: row.statement_date })
    }
    return map
  }, [orgId])

  return {
    result:      storeResult,
    diagnostics: storeDiagnostics,
    loading,
    error,
    history,
    historyLoading,
    runCheck,
    fetchHistory,
    saveReferenceBalance,
    fetchReferenceBalances,
  }
}
