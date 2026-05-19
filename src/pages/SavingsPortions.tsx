import { useEffect, useState, useCallback, useMemo } from 'react'
import { Archive, AlertCircle, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatCurrency } from '../utils/formatters'
import { DataControlsBar } from '../components/ui/DataControlsBar'
import { SortableHeader } from '../components/ui/SortableHeader'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows, type SortField } from '../utils/sortUtils'

interface SavingsRow {
  category:     string
  deposited:    number
  withdrawn:    number
  balance:      number
}

const SVP_SORT_FIELDS: SortField[] = [
  { key: 'category', label: 'Category',   type: 'text',    primary: true },
  { key: 'deposited', label: 'Total Saved', type: 'numeric', primary: true },
  { key: 'balance',   label: 'Net Balance', type: 'numeric', primary: true },
]

const SVP_SEARCH_COLS = [
  { key: 'all',      label: 'All Columns' },
  { key: 'category', label: 'Category' },
]

export default function SavingsPortions() {
  usePageTitle('Savings Portions')

  const [rows,    setRows]    = useState<SavingsRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const svpState = useDataViewState({ storageKey: 'svp', defaultSortKey: 'balance', defaultSortDir: 'desc' })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [inflowRes, outflowRes, cobRes] = await Promise.all([
      supabase
        .from('inflow_transactions')
        .select('stage_code_1, amount')
        .eq('stage_code_2', 'Savings'),
      supabase
        .from('outflow_transactions')
        .select('stage_code_1, actual_amount, amount_disbursed')
        .eq('stage_code_2', 'Savings'),
      supabase
        .from('category_opening_balances')
        .select('amount, categories(name)')
        .eq('budget_portion', 'Savings'),
    ])

    if (inflowRes.error || outflowRes.error) {
      setError(inflowRes.error?.message ?? outflowRes.error?.message ?? 'Failed to load')
      setLoading(false)
      return
    }

    const cobData = cobRes.error ? [] : (cobRes.data ?? [])

    // Accumulate per category
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
      ensure(cat).withdrawn += Number(r.actual_amount || r.amount_disbursed || 0)
    }

    for (const ob of cobData) {
      const catName = (ob.categories as unknown as { name: string } | null)?.name ?? ''
      if (!catName) continue
      ensure(catName).deposited += Number(ob.amount)
    }

    const result: SavingsRow[] = [...map.entries()].map(([category, v]) => ({
      category,
      deposited: v.deposited,
      withdrawn: v.withdrawn,
      balance:   v.deposited - v.withdrawn,
    })).sort((a, b) => b.balance - a.balance)

    setRows(result)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // Filter by search
  const visibleRows = useMemo(() => {
    const q = svpState.search.trim().toLowerCase()
    return q ? rows.filter(r => r.category.toLowerCase().includes(q)) : rows
  }, [rows, svpState.search])

  const getSvpValue = (r: SavingsRow, k: string) => {
    if (k === 'category') return r.category
    if (k === 'deposited') return r.deposited
    return r.balance
  }

  // Sort
  const sortedRows = useMemo(() => {
    const adv = svpState.advancedSort
    if (adv.length > 0) return multiSortRows(visibleRows, getSvpValue, adv, SVP_SORT_FIELDS)
    return sortRows(visibleRows, getSvpValue, svpState.sortKey, svpState.sortDir, SVP_SORT_FIELDS)
  }, [visibleRows, svpState.sortKey, svpState.sortDir, svpState.advancedSort])

  // Totals reflect visible (filtered) data
  const totalDeposited = visibleRows.reduce((s, r) => s + r.deposited, 0)
  const totalWithdrawn = visibleRows.reduce((s, r) => s + r.withdrawn, 0)
  const totalBalance   = visibleRows.reduce((s, r) => s + r.balance, 0)

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Savings Portions</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Accumulated savings balances per category — all time
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
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
            <Archive className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-gray-800">No savings recorded yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Tag transactions with Stage Code 2 = "Savings" to track them here.
            </p>
          </div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-success mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Total Saved</span>
              </div>
              <p className="font-mono font-bold text-success text-base">{formatCurrency(totalDeposited)}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-danger mb-1">
                <TrendingDown className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Withdrawn</span>
              </div>
              <p className="font-mono font-bold text-danger text-base">{formatCurrency(totalWithdrawn)}</p>
            </div>
            <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-primary mb-1">
                <Archive className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Net Balance</span>
              </div>
              <p className={`font-mono font-bold text-base ${totalBalance >= 0 ? 'text-primary' : 'text-danger'}`}>
                {formatCurrency(totalBalance)}
              </p>
            </div>
          </div>

          {/* Per-category table */}
          <div className="space-y-1.5">
            <DataControlsBar
              sortFields={SVP_SORT_FIELDS}
              sortKey={svpState.sortKey}
              sortDir={svpState.sortDir}
              onSort={svpState.setSort}
              defaultSortKey="balance"
              defaultSortDir="desc"
              search={svpState.search}
              onSearchChange={svpState.setSearch}
              searchPlaceholder="Search categories…"
              searchColumns={SVP_SEARCH_COLS}
              searchCol={svpState.searchCol}
              onSearchColChange={svpState.setSearchCol}
              advancedSort={svpState.advancedSort}
              onAdvancedSort={svpState.setAdvancedSort}
            />
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <SortableHeader field={SVP_SORT_FIELDS[0]} activeSortKey={svpState.sortKey} activeSortDir={svpState.sortDir} onSort={svpState.setSort} className="px-5 py-3" />
                  <SortableHeader field={SVP_SORT_FIELDS[1]} activeSortKey={svpState.sortKey} activeSortDir={svpState.sortDir} onSort={svpState.setSort} rightAlign className="px-5 py-3" inactiveCls="text-success/80 hover:text-success" />
                  <th className="px-5 py-3 text-right font-medium hidden sm:table-cell">Withdrawn</th>
                  <SortableHeader field={SVP_SORT_FIELDS[2]} activeSortKey={svpState.sortKey} activeSortDir={svpState.sortDir} onSort={svpState.setSort} rightAlign className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sortedRows.map(row => (
                  <tr key={row.category} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-gray-800">{row.category}</td>
                    <td className="px-5 py-3 text-right text-success font-mono">
                      {formatCurrency(row.deposited)}
                    </td>
                    <td className="px-5 py-3 text-right text-danger font-mono hidden sm:table-cell">
                      {row.withdrawn > 0 ? formatCurrency(row.withdrawn) : '—'}
                    </td>
                    <td className={`px-5 py-3 text-right font-bold font-mono ${row.balance >= 0 ? 'text-gray-800' : 'text-danger'}`}>
                      {formatCurrency(row.balance)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                  <td className="px-5 py-3 text-gray-700">Total</td>
                  <td className="px-5 py-3 text-right text-success font-mono">{formatCurrency(totalDeposited)}</td>
                  <td className="px-5 py-3 text-right text-danger font-mono hidden sm:table-cell">
                    {totalWithdrawn > 0 ? formatCurrency(totalWithdrawn) : '—'}
                  </td>
                  <td className={`px-5 py-3 text-right font-mono ${totalBalance >= 0 ? 'text-primary' : 'text-danger'}`}>
                    {formatCurrency(totalBalance)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          </div>
        </>
      )}
    </div>
  )
}
