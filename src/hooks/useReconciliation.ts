import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import { useAuth } from './useAuth'
import { runReconciliation, type ReconciliationResult } from '../utils/reconciliationEngine'
import { ALL_RULES } from '../utils/reconciliationRules'
import { aggregateDiagnostics, type ReconciliationDiagnostics, type HealthStatus } from '../utils/reconciliationAggregator'

export interface ReconciliationRun {
  id: string
  run_at: string
  issue_count: number
  critical_count: number
  warning_count: number
  info_count: number
  health_status: HealthStatus
}

const HEALTH_STORAGE_KEY = 'church-recon-last-health'

export function getStoredHealthStatus(): { status: HealthStatus; runAt: string } | null {
  try {
    const raw = localStorage.getItem(HEALTH_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function storeHealthStatus(status: HealthStatus, runAt: string) {
  try {
    localStorage.setItem(HEALTH_STORAGE_KEY, JSON.stringify({ status, runAt }))
  } catch { /* storage unavailable */ }
}

export function useReconciliation() {
  const orgId   = useOrgStore(s => s.orgId)
  const { user } = useAuth()

  const [result,      setResult]      = useState<ReconciliationResult | null>(null)
  const [diagnostics, setDiagnostics] = useState<ReconciliationDiagnostics | null>(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [history,     setHistory]     = useState<ReconciliationRun[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const runCheck = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    setError(null)
    try {
      const res = await runReconciliation(orgId, ALL_RULES)
      const diag = aggregateDiagnostics(res.issues)

      storeHealthStatus(diag.healthStatus, res.runAt)
      setResult(res)
      setDiagnostics(diag)

      // Persist run to DB
      await supabase.from('reconciliation_runs').insert({
        run_at:         res.runAt,
        issue_count:    res.issues.length,
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
  }, [orgId, user?.id])

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
    if (!res.error) setHistory((res.data ?? []) as ReconciliationRun[])
  }, [orgId])

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
    result,
    diagnostics,
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
