import { useState, useEffect } from 'react'
import {
  TrendingDown, Pencil, Trash2,
  AlertCircle, RefreshCw, ChevronRight, ChevronDown,
} from 'lucide-react'
import { Card }                    from '../components/ui/Card'
import { DeleteDialog }            from '../components/ui/DeleteDialog'
import { BulkActionBar }           from '../components/ui/BulkActionBar'
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
import { supabase }                from '../lib/supabase'
import { normalizeNarration }      from '../utils/normalizeNarration'
import { ExportDropdown }          from '../components/ui/ExportDropdown'
import { useCategories }           from '../hooks/useCategories'
import { useOutflowTypes }         from '../hooks/useOutflowTypes'
import { useYearRange }            from '../hooks/useYearRange'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { EmptyState } from '../components/ui/EmptyState'
import { AmountCell } from '../components/ui/AmountCell'
import { filterInputCls } from '../components/ui/FormField'
import { OutflowRowDetail } from '../components/ui/OutflowRowDetail'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { SearchableSelect } from '../components/ui/SearchableSelect'

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
  { key: 'stage_code_1',     label: 'Stage Code',                         accessor: r => r.stage_code_1 ?? '' },
  { key: 'net',              label: 'Net',                                accessor: r => String(Number(r.amount_disbursed) - Number(r.amount_refunded) - Number(r.transfer_charge)) },
]

const OUT_SORT_FIELDS = deriveSortFields(OUT_COLUMNS)
const outSF = (key: string) => OUT_SORT_FIELDS.find(f => f.key === key)!

const OUTFLOW_SORT_COLS = new Set(['date', 'amount_disbursed', 'bank_name', 'description', 'transaction_type', 'recorded_at'])
const OUTFLOW_SEARCH_COLS = new Set(['description', 'bank_description', 'bank_name', 'transaction_id', 'stage_code_1', 'transaction_type', 'outflow_type'])

// ── Summary strip ──────────────────────────────────────────────────────────────

