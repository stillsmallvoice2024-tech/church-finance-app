import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useHealthStore } from '../store/healthStore'

export interface RecordConfidence {
  /** 0–100 composite score, or null when reconciliation has never run. */
  score: number | null
  /** Percentage of transactions with a bank assigned (0–100). */
  bankCompleteness: number
  /** One-line human suggestion for improving the score. */
  suggestion: string | null
  loading: boolean
}

/**
 * Display-only composite confidence score. Reads existing data; performs no writes
 * and no changes to reconciliation logic.
 *
 * Weighting: reconciliation health 60, bank completeness 25, check recency 15.
 */
export function useRecordConfidence(): RecordConfidence {
  const healthStatus = useHealthStore(s => s.status)
  const healthRunAt  = useHealthStore(s => s.runAt)

  const [bankCompleteness, setBankCompleteness] = useState(100)
  const [loading, setLoading] = useState(true)

  const fetchCompleteness = useCallback(async () => {
    setLoading(true)
    const [inAll, inMissing, outAll, outMissing] = await Promise.all([
      supabase.from('inflow_transactions').select('id',  { count: 'exact', head: true }),
      supabase.from('inflow_transactions').select('id',  { count: 'exact', head: true }).is('bank_name', null),
      supabase.from('outflow_transactions').select('id', { count: 'exact', head: true }),
      supabase.from('outflow_transactions').select('id', { count: 'exact', head: true }).is('bank_name', null),
    ])
    const total   = (inAll.count ?? 0) + (outAll.count ?? 0)
    const missing = (inMissing.count ?? 0) + (outMissing.count ?? 0)
    setBankCompleteness(total === 0 ? 100 : Math.round(((total - missing) / total) * 100))
    setLoading(false)
  }, [])

  useEffect(() => { fetchCompleteness() }, [fetchCompleteness])

  if (!healthStatus) {
    return { score: null, bankCompleteness, suggestion: 'Run a reconciliation check to verify your records.', loading }
  }

  const healthPts = healthStatus === 'healthy' ? 60 : healthStatus === 'warning' ? 35 : 15
  const bankPts   = Math.round((bankCompleteness / 100) * 25)

  let recencyPts = 0
  if (healthRunAt) {
    const days = (Date.now() - new Date(healthRunAt).getTime()) / 86_400_000
    recencyPts = days <= 7 ? 15 : days <= 30 ? 10 : days <= 90 ? 5 : 0
  }

  const score = Math.min(100, healthPts + bankPts + recencyPts)

  let suggestion: string | null = null
  if (healthStatus !== 'healthy')   suggestion = 'Resolve the open reconciliation issues to raise your score.'
  else if (bankCompleteness < 100)  suggestion = 'Some transactions have no bank assigned — they are invisible to the Bank Ledger.'
  else if (recencyPts < 15)         suggestion = 'Run a fresh reconciliation check to confirm everything is still in order.'

  return { score, bankCompleteness, suggestion, loading }
}
