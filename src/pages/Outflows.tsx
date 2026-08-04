import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingDown, Pencil, Trash2, PlusCircle,
  AlertCircle, RefreshCw, ChevronRight, ChevronDown, AlertTriangle,
  ArrowRight, ArrowLeft, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import { BarChart, Bar, XAxis, Cell, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import { Card }                    from '../components/ui/Card'
import { DeleteDialog }            from '../components/ui/DeleteDialog'
import { BulkActionBar }           from '../components/ui/BulkActionBar'
import { BulkResultsModal, type BulkResults } from '../components/ui/BulkResultsModal'
import { AddOutflowModal }         from '../components/modals/AddOutflowModal'
import { BulkEditOutflowModal }    from '../components/modals/BulkEditOutflowModal'
import { ReceiptBadge }            from '../components/ui/ReceiptBadge'
import { DataControlsBar }         from '../components/ui/DataControlsBar'
import { SortableHeader }          from '../components/ui/SortableHeader'
import { PaginationBar }           from '../components/ui/PaginationBar'
import { useDataViewState }        from '../hooks/useDataViewState'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields } from '../utils/tableColumns'
import { useOutflowTransactions, type OutflowTransaction } from '../hooks/useTransactions'
import { useDeleteTransaction, useBulkDeleteTransaction } from '../hooks/useMutations'
import { useBulkSelection }        from '../hooks/useBulkSelection'
import { useBanks }                from '../hooks/useBanks'
import { useToastStore }           from '../store/toastStore'
import { useRole }                 from '../hooks/useRole'
import { usePageTitle }            from '../hooks/usePageTitle'
import { formatDate, formatCurrency, formatCurrencyCompact } from '../utils/formatters'
import { exportCSV }               from '../utils/csvExport'
import { friendlyError }           from '../utils/friendlyError'
import { supabase }                from '../lib/supabase'
import { normalizeNarration }      from '../utils/normalizeNarration'
import { useOrgStore }             from '../store/orgStore'
import { fetchAllPaginated, EXPORT_MAX } from '../utils/paginatedExport'
import { ExportDropdown }          from '../components/ui/ExportDropdown'
import { useCategories }           from '../hooks/useCategories'
import { useOutflowTypes, type OutflowType } from '../hooks/useOutflowTypes'
import { useDetailLevel } from '../hooks/useDetailLevel'
import { SimpleShell } from '../components/ui/SimpleShell'
import { useCountUp } from '../hooks/useCountUp'
import { useOutflowSummary } from '../hooks/useOutflowSummary'
import { useYearRange }            from '../hooks/useYearRange'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { EmptyState } from '../components/ui/EmptyState'
import { PageEmptyState } from '../components/onboarding/PageEmptyState'
import { AmountCell } from '../components/ui/AmountCell'
import { filterInputCls } from '../components/ui/FormField'
import { OutflowRowDetail } from '../components/ui/OutflowRowDetail'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { SearchableSelect } from '../components/ui/SearchableSelect'
import { HelpButton }       from '../components/onboarding/HelpButton'
import { PageHelpBanner }   from '../components/ui/PageHelpBanner'
import { useFirstVisitTour } from '../hooks/useFirstVisitTour'
import { DatePresetBar, type DatePreset } from '../components/ui/DatePresetBar'
import { MobileFab } from '../components/ui/MobileFab'

const DEFAULT_PAGE_SIZE = 25

const TXN_TYPE_LABELS: Record<string, string> = {
  refund:              'Refund',
  reversal:            'Reversal',
  bank_deposit:        'Bank Deposit',
  intrabank_transfer:  'Intrabank Transfer',
}

const OUT_COLUMNS: TableColumnDef<OutflowTransaction>[] = [
  { key: 'date',             label: 'Date',          sortType: 'date',    primary: true, noSearch: true },
  { key: 'recorded_at',      label: 'Recorded',      sortType: 'date',    primary: true, noSearch: true },
  { key: 'description',      label: 'Description',   sortType: 'text',    accessor: r => r.display_description },
  { key: 'bank_name',        label: 'Bank',          sortType: 'text',    accessor: r => r.bank_name ?? '' },
  { key: 'bank_description', label: 'Bank Narration',                     accessor: r => r.bank_description ?? '' },
  { key: 'transaction_id',   label: 'Txn ID',                             accessor: r => r.transaction_id ?? '' },
  { key: 'transaction_type', label: 'Type',          sortType: 'text',    accessor: r => TXN_TYPE_LABELS[r.transaction_type ?? ''] ?? r.transaction_type ?? '' },
  { key: 'amount_disbursed', label: 'Disbursed',     sortType: 'numeric', accessor: r => String(r.amount_disbursed) },
  { key: 'outflow_type',     label: 'Outflow Type',  sortType: 'text',    accessor: r => r.outflow_type_name ?? '' },
  { key: 'stage_code_1',     label: 'Fund',                               accessor: r => r.stage_code_1 ?? '' },
  { key: 'net',              label: 'Net',                                accessor: r => String(Number(r.amount_disbursed) - Number(r.amount_refunded) - Number(r.transfer_charge)) },
]

const OUT_SORT_FIELDS = deriveSortFields(OUT_COLUMNS)
const outSF = (key: string) => OUT_SORT_FIELDS.find(f => f.key === key)!

