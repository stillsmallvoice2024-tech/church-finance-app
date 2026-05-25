import { useState, useEffect, useMemo } from 'react'
import {
  TrendingUp, Pencil, Trash2,
  ChevronDown, ChevronRight, AlertCircle, RefreshCw,
} from 'lucide-react'
import { Card }                    from '../components/ui/Card'
import { Modal }                   from '../components/ui/Modal'
import { DeleteDialog }            from '../components/ui/DeleteDialog'
import { AddInflowModal }          from '../components/modals/AddInflowModal'
import { DataControlsBar }         from '../components/ui/DataControlsBar'
import { SortableHeader }          from '../components/ui/SortableHeader'
import { PaginationBar }           from '../components/ui/PaginationBar'
import { useDataViewState }        from '../hooks/useDataViewState'
import { sortRows, multiSortRows } from '../utils/sortUtils'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields, searchRows } from '../utils/tableColumns'
import { useInflowTransactions, type InflowTransaction } from '../hooks/useTransactions'
import { useDeleteTransaction, useUpdateTransaction } from '../hooks/useMutations'
import { useBanks }                from '../hooks/useBanks'
import { useToastStore }           from '../store/toastStore'
import { useRole }                 from '../hooks/useRole'
import { usePageTitle }            from '../hooks/usePageTitle'
import { formatDate, formatCurrency, formatCurrencyCompact } from '../utils/formatters'
import { exportCSV }               from '../utils/csvExport'
import { supabase }                from '../lib/supabase'
import { ExportDropdown }          from '../components/ui/ExportDropdown'
import { useYearRange }            from '../hooks/useYearRange'
import { useIncomeTypes }          from '../hooks/useIncomeTypes'
import { useCategories }           from '../hooks/useCategories'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { EmptyState } from '../components/ui/EmptyState'
import { AmountCell } from '../components/ui/AmountCell'
import { filterInputCls } from '../components/ui/FormField'
import { RowDetailPanel } from '../components/ui/RowDetailPanel'
import { inflowDetailItems } from '../utils/rowDetailItems'

const DEFAULT_PAGE_SIZE = 25

const TXN_TYPE_LABELS: Record<string, string> = {
  refund:                   'Refund',
  reversal:                 'Reversal',
  bank_deposit:             'Bank Deposit',
  intrabank_transfer:       'Intrabank Transfer',
  balance_brought_forward:  'Balance Brought Forward',
}

const BALANCE_BROUGHT_FORWARD_TYPE = 'balance_brought_forward'

const INF_COLUMNS: TableColumnDef<InflowTransaction>[] = [
  { key: 'date',             label: 'Date',        sortType: 'date',    primary: true, noSearch: true },
  { key: 'amount',           label: 'Amount',      sortType: 'numeric', primary: true, accessor: r => String(r.amount) },
  { key: 'bank_name',        label: 'Bank',        sortType: 'text',    accessor: r => r.bank_name ?? '' },
  { key: 'transaction_ref',  label: 'Txn Ref',                          accessor: r => r.transaction_ref ?? '' },
  { key: 'transaction_type', label: 'Type',        sortType: 'text',    accessor: r => TXN_TYPE_LABELS[r.transaction_type ?? ''] ?? r.transaction_type ?? '' },
  { key: 'description',      label: 'Description', sortType: 'text',    accessor: r => r.description ?? '' },
]

const INF_SORT_FIELDS = deriveSortFields(INF_COLUMNS)

// ── Summary strip ──────────────────────────────────────────────────────────────

