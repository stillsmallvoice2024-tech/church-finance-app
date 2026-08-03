import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import { fetchAllRows } from '../utils/fetchAllRows'
import { aggregateFlow, isSameTableOffset, type FlowRow } from '../utils/flowAggregate'

// Aggregates for the Outflows "Simple" view: monthly totals, outflow-type
// breakdown, period total/count, and the prior equal-length period total
// (for a trend delta). Mirrors the outflow inclusion rules used by the
// dashboard so numbers stay consistent — including the directional flip of
// same-table offsets (see src/utils/flowAggregate.ts):
//   • outflow offsets whose root is also an outflow → money back in, excluded
//   • inflow offsets whose root is also an inflow    → money back out, counted here

export interface MonthPoint { month: string; amount: number } // month = 'YYYY-MM'
export interface TypeSlice  { outflowTypeId: string | null; amount: number }

export interface OutflowSummary {
  monthly:   MonthPoint[]
  byType:    TypeSlice[]
  total:     number
  count:     number
  prevTotal: number | null
  loading:   boolean
  error:     string | null
  refetch:   () => void
}

type Raw = {
  date: string
  amount_disbursed: number
  outflow_type_id: string | null
  offset_role: string | null
  root_transaction_table: string | null
}

type FlippedRaw = {
  date: string
  amount: number
}

const TYPE_EXCLUDE = 'transaction_type.is.null,transaction_type.not.in.(bank_deposit,intrabank_transfer)'
// Inflow-side exclusion list — matches the dashboard's inflow query so the
// flipped set is identical on both screens.
const IN_TYPE_EXCLUDE = 'transaction_type.is.null,transaction_type.not.in.(bank_deposit,intrabank_transfer,balance_brought_forward)'

const toFlowRows = (rows: Raw[]): FlowRow[] =>
  rows
    .filter(r => !isSameTableOffset(r, 'outflow_transactions'))
    .map(r => ({ date: r.date, amount: Number(r.amount_disbursed), typeId: r.outflow_type_id }))

// Inflow offsets reversing an inflow — cash back out, so they count as outflows.
const flippedToFlowRows = (rows: FlippedRaw[]): FlowRow[] =>
  rows.map(r => ({ date: r.date, amount: Number(r.amount), typeId: null }))

function shiftBack(dateFrom: string, dateTo: string): { from: string; to: string } {
  const from = new Date(dateFrom)
  const to   = new Date(dateTo)
  const lenMs = to.getTime() - from.getTime()
  const prevTo   = new Date(from.getTime() - 86_400_000)
  const prevFrom = new Date(prevTo.getTime() - lenMs)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { from: iso(prevFrom), to: iso(prevTo) }
}

export function useOutflowSummary(dateFrom: string, dateTo: string): OutflowSummary {
  const orgId = useOrgStore((s) => s.orgId)

  const [monthly,   setMonthly]   = useState<MonthPoint[]>([])
  const [byType,    setByType]    = useState<TypeSlice[]>([])
  const [total,     setTotal]     = useState(0)
  const [count,     setCount]     = useState(0)
  const [prevTotal, setPrevTotal] = useState<number | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId || !dateFrom || !dateTo) { setLoading(false); return }
    setLoading(true)
    setError(null)

    const prev = shiftBack(dateFrom, dateTo)

    const flippedQuery = (from: string, to: string) => supabase
      .from('inflow_transactions')
      .select('date, amount')
      .eq('org_id', orgId)
      .gte('date', from)
      .lte('date', to)
      .eq('offset_role', 'offset')
      .eq('root_transaction_table', 'inflow_transactions')
      .or(IN_TYPE_EXCLUDE)

    const [curRes, prevRes, curFlipRes, prevFlipRes] = await Promise.all([
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('date, amount_disbursed, outflow_type_id, offset_role, root_transaction_table')
        .eq('org_id', orgId)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .or(TYPE_EXCLUDE)),
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('date, amount_disbursed, outflow_type_id, offset_role, root_transaction_table')
        .eq('org_id', orgId)
        .gte('date', prev.from)
        .lte('date', prev.to)
        .or(TYPE_EXCLUDE)),
      fetchAllRows(() => flippedQuery(dateFrom, dateTo)),
      fetchAllRows(() => flippedQuery(prev.from, prev.to)),
    ])

    const firstError = [curRes.error, prevRes.error, curFlipRes.error, prevFlipRes.error].find(Boolean)
    if (firstError) {
      setError(firstError.message)
      setLoading(false)
      return
    }

    const rows = [
      ...toFlowRows((curRes.data ?? []) as Raw[]),
      ...flippedToFlowRows((curFlipRes.data ?? []) as FlippedRaw[]),
    ]
    const prevRows = [
      ...toFlowRows((prevRes.data ?? []) as Raw[]),
      ...flippedToFlowRows((prevFlipRes.data ?? []) as FlippedRaw[]),
    ]

    const agg     = aggregateFlow(rows)
    const prevAgg = aggregateFlow(prevRows)

    setMonthly(agg.monthly)
    setByType(agg.byType.map(({ typeId, amount }) => ({ outflowTypeId: typeId, amount })))
    setTotal(agg.total)
    setCount(agg.count)
    setPrevTotal(prevAgg.count > 0 ? prevAgg.total : null)
    setLoading(false)
  }, [orgId, dateFrom, dateTo])

  useEffect(() => { fetch() }, [fetch])

  return { monthly, byType, total, count, prevTotal, loading, error, refetch: fetch }
}
