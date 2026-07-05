import { useEffect, useState, useCallback, useMemo } from 'react'
import { PieChart, AlertCircle, RefreshCw, TrendingUp, TrendingDown, ArrowLeft, X } from 'lucide-react'
import { useDetailLevel } from '../hooks/useDetailLevel'
import { SimpleShell } from '../components/ui/SimpleShell'
import { RankedBarChart, RANKED_CHART_MAX_ROWS } from '../components/ui/RankedBarChart'
import { useCountUp } from '../hooks/useCountUp'
import { SearchableSelect } from '../components/ui/SearchableSelect'
import { exportCSV } from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
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
import { deriveSortFields, searchRows } from '../utils/tableColumns'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { useOrgStore } from '../store/orgStore'
import { computeFundBuckets } from '../utils/fundBuckets'

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

export default function PercentageAllocation() {
  usePageTitle('Regular Funds')
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()
  const orgId = useOrgStore(s => s.orgId)

  const [rows,    setRows]    = useState<PctRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const state = useDataViewState({ storageKey: 'pa', defaultSortKey: 'balance', defaultSortDir: 'desc' })
  const intraflowVersion = useTransactionSyncStore(s => s.intraflowVersion)
  const { setLevel: setDetail, isSimple } = useDetailLevel('regular-funds')

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    // Single shared source of truth — same engine as the Category Accounts
    // summary cards, so Regular Funds here always reconciles with that card.
    const fb = await computeFundBuckets(orgId)
    if (fb.error) { setError(fb.error); setLoading(false); return }

    const result: PctRow[] = [...fb.byCategory.values()]
      .filter(b => b.pctIn !== 0 || b.pctOut !== 0)
      .map(b => ({
        category:  b.category,
        deposited: b.pctIn,
        withdrawn: b.pctOut,
        balance:   b.pctIn - b.pctOut,
      }))
      .sort((a, b) => b.balance - a.balance)

    setRows(result)
    setLoading(false)
  }, [orgId])

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

  if (isSimple) {
    return (
      <SimpleRegularFundsView
        rows={rows}
        loading={loading}
        baseCurrencyCode={baseCurrencyCode}
        onViewAll={() => setDetail('full')}
      />
    )
  }

  return (
    <div className="space-y-5">

      <button
        type="button"
        onClick={() => setDetail('simple')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Show summary
      </button>

      <PageHelpBanner storageKey="help-dismissed-pct-alloc" title="What are Regular Funds?">
        This page shows how incoming funds have been distributed across departments or budget lines using your preset percentage rules.
        Each row represents a category that receives a fixed share of qualifying inflows — for example, 60% to General Fund.
        Balances accumulate over time and update automatically when new inflows are recorded.
      </PageHelpBanner>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Regular Funds</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Accumulated regular fund balances per category — all time
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
            <PieChart className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-gray-800">No regular funds recorded yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Tag transactions with Fund Type = "Regular Funds" or use distribution rules to track them here.
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
              <table className="w-full text-sm table-sticky-col">
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

// ── Simple view ──────────────────────────────────────────────────────────────
// Matches the Category Accounts summary pattern: hero net balance + smaller
// In/Withdrawn strip, then a ranked bar per category (shrink-to-fit, "Other"
// bucket past ~23 categories). Bars use Teal Anchor — the same color this
// fund type gets in the Category Accounts composition chart.

const REGULAR_BAR_COLOR = '#0D7377' // Teal Anchor

type BucketRow = PctRow & { isOther?: boolean }

function SimpleRegularFundsView({ rows, loading, baseCurrencyCode, onViewAll }: {
  rows: PctRow[]
  loading: boolean
  baseCurrencyCode: string
  onViewAll: () => void
}) {
  const [activeCategory, setActiveCategory] = useState('')

  const totalDeposited = rows.reduce((s, r) => s + r.deposited, 0)
  const totalWithdrawn = rows.reduce((s, r) => s + r.withdrawn, 0)
  const totalBalance   = rows.reduce((s, r) => s + r.balance, 0)
  const animatedTotal  = useCountUp(totalBalance)

  const ranked: BucketRow[] = useMemo(
    () => [...rows].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
    [rows],
  )

  const { displayRows, otherMembers } = useMemo(() => {
    if (ranked.length <= RANKED_CHART_MAX_ROWS) return { displayRows: ranked, otherMembers: null as BucketRow[] | null }
    const top  = ranked.slice(0, RANKED_CHART_MAX_ROWS - 1)
    const rest = ranked.slice(RANKED_CHART_MAX_ROWS - 1)
    const agg = rest.reduce(
      (acc, r) => ({ deposited: acc.deposited + r.deposited, withdrawn: acc.withdrawn + r.withdrawn, balance: acc.balance + r.balance }),
      { deposited: 0, withdrawn: 0, balance: 0 },
    )
    return {
      displayRows: [...top, { category: `Other (${rest.length})`, ...agg, isOther: true }] as BucketRow[],
      otherMembers: rest,
    }
  }, [ranked])

  const selected = activeCategory
    ? (displayRows.find(r => r.category === activeCategory) ?? ranked.find(r => r.category === activeCategory) ?? null)
    : null

  const selectBar = (name: string) => setActiveCategory(prev => prev === name ? '' : name)

  const hero = (
    <div className="space-y-3">
      {loading ? (
        <div className="h-24 rounded-2xl border border-gray-100 bg-white animate-pulse" />
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <p className="text-xs font-medium text-gray-500">Regular Funds — net balance</p>
          <p className={`text-3xl font-extrabold tabular-nums mt-1 ${totalBalance >= 0 ? 'text-gray-900' : 'text-danger'}`}>
            {formatCurrency(animatedTotal, baseCurrencyCode)}
          </p>
        </div>
      )}
      {loading ? (
        <div className="grid grid-cols-2 gap-2">
          {[1, 2].map(i => <div key={i} className="h-14 rounded-lg bg-gray-100 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-green-50 border border-green-200 px-2.5 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-success mb-0.5 flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5" />Allocated</p>
            <p className="text-xs font-mono font-bold text-success tabular-nums">{formatCurrency(totalDeposited, baseCurrencyCode)}</p>
          </div>
          <div className="rounded-lg bg-red-50 border border-red-200 px-2.5 py-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-danger mb-0.5 flex items-center gap-1"><TrendingDown className="w-2.5 h-2.5" />Withdrawn</p>
            <p className="text-xs font-mono font-bold text-danger tabular-nums">{formatCurrency(totalWithdrawn, baseCurrencyCode)}</p>
          </div>
        </div>
      )}
    </div>
  )

  const filters = (
    <div className="flex flex-wrap items-center gap-2">
      <SearchableSelect
        value={activeCategory}
        onChange={setActiveCategory}
        options={rows.map(r => ({ value: r.category, label: r.category }))}
        placeholder="Select a category to zoom in…"
        className="text-xs px-3 py-1.5 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white text-gray-700"
      />
      {activeCategory && (
        <button type="button" onClick={() => setActiveCategory('')} className="text-xs text-gray-400 hover:text-gray-600">Clear</button>
      )}
    </div>
  )

  const body = loading && ranked.length === 0 ? (
    <div className="h-48 rounded-2xl border border-gray-100 bg-white animate-pulse" />
  ) : ranked.length === 0 ? (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-2xl border border-dashed border-gray-200 bg-gray-50">
      <PieChart className="w-8 h-8 text-primary/60" />
      <p className="text-sm text-gray-500">No regular funds recorded yet.</p>
    </div>
  ) : (
    <div className="space-y-3">
      {selected && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between mb-2 gap-2">
            <p className="text-sm font-semibold text-gray-800 min-w-0 truncate">{selected.category}</p>
            <div className="flex items-center gap-2 shrink-0">
              <p className={`text-sm font-mono font-bold tabular-nums ${selected.balance >= 0 ? 'text-gray-900' : 'text-danger'}`}>{formatCurrency(selected.balance, baseCurrencyCode)}</p>
              <button type="button" onClick={() => setActiveCategory('')} aria-label="Close category detail" className="p-1 -m-1 rounded text-gray-400 hover:text-gray-600 hover:bg-black/5 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Allocated</span>
              <span className="font-mono font-semibold text-success">{formatCurrency(selected.deposited, baseCurrencyCode)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-600">Withdrawn</span>
              <span className="font-mono font-semibold text-danger">{formatCurrency(selected.withdrawn, baseCurrencyCode)}</span>
            </div>
          </div>

          {(selected as BucketRow).isOther && otherMembers && otherMembers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-primary/20 space-y-1">
              <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Categories in this group</p>
              {otherMembers.slice(0, 10).map(m => (
                <div key={m.category} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600 truncate min-w-0 mr-2">{m.category}</span>
                  <span className="font-mono text-gray-700 shrink-0">{formatCurrency(m.balance, baseCurrencyCode)}</span>
                </div>
              ))}
              {otherMembers.length > 10 && <p className="text-[11px] text-gray-400 pt-0.5">+{otherMembers.length - 10} more</p>}
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-[11px] text-gray-400 mb-2">Tap a category to see its detail</p>
        <RankedBarChart
          items={displayRows.map(r => ({ name: r.category, value: r.balance, muted: !!r.isOther }))}
          color={REGULAR_BAR_COLOR}
          activeName={activeCategory || null}
          onSelect={selectBar}
        />
      </div>
    </div>
  )

  return (
    <SimpleShell
      pageId="regular-funds"
      hero={hero}
      filters={filters}
      bodyTitle="Balances by category"
      body={body}
      onViewAll={onViewAll}
      viewAllLabel="View full table"
    />
  )
}
