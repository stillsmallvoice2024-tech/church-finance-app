import { useEffect, useState, useCallback, Fragment } from 'react'
import { LayoutList, AlertCircle, RefreshCw, Percent, Gift, Archive, Layers } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAllocationStore, getConfigForDate } from '../store/allocationStore'
import { useCategories, useCategoryGroups } from '../hooks/useCategories'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatCurrency, formatDate } from '../utils/formatters'

// ── Types ────────────────────────────────────────────────────────────────────────

interface CategoryRow {
  name:                string
  percentage:          number | null
  percentageAllocated: number
  specificSeed:        number
  savingsIn:           number
  savingsOut:          number
}

interface LedgerRow {
  id:          string
  date:        string
  description: string
  inflow:      number
  outflow:     number
  balance:     number
}

type ViewMode    = 'summary' | 'ledger'
type DisplayMode = 'table' | 'cards'
type Portion     = 'All' | 'Percentage' | 'Specific Seed' | 'Savings'
type LedgerPortion = 'Percentage' | 'Specific Seed' | 'Savings'

const PORTIONS: Portion[]       = ['All', 'Percentage', 'Specific Seed', 'Savings']
const LEDGER_PORTIONS: LedgerPortion[] = ['Percentage', 'Specific Seed', 'Savings']

// ── Component ──────────────────────────────────────────────────────────────────