function SummaryStrip({ total, count, largest, average, loading }: {
  total: number; count: number; largest: number; average: number; loading: boolean
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
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Outflows() {
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()
  const { year, dateFrom: yearStart, dateTo: yearEnd } = useYearRange()

  // Filters
  const [dateFrom,          setDateFrom]          = useState(yearStart)
  const [dateTo,            setDateTo]            = useState(yearEnd)
  const [stageCode,         setStageCode]         = useState('')
  const [outflowTypeFilter, setOutflowTypeFilter] = useState('')
  const [searchInput,       setSearchInput]       = useState('')
  const [debouncedSearch,   setDebouncedSearch]   = useState('')
  const [page,              setPage]              = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  // Data controls state
  const outState = useDataViewState({ storageKey: 'out', defaultSortKey: 'recorded_at', defaultSortDir: 'desc', defaultPageSize: DEFAULT_PAGE_SIZE, persistSort: false })

  const { data, count, loading, error, refetch } = useOutflowTransactions({
    dateFrom:     dateFrom  || undefined,
    dateTo:       dateTo    || undefined,
    stageCode:    stageCode || undefined,
    search:       debouncedSearch || undefined,
    searchCol:    outState.searchCol,
    page,
    pageSize:     outState.pageSize,
    sortColumn:   outState.advancedSort.length === 0 ? outState.sortKey : undefined,
    sortAscending: outState.advancedSort.length === 0 ? (outState.sortDir === 'asc') : undefined,
    advancedSort: outState.advancedSort.length > 0 ? outState.advancedSort : undefined,
  })

  // Client-side outflow type filter (server doesn't filter by outflow_type_id yet)
  const displayed = outflowTypeFilter
    ? data.filter(r => r.outflow_type_id === outflowTypeFilter)
    : data

  // Summary (current page, disbursed amounts)
  const total   = displayed.reduce((s, r) => s + Number(r.amount_disbursed), 0)
  const largest = displayed.length ? Math.max(...displayed.map(r => Number(r.amount_disbursed))) : 0
  const average = displayed.length ? total / displayed.length : 0

  // UI state
  const [editRecord,        setEditRecord]        = useState<OutflowTransaction | null>(null)
  const [modalOpen,         setModalOpen]         = useState(false)
  const [deleteId,          setDeleteId]          = useState<string | null>(null)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
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

  // Clear selection when filters/page/sort change
  useEffect(() => { setPage(0); clearAll() }, [dateFrom, dateTo, stageCode, outflowTypeFilter, debouncedSearch]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setDateFrom(`${year}-01-01`); setDateTo(`${year}-12-31`); setPage(0); clearAll() }, [year]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { clearAll() }, [page]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(0); clearAll() }, [outState.sortKey, outState.sortDir, outState.searchCol, outState.advancedSort, outState.pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (r: OutflowTransaction) => { setEditRecord(r); setModalOpen(true) }

  const handleModalSuccess = () => {
    toast('Transaction updated', 'success')
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
      toast(e instanceof Error ? e.message : 'Delete failed', 'error')
    }
  }

  const handleBulkDelete = async () => {
    const ids = [...selectedIds]
    const { failed } = await executeBulkDelete(ids)
    setConfirmBulkDelete(false)
    clearAll()
    refetch()
    if (failed === 0) toast(`${ids.length} transaction${ids.length !== 1 ? 's' : ''} deleted`, 'success')
    else toast(`${ids.length - failed} deleted, ${failed} failed`, 'error')
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
    let query = supabase.from('outflow_transactions').select('*').limit(10000)
    const adv = outState.advancedSort
    if (adv.length > 0) {
      for (const l of adv) {
        if (OUTFLOW_SORT_COLS.has(l.key)) query = query.order(l.key, { ascending: l.dir === 'asc' })
      }
    } else if (OUTFLOW_SORT_COLS.has(outState.sortKey)) {
      query = query.order(outState.sortKey, { ascending: outState.sortDir === 'asc' })
      if (outState.sortKey !== 'recorded_at') query = query.order('recorded_at', { ascending: false })
    } else {
      query = query.order('recorded_at', { ascending: false }).order('date', { ascending: false })
    }
    if (dateFrom)  query = query.gte('date', dateFrom)
    if (dateTo)    query = query.lte('date', dateTo)
    if (stageCode) query = query.eq('stage_code_1', stageCode)
    if (debouncedSearch) {
      const safeSearch = debouncedSearch.replace(/[(),]/g, '')
      if (!outState.searchCol || outState.searchCol === 'all') {
        query = query.or(`description.ilike.%${safeSearch}%,bank_description.ilike.%${safeSearch}%,bank_name.ilike.%${safeSearch}%,transaction_id.ilike.%${safeSearch}%,stage_code_1.ilike.%${safeSearch}%,transaction_type.ilike.%${safeSearch}%`)
      } else if (outState.searchCol === 'description') {
        query = query.or(`description.ilike.%${safeSearch}%,bank_description.ilike.%${safeSearch}%`)
      } else if (OUTFLOW_SEARCH_COLS.has(outState.searchCol)) {
        query = query.ilike(outState.searchCol, `%${debouncedSearch}%`)
      }
    }
    const { data: rows } = await query
    if (!rows) return
    const allRows = (rows as Omit<OutflowTransaction, 'display_description'>[]).map(r => ({
      ...r,
      display_description: normalizeNarration(r.description ?? r.bank_description),
    })) as OutflowTransaction[]
    exportCSV(OUT_CSV_FILE, OUT_CSV_HEADERS, allRows.map(outflowCsvRow))
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
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Outflow Transactions</h1>
            <p className="text-sm text-gray-500 mt-0.5">All disbursements and payments</p>
          </div>
          <div className="flex items-center gap-2">
            <ExportDropdown
              onExportView={handleExportView}
              onExportAll={handleExportAll}
              disabled={data.length === 0}
            />
          </div>
        </div>

        {/* Filter bar */}
        <Card>
          <div className="flex flex-wrap gap-3 items-end">
            <FilterGroup label="From">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={filterInputCls} />
            </FilterGroup>
            <FilterGroup label="To">
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={filterInputCls} />
            </FilterGroup>
            <FilterGroup label="Stage Code 1" className="min-w-[180px]">
              <SearchableSelect value={stageCode} onChange={setStageCode}
                options={categories.map(c => ({ value: c.name, label: c.name }))}
                placeholder="All categories" className={`${filterInputCls} bg-white`} />
            </FilterGroup>
            {outflowTypes.length > 0 && (
              <FilterGroup label="Outflow Type" className="min-w-[180px]">
                <SearchableSelect value={outflowTypeFilter} onChange={setOutflowTypeFilter}
                  options={outflowTypes.map(t => ({ value: t.id, label: t.name }))}
                  placeholder="All types" className={`${filterInputCls} bg-white`} />
              </FilterGroup>
            )}
            {(dateFrom || dateTo || stageCode || outflowTypeFilter) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setStageCode(''); setOutflowTypeFilter(''); setSearchInput(''); outState.setSort('recorded_at', 'desc'); outState.setAdvancedSort([]) }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </Card>

        {/* Summary strip */}
        <SummaryStrip total={total} count={count} largest={largest} average={average} loading={loading} />

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

        {/* Compact pagination above content */}
        <PaginationBar
          page={page}
          pageSize={outState.pageSize}
          total={count}
          onPageChange={setPage}
          variant="compact"
        />

        {/* Cards / Table */}
        {outState.view === 'cards' ? (
          <div className="space-y-3">
            {loading ? (
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
              <EmptyState icon={TrendingDown} title="No outflow transactions" message="No transactions match your filters." compact />
            ) : displayed.map(row => {
              const net = Number(row.amount_disbursed) - Number(row.amount_refunded) - Number(row.transfer_charge)
              const netDiffers = net !== Number(row.amount_disbursed)
              return (
                <div key={row.id} className="rounded-xl border overflow-hidden shadow-sm bg-white border-gray-200">
                  {/* Card header */}
                  <div className="px-4 pt-3.5 pb-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-[11px] font-semibold text-gray-400">{formatDate(row.date)}</p>
                      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                        {row.is_pending_deduction && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">Pending</span>
                        )}
                        {row.transaction_type && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 whitespace-nowrap">
                            {TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type}
                          </span>
                        )}
                      </div>
                    </div>
                    {row.bank_name && <p className="text-[11px] text-gray-400 mb-1.5">{row.bank_name}</p>}
                    <div className="text-sm">
                      <DescriptionCell id={`card-${row.id}`} text={row.display_description || row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-800" />
                    </div>
                    {row.bank_description && row.bank_description !== row.description && (
                      <div className="text-xs mt-1">
                        <DescriptionCell id={`card-raw-${row.id}`} text={row.bank_description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-400" />
                      </div>
                    )}
                    {row.stage_code_1 && <p className="text-[11px] text-gray-400 mt-1">{row.stage_code_1}</p>}
                    {row.outflow_type_name && (
                      <span className="inline-block mt-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-50 text-violet-600">{row.outflow_type_name}</span>
                    )}
                  </div>
                  {/* Metrics footer */}
                  <div className={`border-t border-gray-100 bg-gray-50/40 px-4 py-3 ${netDiffers ? 'grid grid-cols-3' : 'grid grid-cols-2'}`}>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide font-semibold mb-0.5 text-red-600/70">Disbursed</p>
                      <p className="text-sm font-mono font-bold tabular-nums text-danger">{formatCurrency(Number(row.amount_disbursed), baseCurrencyCode)}</p>
                    </div>
                    {netDiffers && (
                      <div className="border-l border-gray-200/80 pl-4 min-w-0">
                        <p className="text-[10px] uppercase tracking-wide font-semibold mb-0.5 text-gray-400">Net</p>
                        <p className="text-sm font-mono font-bold tabular-nums text-gray-700">{formatCurrency(net, baseCurrencyCode)}</p>
                      </div>
                    )}
                    <div className="border-l border-gray-200/80 pl-4 min-w-0 flex items-center justify-end gap-0.5">
                      {canWrite() && (
                        <button onClick={() => openEdit(row)} className="p-1.5 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete() && (
                        <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded text-gray-400 hover:text-danger hover:bg-red-50 transition-colors" title="Delete">
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

        {outState.view === 'table' && <Card padding={false}>
          <BulkActionBar
            count={selectedIds.size}
            onClear={clearAll}
            actions={[
              { key: 'edit',   label: 'Edit selected',   variant: 'outline', onClick: () => setBulkEditOpen(true),      show: canWrite() },
              { key: 'delete', label: 'Delete selected', variant: 'danger',  onClick: () => setConfirmBulkDelete(true), show: canDelete(), icon: <Trash2 className="w-3.5 h-3.5" /> },
            ]}
          />
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="w-10 pl-4 pr-2 py-3">
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-gray-300"
                      checked={allSelected}
                      onChange={e => e.target.checked ? selectAllRows() : clearAll()}
                    />
                  </th>
                  <th className="w-8 px-1 py-3" />
                  <SortableHeader field={outSF('date')} activeSortKey={outState.sortKey} activeSortDir={outState.sortDir} onSort={outState.setSort} className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" />
                  <SortableHeader field={outSF('recorded_at')} activeSortKey={outState.sortKey} activeSortDir={outState.sortDir} onSort={outState.setSort} className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" />
                  <SortableHeader field={outSF('bank_name')} activeSortKey={outState.sortKey} activeSortDir={outState.sortDir} onSort={outState.setSort} className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" />
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Description</th>
                  <SortableHeader field={outSF('outflow_type')} activeSortKey={outState.sortKey} activeSortDir={outState.sortDir} onSort={outState.setSort} className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" />
                  <SortableHeader field={outSF('amount_disbursed')} activeSortKey={outState.sortKey} activeSortDir={outState.sortDir} onSort={outState.setSort} rightAlign className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" inactiveCls="text-danger/80 hover:text-danger" />
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">📎</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
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
                      <EmptyState icon={TrendingDown} title="No outflow transactions" message="No transactions match your filters." compact />
                    </td>
                  </tr>
                ) : (
                  displayed.map(row => {
                    const isExpanded = expandedId === row.id
                    return (
                      <>
                        <tr
                          key={row.id}
                          className={`hover:bg-gray-50 transition-colors${selectedIds.has(row.id) ? ' bg-primary/5 hover:bg-primary/10' : ''}`}
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
                              className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
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
                            {row.outflow_type_name
                              ? <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-violet-50 text-violet-700">{row.outflow_type_name}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <AmountCell value={Number(row.amount_disbursed)} mode="outflow" />
                          <td className="px-2 py-3">
                            <ReceiptBadge entityType="outflow" entityId={row.id} />
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {canWrite() && (
                                <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                                  <Pencil className="w-4 h-4" />
                                </button>
                              )}
                              {canDelete() && (
                                <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors" title="Delete">
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
      />
      <DescriptionTooltip tooltip={descTooltip} />
    </>
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

