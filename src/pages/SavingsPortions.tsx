import { useEffect, useState, useCallback, useMemo } from 'react'
import { Archive, AlertCircle, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react'
import { PageHelpBanner } from '../components/ui/PageHelpBanner'
import { exportCSV } from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatCurrency } from '../utils/formatters'
import { useTransactionSyncStore } from '../store/transactionSyncStore'
import { DataControlsBar } from '../components/ui/DataControlsBar'
import { SortableHeader } from '../components/ui/SortableHeader'
import { PaginationBar } from '../components/ui/PaginationBar'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows } from '../utils/sortUtils'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields, searchRows } from '../utils/tableColumns'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { useOrgStore } from '../store/orgStore'
import { computeFundBuckets } from '../utils/fundBuckets'

interface SavingsRow {
  category:     string
  deposited:    number
  withdrawn:    number
  balance:      number
}

const SVP_COLUMNS: TableColumnDef<SavingsRow>[] = [
  { key: 'category', label: 'Category',   sortType: 'text',    primary: true, accessor: r => r.category },
  { key: 'deposited', label: 'Total Saved', sortType: 'numeric', primary: true },
  { key: 'balance',   label: 'Net Balance', sortType: 'numeric', primary: true },
]

const SVP_SORT_FIELDS = deriveSortFields(SVP_COLUMNS)

export default function SavingsPortions() {
  usePageTitle('Savings Funds')
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()
  const orgId = useOrgStore(s => s.orgId)

  const [rows,    setRows]    = useState<SavingsRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const svpState = useDataViewState({ storageKey: 'svp', defaultSortKey: 'balance', defaultSortDir: 'desc' })
  const intraflowVersion = useTransactionSyncStore(s => s.intraflowVersion)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    // Single shared source of truth — same engine as the Category Accounts
    // summary cards, so Savings here always reconciles with that card.
    const fb = await computeFundBuckets(orgId)
    if (fb.error) { setError(fb.error); setLoading(false); return }

    const result: SavingsRow[] = [...fb.byCategory.values()]
      .filter(b => b.savIn !== 0 || b.savOut !== 0)
      .map(b => ({
        category:  b.category,
        deposited: b.savIn,
        withdrawn: b.savOut,
        balance:   b.savIn - b.savOut,
      }))
      .sort((a, b) => b.balance - a.balance)

    setRows(result)
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load, intraflowVersion])

  // Filter by search
  const visibleRows = useMemo(
    () => searchRows(rows, SVP_COLUMNS, svpState.search, svpState.searchCol),
    [rows, svpState.search, svpState.searchCol],
  )

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

  const svpPage = useMemo(
    () => sortedRows.slice(svpState.page * svpState.pageSize, (svpState.page + 1) * svpState.pageSize),
    [sortedRows, svpState.page, svpState.pageSize],
  )

  const SVP_CSV_HEADERS = ['Category', `Deposited (${baseCurrencySymbol})`, `Withdrawn (${baseCurrencySymbol})`, `Balance (${baseCurrencySymbol})`]
  const svpCsvRow = (r: SavingsRow) => [r.category, r.deposited, r.withdrawn, r.balance]
  const SVP_CSV_FILE = `savings-portions-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(SVP_CSV_FILE, SVP_CSV_HEADERS, svpPage.map(svpCsvRow))
  const handleExportAll  = () => exportCSV(SVP_CSV_FILE, SVP_CSV_HEADERS, sortedRows.map(svpCsvRow))

  // Totals reflect visible (filtered) data
  const totalDeposited = visibleRows.reduce((s, r) => s + r.deposited, 0)
  const totalWithdrawn = visibleRows.reduce((s, r) => s + r.withdrawn, 0)
  const totalBalance   = visibleRows.reduce((s, r) => s + r.balance, 0)

  return (
    <div className="space-y-5">

      <PageHelpBanner storageKey="help-dismissed-savings-portions" title="What are Savings Funds?">
        Savings funds are amounts set aside from income as a reserve or contingency fund, separate from the operating budget.
        Each category here represents a savings fund rule — a percentage of qualifying inflows is automatically reserved.
        The balance grows with each new inflow and is only reduced when a formal withdrawal is recorded.
      </PageHelpBanner>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Savings Funds</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Accumulated savings fund balances per category — all time
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportDropdown onExportView={handleExportView} onExportAll={handleExportAll} disabled={sortedRows.length === 0} />
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-success mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Total Saved</span>
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
                <Archive className="w-4 h-4" />
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
              columns={SVP_COLUMNS}
              sortKey={svpState.sortKey}
              sortDir={svpState.sortDir}
              onSort={svpState.setSort}
              defaultSortKey="balance"
              defaultSortDir="desc"
              search={svpState.search}
              onSearchChange={svpState.setSearch}
              searchPlaceholder="Search categories…"
              searchCol={svpState.searchCol}
              onSearchColChange={svpState.setSearchCol}
              advancedSort={svpState.advancedSort}
              onAdvancedSort={svpState.setAdvancedSort}
              pageSize={svpState.pageSize}
              onPageSizeChange={svpState.setPageSize}
            />
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm table-sticky-col">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <SortableHeader field={SVP_SORT_FIELDS[0]} activeSortKey={svpState.sortKey} activeSortDir={svpState.sortDir} onSort={svpState.setSort} className="px-5 py-3" />
                  <SortableHeader field={SVP_SORT_FIELDS[1]} activeSortKey={svpState.sortKey} activeSortDir={svpState.sortDir} onSort={svpState.setSort} rightAlign className="px-5 py-3" inactiveCls="text-success/80 hover:text-success" />
                  <th className="px-5 py-3 text-right font-medium hidden sm:table-cell">Withdrawn</th>
                  <SortableHeader field={SVP_SORT_FIELDS[2]} activeSortKey={svpState.sortKey} activeSortDir={svpState.sortDir} onSort={svpState.setSort} rightAlign className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {svpPage.map(row => (
                  <tr key={row.category} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
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
            page={svpState.page}
            pageSize={svpState.pageSize}
            total={sortedRows.length}
            onPageChange={svpState.setPage}
            variant="full"
          />
          </div>
        </>
      )}
    </div>
  )
}
