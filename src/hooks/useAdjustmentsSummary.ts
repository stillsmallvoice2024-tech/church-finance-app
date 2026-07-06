import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import { fetchAllRows } from '../utils/fetchAllRows'

// All-time aggregates for the Adjustments hub (Upcoming Deductions, Refunds,
// Reversals). Refunds/Reversals are tagged on both inflow_transactions and
// outflow_transactions, in root+offset pairs recording one physical
// adjustment twice (same model as Bank Deposits & Transfers) — only
// offset_role !== 'offset' rows are counted so a pair isn't summed twice.
// Upcoming Deductions has no such pairing: it's outflow_transactions rows
// flagged is_pending_deduction, counted directly.

export interface MonthPoint { month: string; amount: number } // month = 'YYYY-MM'

export interface AdjustmentsSummary {
  pending:    { total: number; count: number }
  refunds:    { total: number; count: number; monthly: MonthPoint[] }
  reversals:  { total: number; count: number; monthly: MonthPoint[] }
  loading:    boolean
  error:      string | null
  refetch:    () => void
}

type TaggedRaw = { date: string; amount: number; offset_role: string | null }

const isRootOrUntagged = (r: { offset_role: string | null }) => r.offset_role !== 'offset'

function monthlyOf(rows: TaggedRaw[]): MonthPoint[] {
  const map = new Map<string, number>()
  for (const r of rows) {
    const ym = r.date.slice(0, 7)
    map.set(ym, (map.get(ym) ?? 0) + Number(r.amount))
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, amount]) => ({ month, amount }))
    .slice(-6)
}

export function useAdjustmentsSummary(): AdjustmentsSummary {
  const orgId = useOrgStore(s => s.orgId)

  const [pending,   setPending]   = useState<AdjustmentsSummary['pending']>({ total: 0, count: 0 })
  const [refunds,   setRefunds]   = useState<AdjustmentsSummary['refunds']>({ total: 0, count: 0, monthly: [] })
  const [reversals, setReversals] = useState<AdjustmentsSummary['reversals']>({ total: 0, count: 0, monthly: [] })
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    const [pendingRes, refundInRes, refundOutRes, reversalInRes, reversalOutRes] = await Promise.all([
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('amount:amount_disbursed')
        .eq('org_id', orgId).eq('is_pending_deduction', true)),
      fetchAllRows(() => supabase
        .from('inflow_transactions')
        .select('date, amount, offset_role')
        .eq('org_id', orgId).eq('transaction_type', 'refund')),
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('date, amount:amount_disbursed, offset_role')
        .eq('org_id', orgId).eq('transaction_type', 'refund')),
      fetchAllRows(() => supabase
        .from('inflow_transactions')
        .select('date, amount, offset_role')
        .eq('org_id', orgId).eq('transaction_type', 'reversal')),
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('date, amount:amount_disbursed, offset_role')
        .eq('org_id', orgId).eq('transaction_type', 'reversal')),
    ])

    const firstError = pendingRes.error ?? refundInRes.error ?? refundOutRes.error ?? reversalInRes.error ?? reversalOutRes.error
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    const pendingRows = pendingRes.data as { amount: number }[]
    setPending({
      total: pendingRows.reduce((s, r) => s + Number(r.amount), 0),
      count: pendingRows.length,
    })

    const refundRows = [
      ...(refundInRes.data  as TaggedRaw[]).filter(isRootOrUntagged),
      ...(refundOutRes.data as TaggedRaw[]).filter(isRootOrUntagged),
    ]
    setRefunds({
      total:   refundRows.reduce((s, r) => s + Number(r.amount), 0),
      count:   refundRows.length,
      monthly: monthlyOf(refundRows),
    })

    const reversalRows = [
      ...(reversalInRes.data  as TaggedRaw[]).filter(isRootOrUntagged),
      ...(reversalOutRes.data as TaggedRaw[]).filter(isRootOrUntagged),
    ]
    setReversals({
      total:   reversalRows.reduce((s, r) => s + Number(r.amount), 0),
      count:   reversalRows.length,
      monthly: monthlyOf(reversalRows),
    })

    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { pending, refunds, reversals, loading, error, refetch: fetch }
}