const OUTFLOW_SORT_COLS = new Set(['date', 'amount_disbursed', 'bank_name', 'description', 'transaction_type', 'recorded_at'])
const OUTFLOW_SEARCH_COLS = new Set(['description', 'bank_description', 'bank_name', 'transaction_id', 'stage_code_1', 'transaction_type', 'outflow_type'])

// ── Summary strip ──────────────────────────────────────────────────────────────

function SummaryStrip({ total, effectiveTotal, hasOffsets, count, largest, average, loading }: {
  total: number; effectiveTotal: number; hasOffsets: boolean; count: number; largest: number; average: number; loading: boolean
}) {
  const { baseCurrencyCode } = useOrgCurrency()
  const items = [
    { label: 'Total (page)', value: formatCurrencyCompact(total, baseCurrencyCode) },
    { label: 'Records',      value: count.toLocaleString() },
    { label: 'Largest',      value: formatCurrencyCompact(largest, baseCurrencyCode) },
    { label: 'Average',      value: formatCurrencyCompact(average, baseCurrencyCode) },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(({ label, value }) => (
        <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 min-w-0">
          <p className="text-xs text-gray-500 mb-1 truncate">{label}</p>
          {loading
            ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
            : <p className="text-base font-bold text-gray-900 tabular-nums">{value}</p>}
        </div>
      ))}
      {!loading && hasOffsets && (
        <div className="bg-white rounded-xl border border-amber-200 shadow-sm px-4 py-3 min-w-0 col-span-2 sm:col-span-4">
          <p className="text-xs text-amber-600 mb-1 truncate font-medium">Effective Total (excl. offsets)</p>
          <p className="text-base font-bold text-amber-700 tabular-nums">{formatCurrencyCompact(effectiveTotal, baseCurrencyCode)}</p>
        </div>
      )}
    </div>
  )
}

