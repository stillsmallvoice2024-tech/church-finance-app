import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAllocationStore, getConfigForDate } from '../store/allocationStore'
import { useCategories } from './useCategories'
import type { ReportCategoryBalance, ReportBasis, OperationalBalanceMap } from '../types'

export function useReportEngine(
  reportDate: string | null,
  reportBasis: ReportBasis = 'transaction_date',
): {
  balances: Map<string, ReportCategoryBalance>
  operationalBalances: OperationalBalanceMap
  loading: boolean
  error: string | null
  refetch: () => void
} {
  const [balances,            setBalances]            = useState<Map<string, ReportCategoryBalance>>(new Map())
  const [operationalBalances, setOperationalBalances] = useState<OperationalBalanceMap>(new Map())
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const { configs, fetch: fetchConfigs, loaded } = useAllocationStore()
  const { categories } = useCategories()

  useEffect(() => { if (!loaded) fetchConfigs() }, [loaded, fetchConfigs])

  const compute = useCallback(async () => {
    if (!reportDate) {
      setBalances(new Map())
      setOperationalBalances(new Map())
      return
    }

    setLoading(true)
    setError(null)

    // ── Date filters based on basis ─────────────────────────────────────────
    // Financial (transaction_date): cumulative up-to date using the transaction date field
    // Operational (recorded_at): cumulative up-to date using recorded_at
    const endOfDay = `${reportDate}T23:59:59.999Z`

    const dateField   = reportBasis === 'recorded_at' ? 'recorded_at' : 'date'
    const dateValue   = reportBasis === 'recorded_at' ? endOfDay : reportDate

    // For operational inflow row totals: exact day filter on recorded_at
    const dayStart = `${reportDate}T00:00:00.000Z`

    const [seedRes, savInRes, savOutRes, allInflowRes, pctOutRes, cobRes,
           opInflowTypeRes, opTxnTypeRes, opNormalRes] = await Promise.all([
      supabase
        .from('inflow_transactions')
        .select('stage_code_1, amount')
        .eq('stage_code_2', 'Specific Seed')
        .lte(dateField, dateValue),
      supabase
        .from('inflow_transactions')
        .select('stage_code_1, amount')
        .eq('stage_code_2', 'Savings')
        .lte(dateField, dateValue),
      supabase
        .from('outflow_transactions')
        .select('stage_code_1, actual_amount, amount_disbursed')
        .eq('stage_code_2', 'Savings')
        .lte(dateField, reportBasis === 'recorded_at' ? endOfDay : reportDate),
      supabase
        .from('inflow_transactions')
        .select('date, amount, stage_code_2, allocation_config_id, transaction_type')
        .lte(dateField, dateValue),
      supabase
        .from('outflow_transactions')
        .select('stage_code_1, actual_amount, amount_disbursed, stage_code_2')
        .not('stage_code_2', 'eq', 'Specific Seed')
        .not('stage_code_2', 'eq', 'Savings')
        .lte(dateField, reportBasis === 'recorded_at' ? endOfDay : reportDate),
      supabase
        .from('category_opening_balances')
        .select('budget_portion, amount, categories(name)'),
      // Operational inflow by income_type: exact day using recorded_at
      supabase
        .from('inflow_transactions')
        .select('income_type_id, amount')
        .gte('recorded_at', dayStart)
        .lte('recorded_at', endOfDay)
        .not('income_type_id', 'is', null),
      // Operational inflow by transaction_type: exact day using recorded_at
      supabase
        .from('inflow_transactions')
        .select('transaction_type, amount')
        .gte('recorded_at', dayStart)
        .lte('recorded_at', endOfDay)
        .not('transaction_type', 'is', null),
      // Normal inflow (no transaction_type): exact day using recorded_at
      supabase
        .from('inflow_transactions')
        .select('amount')
        .gte('recorded_at', dayStart)
        .lte('recorded_at', endOfDay)
        .is('transaction_type', null),
    ])

    const firstErr =
      seedRes.error ?? savInRes.error ?? savOutRes.error ??
      allInflowRes.error ?? pctOutRes.error

    if (firstErr) {
      setError(firstErr.message)
      setLoading(false)
      return
    }

    // ── Opening balances — category_opening_balances is the sole source of truth ──
    const cobRows = cobRes.error ? [] : (cobRes.data ?? [])

    const map = new Map<string, { specificSeed: number; savingsIn: number; savingsOut: number }>()
    const ensure = (cat: string) => {
      if (!map.has(cat)) map.set(cat, { specificSeed: 0, savingsIn: 0, savingsOut: 0 })
      return map.get(cat)!
    }

    for (const r of seedRes.data ?? []) {
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').specificSeed += Number(r.amount)
    }
    for (const r of savInRes.data ?? []) {
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').savingsIn += Number(r.amount)
    }
    for (const r of savOutRes.data ?? []) {
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').savingsOut +=
        Number(r.actual_amount || r.amount_disbursed || 0)
    }

    for (const ob of cobRows) {
      const catName = (ob.categories as unknown as { name: string } | null)?.name ?? ''
      if (!catName) continue
      const row = ensure(catName)
      if (ob.budget_portion === 'Specific Seed') row.specificSeed += Number(ob.amount)
      else if (ob.budget_portion === 'Savings')  row.savingsIn    += Number(ob.amount)
    }

    // ── Percentage-allocated inflows ────────────────────────────────────────
    const allocMap = new Map<string, number>()
    for (const r of allInflowRes.data ?? []) {
      if (r.stage_code_2 && r.stage_code_2 !== 'Percentage Allocation') continue
      if (r.transaction_type) continue
      const configId = r.allocation_config_id as string | null
      const cfg = configId
        ? (configs.find(c => c.id === configId) ?? getConfigForDate(configs, r.date as string))
        : getConfigForDate(configs, r.date as string)
      if (!cfg) continue
      for (const catRow of cfg.rows) {
        if (!catRow.percentage) continue
        const allocated = Number(r.amount) * (catRow.percentage / 100)
        allocMap.set(catRow.category_name, (allocMap.get(catRow.category_name) ?? 0) + allocated)
      }
    }

    for (const ob of cobRows) {
      if (ob.budget_portion !== 'Percentage Allocation') continue
      const catName = (ob.categories as unknown as { name: string } | null)?.name ?? ''
      if (!catName) continue
      allocMap.set(catName, (allocMap.get(catName) ?? 0) + Number(ob.amount))
    }

    // ── Percentage outflows ─────────────────────────────────────────────────
    const pctOutMap = new Map<string, number>()
    for (const r of pctOutRes.data ?? []) {
      const cat = (r.stage_code_1 as string | null) || '(Uncategorised)'
      pctOutMap.set(cat, (pctOutMap.get(cat) ?? 0) + Number(r.actual_amount || r.amount_disbursed || 0))
    }

    // ── Build category balance result ───────────────────────────────────────
    const allNames = new Set<string>([
      ...categories.map(c => c.name),
      ...map.keys(),
      ...allocMap.keys(),
    ])

    const result = new Map<string, ReportCategoryBalance>()
    for (const name of allNames) {
      const d = map.get(name) ?? { specificSeed: 0, savingsIn: 0, savingsOut: 0 }
      result.set(name, {
        categoryName:        name,
        percentageAllocated: (allocMap.get(name) ?? 0) - (pctOutMap.get(name) ?? 0),
        specificSeed:        d.specificSeed,
        savingsNet:          d.savingsIn - d.savingsOut,
      })
    }

    setBalances(result)

    // ── Operational inflow balances (always by recorded_at exact day) ───────
    const opMap = new Map<string, number>()

    for (const r of opInflowTypeRes.data ?? []) {
      const key = `it::${r.income_type_id as string}`
      opMap.set(key, (opMap.get(key) ?? 0) + Number(r.amount))
    }
    for (const r of opTxnTypeRes.data ?? []) {
      const key = `tt::${r.transaction_type as string}`
      opMap.set(key, (opMap.get(key) ?? 0) + Number(r.amount))
    }
    for (const r of opNormalRes.data ?? []) {
      opMap.set('tt::normal', (opMap.get('tt::normal') ?? 0) + Number(r.amount))
    }

    setOperationalBalances(opMap)
    setLoading(false)
  }, [reportDate, reportBasis, configs, categories])

  useEffect(() => { compute() }, [compute])

  return { balances, operationalBalances, loading, error, refetch: compute }
}
