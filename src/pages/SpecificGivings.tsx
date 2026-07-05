import { useEffect, useState, useCallback, useMemo, Fragment } from 'react'
import { Gift, AlertCircle, RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronRight, ArrowLeft, X } from 'lucide-react'
import { useDetailLevel } from '../hooks/useDetailLevel'
import { SimpleShell } from '../components/ui/SimpleShell'
import { RankedBarChart, RANKED_CHART_MAX_ROWS } from '../components/ui/RankedBarChart'
import { useCountUp } from '../hooks/useCountUp'
import { SearchableSelect } from '../components/ui/SearchableSelect'
import { PageHelpBanner } from '../components/ui/PageHelpBanner'
import { exportCSV } from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatDate, formatCurrency } from '../utils/formatters'
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
import { computeFundBuckets, type SeedTarget } from '../utils/fundBuckets'

interface GiftRow {
  category:  string
  deposited: number
  withdrawn: number
  balance:   number
  targets:   SeedTarget[]
}

const SG_COLUMNS: TableColumnDef<GiftRow>[] = [
  { key: 'category',  label: 'Category',    sortType: 'text',    primary: true, accessor: r => r.category },
  { key: 'deposited', label: 'Gifts In',    sortType: 'numeric', primary: true },
  { key: 'balance',   label: 'Net Balance', sortType: 'numeric', primary: true },
]

const SG_SORT_FIELDS = deriveSortFields(SG_COLUMNS)

export default function SpecificGivings() {
  usePageTitle('Designated Gifts')
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()
  const orgId = useOrgStore(s => s.orgId)

  const [rows,    setRows]    = useState<GiftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)

  const sgState = useDataViewState({ storageKey: 'sg', defaultSortKey: 'balance', defaultSortDir: 'desc' })
  const { setLevel: setDetail, isSimple } = useDetailLevel('designated-gifts')
  const intraflowVersion = useTransactionSyncStore(s => s.intraflowVersion)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    // Single shared source of truth — same engine as the Category Accounts
    // summary cards. Designated Gifts here (and its per-target breakdown)
    // always reconciles with that card.
    const fb = await computeFundBuckets(orgId)
    if (fb.error) { setError(fb.error); setLoading(false); return }

    const result: GiftRow[] = [...fb.byCategory.values()]
      .filter(b => b.seedIn !== 0 || b.seedOut !== 0)
      .map(b => ({
        category:  b.category,
        deposited: b.seedIn,
        withdrawn: b.seedOut,
        balance:   b.seedIn - b.seedOut,
        targets:   fb.seedTargets.get(b.category) ?? [],
      }))
      .sort((a, b) => b.balance - a.balance)

    setRows(result)
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load, intraflowVersion])

  const visibleRows = useMemo(
    () => searchRows(rows, SG_COLUMNS, sgState.search, sgState.searchCol),
    [rows, sgState.search, sgState.searchCol],
  )

  const getSgValue = (r: GiftRow, k: string) => {
    if (k === 'category') return r.category
    if (k === 'deposited') return r.deposited
    return r.balance
  }

  const sortedRows = useMemo(() => {
    const adv = sgState.advancedSort
    if (adv.length > 0) return multiSortRows(visibleRows, getSgValue, adv, SG_SORT_FIELDS)
    return sortRows(visibleRows, getSgValue, sgState.sortKey, sgState.sortDir, SG_SORT_FIELDS)
  }, [visibleRows, sgState.sortKey, sgState.sortDir, sgState.advancedSort])

  const sgPage = useMemo(
    () => sortedRows.slice(sgState.page * sgState.pageSize, (sgState.page + 1) * sgState.pageSize),
    [sortedRows, sgState.page, sgState.pageSize],
  )

  const SG_CSV_HEADERS = ['Category', `Gifts In (${baseCurrencySymbol})`, `Withdrawn (${baseCurrencySymbol})`, `Balance (${baseCurrencySymbol})`]
  const sgCsvRow = (r: GiftRow) => [r.category, r.deposited, r.withdrawn, r.balance]
  const SG_CSV_FILE = `specific-givings-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(SG_CSV_FILE, SG_CSV_HEADERS, sgPage.map(sgCsvRow))
  const handleExportAll  = () => exportCSV(SG_CSV_FILE, SG_CSV_HEADERS, sortedRows.map(sgCsvRow))

  // Totals reflect visible (filtered) data
  const totalDeposited = visibleRows.reduce((s, r) => s + r.deposited, 0)
  const totalWithdrawn = visibleRows.reduce((s, r) => s + r.withdrawn, 0)
  const totalBalance   = visibleRows.reduce((s, r) => s + r.balance, 0)

  if (isSimple) {
    return (
      <SimpleDesignatedGiftsView
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

      <PageHelpBanner storageKey="help-dismissed-specific-givings" title="What are Designated Gifts?">
        These are donations earmarked for a particular purpose — for example, a gift specifically for the Building Fund or a mission project.
        Unlike general offerings, designated gifts are restricted: the money should only be used for the stated purpose.
        This page shows the running balance for each designated fund; expand a row to see the breakdown by target or recipient.
      </PageHelpBanner>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Designated Gifts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Designated gift balances per category — all time
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
            <Gift className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-gray-800">No designated gifts recorded yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Transactions tagged with Fund Type = "Designated Gift" will appear here.
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
                <span className="text-xs font-semibold uppercase tracking-wide">Total Gifts In</span>
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
                <Gift className="w-4 h-4" />
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
              columns={SG_COLUMNS}
              sortKey={sgState.sortKey}
              sortDir={sgState.sortDir}
              onSort={sgState.setSort}
              defaultSortKey="balance"
              defaultSortDir="desc"
              search={sgState.search}
              onSearchChange={sgState.setSearch}
              searchPlaceholder="Search categories…"
              searchCol={sgState.searchCol}
              onSearchColChange={sgState.setSearchCol}
              advancedSort={sgState.advancedSort}
              onAdvancedSort={sgState.setAdvancedSort}
              pageSize={sgState.pageSize}
              onPageSizeChange={sgState.setPageSize}
            />
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm table-sticky-col">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="w-8 px-2 py-3" />
                  <SortableHeader field={SG_SORT_FIELDS[0]} activeSortKey={sgState.sortKey} activeSortDir={sgState.sortDir} onSort={sgState.setSort} className="px-5 py-3" />
                  <SortableHeader field={SG_SORT_FIELDS[1]} activeSortKey={sgState.sortKey} activeSortDir={sgState.sortDir} onSort={sgState.setSort} rightAlign className="px-5 py-3" inactiveCls="text-success/80 hover:text-success" />
                  <th className="px-5 py-3 text-right font-medium hidden sm:table-cell">Withdrawn</th>
                  <SortableHeader field={SG_SORT_FIELDS[2]} activeSortKey={sgState.sortKey} activeSortDir={sgState.sortDir} onSort={sgState.setSort} rightAlign className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sgPage.map(row => {
                  const isExpanded = expandedCategory === row.category
                  return (
                    <Fragment key={row.category}>
                      <tr className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                        <td className="w-8 px-2 py-3">
                          <button
                            onClick={() => setExpandedCategory(isExpanded ? null : row.category)}
                            className="touch-target p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                            title={isExpanded ? 'Collapse' : 'Show targets'}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        </td>
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
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="px-5 pb-4 pt-1 bg-gray-50/60">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                                  <th className="px-3 py-2 text-left font-medium">Target / Recipient</th>
                                  <th className="px-3 py-2 text-center font-medium hidden sm:table-cell">Entries</th>
                                  <th className="px-3 py-2 text-center font-medium hidden sm:table-cell">Latest</th>
                                  <th className="px-3 py-2 text-right font-medium">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {row.targets.map(t => (
                                  <tr key={t.target}>
                                    <td className="px-3 py-2 text-gray-700">{t.target}</td>
                                    <td className="px-3 py-2 text-center text-gray-500 text-xs hidden sm:table-cell">{t.count}</td>
                                    <td className="px-3 py-2 text-center text-gray-500 text-xs hidden sm:table-cell">
                                      {t.latest ? formatDate(t.latest) : '—'}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-semibold ${t.total >= 0 ? 'text-success' : 'text-danger'}`}>
                                      {formatCurrency(t.total, baseCurrencyCode)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                  <td className="w-8 px-2 py-3" />
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
            page={sgState.page}
            pageSize={sgState.pageSize}
            total={sortedRows.length}
            onPageChange={sgState.setPage}
            variant="full"
          />
          </div>
        </>
      )}
    </div>
  )
}

