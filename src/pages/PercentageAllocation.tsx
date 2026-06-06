import { useEffect, useState, useCallback, useMemo } from 'react'
import { PieChart, AlertCircle, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react'
import { exportCSV } from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { supabase } from '../lib/supabase'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatCurrency } from '../utils/formatters'
import { useTransactionSyncStore } from '../store/transactionSyncStore'
import { DataControlsBar } from '../components/ui/DataControlsBar'
import { SortableHeader } from '../components/ui/SortableHeader'
import { PageHelpBanner } from '../components/ui/PageHelpBanner'
import { PaginationBar } from '../components/ui/PaginationBar'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows } from '../utils/sortUtils'
import type { TableColumnDef } from '../utils/tableColumns'
import { allocatePercent } from '../utils/financeMath'
import { deriveSortFields, searchRows } from '../utils/tableColumns'
import { useOrgCurrency } from '../hooks/useOrgCurrency'

interface PctRow {
  category:  string
  deposited: number
  withdrawn: number
  balance:   number
}

const PA_COLUMNS: TableColumnDef<PctRow>[] = [
  { key: 'category',  label: 'Category',       sortType: 'text',    primary: true, accessor: r => r.category },
  { key: 'deposited', label: 'Total Allocated', sortType: 'numeric', primary: true },
  { key: 'balance',   label: 'Net Balance',     sortType: 'numeric', primary: true },
]

const PA_SORT_FIELDS = deriveSortFields(PA_COLUMNS)

type ConfigRowShape = { category_name: string; budget_portion?: string; percentage?: number }

