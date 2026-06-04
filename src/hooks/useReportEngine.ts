import { useState, useCallback, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAllocationStore, getConfigForDate } from '../store/allocationStore'
import { useOrgStore } from '../store/orgStore'
import { useCategories } from './useCategories'
import type { ReportCategoryBalance, ReportBasis, OperationalBalanceMap } from '../types'
import { allocatePercent } from '../utils/financeMath'

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

  const orgId = useOrgStore((s) => s.orgId)
  const { configs, fetch: fetchConfigs, loaded } = useAllocationStore()
  const { categories } = useCategories()

  useEffect(() => { if (!loaded) fetchConfigs() }, [loaded, fetchConfigs])

  const compute = useCallback(async () => {
    if (!reportDate || !orgId) {
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

    const [seedRes, seedOutRes, savInRes, savOutRes, allInflowRes, pctOutRes, cobRes,
           opInflowTypeRes, opTxnTypeRes, opNormalRes, intraFlowRes] = await Promise.all([
      supabase
        .from('inflow_transactions')
        .select('stage_code_1, amount')
        .eq('org_id', orgId)
        .eq('stage_code_2', 'Specific Seed')
        .lte(dateField, dateValue),
      supabase
        .from('outflow_transactions')
        .select('stage_code_1, amount_disbursed')
        .eq('org_id', orgId)
        .eq('stage_code_2', 'Specific Seed')
        .lte(dateField, reportBasis === 'recorded_at' ? endOfDay : reportDate),
      supabase
        .from('inflow_transactions')
        .select('stage_code_1, amount')
        .eq('org_id', orgId)
        .eq('stage_code_2', 'Savings')
        .lte(dateField, dateValue),
      supabase
        .from('outflow_transactions')
        .select('stage_code_1, amount_disbursed')
        .eq('org_id', orgId)
        .eq('stage_code_2', 'Savings')
        .lte(dateField, reportBasis === 'recorded_at' ? endOfDay : reportDate),
      supabase
        .from('inflow_transactions')
        .select('date, amount, stage_code_2, allocation_config_id, transaction_type')
        .eq('org_id', orgId)
        .lte(dateField, dateValue),
      supabase
        .from('outflow_transactions')
        .select('stage_code_1, amount_disbursed, stage_code_2')
        .eq('org_id', orgId)
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
        .eq('org_id', orgId)
        .gte('recorded_at', dayStart)
        .lte('recorded_at', endOfDay)
        .not('income_type_id', 'is', null),
      // Operational inflow by transaction_type: exact day using recorded_at
      supabase
        .from('inflow_transactions')
        .select('transaction_type, amount')
        .eq('org_id', orgId)
        .gte('recorded_at', dayStart)
        .lte('recorded_at', endOfDay)
        .not('transaction_type', 'is', null),
      // Normal inflow (no transaction_type): exact day using recorded_at
      supabase
        .from('inflow_transactions')
        .select('amount')
        .eq('org_id', orgId)
        .gte('recorded_at', dayStart)
        .lte('recorded_at', endOfDay)
        .is('transaction_type', null),
      // Intra-account transfers: cumulative up to reportDate (no recorded_at column)
      supabase
        .from('intra_flows')
        .select('account_from, account_from_stage2, account_to, account_to_stage2, total_amount')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .lte('date', reportDate),
    ])

    const firstErr =
      seedRes.error ?? seedOutRes.error ?? savInRes.error ?? savOutRes.error ??
      allInflowRes.error ?? pctOutRes.error

    if (firstErr) {
      setError(firstErr.message)
      setLoading(false)
      return
    }

    // ── Opening balances — category_opening_balances is the sole source of truth ──
    const cobRows = cobRes.error ? [] : (cobRes.data ?? [])

    const map = new Map<string, { specificSeed: number; specificSeedOut: number; savingsIn: number; savingsOut: number }>()
    const ensure = (cat: string) => {
      if (!map.has(cat)) map.set(cat, { specificSeed: 0, specificSeedOut: 0, savingsIn: 0, savingsOut: 0 })
      return map.get(cat)!
    }

    for (const r of seedRes.data ?? []) {
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').specificSeed += Number(r.amount)
    }
    for (const r of seedOutRes.data ?? []) {
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').specificSeedOut +=
        Number(r.amount_disbursed || 0)
    }
    for (const r of savInRes.data ?? []) {
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').savingsIn += Number(r.amount)
    }
    for (const r of savOutRes.data ?? []) {
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').savingsOut +=
        Number(r.amount_disbursed || 0)
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
        const allocated = allocatePercent(Number(r.amount), catRow.percentage)
        if (catRow.budget_portion === 'Specific Seed') {
          ensure(catRow.category_name).specificSeed += allocated
        } else if (catRow.budget_portion === 'Savings') {
          ensure(catRow.category_name).savingsIn += allocated
        } else {
          allocMap.set(catRow.category_name, (allocMap.get(catRow.category_name) ?? 0) + allocated)
        }
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
      pctOutMap.set(cat, (pctOutMap.get(cat) ?? 0) + Number(r.amount_disbursed || 0))
    }

    // ── Intra-flow adjustments (FROM = debit, TO = credit) ─────────────────
    // Mirrors CategoryLedger logic. Reversed/void rows excluded by status='active'.
    for (const r of intraFlowRes.error ? [] : (intraFlowRes.data ?? [])) {
      const amount = Number(r.total_amount)
      if (amount <= 0) continue
      const fromCat   = (r.account_from        as string | null) || ''
      const fromStage = (r.account_from_stage2 as string | null) || ''
      const toCat     = (r.account_to          as string | null) || ''
      const toStage   = (r.account_to_stage2   as string | null) || ''
      if (fromCat === toCat && fromStage === toStage) continue
      if (fromCat) {
        if (fromStage === 'Percentage Allocation') {
          allocMap.set(fromCat, (allocMap.get(fromCat) ?? 0) - amount)
        } else {
          const row = ensure(fromCat)
          if (fromStage === 'Specific Seed') row.specificSeed -= amount
          else if (fromStage === 'Savings')  row.savingsIn   -= amount
        }
      }
      if (toCat) {
        if (toStage === 'Percentage Allocation') {
          allocMap.set(toCat, (allocMap.get(toCat) ?? 0) + amount)
        } else {
          const row = ensure(toCat)
          if (toStage === 'Specific Seed') row.specificSeed += amount
          else if (toStage === 'Savings')  row.savingsIn   += amount
        }
      }
    }

    // ── Build category balance result ───────────────────────────────────────
    const allNames = new Set<string>([
      ...categories.map(c => c.name),
      ...map.keys(),
      ...allocMap.keys(),
    ])

    const result = new Map<string, ReportCategoryBalance>()
    for (const name of allNames) {
      const d = map.get(name) ?? { specificSeed: 0, specificSeedOut: 0, savingsIn: 0, savingsOut: 0 }
      result.set(name, {
        categoryName:        name,
        percentageAllocated: (allocMap.get(name) ?? 0) - (pctOutMap.get(name) ?? 0),
        specificSeed:        d.specificSeed - d.specificSeedOut,
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
  }, [orgId, reportDate, reportBasis, configs, categories])

  useEffect(() => { compute() }, [compute])

  return { balances, operationalBalances, loading, error, refetch: compute }
}