function UnmappedStrip({ count, active, onToggle, loading, label }: {
  count: number; active: boolean; onToggle: () => void; loading: boolean; label: string
}) {
  if (!loading && count === 0 && !active) return null
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
        {loading ? (
          <div className="h-4 bg-amber-200/70 rounded animate-pulse w-56" />
        ) : (
          <p className="text-sm text-amber-800">
            <span className="font-semibold">{count.toLocaleString()}</span>{' '}
            transaction{count !== 1 ? 's' : ''} {label}
          </p>
        )}
      </div>
      <button
        onClick={onToggle}
        className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors whitespace-nowrap ${
          active
            ? 'bg-amber-600 text-white hover:bg-amber-700'
            : 'bg-white border border-amber-300 text-amber-700 hover:bg-amber-100'
        }`}
      >
        {active ? 'Show all' : 'Show only'}
      </button>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Outflows() {
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()
  const { year, dateFrom: yearStart, dateTo: yearEnd } = useYearRange()
  const orgId = useOrgStore((s) => s.orgId)

  // Filters
  const [dateFrom,          setDateFrom]          = useState(yearStart)
  const [dateTo,            setDateTo]            = useState(yearEnd)
  // Default to the full accounting year — 'ytd' so the "This Year" chip is active.
  const [datePreset,        setDatePreset]        = useState<DatePreset | null>('ytd')
  const [stageCode,         setStageCode]         = useState('')
  const [outflowTypeFilter, setOutflowTypeFilter] = useState('')
  const [searchInput,       setSearchInput]       = useState('')
  const [debouncedSearch,   setDebouncedSearch]   = useState('')
  const [page,              setPage]              = useState(0)
  const [showUnmappedOnly,  setShowUnmappedOnly]  = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  // Data controls state
  const outState = useDataViewState({ storageKey: 'out', defaultSortKey: 'recorded_at', defaultSortDir: 'desc', defaultPageSize: DEFAULT_PAGE_SIZE, persistSort: false })

  // Progressive disclosure: Simple opens with just the latest outflows.
  const { setLevel: setDetail, isSimple } = useDetailLevel('outflows')
  const SIMPLE_LIMIT = 10

  const { data, count, unmappedCount = 0, loading, error, refetch } = useOutflowTransactions({
    dateFrom:       dateFrom          || undefined,
    dateTo:         dateTo            || undefined,
    stageCode:      isSimple ? undefined : (stageCode || undefined),
    outflowTypeId:  isSimple ? undefined : (outflowTypeFilter || undefined),
    search:         isSimple ? undefined : (debouncedSearch || undefined),
    searchCol:      outState.searchCol,
    page:           isSimple ? 0 : page,
    pageSize:       isSimple ? SIMPLE_LIMIT : outState.pageSize,
    sortColumn:     isSimple ? 'recorded_at' : (outState.advancedSort.length === 0 ? outState.sortKey : undefined),
    sortAscending:  isSimple ? false : (outState.advancedSort.length === 0 ? (outState.sortDir === 'asc') : undefined),
    advancedSort:   isSimple ? undefined : (outState.advancedSort.length > 0 ? outState.advancedSort : undefined),
    unmappedOnly:   isSimple ? false : showUnmappedOnly,
  })

  const displayed = data

  const isOutflowUnmapped = (row: OutflowTransaction) => {
    if (!row.transaction_type) return !row.stage_code_1 || !row.stage_code_2
    return !row.offset_role || (row.offset_role === 'offset' && !row.root_transaction_id)
  }

  // Summary (current page, disbursed amounts)
  const total          = displayed.reduce((s, r) => s + Number(r.amount_disbursed), 0)
  const largest        = displayed.length ? Math.max(...displayed.map(r => Number(r.amount_disbursed))) : 0
  const average        = displayed.length ? total / displayed.length : 0
  const hasOffsets     = displayed.some(r => r.offset_role === 'offset')
  const effectiveTotal = displayed.reduce((s, r) =>
    r.offset_role === 'offset' ? s - Number(r.amount_disbursed) : s + Number(r.amount_disbursed), 0)

  // UI state
  const [editRecord,        setEditRecord]        = useState<OutflowTransaction | null>(null)
  const [modalOpen,         setModalOpen]         = useState(false)
  const [deleteId,          setDeleteId]          = useState<string | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkResults, setBulkResults] = useState<BulkResults | null>(null)
  const [bulkEditOpen,      setBulkEditOpen]      = useState(false)
  const [expandedId,        setExpandedId]        = useState<string | null>(null)

  const { selectedIds, toggleRow, clearAll, selectAllRows, allSelected } = useBulkSelection(data)

  const toggleExpand = (id: string) => setExpandedId(prev => prev === id ? null : id)

  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()
  const { push: toast }                             = useToastStore()
  const { canWrite, canDelete }                     = useRole()
  const { mutate: deleteRecord, loading: deleting }            = useDeleteTransaction('outflow_transactions')
  const { execute: executeBulkDelete, loading: bulkDeleting }  = useBulkDeleteTransaction('outflow_transactions')
  const { banks }                                   = useBanks()
  const { categories }                              = useCategories()
  const { outflowTypes }                            = useOutflowTypes()

  usePageTitle('Outflows')
  useFirstVisitTour('outflows')

  // Clear selection when filters/page/sort change
  useEffect(() => { setPage(0); clearAll(); setShowUnmappedOnly(false) }, [dateFrom, dateTo, stageCode, outflowTypeFilter, debouncedSearch]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDateFrom(`${year}-01-01`); setDateTo(`${year}-12-31`); setPage(0); clearAll() }, [year]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { clearAll() }, [page]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(0); clearAll() }, [outState.sortKey, outState.sortDir, outState.searchCol, outState.advancedSort, outState.pageSize]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(0) }, [showUnmappedOnly]) // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (r: OutflowTransaction) => { setEditRecord(r); setModalOpen(true) }

  const handleModalSuccess = () => {
    toast(editRecord ? 'Transaction updated' : 'Outflow added', 'success')
    refetch()
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteRecord(deleteId)
      toast('Transaction deleted', 'success')
      setDeleteId(null)
      refetch()
    } catch (e: unknown) {
      toast(friendlyError(e, 'delete the transaction'), 'error')
    }
  }

  const handleBulkDelete = async () => {
    const ids = [...selectedIds]
    const { failed, failures } = await executeBulkDelete(ids)
    setConfirmBulkDelete(false)
    clearAll()
    refetch()
    if (failed === 0) toast(`${ids.length} transaction${ids.length !== 1 ? 's' : ''} deleted.`, 'success')
    else setBulkResults({ action: 'deleted', succeeded: ids.length - failed, failures })
  }

  const OUT_CSV_HEADERS = ['Date', 'Txn ID', 'Description', 'Bank Narration', `Disbursed (${baseCurrencySymbol})`, `Refunded (${baseCurrencySymbol})`, `Transfer Charge (${baseCurrencySymbol})`, `Net Amount (${baseCurrencySymbol})`, 'Stage Code 1', 'Outflow Type', 'Remarks']
  const outflowCsvRow = (r: OutflowTransaction) => [
    r.date, r.transaction_id, r.display_description, r.bank_description,
    r.amount_disbursed, r.amount_refunded, r.transfer_charge,
    Number(r.amount_disbursed) - Number(r.amount_refunded) - Number(r.transfer_charge),
    r.stage_code_1, r.outflow_type_name ?? '', r.remarks,
  ]
  const OUT_CSV_FILE = `outflows-${new Date().toISOString().slice(0, 10)}.csv`

  const handleExportView = () => {
    exportCSV(OUT_CSV_FILE, OUT_CSV_HEADERS, displayed.map(outflowCsvRow))
  }

  const handleExportAll = async () => {
    if (!orgId) return
    try {
      const { rows, truncated } = await fetchAllPaginated<Omit<OutflowTransaction, 'display_description'>>((from, to) => {
        const adv = outState.advancedSort
        let q = supabase
          .from('outflow_transactions')
          .select('*', { count: 'exact' })
          .eq('org_id', orgId)
        if (adv.length > 0) {
          for (const l of adv) {
            if (OUTFLOW_SORT_COLS.has(l.key)) q = q.order(l.key, { ascending: l.dir === 'asc' })
          }
        } else if (OUTFLOW_SORT_COLS.has(outState.sortKey)) {
          q = q.order(outState.sortKey, { ascending: outState.sortDir === 'asc' })
          if (outState.sortKey !== 'recorded_at') q = q.order('recorded_at', { ascending: false })
        } else {
          q = q.order('recorded_at', { ascending: false }).order('date', { ascending: false })
        }
        if (dateFrom)          q = q.gte('date', dateFrom)
        if (dateTo)            q = q.lte('date', dateTo)
        if (stageCode)         q = q.eq('stage_code_1', stageCode)
        if (outflowTypeFilter) q = q.eq('outflow_type_id', outflowTypeFilter)
        if (debouncedSearch) {
          const safeSearch = debouncedSearch.replace(/[(),]/g, '')
          if (!outState.searchCol || outState.searchCol === 'all') {
            q = q.or(`description.ilike.%${safeSearch}%,bank_description.ilike.%${safeSearch}%,bank_name.ilike.%${safeSearch}%,transaction_id.ilike.%${safeSearch}%,stage_code_1.ilike.%${safeSearch}%,transaction_type.ilike.%${safeSearch}%`)
          } else if (outState.searchCol === 'description') {
            q = q.or(`description.ilike.%${safeSearch}%,bank_description.ilike.%${safeSearch}%`)
          } else if (OUTFLOW_SEARCH_COLS.has(outState.searchCol)) {
            q = q.ilike(outState.searchCol, `%${debouncedSearch}%`)
          }
        }
        return q.range(from, to)
      })
      if (truncated) toast(`Export capped at ${EXPORT_MAX.toLocaleString()} records — use a full database export for larger datasets`, 'warning')
      const allRows = rows.map(r => ({
        ...r,
        display_description: normalizeNarration(r.description ?? r.bank_description),
      })) as OutflowTransaction[]
      exportCSV(OUT_CSV_FILE, OUT_CSV_HEADERS, allRows.map(outflowCsvRow))
    } catch (e: unknown) {
      toast(friendlyError(e, 'export'), 'error')
    }
  }

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load outflow transactions</p>
      <p className="text-sm text-gray-500">{error}</p>
      <button onClick={refetch} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  )

  return (
    <>
      <div className="space-y-5">

        {/* Header */}
        <div data-tour="page-header" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-gray-100">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Outflow Transactions</h1>
            <p className="text-sm text-gray-500 mt-0.5">All disbursements and payments</p>
          </div>
          <div className="flex items-center gap-2">
            <HelpButton tourId="outflowsTour" size="sm" />
            {canWrite() && (
              <button
                onClick={() => { setEditRecord(null); setModalOpen(true) }}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 transition-colors"
              >
                <PlusCircle className="w-4 h-4" />
                Add Outflow
              </button>
            )}
            <Link
              to="/import"
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
            >
              Import
            </Link>
            <ExportDropdown
              onExportView={handleExportView}
              onExportAll={handleExportAll}
              disabled={data.length === 0}
            />
          </div>
        </div>

        {!isSimple && (
        <PageHelpBanner storageKey="help-dismissed-outflows" title="Outflow Transactions">
          Disbursements and payments are imported from bank statements — bulk data should come through
          the <strong>Import</strong> page. Use <strong>Add Outflow</strong> for one-off manual entries only.
          Filter by date, fund, or bank and export the current view at any time.
        </PageHelpBanner>
        )}

        {/* Filter bar */}
        {!isSimple && (
        <Card data-tour="data-controls">
          <div className="space-y-3">
            <DatePresetBar
              activePreset={datePreset}
              onPreset={(preset, from, to) => { setDatePreset(preset); setDateFrom(from); setDateTo(to) }}
              onCustom={() => setDatePreset('custom')}
            />
            <div className="flex flex-wrap gap-3 items-end">
              <FilterGroup label="From">
                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setDatePreset('custom') }} className={filterInputCls} />
              </FilterGroup>
              <FilterGroup label="To">
                <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setDatePreset('custom') }} className={filterInputCls} />
              </FilterGroup>
              <FilterGroup label="Fund" className="min-w-[180px]">
                <SearchableSelect value={stageCode} onChange={setStageCode}
                  options={categories.map(c => ({ value: c.name, label: c.name }))}
                  placeholder="All funds" className={`${filterInputCls} bg-white`} />
              </FilterGroup>
              {outflowTypes.length > 0 && (
                <FilterGroup label="Outflow Type" className="min-w-[180px]">
                  <SearchableSelect value={outflowTypeFilter} onChange={setOutflowTypeFilter}
                    options={outflowTypes.map(t => ({ value: t.id, label: t.name }))}
                    placeholder="All types" className={`${filterInputCls} bg-white`} />
                </FilterGroup>
              )}
              {(dateFrom || dateTo || stageCode || outflowTypeFilter || datePreset) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); setDatePreset(null); setStageCode(''); setOutflowTypeFilter(''); setSearchInput(''); setShowUnmappedOnly(false); outState.setSort('recorded_at', 'desc'); outState.setAdvancedSort([]) }}
                  className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </Card>
        )}

        {/* Summary strip — full view only (Simple has its own hero total) */}
        {!isSimple && (
          <SummaryStrip total={total} effectiveTotal={effectiveTotal} hasOffsets={hasOffsets} count={count} largest={largest} average={average} loading={loading} />
        )}

        {/* ── Simple view: interactive summary + reveal ────────────────────── */}
        {isSimple && (
          <SimpleOutflowView
            rows={displayed}
            recentLoading={loading}
            dateFrom={dateFrom}
            dateTo={dateTo}
            datePreset={datePreset}
            unmappedCount={unmappedCount}
            outflowTypes={outflowTypes}
            baseCurrencyCode={baseCurrencyCode}
            onPreset={(preset, from, to) => { setDatePreset(preset); setDateFrom(from); setDateTo(to) }}
            onViewAll={() => setDetail('full')}
            onDrillMonth={(from, to) => { setDatePreset('custom'); setDateFrom(from); setDateTo(to); setDetail('full') }}
            onDrillUnmapped={() => { setShowUnmappedOnly(true); setDetail('full') }}
          />
        )}

        {/* ── Full view: dense controls + list ─────────────────────────────── */}
        {!isSimple && <>

        {/* Quiet collapse back to the summary view */}
        <button
          type="button"
          onClick={() => setDetail('simple')}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Show summary
        </button>

        {/* Data controls bar */}
        <DataControlsBar
          columns={OUT_COLUMNS}
          sortKey={outState.sortKey}
          sortDir={outState.sortDir}
          onSort={outState.setSort}
          defaultSortKey="recorded_at"
          defaultSortDir="desc"
          view={outState.view}
          onViewChange={outState.setView}
          search={searchInput}
          onSearchChange={v => { setSearchInput(v) }}
          searchPlaceholder="Search transactions…"
          searchCol={outState.searchCol}
          onSearchColChange={outState.setSearchCol}
          advancedSort={outState.advancedSort}
          onAdvancedSort={outState.setAdvancedSort}
          pageSize={outState.pageSize}
          onPageSizeChange={outState.setPageSize}
        />

        <UnmappedStrip
          count={unmappedCount}
          active={showUnmappedOnly}
          onToggle={() => setShowUnmappedOnly(v => !v)}
          loading={loading}
          label="missing fund or fund type"
        />

        {/* Compact pagination above content */}
        <PaginationBar
          page={page}
          pageSize={outState.pageSize}
          total={count}
          onPageChange={setPage}
          variant="compact"
        />

        {/* Bulk action bar — shown in both card and table views */}
        {(() => {
          const selectedRows  = displayed.filter(r => selectedIds.has(r.id))
          const selHasOffsets = selectedRows.some(r => r.offset_role === 'offset')
          const selEffective  = selectedRows.reduce((s, r) =>
            r.offset_role === 'offset' ? s - Number(r.amount_disbursed) : s + Number(r.amount_disbursed), 0)
          const selTotal = selectedRows.reduce((s, r) => s + Number(r.amount_disbursed), 0)
          return (
            <BulkActionBar
              count={selectedIds.size}
              onClear={clearAll}
              actions={[
                { key: 'edit',   label: 'Edit selected',   variant: 'outline', onClick: () => setBulkEditOpen(true),      show: canWrite() },
                { key: 'delete', label: 'Delete selected', variant: 'danger',  onClick: () => setConfirmBulkDelete(true), show: canDelete(), icon: <Trash2 className="w-3.5 h-3.5" /> },
              ]}
              summary={selHasOffsets ? (
                <span className="text-xs text-gray-500 font-mono">
                  Total: <span className="font-semibold text-danger">{formatCurrency(selTotal, baseCurrencyCode)}</span>
                  {' · '}Effective: <span className="font-semibold text-amber-600">{formatCurrency(selEffective, baseCurrencyCode)}</span>
                </span>
              ) : undefined}
            />
          )
        })()}

        {/* Cards / Table */}
        {outState.view === 'cards' ? (
          <div className="space-y-3">
            {/* Select-all row */}
            {!loading && displayed.length > 0 && (
              <div className="flex items-center gap-2 px-1">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-gray-300"
                  checked={allSelected}
                  onChange={e => e.target.checked ? selectAllRows() : clearAll()}
                />
                <span className="text-xs text-gray-500">Select all on page</span>
              </div>
            )}
            {loading && displayed.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-gray-200 overflow-hidden shadow-sm animate-pulse">
                  <div className="px-4 pt-3.5 pb-3 space-y-2">
                    <div className="h-3 bg-gray-200 rounded w-1/4" />
                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                  </div>
                  <div className="border-t border-gray-100 bg-gray-50/40 px-4 py-3 grid grid-cols-2 gap-4">
                    <div className="h-8 bg-gray-200 rounded" /><div className="h-8 bg-gray-200 rounded" />
                  </div>
                </div>
              ))
            ) : data.length === 0 ? (
              searchInput
                ? <EmptyState icon={TrendingDown} title="No outflow transactions" message="No transactions match your filters." compact />
                : <PageEmptyState pageId="outflows" compact />
            ) : displayed.map(row => {
              const net = Number(row.amount_disbursed) - Number(row.amount_refunded) - Number(row.transfer_charge)
              const netDiffers = net !== Number(row.amount_disbursed)
              const isSelected = selectedIds.has(row.id)
              return (
                <div key={row.id} className={`rounded-xl border overflow-hidden shadow-sm bg-white transition-colors ${isSelected ? 'border-primary/40 bg-primary/5' : 'border-gray-200'}`}>
                  {/* Card header */}
                  <div className="px-4 pt-3.5 pb-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded border-gray-300 shrink-0"
                          checked={isSelected}
                          onChange={() => toggleRow(row.id)}
                        />
                        <p className="text-xs font-semibold text-gray-400">{formatDate(row.date)}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                        {row.is_pending_deduction && (
                          <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700">Pending</span>
                        )}
                        {row.transaction_type && TXN_TYPE_LABELS[row.transaction_type] && (
                          <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-500 whitespace-nowrap">
                            {TXN_TYPE_LABELS[row.transaction_type]}
                          </span>
                        )}
                        {row.offset_role === 'root' && (
                          <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700">Root</span>
                        )}
                        {row.offset_role === 'offset' && (
                          <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-700">Offset</span>
                        )}
                        {isOutflowUnmapped(row) && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap bg-amber-100 text-amber-700">
                            Unmapped
                          </span>
                        )}
                      </div>
                    </div>
                    {row.bank_name && <p className="text-xs text-gray-500 mb-1.5">{row.bank_name}</p>}
                    <div className="text-sm">
                      <DescriptionCell id={`card-${row.id}`} text={row.display_description || row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-800" />
                    </div>
                    {row.bank_description && row.bank_description !== row.description && (
                      <div className="text-xs mt-1">
                        <DescriptionCell id={`card-raw-${row.id}`} text={row.bank_description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-400" />
                      </div>
                    )}
                    {row.stage_code_1 && <p className="text-xs text-gray-500 mt-1">{row.stage_code_1}</p>}
                    {row.outflow_type_name && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-violet-50 text-violet-600">{row.outflow_type_name}</span>
                    )}
                  </div>
                  {/* Metrics footer */}
                  <div className={`border-t border-gray-100 bg-gray-50/40 px-4 py-3 ${netDiffers ? 'grid grid-cols-3' : 'grid grid-cols-2'}`}>
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wide font-semibold mb-0.5 text-red-600/70">Disbursed</p>
                      <p className="text-sm font-mono font-bold tabular-nums text-danger">{formatCurrency(Number(row.amount_disbursed), baseCurrencyCode)}</p>
                    </div>
                    {netDiffers && (
                      <div className="border-l border-gray-200/80 pl-4 min-w-0">
                        <p className="text-xs uppercase tracking-wide font-semibold mb-0.5 text-gray-400">Net</p>
                        <p className="text-sm font-mono font-bold tabular-nums text-gray-700">{formatCurrency(net, baseCurrencyCode)}</p>
                      </div>
                    )}
                    <div className="border-l border-gray-200/80 pl-4 min-w-0 flex items-center justify-end gap-0.5">
                      {canWrite() && (
                        <button onClick={() => openEdit(row)} className="touch-target p-1.5 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit" aria-label="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete() && (
                        <button onClick={() => setDeleteId(row.id)} className="touch-target p-1.5 rounded text-gray-400 hover:text-danger hover:bg-red-50 transition-colors" title="Delete" aria-label="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
        {outState.view === 'cards' && (
          <PaginationBar
            page={page}
            pageSize={outState.pageSize}
            total={count}
            onPageChange={setPage}
            variant="full"
          />
        )}

        {outState.view === 'table' && <Card padding={false} data-tour="data-table">
          <div className="overflow-x-auto scroll-x-fade">
            <table className="min-w-full">
              <thead>
                <tr className="border-b-2 border-black/[0.06] dark:border-white/[0.07]">
                  <th className="w-10 pl-4 pr-2 py-3">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-gray-300"
                      checked={allSelected}
                      onChange={e => e.target.checked ? selectAllRows() : clearAll()}
                    />
                  </th>
                  <th className="w-8 px-1 py-3" />
                  <SortableHeader field={outSF('date')} activeSortKey={outState.sortKey} activeSortDir={outState.sortDir} onSort={outState.setSort} className="px-4 py-3" />
                  <SortableHeader field={outSF('recorded_at')} activeSortKey={outState.sortKey} activeSortDir={outState.sortDir} onSort={outState.setSort} className="px-4 py-3" />
                  <SortableHeader field={outSF('bank_name')} activeSortKey={outState.sortKey} activeSortDir={outState.sortDir} onSort={outState.setSort} className="px-4 py-3" />
                  <th className="px-4 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-left whitespace-nowrap">Description</th>
                  <SortableHeader field={outSF('outflow_type')} activeSortKey={outState.sortKey} activeSortDir={outState.sortDir} onSort={outState.setSort} className="px-4 py-3" />
                  <SortableHeader field={outSF('amount_disbursed')} activeSortKey={outState.sortKey} activeSortDir={outState.sortDir} onSort={outState.setSort} rightAlign className="px-4 py-3" inactiveCls="text-danger/80 hover:text-danger" />
                  <th className="px-4 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-left whitespace-nowrap">📎</th>
                  <th className="px-4 py-3 text-[11px] font-bold text-gray-400 uppercase tracking-widest text-left whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {loading && displayed.length === 0 ? (
                  Array.from({ length: 9 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 10 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-200 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={10}>
                      {searchInput
                        ? <EmptyState icon={TrendingDown} title="No outflow transactions" message="No transactions match your filters." compact />
                        : <PageEmptyState pageId="outflows" compact />
                      }
                    </td>
                  </tr>
                ) : (
                  displayed.map(row => {
                    const isExpanded = expandedId === row.id
                    return (
                      <>
                        <tr
                          key={row.id}
                          className={`hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors${selectedIds.has(row.id) ? ' bg-primary/5 hover:bg-primary/10' : ''}`}
                        >
                          <td className="pl-4 pr-2 py-3 w-10">
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-gray-300"
                              checked={selectedIds.has(row.id)}
                              onChange={() => toggleRow(row.id)}
                            />
                          </td>
                          <td className="w-8 px-1 py-3">
                            <button
                              onClick={() => toggleExpand(row.id)}
                              className="touch-target p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                              title={isExpanded ? 'Collapse' : 'Expand details'}
                            >
                              {isExpanded
                                ? <ChevronDown className="w-3.5 h-3.5" />
                                : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                          <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                            {row.recorded_at ? formatDate(row.recorded_at.slice(0, 10)) : '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{row.bank_name ?? '—'}</td>
                          <td className="px-4 py-3 text-sm text-gray-800 max-w-[280px]">
                            <DescriptionCell id={row.id} text={row.display_description || row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
                          </td>
                          <td className="px-4 py-3 text-sm whitespace-nowrap">
                            <div className="flex flex-col gap-0.5 items-start">
                              {row.outflow_type_name && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-violet-50 text-violet-700">{row.outflow_type_name}</span>
                              )}
                              {row.transaction_type && TXN_TYPE_LABELS[row.transaction_type] ? (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold bg-slate-100 text-slate-500">
                                  {row.offset_role === 'root' && (
                                    <span className="px-1 rounded text-[9px] font-bold bg-green-100 text-green-700">R</span>
                                  )}
                                  {row.offset_role === 'offset' && (
                                    <span className="px-1 rounded text-[9px] font-bold bg-amber-100 text-amber-700">O</span>
                                  )}
                                  {TXN_TYPE_LABELS[row.transaction_type]}
                                </span>
                              ) : null}
                              {isOutflowUnmapped(row) && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap bg-amber-100 text-amber-700">
                                  Unmapped
                                </span>
                              )}
                              {!row.outflow_type_name && !row.transaction_type && !isOutflowUnmapped(row) && (
                                <span className="text-gray-300">—</span>
                              )}
                            </div>
                          </td>
                          <AmountCell value={Number(row.amount_disbursed)} mode="outflow" />
                          <td className="px-2 py-3">
                            <ReceiptBadge entityType="outflow" entityId={row.id} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {canWrite() && (
                                <button onClick={() => openEdit(row)} className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit" aria-label="Edit">
                                  <Pencil className="w-4 h-4" />
                                </button>
                              )}
                              {canDelete() && (
                                <button onClick={() => setDeleteId(row.id)} className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors" title="Delete" aria-label="Delete">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {isExpanded && <OutflowRowDetail key={`detail-${row.id}`} row={row} colSpan={10} />}
                      </>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          <PaginationBar
            page={page}
            pageSize={outState.pageSize}
            total={count}
            onPageChange={setPage}
            variant="full"
          />
        </Card>}

        </>}
      </div>

      <AddOutflowModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={handleModalSuccess}
        editRecord={editRecord}
      />
      <DeleteDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        loading={deleting}
        label="this outflow transaction"
        detail={(() => {
          const row = displayed.find(r => r.id === deleteId)
          if (!row) return null
          return (
            <div className="space-y-0.5">
              <p className="font-mono font-semibold">{formatCurrency(Number(row.amount_disbursed), baseCurrencyCode)}</p>
              <p className="text-xs text-gray-500">{formatDate(row.date)}{row.bank_name ? ` · ${row.bank_name}` : ''}</p>
              {row.display_description && <p className="text-xs text-gray-500 line-clamp-2">{row.display_description}</p>}
            </div>
          )
        })()}
      />
      <DeleteDialog
        open={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={handleBulkDelete}
        loading={bulkDeleting}
        label={`these ${selectedIds.size} outflow transaction${selectedIds.size !== 1 ? 's' : ''}`}
      />
      <BulkEditOutflowModal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        ids={[...selectedIds]}
        banks={banks}
        onSuccess={() => { clearAll(); refetch() }}
        onResults={setBulkResults}
      />
      <BulkResultsModal results={bulkResults} onClose={() => setBulkResults(null)} />
      {canWrite() && <MobileFab icon={PlusCircle} label="Add Outflow" onClick={() => { setEditRecord(null); setModalOpen(true) }} />}
      <DescriptionTooltip tooltip={descTooltip} />
    </>
  )
}

// ── Simple view ──────────────────────────────────────────────────────────────
// Lean by default: hero total + quick ranges + recent activity + reveal, with a
// "More insights" peel (trend, monthly chart, outflow-type breakdown, nudge).

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7))
  return MONTH_ABBR[m - 1] ?? ym
}
function monthRange(ym: string): { from: string; to: string } {
  const y = Number(ym.slice(0, 4)); const m = Number(ym.slice(5, 7))
  const last = new Date(y, m, 0).getDate()
  const pad = (n: number) => String(n).padStart(2, '0')
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` }
}
function periodLabel(preset: DatePreset | null): string {
  switch (preset) {
    case 'this_month': return 'this month'
    case 'last_month': return 'last month'
    case 'custom':     return 'selected dates'
    default:           return 'this year'
  }
}
const UNCLASSIFIED_COLOR = '#94a3b8'

