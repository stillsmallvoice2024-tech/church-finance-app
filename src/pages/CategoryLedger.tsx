import { useEffect, useState, useCallback, Fragment, useMemo } from 'react'
import { LayoutList, AlertCircle, RefreshCw, Percent, Gift, Archive, Layers } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAllocationStore, getConfigForDate } from '../store/allocationStore'
import { useCategories, useCategoryGroups } from '../hooks/useCategories'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatCurrency, formatDate } from '../utils/formatters'
import { useTransactionSyncStore } from '../store/transactionSyncStore'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { useDescriptionExpand } from '../hooks/useDescriptionExpand'
import { DataControlsBar } from '../components/ui/DataControlsBar'
import { SortableHeader } from '../components/ui/SortableHeader'
import { PaginationBar } from '../components/ui/PaginationBar'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows, directionLabel } from '../utils/sortUtils'
import type { SortField } from '../utils/sortUtils'

// ── Sort field definitions ────────────────────────────────────────────────────

const SUMMARY_SORT_FIELDS: SortField[] = [
  { key: 'name',                label: 'Category',      type: 'text',    primary: true },
  { key: 'percentage',          label: '% Alloc',       type: 'numeric', primary: true },
  { key: 'percentageAllocated', label: '₦ Allocated',   type: 'numeric', primary: true },
  { key: 'specificSeed',        label: 'Specific Seed', type: 'numeric', primary: true },
  { key: 'savingsNet',          label: 'Savings Net',   type: 'numeric', primary: true },
]

const LEDGER_SORT_FIELDS: SortField[] = [
  { key: 'date',        label: 'Date',        type: 'date',    primary: true },
  { key: 'inflow',      label: 'Inflow',      type: 'numeric', primary: true },
  { key: 'outflow',     label: 'Outflow',     type: 'numeric', primary: true },
  { key: 'balance',     label: 'Balance',     type: 'numeric', primary: true },
  { key: 'description', label: 'Description', type: 'text' },
]

const SUMMARY_SEARCH_COLS = [
  { key: 'all',  label: 'All Columns' },
  { key: 'name', label: 'Category' },
]

const LEDGER_SEARCH_COLS = [
  { key: 'all',         label: 'All Columns' },
  { key: 'description', label: 'Description' },
]

// ── Types ─────────────────────────────────────────────────────────────────────

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

type ViewMode      = 'summary' | 'ledger'
type Portion       = 'All' | 'Percentage' | 'Specific Seed' | 'Savings'
type LedgerPortion = 'Percentage' | 'Specific Seed' | 'Savings'

const PORTIONS: Portion[]             = ['All', 'Percentage', 'Specific Seed', 'Savings']
const LEDGER_PORTIONS: LedgerPortion[] = ['Percentage', 'Specific Seed', 'Savings']

// ── Component ─────────────────────────────────────────────────────────────────