export default function PercentageAllocation() {
  usePageTitle('Percentage Allocation')
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()

  const [rows,    setRows]    = useState<PctRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const state = useDataViewState({ storageKey: 'pa', defaultSortKey: 'balance', defaultSortDir: 'desc' })
  const intraflowVersion = useTransactionSyncStore(s => s.intraflowVersion)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [inflowRes, outflowRes, cobRes, configSplitRes, intraflowRes] = await Promise.all([
      supabase
        .from('inflow_transactions')
        .select('stage_code_1, amount')
        .eq('stage_code_2', 'Percentage Allocation'),
      supabase
        .from('outflow_transactions')
        .select('stage_code_1, amount_disbursed')
        .eq('stage_code_2', 'Percentage Allocation'),
      supabase
        .from('category_opening_balances')
        .select('amount, categories(name)')
        .eq('budget_portion', 'Percentage Allocation'),
      supabase
        .from('inflow_transactions')
        .select('amount, allocation_config_id')
        .not('allocation_config_id', 'is', null)
        .is('stage_code_2', null)
        .is('transaction_type', null),
      supabase
        .from('intra_flows')
        .select('account_from, account_from_stage2, account_to, account_to_stage2, total_amount')
        .eq('status', 'active'),
    ])

    if (inflowRes.error || outflowRes.error) {
      setError(inflowRes.error?.message ?? outflowRes.error?.message ?? 'Failed to load')
      setLoading(false)
      return
    }

    const cobData = cobRes.error ? [] : (cobRes.data ?? [])

    const map = new Map<string, { deposited: number; withdrawn: number }>()
    const ensure = (cat: string) => {
      if (!map.has(cat)) map.set(cat, { deposited: 0, withdrawn: 0 })
      return map.get(cat)!
    }

    for (const r of inflowRes.data ?? []) {
      const cat = (r.stage_code_1 as string | null) || '(Uncategorised)'
      ensure(cat).deposited += Number(r.amount)
    }
    for (const r of outflowRes.data ?? []) {
      const cat = (r.stage_code_1 as string | null) || '(Uncategorised)'
      ensure(cat).withdrawn += Number(r.amount_disbursed || 0)
    }
    for (const ob of cobData) {
      const catName = (ob.categories as unknown as { name: string } | null)?.name ?? ''
      if (!catName) continue
      ensure(catName).deposited += Number(ob.amount)
    }

    // Config-split inflows: allocation_config_id set, stage_code_2 null
    // Config rows with budget_portion = 'Percentage' (or unset) contribute here
    const configSplitData = (configSplitRes.data ?? []) as Array<{
      amount: number; allocation_config_id: string
    }>
    if (configSplitData.length > 0) {
      const configIds = [...new Set(configSplitData.map(r => r.allocation_config_id))]
      const configsRes = await supabase
        .from('allocation_configs')
        .select('id, rows')
        .in('id', configIds)

      const configMap = new Map<string, ConfigRowShape[]>(
        (configsRes.data ?? []).map(c => [c.id as string, c.rows as ConfigRowShape[]])
      )

      for (const inflow of configSplitData) {
        const cfgRows = configMap.get(inflow.allocation_config_id) ?? []
        for (const row of cfgRows) {
          // Unset budget_portion defaults to Percentage; skip Specific Seed / Savings rows
          if (row.budget_portion && row.budget_portion !== 'Percentage') continue
          const pct = Number(row.percentage ?? 0)
          if (pct <= 0) continue
          const allocAmount = allocatePercent(Number(inflow.amount), pct)
          if (allocAmount <= 0) continue
          const cat = row.category_name || '(Uncategorised)'
          ensure(cat).deposited += allocAmount
        }
      }
    }

    for (const r of intraflowRes.error ? [] : (intraflowRes.data ?? [])) {
      const amount    = Number(r.total_amount)
      if (amount <= 0) continue
      const fromCat   = (r.account_from       as string | null) || ''
      const fromStage = (r.account_from_stage2 as string | null) || ''
      const toCat     = (r.account_to         as string | null) || ''
      const toStage   = (r.account_to_stage2   as string | null) || ''
      if (fromCat === toCat && fromStage === toStage) continue
      if (toStage === 'Percentage Allocation' && toCat)   ensure(toCat).deposited  += amount
      if (fromStage === 'Percentage Allocation' && fromCat) ensure(fromCat).withdrawn += amount
    }

    const result: PctRow[] = [...map.entries()].map(([category, v]) => ({
      category,
      deposited: v.deposited,
      withdrawn: v.withdrawn,
      balance:   v.deposited - v.withdrawn,
    })).sort((a, b) => b.balance - a.balance)

    setRows(result)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load, intraflowVersion])

  const visibleRows = useMemo(
    () => searchRows(rows, PA_COLUMNS, state.search, state.searchCol),
    [rows, state.search, state.searchCol],
  )

  const getPaValue = (r: PctRow, k: string) => {
    if (k === 'category') return r.category
    if (k === 'deposited') return r.deposited
    return r.balance
  }

  const sortedRows = useMemo(() => {
    const adv = state.advancedSort
    if (adv.length > 0) return multiSortRows(visibleRows, getPaValue, adv, PA_SORT_FIELDS)
    return sortRows(visibleRows, getPaValue, state.sortKey, state.sortDir, PA_SORT_FIELDS)
  }, [visibleRows, state.sortKey, state.sortDir, state.advancedSort])

  const paPage = useMemo(
    () => sortedRows.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize),
    [sortedRows, state.page, state.pageSize],
  )

  const PA_CSV_HEADERS = ['Category', `Allocated (${baseCurrencySymbol})`, `Withdrawn (${baseCurrencySymbol})`, `Balance (${baseCurrencySymbol})`]
  const paCsvRow = (r: PctRow) => [r.category, r.deposited, r.withdrawn, r.balance]
  const PA_CSV_FILE = `percentage-allocation-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(PA_CSV_FILE, PA_CSV_HEADERS, paPage.map(paCsvRow))
  const handleExportAll  = () => exportCSV(PA_CSV_FILE, PA_CSV_HEADERS, sortedRows.map(paCsvRow))

  const totalDeposited = visibleRows.reduce((s, r) => s + r.deposited, 0)
  const totalWithdrawn = visibleRows.reduce((s, r) => s + r.withdrawn, 0)
  const totalBalance   = visibleRows.reduce((s, r) => s + r.balance, 0)

  return (
    <div className="space-y-5">

      <PageHelpBanner storageKey="help-dismissed-pct-alloc" title="What is Percentage Allocation?">
        This page shows how incoming funds have been distributed across departments or budget lines using your preset percentage rules.
        Each row represents a category that receives a fixed share of qualifying inflows — for example, 60% to General Fund.
        Balances accumulate over time and update automatically when new inflows are recorded.
      </PageHelpBanner>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Percentage Allocation</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Accumulated percentage-allocation balances per category — all time
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportDropdown onExportView={handleExportView} onExportAll={handleExportAll} disabled={sortedRows.length === 0} />
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <PieChart className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-gray-800">No percentage allocations recorded yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Tag transactions with Stage Code 2 = "Percentage Allocation" or use allocation configs to track them here.
            </p>
          </div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-success mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Total Allocated</span>
              </div>
              <p className="font-mono font-bold text-success text-base">{formatCurrency(totalDeposited, baseCurrencyCode)}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-danger mb-1">
                <TrendingDown className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Withdrawn</span>
              </div>
              <p className="font-mono font-bold text-danger text-base">{formatCurrency(totalWithdrawn, baseCurrencyCode)}</p>
            </div>
            <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-primary mb-1">
                <PieChart className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Net Balance</span>
              </div>
              <p className={`font-mono font-bold text-base ${totalBalance >= 0 ? 'text-primary' : 'text-danger'}`}>
                {formatCurrency(totalBalance, baseCurrencyCode)}
              </p>
            </div>
          </div>

          {/* Per-category table */}
          <div className="space-y-1.5">
            <DataControlsBar
              columns={PA_COLUMNS}
              sortKey={state.sortKey}
              sortDir={state.sortDir}
              onSort={state.setSort}
              defaultSortKey="balance"
              defaultSortDir="desc"
              search={state.search}
              onSearchChange={state.setSearch}
              searchPlaceholder="Search categories…"
              searchCol={state.searchCol}
              onSearchColChange={state.setSearchCol}
              advancedSort={state.advancedSort}
              onAdvancedSort={state.setAdvancedSort}
              pageSize={state.pageSize}
              onPageSizeChange={state.setPageSize}
            />
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <SortableHeader field={PA_SORT_FIELDS[0]} activeSortKey={state.sortKey} activeSortDir={state.sortDir} onSort={state.setSort} className="px-5 py-3" />
                    <SortableHeader field={PA_SORT_FIELDS[1]} activeSortKey={state.sortKey} activeSortDir={state.sortDir} onSort={state.setSort} rightAlign className="px-5 py-3" inactiveCls="text-success/80 hover:text-success" />
                    <th className="px-5 py-3 text-right font-medium hidden sm:table-cell">Withdrawn</th>
                    <SortableHeader field={PA_SORT_FIELDS[2]} activeSortKey={state.sortKey} activeSortDir={state.sortDir} onSort={state.setSort} rightAlign className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {paPage.map(row => (
                    <tr key={row.category} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-gray-800">{row.category}</td>
                      <td className="px-5 py-3 text-right text-success font-mono">
                        {formatCurrency(row.deposited, baseCurrencyCode)}
                      </td>
                      <td className="px-5 py-3 text-right text-danger font-mono hidden sm:table-cell">
                        {row.withdrawn > 0 ? formatCurrency(row.withdrawn, baseCurrencyCode) : '—'}
                      </td>
                      <td className={`px-5 py-3 text-right font-bold font-mono ${row.balance >= 0 ? 'text-gray-800' : 'text-danger'}`}>
                        {formatCurrency(row.balance, baseCurrencyCode)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                    <td className="px-5 py-3 text-gray-700">Total</td>
                    <td className="px-5 py-3 text-right text-success font-mono">{formatCurrency(totalDeposited, baseCurrencyCode)}</td>
                    <td className="px-5 py-3 text-right text-danger font-mono hidden sm:table-cell">
                      {totalWithdrawn > 0 ? formatCurrency(totalWithdrawn, baseCurrencyCode) : '—'}
                    </td>
                    <td className={`px-5 py-3 text-right font-mono ${totalBalance >= 0 ? 'text-primary' : 'text-danger'}`}>
                      {formatCurrency(totalBalance, baseCurrencyCode)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <PaginationBar
              page={state.page}
              pageSize={state.pageSize}
              total={sortedRows.length}
              onPageChange={state.setPage}
              variant="full"
            />
          </div>
        </>
      )}
    </div>
  )
}
