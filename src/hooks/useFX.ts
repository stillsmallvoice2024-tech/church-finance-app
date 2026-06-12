import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
// ── DB row type ────────────────────────────────────────────────────────────────

export interface FXTransaction {
  id: string
  date: string
  currency: string
  transaction_ref: string | null
  narration: string | null
  deposit: number
  withdrawal: number
  running_balance: number
  created_by: string | null
  created_at: string
  import_seq: number | null
}

// ── Derived summary per currency ───────────────────────────────────────────────

export interface FXCurrencySummary {
  currency: string
  currentBalance: number      // running_balance of the most-recent row
  totalDeposits: number
  totalWithdrawals: number
  transactionCount: number
}

// ── Helper ─────────────────────────────────────────────────────────────────────

function computeSummaries(rows: FXTransaction[]): FXCurrencySummary[] {
  // rows are ordered by date desc then created_at desc
  // → first encounter per currency = latest running_balance
  const map = new Map<string, FXCurrencySummary>()

  for (const row of rows) {
    if (!map.has(row.currency)) {
      map.set(row.currency, {
        currency:         row.currency,
        currentBalance:   Number(row.running_balance),
        totalDeposits:    0,
        totalWithdrawals: 0,
        transactionCount: 0,
      })
    }
    const s = map.get(row.currency)!
    s.totalDeposits    += Number(row.deposit)
    s.totalWithdrawals += Number(row.withdrawal)
    s.transactionCount += 1
  }

  return Array.from(map.values()).sort((a, b) => a.currency.localeCompare(b.currency))
}

// ── useFXTransactions ──────────────────────────────────────────────────────────

export interface FXResult {
  transactions: FXTransaction[]
  summaries: FXCurrencySummary[]
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useFXTransactions(currency?: string): FXResult {
  const orgId = useOrgStore((s) => s.orgId)

  const [transactions, setTransactions] = useState<FXTransaction[]>([])
  const [summaries,    setSummaries]    = useState<FXCurrencySummary[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    let query = supabase
      .from('fx_transactions')
      .select('*')
      .eq('org_id', orgId)
      .order('date',       { ascending: false })
      .order('import_seq', { ascending: false })

    if (currency) query = query.eq('currency', currency.toUpperCase())

    const { data, error: err } = await query

    if (err) {
      setError(err.message)
    } else {
      const rows = (data ?? []) as FXTransaction[]
      setTransactions(rows)
      setSummaries(computeSummaries(rows))
    }
    setLoading(false)
  }, [orgId, currency])

  useEffect(() => { fetch() }, [fetch])

  return { transactions, summaries, loading, error, refetch: fetch }
}