export default function CategoryLedger() {
  usePageTitle('Category Ledger')

  const { categories }                           = useCategories()
  const { groups }                               = useCategoryGroups()
  const { configs, fetch: fetchConfigs, loaded } = useAllocationStore()
  const outflowVersion                           = useTransactionSyncStore(s => s.outflowVersion)
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()

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
  const [activePortion,  setActivePortion]  = useState<Portion>('All')
  const [activeCategory, setActiveCategory] = useState('')
  const [ledgerPortion,  setLedgerPortion]  = useState<LedgerPortion>('Percentage')

  // Data controls state — persisted per view
  const summaryViewState = useDataViewState({
    storageKey:     'cl-summary',
    defaultSortKey: 'name',
    defaultSortDir: 'asc',
  })
  const ledgerViewState = useDataViewState({
    storageKey:      'cl-ledger',
    defaultSortKey:  'date',
    defaultSortDir:  'asc',
    defaultPageSize: 25,
  })

  useEffect(() => { if (!loaded) fetchConfigs() }, [loaded, fetchConfigs])

  // ── Summary load ─────────────────────────────────────────────────────────────

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

    const cobRows = cobRes.error ? [] : (cobRes.data ?? [])

    const today  = new Date().toISOString().slice(0, 10)
    const active = configs
      .filter(c => c.start_date <= today && c.status === 'locked')
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0] ?? null

    const pctMap = new Map<string, number>()
    if (active) {
      for (const r of active.rows) pctMap.set(r.category_name, Number(r.percentage ?? 0))
    }

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
      ensure((r.stage_code_1 as string | null) || '(Uncategorised)').savingsOut += Number(r.actual_amount || r.amount_disbursed || 0)
    }

    for (const ob of cobRows) {
      const catName = (ob.categories as unknown as { name: string } | null)?.name ?? ''
      if (!catName) continue
      const row = ensure(catName)
      if (ob.budget_portion === 'Specific Seed') row.specificSeed += Number(ob.amount)
      else if (ob.budget_portion === 'Savings') row.savingsIn += Number(ob.amount)
    }

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

    for (const ob of cobRows) {
      if (ob.budget_portion !== 'Percentage Allocation') continue
      const catName = (ob.categories as unknown as { name: string } | null)?.name ?? ''
      if (!catName) continue
      allocMap.set(catName, (allocMap.get(catName) ?? 0) + Number(ob.amount))
    }

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

  useEffect(() => { loadSummary() }, [loadSummary, outflowVersion])

  // ── Ledger load ───────────────────────────────────────────────────────────────

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
          const amt = Number(r.actual_amount || r.amount_disbursed || 0)
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
          const amt = Number(r.actual_amount || r.amount_disbursed || 0)
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

      const catRecord = categories.find(c => c.name === activeCategory)
      const portionMap: Record<LedgerPortion, string> = {
        'Percentage':    'Percentage Allocation',
        'Specific Seed': 'Specific Seed',
        'Savings':       'Savings',
      }
      const bfRow: LedgerRow[] = []
      if (catRecord) {
        const { data: cobLedger } = await supabase
          .from('category_opening_balances')
          .select('amount')
          .eq('category_id', catRecord.id)
          .eq('budget_portion', portionMap[ledgerPortion])
          .maybeSingle()
        const bfAmt = cobLedger?.amount ? Number(cobLedger.amount) : 0
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
  }, [viewMode, activeCategory, ledgerPortion, loadLedger, outflowVersion])

  // Reset ledger page when category or portion changes
  const { setPage: setLedgerPage } = ledgerViewState
  useEffect(() => {
    setLedgerPage(0)
  }, [activeCategory, ledgerPortion, setLedgerPage])

  // ── Derived — Summary ─────────────────────────────────────────────────────────

  const filteredRows = useMemo(
    () => rows.filter(r => {
      const catOk = !activeCategory || r.name === activeCategory
      const portOk =
        activePortion === 'All'           ? true :
        activePortion === 'Percentage'    ? r.percentage !== null :
        activePortion === 'Specific Seed' ? r.specificSeed > 0 :
        /* Savings */                       r.savingsIn > 0 || r.savingsOut > 0
      return catOk && portOk
    }),
    [rows, activeCategory, activePortion],
  )

  const summarySearchFiltered = useMemo(
    () => {
      const lower = summaryViewState.search.toLowerCase().trim()
      if (!lower) return filteredRows
      return filteredRows.filter(r => r.name.toLowerCase().includes(lower))
    },
    [filteredRows, summaryViewState.search],
  )

  const getSummaryValue = (row: CategoryRow, key: string) => {
    if (key === 'name')                return row.name
    if (key === 'percentage')          return row.percentage ?? -Infinity
    if (key === 'percentageAllocated') return row.percentageAllocated
    if (key === 'specificSeed')        return row.specificSeed
    if (key === 'savingsNet')          return row.savingsIn - row.savingsOut
    return null
  }

  const summarySorted = useMemo(() => {
    const adv = summaryViewState.advancedSort
    if (adv.length > 0) return multiSortRows(summarySearchFiltered, getSummaryValue, adv, SUMMARY_SORT_FIELDS)
    return sortRows(summarySearchFiltered, getSummaryValue, summaryViewState.sortKey, summaryViewState.sortDir, SUMMARY_SORT_FIELDS)
  }, [summarySearchFiltered, summaryViewState.sortKey, summaryViewState.sortDir, summaryViewState.advancedSort])

  const totals = useMemo(
    () => summarySorted.reduce(
      (acc, r) => ({
        pct:   acc.pct   + (r.percentage ?? 0),
        alloc: acc.alloc + r.percentageAllocated,
        seed:  acc.seed  + r.specificSeed,
        sav:   acc.sav   + (r.savingsIn - r.savingsOut),
      }),
      { pct: 0, alloc: 0, seed: 0, sav: 0 },
    ),
    [summarySorted],
  )

  const globalTotals = useMemo(
    () => rows.reduce(
      (acc, r) => ({
        alloc: acc.alloc + r.percentageAllocated,
        seed:  acc.seed  + r.specificSeed,
        sav:   acc.sav   + (r.savingsIn - r.savingsOut),
      }),
      { alloc: 0, seed: 0, sav: 0 },
    ),
    [rows],
  )

  // ── Derived — Ledger ──────────────────────────────────────────────────────────

  const ledgerFiltered = useMemo(
    () => {
      const lower = ledgerViewState.search.toLowerCase().trim()
      if (!lower) return ledgerRows
      return ledgerRows.filter(r =>
        r.id === 'bal-bf' || r.description.toLowerCase().includes(lower)
      )
    },
    [ledgerRows, ledgerViewState.search],
  )

  const getLedgerValue = (row: LedgerRow, key: string) => {
    if (key === 'date')        return row.date
    if (key === 'inflow')      return row.inflow
    if (key === 'outflow')     return row.outflow
    if (key === 'balance')     return row.balance
    if (key === 'description') return row.description
    return null
  }

  const ledgerSorted = useMemo(() => {
    const adv = ledgerViewState.advancedSort
    if (adv.length > 0) return multiSortRows(ledgerFiltered, getLedgerValue, adv, LEDGER_SORT_FIELDS)
    return sortRows(ledgerFiltered, getLedgerValue, ledgerViewState.sortKey, ledgerViewState.sortDir, LEDGER_SORT_FIELDS)
  }, [ledgerFiltered, ledgerViewState.sortKey, ledgerViewState.sortDir, ledgerViewState.advancedSort])

  const ledgerPagedRows = useMemo(
    () => ledgerSorted.slice(
      ledgerViewState.page * ledgerViewState.pageSize,
      (ledgerViewState.page + 1) * ledgerViewState.pageSize,
    ),
    [ledgerSorted, ledgerViewState.page, ledgerViewState.pageSize],
  )

  const ledgerTotals = useMemo(
    () => ledgerRows.reduce(
      (acc, r) => ({ inflow: acc.inflow + r.inflow, outflow: acc.outflow + r.outflow }),
      { inflow: 0, outflow: 0 },
    ),
    [ledgerRows],
  )

  const activeLedgerField = LEDGER_SORT_FIELDS.find(f => f.key === ledgerViewState.sortKey)

  // ── Render ────────────────────────────────────────────────────────────────────

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

      {/* ── SUMMARY VIEW ──────────────────────────────────────────────────────────── */}
      {viewMode === 'summary' && (
        <>
          {/* Aggregate summary cards */}
          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl bg-primary/5 border border-primary/20 px-3 py-3 min-w-0 overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-wide text-primary mb-1.5 flex items-center gap-1">
                  <Percent className="w-3 h-3 shrink-0" /><span className="truncate">% Allocated</span>
                </p>
                <p className="text-sm font-mono font-bold text-primary tabular-nums">{formatCurrency(globalTotals.alloc)}</p>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-3 min-w-0 overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700 mb-1.5 flex items-center gap-1">
                  <Gift className="w-3 h-3 shrink-0" /><span className="truncate">Specific Seeds</span>
                </p>
                <p className="text-sm font-mono font-bold text-amber-700 tabular-nums">{formatCurrency(globalTotals.seed)}</p>
              </div>
              <div className={`rounded-xl border px-3 py-3 min-w-0 overflow-hidden ${globalTotals.sav >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                <p className={`text-[10px] font-bold uppercase tracking-wide mb-1.5 flex items-center gap-1 ${globalTotals.sav >= 0 ? 'text-success' : 'text-danger'}`}>
                  <Archive className="w-3 h-3 shrink-0" /><span className="truncate">Savings Net</span>
                </p>
                <p className={`text-sm font-mono font-bold tabular-nums ${globalTotals.sav >= 0 ? 'text-success' : 'text-danger'}`}>{formatCurrency(globalTotals.sav)}</p>
              </div>
              <div className="rounded-xl bg-gray-800 border border-gray-700 px-3 py-3 min-w-0 overflow-hidden">
                <p className="text-[10px] font-bold uppercase tracking-wide text-gray-300 mb-1.5 truncate">Grand Total</p>
                <p className="text-sm font-mono font-bold text-white tabular-nums">{formatCurrency(globalTotals.alloc + globalTotals.seed + globalTotals.sav)}</p>
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

          {!loading && !error && filteredRows.length > 0 && (
            <div className="space-y-2">
              {/* Data Controls — immediately above table */}
              <DataControlsBar
                sortFields={SUMMARY_SORT_FIELDS}
                sortKey={summaryViewState.sortKey}
                sortDir={summaryViewState.sortDir}
                onSort={summaryViewState.setSort}
                defaultSortKey="name"
                defaultSortDir="asc"
                search={summaryViewState.search}
                onSearchChange={summaryViewState.setSearch}
                searchPlaceholder="Search categories…"
                searchColumns={SUMMARY_SEARCH_COLS}
                searchCol={summaryViewState.searchCol}
                onSearchColChange={summaryViewState.setSearchCol}
                advancedSort={summaryViewState.advancedSort}
                onAdvancedSort={summaryViewState.setAdvancedSort}
              />

              {summarySorted.length === 0 ? (
                <div className="py-10 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50">
                  <p className="text-sm text-gray-500">No categories match <span className="font-medium">"{summaryViewState.search}"</span></p>
                  <button
                    type="button"
                    onClick={() => summaryViewState.setSearch('')}
                    className="mt-2 text-xs text-primary hover:underline"
                  >
                    Clear search
                  </button>
                </div>
              ) : (
                <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-100">
                        <SortableHeader
                          field={SUMMARY_SORT_FIELDS[0]}
                          activeSortKey={summaryViewState.sortKey}
                          activeSortDir={summaryViewState.sortDir}
                          onSort={summaryViewState.setSort}
                          className="px-5 py-3"
                        />
                        <SortableHeader
                          field={SUMMARY_SORT_FIELDS[1]}
                          activeSortKey={summaryViewState.sortKey}
                          activeSortDir={summaryViewState.sortDir}
                          onSort={summaryViewState.setSort}
                          rightAlign
                          className="px-4 py-3"
                        >
                          <span className="flex items-center justify-end gap-1"><Percent className="w-3 h-3" /> % Alloc</span>
                        </SortableHeader>
                        <SortableHeader
                          field={SUMMARY_SORT_FIELDS[2]}
                          activeSortKey={summaryViewState.sortKey}
                          activeSortDir={summaryViewState.sortDir}
                          onSort={summaryViewState.setSort}
                          rightAlign
                          className="px-4 py-3 hidden md:table-cell"
                        >
                          <span className="flex items-center justify-end gap-1"><Percent className="w-3 h-3" /> ₦ Allocated</span>
                        </SortableHeader>
                        <SortableHeader
                          field={SUMMARY_SORT_FIELDS[3]}
                          activeSortKey={summaryViewState.sortKey}
                          activeSortDir={summaryViewState.sortDir}
                          onSort={summaryViewState.setSort}
                          rightAlign
                          className="px-4 py-3 hidden md:table-cell"
                        >
                          <span className="flex items-center justify-end gap-1"><Gift className="w-3 h-3" /> Specific Seed</span>
                        </SortableHeader>
                        <SortableHeader
                          field={SUMMARY_SORT_FIELDS[4]}
                          activeSortKey={summaryViewState.sortKey}
                          activeSortDir={summaryViewState.sortDir}
                          onSort={summaryViewState.setSort}
                          rightAlign
                          className="px-5 py-3"
                        >
                          <span className="flex items-center justify-end gap-1"><Archive className="w-3 h-3" /> Savings Net</span>
                        </SortableHeader>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(() => {
                        const nameToGroupId = new Map(categories.map(c => [c.name, c.group_id]))
                        const groupedSections = groups
                          .map(g => ({ group: g, rows: summarySorted.filter(r => nameToGroupId.get(r.name) === g.id) }))
                          .filter(s => s.rows.length > 0)
                        const ungroupedRows = summarySorted.filter(r => !nameToGroupId.get(r.name))

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
                        <td className="px-5 py-3 text-gray-700">
                          Totals
                          {summaryViewState.search && (
                            <span className="ml-1.5 font-normal text-gray-400">({summarySorted.length} shown)</span>
                          )}
                        </td>
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
            </div>
          )}
        </>
      )}

      {/* ── LEDGER VIEW ───────────────────────────────────────────────────────────── */}
      {viewMode === 'ledger' && (
        <>
          {/* Controls row */}
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={activeCategory}
              onChange={e => setActiveCategory(e.target.value)}
              className="text-sm px-3 py-2 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white text-gray-700 min-w-[180px]"
            >
              <option value="">Select a category…</option>
              {rows.map(r => <option key={r.name} value={r.name}>{r.name}</option>)}
            </select>

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
              {/* Summary strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="col-span-2 sm:col-span-1 rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 min-w-0 overflow-hidden">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-primary mb-1 truncate">{activeCategory}</p>
                  <p className="text-xs text-gray-500">{ledgerPortion} portion</p>
                </div>
                <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 min-w-0 overflow-hidden">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-success mb-1">Total Inflow</p>
                  <p className="text-sm font-mono font-semibold text-success tabular-nums">{formatCurrency(ledgerTotals.inflow)}</p>
                </div>
                <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 min-w-0 overflow-hidden">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-danger mb-1">Total Outflow</p>
                  <p className="text-sm font-mono font-semibold text-danger tabular-nums">{formatCurrency(ledgerTotals.outflow)}</p>
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

              {ledgerRows.length > 0 && (
                <div className="space-y-1.5">
                  {/* Data Controls — immediately above data */}
                  <DataControlsBar
                    sortFields={LEDGER_SORT_FIELDS}
                    sortKey={ledgerViewState.sortKey}
                    sortDir={ledgerViewState.sortDir}
                    onSort={ledgerViewState.setSort}
                    defaultSortKey="date"
                    defaultSortDir="asc"
                    view={ledgerViewState.view}
                    onViewChange={ledgerViewState.setView}
                    search={ledgerViewState.search}
                    onSearchChange={ledgerViewState.setSearch}
                    searchPlaceholder="Search descriptions…"
                    searchColumns={LEDGER_SEARCH_COLS}
                    searchCol={ledgerViewState.searchCol}
                    onSearchColChange={ledgerViewState.setSearchCol}
                    advancedSort={ledgerViewState.advancedSort}
                    onAdvancedSort={ledgerViewState.setAdvancedSort}
                  />

                  {/* Top pagination — compact */}
                  <PaginationBar
                    page={ledgerViewState.page}
                    pageSize={ledgerViewState.pageSize}
                    total={ledgerSorted.length}
                    onPageChange={ledgerViewState.setPage}
                    variant="compact"
                  />

                  {/* No search results */}
                  {ledgerSorted.length === 0 && (
                    <div className="py-10 text-center border border-dashed border-gray-200 rounded-xl bg-gray-50">
                      <p className="text-sm text-gray-500">No transactions match <span className="font-medium">"{ledgerViewState.search}"</span></p>
                      <button
                        type="button"
                        onClick={() => ledgerViewState.setSearch('')}
                        className="mt-2 text-xs text-primary hover:underline"
                      >
                        Clear search
                      </button>
                    </div>
                  )}

                  {/* TABLE display */}
                  {ledgerSorted.length > 0 && ledgerViewState.view === 'table' && (
                    <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-100">
                            <SortableHeader
                              field={LEDGER_SORT_FIELDS[0]}
                              activeSortKey={ledgerViewState.sortKey}
                              activeSortDir={ledgerViewState.sortDir}
                              onSort={ledgerViewState.setSort}
                              className="px-4 py-3"
                            />
                            <th className="px-4 py-3 text-left font-medium">Description</th>
                            <SortableHeader
                              field={LEDGER_SORT_FIELDS[1]}
                              activeSortKey={ledgerViewState.sortKey}
                              activeSortDir={ledgerViewState.sortDir}
                              onSort={ledgerViewState.setSort}
                              rightAlign
                              className="px-4 py-3"
                              inactiveCls="text-success/80 hover:text-success"
                            />
                            <SortableHeader
                              field={LEDGER_SORT_FIELDS[2]}
                              activeSortKey={ledgerViewState.sortKey}
                              activeSortDir={ledgerViewState.sortDir}
                              onSort={ledgerViewState.setSort}
                              rightAlign
                              className="px-4 py-3"
                              inactiveCls="text-danger/80 hover:text-danger"
                            />
                            <SortableHeader
                              field={LEDGER_SORT_FIELDS[3]}
                              activeSortKey={ledgerViewState.sortKey}
                              activeSortDir={ledgerViewState.sortDir}
                              onSort={ledgerViewState.setSort}
                              rightAlign
                              className="px-5 py-3"
                            />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {ledgerPagedRows.map(row => (
                            <tr key={row.id} className={`transition-colors ${row.id === 'bal-bf' ? 'bg-blue-50/60 font-medium' : 'hover:bg-gray-50'}`}>
                              <td className="px-4 py-3 text-gray-500 whitespace-nowrap text-xs">{row.id === 'bal-bf' ? '—' : formatDate(row.date)}</td>
                              <td className="px-4 py-3 text-gray-700 max-w-xs">
                                <DescriptionCell id={row.id} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
                              </td>
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
                  {ledgerSorted.length > 0 && ledgerViewState.view === 'cards' && (
                    <div className="space-y-3">
                      {activeLedgerField && (ledgerViewState.sortKey !== 'date' || ledgerViewState.sortDir !== 'asc' || ledgerViewState.search) && (
                        <p className="text-xs text-gray-400 px-0.5">
                          {ledgerViewState.search
                            ? `${ledgerSorted.length} result${ledgerSorted.length !== 1 ? 's' : ''} · `
                            : ''}
                          Sorted by {activeLedgerField.label} · {directionLabel(activeLedgerField.type, ledgerViewState.sortDir)}
                        </p>
                      )}
                      {ledgerPagedRows.map(row => (
                        <div
                          key={row.id}
                          className={`rounded-xl border overflow-hidden shadow-sm ${
                            row.id === 'bal-bf'
                              ? 'bg-blue-50/60 border-blue-200'
                              : 'bg-white border-gray-200'
                          }`}
                        >
                          <div className="px-4 pt-3.5 pb-3">
                            <p className={`text-[11px] font-semibold mb-1.5 ${
                              row.id === 'bal-bf'
                                ? 'text-blue-500 uppercase tracking-wide'
                                : 'text-gray-400'
                            }`}>
                              {row.id === 'bal-bf' ? 'Balance B/F' : formatDate(row.date)}
                            </p>
                            {row.id === 'bal-bf' ? (
                              <p className="text-sm font-semibold text-blue-800">{row.description}</p>
                            ) : (
                              <div className="text-sm">
                                <DescriptionCell
                                  id={`card-${row.id}`}
                                  text={row.description}
                                  tooltip={descTooltip}
                                  setTooltip={setDescTooltip}
                                  textCls="text-gray-800"
                                />
                              </div>
                            )}
                          </div>

                          <div className={`grid grid-cols-2 border-t px-4 py-3 ${
                            row.id === 'bal-bf'
                              ? 'border-blue-200/60 bg-blue-50/30'
                              : 'border-gray-100 bg-gray-50/40'
                          }`}>
                            <div className="min-w-0">
                              <p className={`text-[10px] uppercase tracking-wide font-semibold mb-0.5 ${
                                row.inflow > 0 ? 'text-green-600/70' : 'text-red-600/70'
                              }`}>
                                {row.id === 'bal-bf' ? 'B/F Amount' : (row.inflow > 0 ? 'Inflow' : 'Outflow')}
                              </p>
                              <p className={`text-sm font-mono font-bold tabular-nums ${
                                row.inflow > 0 ? 'text-success' : 'text-danger'
                              }`}>
                                {row.inflow > 0 ? formatCurrency(row.inflow) : formatCurrency(row.outflow)}
                              </p>
                            </div>
                            <div className="border-l border-gray-200/80 pl-4 min-w-0">
                              <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-0.5">Balance</p>
                              <p className={`text-sm font-mono font-bold tabular-nums ${
                                row.balance >= 0 ? 'text-gray-900' : 'text-danger'
                              }`}>
                                {formatCurrency(row.balance)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Bottom pagination — full */}
                  <PaginationBar
                    page={ledgerViewState.page}
                    pageSize={ledgerViewState.pageSize}
                    total={ledgerSorted.length}
                    onPageChange={ledgerViewState.setPage}
                    onPageSizeChange={ledgerViewState.setPageSize}
                    variant="full"
                  />
                </div>
              )}
            </>
          )}
        </>
      )}

      <DescriptionTooltip tooltip={descTooltip} />
    </div>
  )
}