// ── Simple view ──────────────────────────────────────────────────────────────
// Same pattern as Regular/Savings Funds, plus: selecting a real category (not
// the "Other" bucket) also lists its target/recipient breakdown, preserving
// the one capability unique to this page. Bars use Gold Honour — the same
// color this fund type gets in the Category Accounts composition chart.

const DESIGNATED_BAR_COLOR = '#C89B3C' // Gold Honour

type BucketRow = GiftRow & { isOther?: boolean }

function SimpleDesignatedGiftsView({ rows, loading, baseCurrencyCode, onViewAll }: {
  rows: GiftRow[]
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
      displayRows: [...top, { category: `Other (${rest.length})`, ...agg, targets: [], isOther: true }] as BucketRow[],
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
          <p className="text-xs font-medium text-gray-500">Designated Gifts — net balance</p>
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
            <p className="text-[10px] font-bold uppercase tracking-wide text-success mb-0.5 flex items-center gap-1"><TrendingUp className="w-2.5 h-2.5" />Gifts In</p>
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
      <Gift className="w-8 h-8 text-primary/60" />
      <p className="text-sm text-gray-500">No designated gifts recorded yet.</p>
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
              <span className="text-gray-600">Gifts In</span>
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

          {!(selected as BucketRow).isOther && selected.targets.length > 0 && (
            <div className="mt-3 pt-3 border-t border-primary/20 space-y-1">
              <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Targets / recipients</p>
              {selected.targets.map(t => (
                <div key={t.target} className="flex items-center justify-between text-xs">
                  <span className="text-gray-600 truncate min-w-0 mr-2">{t.target}</span>
                  <span className={`font-mono shrink-0 ${t.total >= 0 ? 'text-success' : 'text-danger'}`}>{formatCurrency(t.total, baseCurrencyCode)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <p className="text-[11px] text-gray-400 mb-2">Tap a category to see its detail</p>
        <RankedBarChart
          items={displayRows.map(r => ({ name: r.category, value: r.balance, muted: !!r.isOther }))}
          color={DESIGNATED_BAR_COLOR}
          activeName={activeCategory || null}
          onSelect={selectBar}
        />
      </div>
    </div>
  )

  return (
    <SimpleShell
      pageId="designated-gifts"
      hero={hero}
      filters={filters}
      bodyTitle="Balances by category"
      body={body}
      onViewAll={onViewAll}
      viewAllLabel="View full table"
    />
  )
}
