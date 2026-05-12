import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAllocationStore, getConfigForDate } from '../store/allocationStore'
import { useCategories } from './useCategories'
import type { ReportCategoryBalance } from '../types'

export function useReportEngine(reportDate: string | null): {
  balances: Map<string, ReportCategoryBalance>
  loading: boolean
  error: string | null
  refetch: () => void
} {
  const [balances, setBalances] = useState<Map<string, ReportCategoryBalance>>(new Map())
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  const { configs, fetch: fetchConfigs, loaded } = useAllocationStore()
  const { categories } = useCategories()

  useEffect(() => { if (!loaded) fetchConfigs() }, [loaded, fetchConfigs])

  const compute = useCallback(async () => {
    if (!reportDate) {
      setBalances(new Map())
      return
    }

    setLoading(true)
    setError(null)

    // All transactions with created_at <= end of reportDate (cumulative up-to-date)
    const endOfDay = `${reportDate}T23:59:59.999Z`

    const [seedRes, savInRes, savOutRes, allInflowRes, pctOutRes, cobRes] = await Promise.all([
      supabase
        .from('inflow_transactions')
        .select('stage_code_1, amount')
        .eq('stage_code_2', 'Specific Seed')
        .lte('created_at', endOfDay),
      supabase
        .from('inflow_transactions')
        .select('stage_code_1, amount')
        .eq('stage_code_2', 'Savings')
        .lte('created_at', endOfDay),
      supabase
        .from('outflow_transactions')
        .select('stage_code_1, actual_amount, amount_disbursed')
        .eq('stage_code_2', 'Savings')
        .lte('created_at', endOfDay),
      supabase
        .from('inflow_transactions')
        .select('date, amount, stage_code_2, allocation_config_id, transaction_type')
        .lte('created_at', endOfDay),
      supabase
        .from('outflow_transactions')
        .select('stage_code_1, actual_amount, amount_disbursed, stage_code_2')
        .not('stage_code_2', 'eq', 'Specific Seed')
        .not('stage_code_2', 'eq', 'Savings')
        .lte('created_at', endOfDay),
      supabase
        .from('category_opening_balances')
        .select('budget_portion, amount, categories(name)'),
    ])

    const firstErr =
      seedRes.error ?? savInRes.error ?? savOutRes.error ??
      allInflowRes.error ?? pctOutRes.error

    if (firstErr) {
      setError(firstErr.message)
      setLoading(false)
      return
    }

    // Opening balances
    const cobRows      = cobRes.error ? [] : (cobRes.data ?? [])
    const cobCatNames  = new Set(cobRows.map(r => (r.categories as { name: string } | null)?.name ?? ''))

    const map = new Map<string, { specificSeed: number; savingsIn: number; savingsOut: number }>()
    const ensure = (cat: string) => {
      if (!map.has(cat)) map.set(cat, { specificSeed: 0, savingsIn: 0, savingsOut: 0 })
      return map.get(cat)!
    }

    // Specific Seed inflows
    for (const r of seedRes.data ?? []) {
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').specificSeed += Number(r.amount)
    }
    // Savings inflows
    for (const r of savInRes.data ?? []) {
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').savingsIn += Number(r.amount)
    }
    // Savings outflows
    for (const r of savOutRes.data ?? []) {
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').savingsOut +=
        Number(r.actual_amount ?? r.amount_disbursed ?? 0)
    }

    // Opening balances from category_opening_balances
    for (const ob of cobRows) {
      const catName = (ob.categories as { name: string } | null)?.name ?? ''
      if (!catName) continue
      const row = ensure(catName)
      if (ob.budget_portion === 'Specific Seed') row.specificSeed += Number(ob.amount)
      else if (ob.budget_portion === 'Savings')  row.savingsIn    += Number(ob.amount)
    }

    // Legacy starting_balance fallback
    for (const cat of categories) {
      if (cobCatNames.has(cat.name)) continue
      if (!cat.starting_balance || cat.starting_balance === 0) continue
      const portion = cat.starting_balance_budget_portion ?? ''
      const row = ensure(cat.name)
      if (portion === 'Specific Seed') row.specificSeed += cat.starting_balance
      else if (portion === 'Savings')  row.savingsIn    += cat.starting_balance
    }

    // Percentage-allocated inflows
    const allocMap = new Map<string, number>()
    for (const r of allInflowRes.data ?? []) {
      if (r.stage_code_2 === 'Specific Seed' || r.stage_code_2 === 'Savings') continue
      if ((r as Record<string, unknown>).transaction_type) continue
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

    // Percentage Allocation opening balances
    for (const ob of cobRows) {
      if (ob.budget_portion !== 'Percentage Allocation') continue
      const catName = (ob.categories as { name: string } | null)?.name ?? ''
      if (!catName) continue
      allocMap.set(catName, (allocMap.get(catName) ?? 0) + Number(ob.amount))
    }
    for (const cat of categories) {
      if (cobCatNames.has(cat.name)) continue
      if (!cat.starting_balance || cat.starting_balance === 0) continue
      if ((cat.starting_balance_budget_portion ?? '') === 'Percentage Allocation') {
        allocMap.set(cat.name, (allocMap.get(cat.name) ?? 0) + cat.starting_balance)
      }
    }

    // Percentage outflows
    const pctOutMap = new Map<string, number>()
    for (const r of pctOutRes.data ?? []) {
      const cat = (r.stage_code_1 as string | null) || '(Uncategorised)'
      pctOutMap.set(cat, (pctOutMap.get(cat) ?? 0) + Number(r.actual_amount ?? r.amount_disbursed ?? 0))
    }

    // Build result map
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
    setLoading(false)
  }, [reportDate, configs, categories])

  useEffect(() => { compute() }, [compute])

  return { balances, loading, error, refetch: compute }
}