interface SimpleOutflowViewProps {
  rows: OutflowTransaction[]
  recentLoading: boolean
  dateFrom: string
  dateTo: string
  datePreset: DatePreset | null
  unmappedCount: number
  outflowTypes: OutflowType[]
  baseCurrencyCode: string
  onPreset: (preset: DatePreset, from: string, to: string) => void
  onViewAll: () => void
  onDrillMonth: (from: string, to: string) => void
  onDrillUnmapped: () => void
}

function SimpleOutflowView({
  rows, recentLoading, dateFrom, dateTo, datePreset, unmappedCount, outflowTypes,
  baseCurrencyCode, onPreset, onViewAll, onDrillMonth, onDrillUnmapped,
}: SimpleOutflowViewProps) {
  const summary       = useOutflowSummary(dateFrom, dateTo)
  const animatedTotal = useCountUp(summary.total)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const delta = summary.prevTotal && summary.prevTotal > 0
    ? ((summary.total - summary.prevTotal) / summary.prevTotal) * 100
    : null

  const typeMeta = (id: string | null): { name: string; color: string } => {
    if (!id) return { name: 'Unclassified', color: UNCLASSIFIED_COLOR }
    const t = outflowTypes.find(x => x.id === id)
    return { name: t?.name ?? 'Unknown', color: t?.color ?? UNCLASSIFIED_COLOR }
  }

  const topTypes  = summary.byType.slice(0, 5)
  const chartData = summary.monthly.map(p => ({ ...p, label: monthLabel(p.month) }))
  const recent    = rows.slice(0, 8)

  const hero = (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-xs font-medium text-gray-500">Total outflows {periodLabel(datePreset)}</p>
      <p className="text-3xl font-extrabold tabular-nums text-gray-900 mt-1">
        {formatCurrency(animatedTotal, baseCurrencyCode)}
      </p>
      <p className="text-xs text-gray-400 mt-1">
        {summary.count.toLocaleString()} transaction{summary.count !== 1 ? 's' : ''}
      </p>
    </div>
  )

  const insightsPanel = (
    <div className="space-y-4">
      {/* Trend vs previous period */}
      {delta !== null && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 flex items-center gap-2">
          <span className={`inline-flex items-center gap-0.5 text-lg font-bold ${delta >= 0 ? 'text-danger' : 'text-success'}`}>
            {delta >= 0 ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
            {Math.abs(delta).toFixed(0)}%
          </span>
          <span className="text-sm text-gray-500">vs the previous {periodLabel(datePreset).replace('this ', '').replace('last ', '')}</span>
        </div>
      )}

      {/* Monthly trend — tap a bar to drill */}
      {!summary.loading && chartData.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-500">Monthly outflows</p>
            <p className="text-[11px] text-gray-400">Tap a month to open it</p>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <RTooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                formatter={(v: number) => [formatCurrency(v, baseCurrencyCode), 'Outflow']}
                labelFormatter={() => ''}
              />
              <Bar dataKey="amount" radius={[4, 4, 0, 0]} cursor="pointer"
                onClick={(d: { month?: string; payload?: { month?: string } }) => {
                  const ym = d?.month ?? d?.payload?.month
                  if (ym) { const r = monthRange(ym); onDrillMonth(r.from, r.to) }
                }}>
                {chartData.map(d => <Cell key={d.month} fill="#DC2626" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Outflow-type breakdown — tap to drill */}
      {!summary.loading && topTypes.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-500 mb-3">Top outflow types</p>
          <div className="flex flex-wrap gap-2">
            {topTypes.map(slice => {
              const { name, color } = typeMeta(slice.outflowTypeId)
              const pct = summary.total > 0 ? (slice.amount / summary.total) * 100 : 0
              return (
                <button
                  key={slice.outflowTypeId ?? 'none'}
                  type="button"
                  onClick={onViewAll}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-200 pl-2 pr-3 py-1.5 hover:bg-gray-50 transition-colors"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="text-xs font-medium text-gray-700">{name}</span>
                  <span className="text-xs font-semibold text-gray-400 tabular-nums">{pct.toFixed(0)}%</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Attention nudge */}
      {unmappedCount > 0 && (
        <button
          type="button"
          onClick={onDrillUnmapped}
          className="w-full flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 hover:bg-amber-100 transition-colors text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <p className="text-sm text-amber-800">
              <span className="font-semibold">{unmappedCount.toLocaleString()}</span> transaction{unmappedCount !== 1 ? 's' : ''} not yet assigned a fund or fund type
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-amber-600 shrink-0" />
        </button>
      )}
    </div>
  )

  const recentList = (
    <div>
      {recentLoading && recent.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl border border-gray-100 bg-white animate-pulse" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <PageEmptyState pageId="outflows" compact />
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
          {recent.map(row => {
            const expanded = expandedId === row.id
            return (
              <div key={row.id}>
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : row.id)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <ChevronDown className={`w-4 h-4 text-gray-300 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800 truncate">{row.display_description || row.description || '—'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {formatDate(row.date)}{row.bank_name ? ` · ${row.bank_name}` : ''}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-mono font-bold tabular-nums text-danger shrink-0">
                    {formatCurrency(Number(row.amount_disbursed), baseCurrencyCode)}
                  </p>
                </button>
                {expanded && (
                  <div className="px-4 pb-3 pt-0 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 pl-10">
                    {row.outflow_type_name && <span>Type: <span className="font-medium text-gray-600">{row.outflow_type_name}</span></span>}
                    {row.stage_code_1 && <span>Fund: <span className="font-medium text-gray-600">{row.stage_code_1}</span></span>}
                    {row.transaction_id && <span>Txn ID: <span className="font-medium text-gray-600">{row.transaction_id}</span></span>}
                    {row.remarks && <span className="w-full text-gray-400">{row.remarks}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  return (
    <SimpleShell
      pageId="outflows"
      hero={hero}
      filters={
        <DatePresetBar
          activePreset={datePreset}
          onPreset={onPreset}
          onCustom={() => { /* custom handled in full view */ }}
          hideCustom
        />
      }
      bodyTitle="Recent outflows"
      insights={insightsPanel}
      body={recentList}
      onViewAll={onViewAll}
    />
  )
}

// ── Local helpers ──────────────────────────────────────────────────────────────


function FilterGroup({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-xs font-medium text-gray-500">{label}</label>
      {children}
    </div>
  )
}