function SummaryStrip({ total, count, largest, average, loading }: {
  total: number; count: number; largest: number; average: number; loading: boolean
}) {
  const items = [
    { label: 'Total (page)', value: formatCurrencyCompact(total) },
    { label: 'Records',      value: count.toLocaleString() },
    { label: 'Largest',      value: formatCurrencyCompact(largest) },
    { label: 'Average',      value: formatCurrencyCompact(average) },
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

export default function Inflows() {
  const { year, dateFrom: yearStart, dateTo: yearEnd } = useYearRange()

  // Filters
  const [dateFrom,        setDateFrom]        = useState(yearStart)
  const [dateTo,          setDateTo]          = useState(yearEnd)
  const [searchInput,     setSearchInput]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page,            setPage]            = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(0); setSelectedIds(new Set()) }, [dateFrom, dateTo, debouncedSearch])

  // Reset to new year range when accounting year changes
  useEffect(() => {
    setDateFrom(`${year}-01-01`)
    setDateTo(`${year}-12-31`)
    setPage(0)
    setSelectedIds(new Set())
  }, [year])

  // Clear selection on page change
  useEffect(() => { setSelectedIds(new Set()) }, [page])

  // Data controls state
  const infState = useDataViewState({ storageKey: 'inf', defaultSortKey: 'date', defaultSortDir: 'desc', defaultPageSize: DEFAULT_PAGE_SIZE })

  // Data — fetch all rows when searching so client can filter across every column and re-paginate
  const isSearching = debouncedSearch.trim() !== ''
  const { data, count, loading, error, refetch } = useInflowTransactions({
    dateFrom:  dateFrom  || undefined,
    dateTo:    dateTo    || undefined,
    page:      isSearching ? 0 : page,
    pageSize:  isSearching ? undefined : infState.pageSize,
    fetchAll:  isSearching,
  })

  // Sort all fetched rows
  const getValue = (r: InflowTransaction, k: string) => {
    if (k === 'amount')           return Number(r.amount)
    if (k === 'bank_name')        return r.bank_name ?? ''
    if (k === 'description')      return r.description ?? ''
    if (k === 'transaction_type') return r.transaction_type ?? ''
    return r.date
  }

  const sorted = useMemo(() => {
    const adv = infState.advancedSort
    if (adv.length > 0) return multiSortRows(data, getValue, adv, INF_SORT_FIELDS)
    return sortRows(data, getValue, infState.sortKey, infState.sortDir, INF_SORT_FIELDS)
  }, [data, infState.sortKey, infState.sortDir, infState.advancedSort])

  // Client-side search across all fetched rows, then paginate the results
  const allMatching = useMemo(
    () => searchRows(sorted, INF_COLUMNS, debouncedSearch, infState.searchCol),
    [sorted, debouncedSearch, infState.searchCol],
  )

  const displayed = useMemo(() => {
    if (!isSearching) return sorted
    const from = page * infState.pageSize
    return allMatching.slice(from, from + infState.pageSize)
  }, [allMatching, isSearching, page, infState.pageSize, sorted])

  // Summary (current page)
  const total   = useMemo(() => displayed.reduce((s, r) => s + Number(r.amount), 0), [displayed])
  const largest = useMemo(() => displayed.length ? Math.max(...displayed.map(r => Number(r.amount))) : 0, [displayed])
  const average = useMemo(() => displayed.length ? total / displayed.length : 0, [total, displayed.length])

  const [editRecord,        setEditRecord]        = useState<InflowTransaction | null>(null)
  const [modalOpen,         setModalOpen]         = useState(false)
  const [deleteId,          setDeleteId]          = useState<string | null>(null)
  const [expandedId,        setExpandedId]        = useState<string | null>(null)
  const [selectedIds,       setSelectedIds]       = useState<Set<string>>(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting,      setBulkDeleting]      = useState(false)
  const [bulkEditOpen,      setBulkEditOpen]      = useState(false)

  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()

  const { push: toast }                             = useToastStore()
  const { canWrite, canDelete }                     = useRole()
  const { mutate: deleteRecord, loading: deleting } = useDeleteTransaction('inflow_transactions')
  const { banks }                                   = useBanks()
  const { incomeTypes }                             = useIncomeTypes()

  usePageTitle('Inflows')

  const openEdit = (r: InflowTransaction) => { setEditRecord(r); setModalOpen(true) }

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
    setBulkDeleting(true)
    let failed = 0
    for (const id of ids) {
      try { await deleteRecord(id) } catch { failed++ }
    }
    setBulkDeleting(false)
    setConfirmBulkDelete(false)
    setSelectedIds(new Set())
    refetch()
    if (failed === 0) toast(`${ids.length} transaction${ids.length !== 1 ? 's' : ''} deleted`, 'success')
    else toast(`${ids.length - failed} deleted, ${failed} failed`, 'error')
  }

  const INF_CSV_HEADERS = ['Date', 'Description', 'Amount (₦)', 'Stage Code 2', 'Specific Seed', 'Txn Ref', 'Remark']
  const inflowCsvRow = (r: InflowTransaction) => [
    r.date, r.description, r.amount,
    r.stage_code_2, r.specific_seed_description, r.transaction_ref, r.remark,
  ]
  const INF_CSV_FILE = `inflows-${new Date().toISOString().slice(0, 10)}.csv`

  const handleExportView = () => {
    exportCSV(INF_CSV_FILE, INF_CSV_HEADERS, displayed.map(inflowCsvRow))
  }

  const handleExportAll = async () => {
    if (isSearching) {
      exportCSV(INF_CSV_FILE, INF_CSV_HEADERS, allMatching.map(inflowCsvRow))
      return
    }
    let query = supabase
      .from('inflow_transactions')
      .select('*')
      .order('recorded_at', { ascending: false })
      .order('date', { ascending: false })
      .limit(10000)
    if (dateFrom) query = query.gte('date', dateFrom)
    if (dateTo)   query = query.lte('date', dateTo)
    const { data: rows } = await query
    if (!rows) return
    const allRows = rows as InflowTransaction[]
    const adv = infState.advancedSort
    const allSorted = adv.length > 0
      ? multiSortRows(allRows, getValue, adv, INF_SORT_FIELDS)
      : sortRows(allRows, getValue, infState.sortKey, infState.sortDir, INF_SORT_FIELDS)
    exportCSV(INF_CSV_FILE, INF_CSV_HEADERS, allSorted.map(inflowCsvRow))
  }

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load inflow transactions</p>
      <p className="text-sm text-gray-500">{error}</p>
      <button onClick={refetch} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  )

  const allOnPageSelected = data.length > 0 && data.every(r => selectedIds.has(r.id))

  return (
    <>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Inflow Transactions</h1>
            <p className="text-sm text-gray-500 mt-0.5">All income and receipts</p>
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
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setSearchInput('') }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </Card>

        {/* Summary strip */}
        <SummaryStrip total={total} count={isSearching ? allMatching.length : count} largest={largest} average={average} loading={loading} />

        {/* Data controls bar */}
        <DataControlsBar
          columns={INF_COLUMNS}
          sortKey={infState.sortKey}
          sortDir={infState.sortDir}
          onSort={infState.setSort}
          defaultSortKey="date"
          defaultSortDir="desc"
          view={infState.view}
          onViewChange={infState.setView}
          search={searchInput}
          onSearchChange={v => { setSearchInput(v) }}
          searchPlaceholder="Search transactions…"
          searchCol={infState.searchCol}
          onSearchColChange={infState.setSearchCol}
          advancedSort={infState.advancedSort}
          onAdvancedSort={infState.setAdvancedSort}
          pageSize={infState.pageSize}
          onPageSizeChange={infState.setPageSize}
        />

        {/* Compact pagination above content */}
        <PaginationBar
          page={page}
          pageSize={infState.pageSize}
          total={isSearching ? allMatching.length : count}
          onPageChange={setPage}
          variant="compact"
        />

        {/* Cards / Table */}
        {infState.view === 'cards' ? (
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
              <EmptyState icon={TrendingUp} title="No inflow transactions" message="No transactions match your filters." compact />
            ) : displayed.map(row => {
              const it = incomeTypes.find(t => t.id === row.income_type_id)
              return (
                <div key={row.id} className="rounded-xl border overflow-hidden shadow-sm bg-white border-gray-200">
                  {/* Card header */}
                  <div className="px-4 pt-3.5 pb-3">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-[11px] font-semibold text-gray-400">{formatDate(row.date)}</p>
                      <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                        {it && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: `${it.color}22`, color: it.color }}>{it.name}</span>
                        )}
                        {row.transaction_type && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${row.transaction_type === BALANCE_BROUGHT_FORWARD_TYPE ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                            {TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type}
                          </span>
                        )}
                      </div>
                    </div>
                    {row.bank_name && <p className="text-[11px] text-gray-400 mb-1.5">{row.bank_name}</p>}
                    <div className="text-sm">
                      <DescriptionCell id={`card-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-800" />
                    </div>
                    {row.remark && (
                      <div className="text-xs mt-1.5">
                        <DescriptionCell id={`card-rem-${row.id}`} text={row.remark} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-400" />
                      </div>
                    )}
                  </div>
                  {/* Metrics footer */}
                  <div className="grid grid-cols-2 border-t border-gray-100 bg-gray-50/40 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide font-semibold mb-0.5 text-green-600/70">Inflow</p>
                      <p className="text-sm font-mono font-bold tabular-nums text-success">{formatCurrency(Number(row.amount))}</p>
                    </div>
                    <div className="border-l border-gray-200/80 pl-4 min-w-0 flex items-center justify-end gap-0.5">
                      {canWrite() && row.transaction_type !== BALANCE_BROUGHT_FORWARD_TYPE && (
                        <button onClick={() => openEdit(row)} className="p-1.5 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {canDelete() && row.transaction_type !== BALANCE_BROUGHT_FORWARD_TYPE && (
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
        {infState.view === 'cards' && (
          <PaginationBar
            page={page}
            pageSize={infState.pageSize}
            total={isSearching ? allMatching.length : count}
            onPageChange={setPage}
            variant="full"
          />
        )}

        {infState.view === 'table' && <Card padding={false}>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 px-4 py-2.5 border-b border-primary/10 bg-primary/5">
              <span className="text-sm font-medium text-primary">{selectedIds.size} selected</span>
              {canWrite() && (
                <button
                  onClick={() => setBulkEditOpen(true)}
                  className="px-3 py-1.5 text-sm font-medium text-primary bg-white border border-primary/30 rounded-lg hover:bg-primary/5 transition-colors"
                >
                  Edit selected
                </button>
              )}
              {canDelete() && (
                <button
                  onClick={() => setConfirmBulkDelete(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete selected
                </button>
              )}
              <button
                onClick={() => setSelectedIds(new Set())}
                className="ml-auto px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Clear
              </button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="w-10 pl-4 pr-2 py-3">
                    <input type="checkbox" className="w-4 h-4 rounded border-gray-300"
                      checked={allOnPageSelected}
                      onChange={e => setSelectedIds(e.target.checked ? new Set(data.map(r => r.id)) : new Set())} />
                  </th>
                  <th className="w-8" />
                  <SortableHeader field={INF_SORT_FIELDS[0]} activeSortKey={infState.sortKey} activeSortDir={infState.sortDir} onSort={infState.setSort} className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" />
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Recorded</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Bank</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Txn Ref</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Type</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Description</th>
                  <SortableHeader field={INF_SORT_FIELDS[1]} activeSortKey={infState.sortKey} activeSortDir={infState.sortDir} onSort={infState.setSort} rightAlign className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" inactiveCls="text-success/80 hover:text-success" />
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
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
                      <EmptyState icon={TrendingUp} title="No inflow transactions" message="No transactions match your filters." compact />
                    </td>
                  </tr>
                ) : (
                  displayed.flatMap(row => {
                    const expanded = expandedId === row.id
                    const rows = [
                      <tr
                        key={row.id}
                        className={`hover:bg-gray-50 transition-colors${selectedIds.has(row.id) ? ' bg-primary/5 hover:bg-primary/10' : ''}`}
                      >
                        <td className="pl-4 pr-2 py-3 w-10">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-gray-300"
                            checked={selectedIds.has(row.id)}
                            onChange={e => {
                              const next = new Set(selectedIds)
                              if (e.target.checked) next.add(row.id)
                              else next.delete(row.id)
                              setSelectedIds(next)
                            }}
                          />
                        </td>
                        <td className="w-8 px-1 py-3">
                          <button
                            onClick={() => setExpandedId(expanded ? null : row.id)}
                            className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                            title={expanded ? 'Collapse' : 'Expand details'}
                          >
                            {expanded
                              ? <ChevronDown className="w-3.5 h-3.5" />
                              : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {row.recorded_at ? formatDate(row.recorded_at.slice(0, 10)) : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{row.bank_name ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-[180px]" onClick={e => e.stopPropagation()}>
                          <DescriptionCell id={`ref-${row.id}`} text={row.transaction_ref ?? null} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-500" />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1">
                            {(() => {
                              const it = incomeTypes.find(t => t.id === row.income_type_id)
                              return it ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap" style={{ backgroundColor: `${it.color}22`, color: it.color }}>
                                  {it.name}
                                </span>
                              ) : null
                            })()}
                            {row.transaction_type ? (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${row.transaction_type === BALANCE_BROUGHT_FORWARD_TYPE ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                                {TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type}
                              </span>
                            ) : null}
                            {!incomeTypes.find(t => t.id === row.income_type_id) && !row.transaction_type && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-gray-100 text-gray-400">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-800 max-w-[240px]" onClick={e => e.stopPropagation()}>
                          <DescriptionCell id={row.id} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
                        </td>
                        <AmountCell value={Number(row.amount)} mode="inflow" />
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center gap-1">
                            {canWrite() && row.transaction_type !== BALANCE_BROUGHT_FORWARD_TYPE && (
                              <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                                <Pencil className="w-4 h-4" />
                              </button>
                            )}
                            {canDelete() && row.transaction_type !== BALANCE_BROUGHT_FORWARD_TYPE && (
                              <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors" title="Delete">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>,
                    ]
                    if (expanded) {
                      rows.push(
                        <RowDetailPanel key={`${row.id}-detail`} items={inflowDetailItems(row)} colSpan={10} />,
                      )
                    }
                    return rows
                  })
                )}
              </tbody>
            </table>
          </div>
          <PaginationBar
            page={page}
            pageSize={infState.pageSize}
            total={isSearching ? allMatching.length : count}
            onPageChange={setPage}
            variant="full"
          />
        </Card>}
      </div>

      <AddInflowModal
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
        label="this inflow transaction"
      />
      <DeleteDialog
        open={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={handleBulkDelete}
        loading={bulkDeleting}
        label={`these ${selectedIds.size} inflow transaction${selectedIds.size !== 1 ? 's' : ''}`}
      />
      <BulkEditInflowModal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        ids={[...selectedIds]}
        banks={banks}
        onSuccess={() => { setSelectedIds(new Set()); refetch() }}
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

// ── BulkEditInflowModal ────────────────────────────────────────────────────────

function BulkEditInflowModal({ open, onClose, ids, banks, onSuccess }: {
  open: boolean
  onClose: () => void
  ids: string[]
  banks: { id: string; name: string }[]
  onSuccess: () => void
}) {
  const { mutate: update } = useUpdateTransaction('inflow_transactions')
  const { push: toast }    = useToastStore()
  const { categories }     = useCategories()
  const { incomeTypes }    = useIncomeTypes()

  const [bankName,     setBankName]     = useState('')
  const [recordedAt,   setRecordedAt]   = useState('')
  const [txnType,      setTxnType]      = useState('')
  const [incomeTypeId, setIncomeTypeId] = useState('')
  const [stageCode1,   setStageCode1]   = useState('')
  const [stageCode2,   setStageCode2]   = useState('')
  const [saving,       setSaving]       = useState(false)

  useEffect(() => {
    if (open) return
    setBankName('')
    setRecordedAt('')
    setTxnType('')
    setIncomeTypeId('')
    setStageCode1('')
    setStageCode2('')
    setSaving(false)
  }, [open])

  const hasChanges = !!bankName || !!recordedAt || !!txnType || !!incomeTypeId || !!stageCode1 || !!stageCode2

  const MISSING_COL_RE = /Could not find (?:the ')?(\w+)'? column/

  const handleApply = async () => {
    if (!hasChanges) return
    setSaving(true)
    const baseUpdates: Record<string, unknown> = {}
    if (bankName)     baseUpdates.bank_name        = bankName
    if (recordedAt)   baseUpdates.recorded_at      = `${recordedAt}T00:00:00.000Z`
    if (txnType)      baseUpdates.transaction_type = txnType
    if (incomeTypeId) baseUpdates.income_type_id   = incomeTypeId
    if (stageCode1)   baseUpdates.stage_code_1     = stageCode1
    if (stageCode2)   baseUpdates.stage_code_2     = stageCode2
    let failed = 0
    const strippedCols: string[] = []
    for (const id of ids) {
      // Build per-row updates from the immutable base, minus any schema-confirmed-missing columns
      const rowUpdates = Object.fromEntries(
        Object.entries(baseUpdates).filter(([k]) => !strippedCols.includes(k))
      )
      try {
        await update({ id, updates: rowUpdates })
      } catch (err: unknown) {
        const col = (err instanceof Error ? err.message : '').match(MISSING_COL_RE)?.[1]
        if (col && col in rowUpdates) {
          if (!strippedCols.includes(col)) strippedCols.push(col)
          const retryUpdates = Object.fromEntries(
            Object.entries(rowUpdates).filter(([k]) => k !== col)
          )
          try { await update({ id, updates: retryUpdates }) } catch { failed++ }
        } else {
          failed++
        }
      }
    }
    setSaving(false)
    for (const col of strippedCols) {
      toast(`⚠ ${col} column missing — run Setup → Database migration`, 'error')
    }
    if (failed === 0) toast(`Updated ${ids.length} transaction${ids.length !== 1 ? 's' : ''}`, 'success')
    else toast(`${ids.length - failed} updated, ${failed} failed`, 'error')
    onSuccess()
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} title={`Bulk Edit ${ids.length} Transaction${ids.length !== 1 ? 's' : ''}`} size="max-w-md">
      <div className="space-y-4">
        <p className="text-sm text-gray-500">Only filled fields will be applied. Leave blank to keep existing values.</p>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Bank Name</label>
          <select value={bankName} onChange={e => setBankName(e.target.value)} className={filterInputCls}>
            <option value="">— Keep existing —</option>
            {banks.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Recorded Date</label>
          <input type="date" value={recordedAt} onChange={e => setRecordedAt(e.target.value)} className={filterInputCls} />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Transaction Type</label>
          <select value={txnType} onChange={e => setTxnType(e.target.value)} className={filterInputCls}>
            <option value="">— Keep existing —</option>
            <option value="refund">Refund</option>
            <option value="reversal">Reversal</option>
            <option value="bank_deposit">Bank Deposit</option>
            <option value="intrabank_transfer">Intrabank Transfer</option>
          </select>
        </div>

        {incomeTypes.length > 0 && (
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500">Income Type</label>
            <select value={incomeTypeId} onChange={e => setIncomeTypeId(e.target.value)} className={filterInputCls}>
              <option value="">— Keep existing —</option>
              {incomeTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Stage Code 1 (Category)</label>
          <select value={stageCode1} onChange={e => setStageCode1(e.target.value)} className={filterInputCls}>
            <option value="">— Keep existing —</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500">Stage Code 2 (Portion Type)</label>
          <select value={stageCode2} onChange={e => setStageCode2(e.target.value)} className={filterInputCls}>
            <option value="">— Keep existing —</option>
            <option value="Percentage Allocation">Percentage Allocation</option>
            <option value="Specific Seed">Specific Seed</option>
            <option value="Savings">Savings</option>
          </select>
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={saving || !hasChanges}
            className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors disabled:opacity-50"
          >
            {saving ? 'Applying…' : `Apply to ${ids.length} record${ids.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
