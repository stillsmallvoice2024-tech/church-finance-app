import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { normalizeNarration } from '../utils/normalizeNarration'
import { useOrgStore } from '../store/orgStore'

// ── Output types ───────────────────────────────────────────────────────────────

export interface MonthlyTotal {
  month: string    // 'YYYY-MM'
  inflow: number
  outflow: number
  net: number
}

export interface FXBalance {
  currency: string
  balance: number  // latest running_balance for this currency
}

export interface RecentInflowRow {
  id: string
  date: string
  description: string | null
  display_description: string  // computed client-side via normalizeNarration(); never stored to DB
  amount: number
  stage_code_1: string | null
}

export interface DashboardStats {
  monthlyTotals: MonthlyTotal[]
  totalInflow: number
  totalOutflow: number
  netBalance: number
  fxBalances: FXBalance[]
  recentTransactions: RecentInflowRow[]
  loading: boolean
  error: string | null
  refetch: () => void
}

// ── Pure helpers ───────────────────────────────────────────────────────────────

function buildMonthlyTotals(
  inflows:  { date: string; amount: number }[],
  outflows: { date: string; amount_disbursed: number }[],
): MonthlyTotal[] {
  const map = new Map<string, { inflow: number; outflow: number }>()

  const ensure = (month: string) => {
    if (!map.has(month)) map.set(month, { inflow: 0, outflow: 0 })
    return map.get(month)!
  }

  for (const tx of inflows) {
    ensure(tx.date.slice(0, 7)).inflow += Number(tx.amount)
  }
  for (const tx of outflows) {
    ensure(tx.date.slice(0, 7)).outflow += Number(tx.amount_disbursed)
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { inflow, outflow }]) => ({
      month,
      inflow,
      outflow,
      net: inflow - outflow,
    }))
}

function latestFXBalances(
  rows: { currency: string; running_balance: number }[],
): FXBalance[] {
  // Rows are ordered by date desc + created_at desc, so first hit per currency
  // is the most-recent running_balance.
  const seen = new Set<string>()
  const result: FXBalance[] = []

  for (const row of rows) {
    if (!seen.has(row.currency)) {
      seen.add(row.currency)
      result.push({ currency: row.currency, balance: Number(row.running_balance) })
    }
  }

  return result.sort((a, b) => a.currency.localeCompare(b.currency))
}

// ── useDashboardStats ──────────────────────────────────────────────────────────

export function useDashboardStats(year: number = new Date().getFullYear()): DashboardStats {
  const orgId = useOrgStore((s) => s.orgId)

  const [monthlyTotals, setMonthlyTotals]       = useState<MonthlyTotal[]>([])
  const [totalInflow,   setTotalInflow]          = useState(0)
  const [totalOutflow,  setTotalOutflow]          = useState(0)
  const [fxBalances,    setFxBalances]            = useState<FXBalance[]>([])
  const [recentTxns,    setRecentTxns]            = useState<RecentInflowRow[]>([])
  const [loading,       setLoading]               = useState(true)
  const [error,         setError]                 = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    const yearStart = `${year}-01-01`
    const yearEnd   = `${year}-12-31`

    // ── Fire all four queries in parallel ──────────────────────────────────────
    const [inflowRes, outflowRes, fxRes, recentRes] = await Promise.all([
      // 1. All inflow amounts for the year (minimal columns for aggregation)
      supabase
        .from('inflow_transactions')
        .select('date, amount, offset_role')
        .eq('org_id', orgId)
        .gte('date', yearStart)
        .lte('date', yearEnd),

      // 2. All outflow disbursed amounts for the year
      supabase
        .from('outflow_transactions')
        .select('date, amount_disbursed, offset_role')
        .eq('org_id', orgId)
        .gte('date', yearStart)
        .lte('date', yearEnd),

      // 3. All FX transactions for latest-balance extraction
      supabase
        .from('fx_transactions')
        .select('currency, running_balance')
        .eq('org_id', orgId)
        .order('date',       { ascending: false })
        .order('created_at', { ascending: false }),

      // 4. Recent 10 inflow transactions for the activity feed
      supabase
        .from('inflow_transactions')
        .select('id, date, description, amount, stage_code_1')
        .eq('org_id', orgId)
        .order('date', { ascending: false })
        .limit(10),
    ])

    // ── Surface first error encountered ───────────────────────────────────────
    const firstError = [inflowRes.error, outflowRes.error, fxRes.error, recentRes.error]
      .find(Boolean)

    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    // ── Aggregate client-side (exclude offset rows — they contribute 0) ──────
    const inflows  = ((inflowRes.data  ?? []) as { date: string; amount: number; offset_role: string | null }[])
      .filter(r => r.offset_role !== 'offset')
    const outflows = ((outflowRes.data ?? []) as { date: string; amount_disbursed: number; offset_role: string | null }[])
      .filter(r => r.offset_role !== 'offset')

    const totals   = buildMonthlyTotals(inflows, outflows)
    const totalIn  = inflows.reduce((s, r)  => s + Number(r.amount),          0)
    const totalOut = outflows.reduce((s, r) => s + Number(r.amount_disbursed), 0)
    const fxBals   = latestFXBalances(
      (fxRes.data ?? []) as { currency: string; running_balance: number }[],
    )

    setMonthlyTotals(totals)
    setTotalInflow(totalIn)
    setTotalOutflow(totalOut)
    setFxBalances(fxBals)
    setRecentTxns(
      ((recentRes.data ?? []) as Omit<RecentInflowRow, 'display_description'>[]).map(r => ({
        ...r,
        display_description: normalizeNarration(r.description),
      })) as RecentInflowRow[]
    )
    setLoading(false)
  }, [orgId, year])

  useEffect(() => { fetch() }, [fetch])

  return {
    monthlyTotals,
    totalInflow,
    totalOutflow,
    netBalance: totalInflow - totalOutflow,
    fxBalances,
    recentTransactions: recentTxns,
    loading,
    error,
    refetch: fetch,
  }
}
