import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import { fetchAllRows } from '../utils/fetchAllRows'

// Aggregates for the Inflows "Simple" view: monthly totals, income-type
// breakdown, period total/count, and the prior equal-length period total
// (for a trend delta). Mirrors the inflow inclusion rules used by the
// dashboard so numbers stay consistent.

export interface MonthPoint { month: string; amount: number } // month = 'YYYY-MM'
export interface TypeSlice  { incomeTypeId: string | null; amount: number }

export interface InflowSummary {
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
  amount: number
  income_type_id: string | null
  offset_role: string | null
  root_transaction_table: string | null
}

// Excludes inflow offsets whose root is also an inflow (avoids double counting).
const included = (r: Raw) =>
  !(r.offset_role === 'offset' && r.root_transaction_table === 'inflow_transactions')

const TYPE_EXCLUDE = 'transaction_type.is.null,transaction_type.not.in.(bank_deposit,intrabank_transfer,balance_brought_forward)'

function shiftBack(dateFrom: string, dateTo: string): { from: string; to: string } {
  const from = new Date(dateFrom)
  const to   = new Date(dateTo)
  const lenMs = to.getTime() - from.getTime()
  const prevTo   = new Date(from.getTime() - 86_400_000)          // day before range start
  const prevFrom = new Date(prevTo.getTime() - lenMs)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { from: iso(prevFrom), to: iso(prevTo) }
}

export function useInflowSummary(dateFrom: string, dateTo: string): InflowSummary {
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

    const [curRes, prevRes] = await Promise.all([
      fetchAllRows(() => supabase
        .from('inflow_transactions')
        .select('date, amount, income_type_id, offset_role, root_transaction_table')
        .eq('org_id', orgId)
        .gte('date', dateFrom)
        .lte('date', dateTo)
        .or(TYPE_EXCLUDE)),
      fetchAllRows(() => supabase
        .from('inflow_transactions')
        .select('date, amount, offset_role, root_transaction_table')
        .eq('org_id', orgId)
        .gte('date', prev.from)
        .lte('date', prev.to)
        .or(TYPE_EXCLUDE)),
    ])

    if (curRes.error || prevRes.error) {
      setError((curRes.error ?? prevRes.error)!.message)
      setLoading(false)
      return
    }

    const rows = ((curRes.data ?? []) as Raw[]).filter(included)

    const monthMap = new Map<string, number>()
    const typeMap  = new Map<string | null, number>()
    let sum = 0
    for (const r of rows) {
      const amt = Number(r.amount)
      sum += amt
      monthMap.set(r.date.slice(0, 7), (monthMap.get(r.date.slice(0, 7)) ?? 0) + amt)
      typeMap.set(r.income_type_id, (typeMap.get(r.income_type_id) ?? 0) + amt)
    }

    const prevRows = ((prevRes.data ?? []) as Raw[]).filter(included)
    const prevSum  = prevRows.reduce((s, r) => s + Number(r.amount), 0)

    setMonthly(
      Array.from(monthMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, amount]) => ({ month, amount })),
    )
    setByType(
      Array.from(typeMap.entries())
        .map(([incomeTypeId, amount]) => ({ incomeTypeId, amount }))
        .sort((a, b) => b.amount - a.amount),
    )
    setTotal(sum)
    setCount(rows.length)
    setPrevTotal(prevRows.length > 0 ? prevSum : null)
    setLoading(false)
  }, [orgId, dateFrom, dateTo])

  useEffect(() => { fetch() }, [fetch])

  return { monthly, byType, total, count, prevTotal, loading, error, refetch: fetch }
}