export default function CategoryLedger() {
  usePageTitle('Category Ledger')

  const { categories }                           = useCategories()
  const { groups }                               = useCategoryGroups()
  const { configs, fetch: fetchConfigs, loaded } = useAllocationStore()

  // Summary state
  const [rows,    setRows]    = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  // Ledger state
  const [ledgerRows,    setLedgerRows]    = useState<LedgerRow[]>([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [ledgerError,   setLedgerError]   = useState<string | null>(null)

  // UI state
  const [viewMode,       setViewMode]       = useState<ViewMode>('summary')
  const [displayMode,    setDisplayMode]    = useState<DisplayMode>('table')
  const [activePortion,  setActivePortion]  = useState<Portion>('All')
  const [activeCategory, setActiveCategory] = useState('')
  const [ledgerPortion,  setLedgerPortion]  = useState<LedgerPortion>('Percentage')

  useEffect(() => { if (!loaded) fetchConfigs() }, [loaded, fetchConfigs])

  // ── Summary load ─────────────────────────────────────────────────────────────────

  const loadSummary = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [seedRes, savInRes, savOutRes, allInflowRes, cobRes] = await Promise.all([
      supabase.from('inflow_transactions').select('stage_code_1, amount').eq('stage_code_2', 'Specific Seed'),
      supabase.from('inflow_transactions').select('stage_code_1, amount').eq('stage_code_2', 'Savings'),
      supabase.from('outflow_transactions').select('stage_code_1, actual_amount, amount_disbursed').eq('stage_code_2', 'Savings'),
      supabase.from('inflow_transactions').select('date, amount, stage_code_2, allocation_config_id, transaction_type'),
      supabase.from('category_opening_balances').select('budget_portion, amount, categories(name)'),
    ])

    if (seedRes.error || savInRes.error || savOutRes.error || allInflowRes.error) {
      setError(
        seedRes.error?.message ?? savInRes.error?.message ??
        savOutRes.error?.message ?? allInflowRes.error?.message ?? 'Failed to load',
      )
      setLoading(false)
      return
    }

    // category_opening_balances (new table; falls back to categories.starting_balance if table absent)
    const cobRows = cobRes.error ? [] : (cobRes.data ?? [])
    const cobCatNames = new Set(cobRows.map(r => (r.categories as { name: string } | null)?.name ?? ''))

    // Active allocation config (most recent locked, on or before today)
    const today  = new Date().toISOString().slice(0, 10)
    const active = configs
      .filter(c => c.start_date <= today && c.status === 'locked')
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0] ?? null

    const pctMap = new Map<string, number>()
    if (active) {
      for (const r of active.rows) pctMap.set(r.category_name, Number(r.percentage ?? 0))
    }

    // Accumulate specific seed and savings
    const map = new Map<string, Omit<CategoryRow, 'name' | 'percentage' | 'percentageAllocated'>>()
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
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').savingsOut += Number(r.actual_amount ?? r.amount_disbursed ?? 0)
    }

    // Add opening balances from new table (category_opening_balances)
    for (const ob of cobRows) {
      const catName = (ob.categories as { name: string } | null)?.name ?? ''
      if (!catName) continue
      const row = ensure(catName)
      if (ob.budget_portion === 'Specific Seed') row.specificSeed += Number(ob.amount)
      else if (ob.budget_portion === 'Savings') row.savingsIn += Number(ob.amount)
    }

    // Fallback: categories not yet in new table use old starting_balance field
    for (const cat of categories) {
      if (cobCatNames.has(cat.name)) continue
      if (!cat.starting_balance || cat.starting_balance === 0) continue
      const portion = cat.starting_balance_budget_portion ?? ''
      const row = ensure(cat.name)
      if (portion === 'Specific Seed') row.specificSeed += cat.starting_balance
      else if (portion === 'Savings') row.savingsIn += cat.starting_balance
    }

    // Compute percentage-allocated amounts across all time
    const allocMap = new Map<string, number>()
    for (const r of allInflowRes.data ?? []) {
      if (r.stage_code_2 === 'Specific Seed' || r.stage_code_2 === 'Savings') continue
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

    // Add Percentage Allocation opening balances (new table)
    for (const ob of cobRows) {
      if (ob.budget_portion !== 'Percentage Allocation') continue
      const catName = (ob.categories as { name: string } | null)?.name ?? ''
      if (!catName) continue
      allocMap.set(catName, (allocMap.get(catName) ?? 0) + Number(ob.amount))
    }
    // Fallback Percentage Allocation
    for (const cat of categories) {
      if (cobCatNames.has(cat.name)) continue
      if (!cat.starting_balance || cat.starting_balance === 0) continue
      if ((cat.starting_balance_budget_portion ?? '') === 'Percentage Allocation') {
        allocMap.set(cat.name, (allocMap.get(cat.name) ?? 0) + cat.starting_balance)
      }
    }

    // Merge all name sources
    const allNames = new Set<string>([
      ...categories.map(c => c.name),
      ...pctMap.keys(),
      ...map.keys(),
      ...allocMap.keys(),
    ])

    const result: CategoryRow[] = [...allNames].map(name => {
      const d = map.get(name) ?? { specificSeed: 0, savingsIn: 0, savingsOut: 0 }
      return {
        name,
        percentage:          pctMap.has(name) ? pctMap.get(name)! : null,
        percentageAllocated: allocMap.get(name) ?? 0,
        ...d,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))

    setRows(result)
    setLoading(false)
  }, [categories, configs])

  useEffect(() => { loadSummary() }, [loadSummary])

  // ── Ledger load ──────────────────────────────────────────────────────────────────

  const loadLedger = useCallback(async () => {
    if (!activeCategory) return
    setLedgerLoading(true)
    setLedgerError(null)

    try {
      const inRows:  LedgerRow[] = []
      const outRows: LedgerRow[] = []

      if (ledgerPortion === 'Percentage') {
        const [inflowRes, outflowRes] = await Promise.all([
          supabase.from('inflow_transactions')
            .select('id, date, description, amount, stage_code_2, allocation_config_id, transaction_type')
            .order('date'),
          supabase.from('outflow_transactions')
            .select('id, date, description, actual_amount, amount_disbursed, stage_code_2')
            .eq('stage_code_1', activeCategory)
            .order('date'),
        ])
        if (inflowRes.error) throw inflowRes.error
        if (outflowRes.error) throw outflowRes.error

        for (const r of inflowRes.data ?? []) {
          if (r.stage_code_2 === 'Specific Seed' || r.stage_code_2 === 'Savings') continue
          if (r.transaction_type) continue
          const configId = r.allocation_config_id as string | null
          const cfg = configId
            ? (configs.find(c => c.id === configId) ?? getConfigForDate(configs, r.date as string))
            : getConfigForDate(configs, r.date as string)
          const catRow = cfg?.rows.find(c => c.category_name === activeCategory)
          if (!catRow?.percentage) continue
          const allocated = Number(r.amount) * (catRow.percentage / 100)
          if (allocated <= 0) continue
          inRows.push({
            id:          r.id as string,
            date:        r.date as string,
            description: (r.description as string | null) || '—',
            inflow:      allocated,
            outflow:     0,
            balance:     0,
          })
        }

        for (const r of outflowRes.data ?? []) {
          if (r.stage_code_2 === 'Specific Seed' || r.stage_code_2 === 'Savings') continue
          const amt = Number(r.actual_amount ?? r.amount_disbursed ?? 0)
          if (amt <= 0) continue
          outRows.push({
            id:          r.id as string,
            date:        r.date as string,
            description: (r.description as string | null) || '—',
            inflow:      0,
            outflow:     amt,
            balance:     0,
          })
        }
      } else {
        const sc2 = ledgerPortion
        const [inflowRes, outflowRes] = await Promise.all([
          supabase.from('inflow_transactions')
            .select('id, date, description, amount')
            .eq('stage_code_2', sc2)
            .eq('stage_code_1', activeCategory)
            .order('date'),
          supabase.from('outflow_transactions')
            .select('id, date, description, actual_amount, amount_disbursed')
            .eq('stage_code_2', sc2)
            .eq('stage_code_1', activeCategory)
            .order('date'),
        ])
        if (inflowRes.error) throw inflowRes.error
        if (outflowRes.error) throw outflowRes.error

        for (const r of inflowRes.data ?? []) {
          inRows.push({
            id:          r.id as string,
            date:        r.date as string,
            description: (r.description as string | null) || '—',
            inflow:      Number(r.amount),
            outflow:     0,
            balance:     0,
          })
        }
        for (const r of outflowRes.data ?? []) {
          const amt = Number(r.actual_amount ?? r.amount_disbursed ?? 0)
          outRows.push({
            id:          r.id as string,
            date:        r.date as string,
            description: (r.description as string | null) || '—',
            inflow:      0,
            outflow:     amt,
            balance:     0,
          })
        }
      }

      // Prepend opening balance (Balance Brought Forward) if it matches the active portion
      const catRecord = categories.find(c => c.name === activeCategory)
      const portionMap: Record<LedgerPortion, string> = {
        'Percentage':    'Percentage Allocation',
        'Specific Seed': 'Specific Seed',
        'Savings':       'Savings',
      }
      const bfRow: LedgerRow[] = []
      if (catRecord) {
        // Try new table first
        const { data: cobLedger } = await supabase
          .from('category_opening_balances')
          .select('amount')
          .eq('category_id', catRecord.id)
          .eq('budget_portion', portionMap[ledgerPortion])
          .maybeSingle()
        const bfAmt = cobLedger?.amount
          ? Number(cobLedger.amount)
          : (catRecord.starting_balance_budget_portion === portionMap[ledgerPortion] ? (catRecord.starting_balance ?? 0) : 0)
        if (bfAmt !== 0) {
          bfRow.push({
            id:          'bal-bf',
            date:        '0000-01-01',
            description: 'Balance Brought Forward',
            inflow:      bfAmt,
            outflow:     0,
            balance:     0,
          })
        }
      }

      // Merge, sort by date, compute running balance
      const combined = [...bfRow, ...inRows, ...outRows].sort((a, b) => a.date.localeCompare(b.date) || (a.inflow > 0 ? -1 : 1))
      let balance = 0
      for (const row of combined) {
        balance += row.inflow - row.outflow
        row.balance = balance
      }
      setLedgerRows(combined)
    } catch (e: unknown) {
      setLedgerError(e instanceof Error ? e.message : 'Failed to load ledger')
    } finally {
      setLedgerLoading(false)
    }
  }, [activeCategory, ledgerPortion, configs])

  useEffect(() => {
    if (viewMode === 'ledger' && activeCategory) loadLedger()
  }, [viewMode, activeCategory, ledgerPortion, loadLedger])

  // ── Derived ────────────────────────────────────────────────────────────────────

  const filteredRows = rows.filter(r => {
    const catOk = !activeCategory || r.name === activeCategory
    const portOk =
      activePortion === 'All'           ? true :
      activePortion === 'Percentage'    ? r.percentage !== null :
      activePortion === 'Specific Seed' ? r.specificSeed > 0 :
      /* Savings */                       r.savingsIn > 0 || r.savingsOut > 0
    return catOk && portOk
  })

  const totals = filteredRows.reduce(
    (acc, r) => ({
      pct:   acc.pct   + (r.percentage ?? 0),
      alloc: acc.alloc + r.percentageAllocated,
      seed:  acc.seed  + r.specificSeed,
      sav:   acc.sav   + (r.savingsIn - r.savingsOut),
    }),
    { pct: 0, alloc: 0, seed: 0, sav: 0 },
  )

  const ledgerTotals = ledgerRows.reduce(
    (acc, r) => ({ inflow: acc.inflow + r.inflow, outflow: acc.outflow + r.outflow }),
    { inflow: 0, outflow: 0 },
  )

  const globalTotals = rows.reduce(
    (acc, r) => ({
      alloc: acc.alloc + r.percentageAllocated,
      seed:  acc.seed  + r.specificSeed,
      sav:   acc.sav   + (r.savingsIn - r.savingsOut),
    }),
    { alloc: 0, seed: 0, sav: 0 },
  )

  // ── Render ─────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Category Ledger</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {viewMode === 'summary' ? 'Aggregated view of all budget portions per category' : 'Transaction-level ledger per category and portion'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button
              onClick={() => setViewMode('summary')}
              className={`flex items-center gap-1.5 px-3 py-1.5 transition-colors ${
                viewMode === 'summary' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" /> Summary
            </button>
            <button
              onClick={() => setViewMode('ledger')}
              className={`flex items-center gap-1.5 px-3 py-1.5 border-l border-gray-200 transition-colors ${
                viewMode === 'ledger' ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" /> Ledger
            </button>
          </div>
          <button
            onClick={() => viewMode === 'summary' ? loadSummary() : loadLedger()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* ── SUMMARY VIEW ──────────────────────────────────────────────────────────────── */}
      {viewMode === 'summary' && (
        <>
          {/* Aggregate summary cards */}
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-primary mb-1 flex items-center gap-1">
                  <Percent className="w-3 h-3" /> % Allocated
                </p>
                <p className="text-base font-mono font-bold text-primary">{formatCurrency(globalTotals.alloc)}</p>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-1 flex items-center gap-1">
                  <Gift className="w-3 h-3" /> Specific Seeds
                </p>
                <p className="text-base font-mono font-bold text-amber-700">{formatCurrency(globalTotals.seed)}</p>
              </div>
              <div className={`rounded-xl border px-4 py-3 ${globalTotals.sav >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className={`text-[10px] font-bold uppercase tracking-wide mb-1 flex items-center gap-1 ${globalTotals.sav >= 0 ? 'text-success' : 'text-danger'}`}>
                  <Archive className="w-3 h-3" /> Savings Net
                </p>
                <p className={`text-base font-mono font-bold ${globalTotals.sav >= 0 ? 'text-success' : 'text-danger'}`}>{formatCurrency(globalTotals.sav)}</p>
              </div>
              <div className="rounded-xl bg-gray-800 border border-gray-700 px-4 py-3">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-300 mb-1">Grand Total</p>
                <p className="text-base font-mono font-bold text-white">{formatCurrency(globalTotals.alloc + globalTotals.seed + globalTotals.sav)}</p>
              </div>
            </div>
          )}

          {/* Portion filter + Category selector */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {PORTIONS.map(p => (
                <button
                  key={p}
                  onClick={() => setActivePortion(p)}
                  className={`px-3 py-1.5 border-r last:border-r-0 border-gray-200 transition-colors ${
                    activePortion === p ? 'bg-primary text-white font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <select
              value={activeCategory}
              onChange={e => setActiveCategory(e.target.value)}
              className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white text-gray-700"
            >
              <option value="">All categories</option>
              {rows.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
            </div>
          )}

          {loading && (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          )}

          {!loading && !error && filteredRows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <LayoutList className="w-8 h-8 text-primary" />
              </div>
              <div>
                <p className="font-semibold text-gray-800">No categories found</p>
                <p className="text-sm text-gray-500 mt-1">Create categories and tag transactions with Stage Codes to populate this view.</p>
              </div>
            </div>
          )}

          {!loading && filteredRows.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <th className="px-5 py-3 text-left font-medium">Category</th>
                    <th className="px-4 py-3 text-right font-medium">
                      <span className="flex items-center justify-end gap-1"><Percent className="w-3 h-3" /> % Alloc</span>
                    </th>
                    <th className="px-4 py-3 text-right font-medium hidden md:table-cell">
                      <span className="flex items-center justify-end gap-1"><Percent className="w-3 h-3" /> ₦ Allocated</span>
                    </th>
                    <th className="px-4 py-3 text-right font-medium hidden md:table-cell">
                      <span className="flex items-center justify-end gap-1"><Gift className="w-3 h-3" /> Specific Seed</span>
                    </th>
                    <th className="px-5 py-3 text-right font-medium">
                      <span className="flex items-center justify-end gap-1"><Archive className="w-3 h-3" /> Savings Net</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {(() => {
                    const nameToGroupId = new Map(categories.map(c => [c.name, c.group_id]))
                    const groupedSections = groups
                      .map(g => ({ group: g, rows: filteredRows.filter(r => nameToGroupId.get(r.name) === g.id) }))
                      .filter(s => s.rows.length > 0)
                    const ungroupedRows = filteredRows.filter(r => !nameToGroupId.get(r.name))

                    const CategoryDataRow = ({ row }: { row: CategoryRow }) => (
                      <tr className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-gray-800">{row.name}</td>
                        <td className="px-4 py-3 text-right">
                          {row.percentage !== null
                            ? <span className="font-mono font-semibold text-primary">{Number(row.percentage).toFixed(1)}%</span>
                            : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right hidden md:table-cell">
                          {row.percentageAllocated > 0
                            ? <span className="font-mono text-primary">{formatCurrency(row.percentageAllocated)}</span>
                            : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right hidden md:table-cell">
                          {row.specificSeed > 0
                            ? <span className="font-mono text-amber-700">{formatCurrency(row.specificSeed)}</span>
                            : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {row.savingsIn > 0 || row.savingsOut > 0
                            ? <span className={`font-mono font-semibold ${row.savingsIn - row.savingsOut >= 0 ? 'text-success' : 'text-danger'}`}>{formatCurrency(row.savingsIn - row.savingsOut)}</span>
                            : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                      </tr>
                    )

                    const GroupSubtotalRow = ({ sectionRows, label }: { sectionRows: CategoryRow[]; label: string }) => {
                      const sPct   = sectionRows.reduce((s, r) => s + (r.percentage ?? 0), 0)
                      const sAlloc = sectionRows.reduce((s, r) => s + r.percentageAllocated, 0)
                      const sSeed  = sectionRows.reduce((s, r) => s + r.specificSeed, 0)
                      const sSav   = sectionRows.reduce((s, r) => s + (r.savingsIn - r.savingsOut), 0)
                      return (
                        <tr className="bg-gray-50 border-t border-gray-100 text-xs font-semibold text-gray-600">
                          <td className="px-5 py-2 pl-8">↳ {label} subtotal</td>
                          <td className="px-4 py-2 text-right font-mono text-primary">{sPct > 0 ? `${sPct.toFixed(1)}%` : '—'}</td>
                          <td className="px-4 py-2 text-right font-mono text-primary hidden md:table-cell">{sAlloc > 0 ? formatCurrency(sAlloc) : '—'}</td>
                          <td className="px-4 py-2 text-right font-mono text-amber-700 hidden md:table-cell">{sSeed > 0 ? formatCurrency(sSeed) : '—'}</td>
                          <td className={`px-5 py-2 text-right font-mono ${sSav >= 0 ? 'text-success' : 'text-danger'}`}>{sSav !== 0 ? formatCurrency(sSav) : '—'}</td>
                        </tr>
                      )
                    }

                    return (
                      <>
                        {groupedSections.map(({ group, rows: gRows }) => (
                          <Fragment key={group.id}>
                            <tr className="bg-gray-100 border-y border-gray-200">
                              <td colSpan={5} className="px-5 py-2">
                                <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">{group.name}</span>
                              </td>
                            </tr>
                            {gRows.map(row => <CategoryDataRow key={row.name} row={row} />)}
                            <GroupSubtotalRow sectionRows={gRows} label={group.name} />
                          </Fragment>
                        ))}
                        {ungroupedRows.length > 0 && groupedSections.length > 0 && (
                          <tr className="bg-gray-100 border-y border-gray-200">
                            <td colSpan={5} className="px-5 py-2">
                              <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">Other</span>
                            </td>
                          </tr>
                        )}
                        {ungroupedRows.map(row => <CategoryDataRow key={row.name} row={row} />)}
                      </>
                    )
                  })()}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold text-xs">
                    <td className="px-5 py-3 text-gray-700">Totals</td>
                    <td className="px-4 py-3 text-right font-mono text-primary">
                      {totals.pct > 0 ? `${totals.pct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-primary hidden md:table-cell">
                      {totals.alloc > 0 ? formatCurrency(totals.alloc) : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-amber-700 hidden md:table-cell">
                      {totals.seed > 0 ? formatCurrency(totals.seed) : '—'}
                    </td>
                    <td className={`px-5 py-3 text-right font-mono ${totals.sav >= 0 ? 'text-success' : 'text-danger'}`}>
                      {formatCurrency(totals.sav)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {/* ── LEDGER VIEW ────────────────────────────────────────────────────────────────── */}
      {viewMode === 'ledger' && (
        <>
          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Category selector */}
            <select
              value={activeCategory}
              onChange={e => setActiveCategory(e.target.value)}
              className="text-sm px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white text-gray-700 min-w-[180px]"
            >
              <option value="">Select a category…</option>
              {rows.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>

            {/* Portion tabs */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {LEDGER_PORTIONS.map(p => (
                <button
                  key={p}
                  onClick={() => setLedgerPortion(p)}
                  className={`px-3 py-2 border-r last:border-r-0 border-gray-200 transition-colors ${
                    ledgerPortion === p ? 'bg-primary text-white font-medium' : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>

            {/* Table / Card toggle */}
            <div className="ml-auto flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              <button
                onClick={() => setDisplayMode('table')}
                className={`px-3 py-2 border-r border-gray-200 transition-colors ${
                  displayMode === 'table' ? 'bg-gray-800 text-white font-medium' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                Table
              </button>
              <button
                onClick={() => setDisplayMode('cards')}
                className={`px-3 py-2 transition-colors ${
                  displayMode === 'cards' ? 'bg-gray-800 text-white font-medium' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                Cards
              </button>
            </div>
          </div>

          {/* No category selected */}
          {!activeCategory && (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center">
                <Layers className="w-8 h-8 text-gray-400" />
              </div>
              <div>
                <p className="font-semibold text-gray-700">Select a category</p>
                <p className="text-sm text-gray-500 mt-1">Choose a category above to view its transaction ledger.</p>
              </div>
            </div>
          )}

          {/* Ledger error */}
          {activeCategory && ledgerError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{ledgerError}
            </div>
          )}

          {/* Loading */}
          {activeCategory && ledgerLoading && (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          )}

          {/* Ledger content */}
          {activeCategory && !ledgerLoading && !ledgerError && (
            <>
              {/* Summary strip for selected category + portion */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-primary mb-1">{activeCategory}</p>
                  <p className="text-xs text-gray-500">{ledgerPortion} portion</p>
                </div>
                <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-success mb-1">Total Inflow</p>
                  <p className="text-sm font-mono font-semibold text-success">{formatCurrency(ledgerTotals.inflow)}</p>
                </div>
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-danger mb-1">Total Outflow</p>
                  <p className="text-sm font-mono font-semibold text-danger">{formatCurrency(ledgerTotals.outflow)}</p>
                </div>
              </div>

              {ledgerRows.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 gap-3 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50">
                  <Layers className="w-8 h-8 text-gray-300" />
                  <div>
                    <p className="text-sm font-medium text-gray-600">No transactions found</p>
                    <p className="text-xs text-gray-400 mt-0.5">No {ledgerPortion} transactions for {activeCategory}.</p>
                  </div>
                </div>
              )}

              {/* TABLE display */}
              {ledgerRows.length > 0 && displayMode === 'table' && (
                <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                        <th className="px-4 py-3 text-left font-medium">Date</th>
                        <th className="px-4 py-3 text-left font-medium">Description</th>
                        <th className="px-4 py-3 text-right font-medium text-success">Inflow</th>
                        <th className="px-4 py-3 text-right font-medium text-danger">Outflow</th>
                        <th className="px-5 py-3 text-right font-medium">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {ledgerRows.map(row => (
                        <tr key={row.id} className={`transition-colors ${row.id === 'bal-bf' ? 'bg-blue-50/60 font-medium' : 'hover:bg-gray-50'}`}>
                          <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{row.id === 'bal-bf' ? '—' : formatDate(row.date)}</td>
                          <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{row.description}</td>
                          <td className="px-4 py-3 text-right font-mono text-success">
                            {row.inflow > 0 ? formatCurrency(row.inflow) : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-danger">
                            {row.outflow > 0 ? formatCurrency(row.outflow) : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className={`px-5 py-3 text-right font-mono font-semibold ${row.balance >= 0 ? 'text-gray-800' : 'text-danger'}`}>
                            {formatCurrency(row.balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold text-xs">
                        <td className="px-4 py-3 text-gray-700" colSpan={2}>Totals</td>
                        <td className="px-4 py-3 text-right font-mono text-success">{formatCurrency(ledgerTotals.inflow)}</td>
                        <td className="px-4 py-3 text-right font-mono text-danger">{formatCurrency(ledgerTotals.outflow)}</td>
                        <td className={`px-5 py-3 text-right font-mono ${ledgerRows[ledgerRows.length - 1]?.balance >= 0 ? 'text-gray-800' : 'text-danger'}`}>
                          {ledgerRows.length > 0 ? formatCurrency(ledgerRows[ledgerRows.length - 1].balance) : '—'}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {/* CARDS display */}
              {ledgerRows.length > 0 && displayMode === 'cards' && (
                <div className="space-y-2">
                  {ledgerRows.map(row => (
                    <div key={row.id} className={`border rounded-xl px-4 py-3 flex items-center gap-4 ${row.id === 'bal-bf' ? 'bg-blue-50/60 border-blue-100 font-medium' : 'bg-white border-gray-200'}`}>
                      <div className="w-20 shrink-0">
                        <p className="text-xs text-gray-400">{row.id === 'bal-bf' ? 'Bal. B/F' : formatDate(row.date)}</p>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 truncate">{row.description}</p>
                      </div>
                      <div className="flex items-center gap-4 shrink-0 text-right">
                        {row.inflow > 0 && (
                          <div>
                            <p className="text-[10px] text-gray-400 uppercase">Inflow</p>
                            <p className="text-sm font-mono font-semibold text-success">{formatCurrency(row.inflow)}</p>
                          </div>
                        )}
                        {row.outflow > 0 && (
                          <div>
                            <p className="text-[10px] text-gray-400 uppercase">Outflow</p>
                            <p className="text-sm font-mono font-semibold text-danger">{formatCurrency(row.outflow)}</p>
                          </div>
                        )}
                        <div className="border-l border-gray-200 pl-4">
                          <p className="text-[10px] text-gray-400 uppercase">Balance</p>
                          <p className={`text-sm font-mono font-semibold ${row.balance >= 0 ? 'text-gray-800' : 'text-danger'}`}>
                            {formatCurrency(row.balance)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
