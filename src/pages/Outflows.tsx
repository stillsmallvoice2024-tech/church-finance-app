import { useState, useEffect, useMemo } from 'react'
import {
  TrendingDown, Download, Pencil, Trash2,
  AlertCircle, RefreshCw,
} from 'lucide-react'
import { Card }                    from '../components/ui/Card'
import { Modal }                   from '../components/ui/Modal'
import { DeleteDialog }            from '../components/ui/DeleteDialog'
import { AddOutflowModal }         from '../components/modals/AddOutflowModal'
import { ReceiptBadge }            from '../components/ui/ReceiptBadge'
import { DataControlsBar }         from '../components/ui/DataControlsBar'
import { SortableHeader }          from '../components/ui/SortableHeader'
import { PaginationBar }           from '../components/ui/PaginationBar'
import { useDataViewState }        from '../hooks/useDataViewState'
import { sortRows, multiSortRows, type SortField } from '../utils/sortUtils'
import { useOutflowTransactions, type OutflowTransaction } from '../hooks/useTransactions'
import { useDeleteTransaction, useUpdateTransaction } from '../hooks/useMutations'
import { useBanks }                from '../hooks/useBanks'
import { useToastStore }           from '../store/toastStore'
import { useRole }                 from '../hooks/useRole'
import { usePageTitle }            from '../hooks/usePageTitle'
import { formatDate, formatCurrency, formatCurrencyCompact } from '../utils/formatters'
import { exportCSV }               from '../utils/csvExport'
import { useCategories }           from '../hooks/useCategories'
import { useYearRange }            from '../hooks/useYearRange'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { EmptyState } from '../components/ui/EmptyState'
import { AmountCell } from '../components/ui/AmountCell'
import { filterInputCls } from '../components/ui/FormField'

const DEFAULT_PAGE_SIZE = 25

const TXN_TYPE_LABELS: Record<string, string> = {
  refund:              'Refund',
  reversal:            'Reversal',
  bank_deposit:        'Bank Deposit',
  intrabank_transfer:  'Intrabank Transfer',
}

const OUT_SORT_FIELDS: SortField[] = [
  { key: 'date',             label: 'Date',        type: 'date',    primary: true },
  { key: 'amount_disbursed', label: 'Disbursed',   type: 'numeric', primary: true },
  { key: 'bank_name',        label: 'Bank',        type: 'text' },
  { key: 'description',      label: 'Description', type: 'text' },
]

const OUT_SEARCH_COLS = [
  { key: 'all',             label: 'All Columns' },
  { key: 'description',     label: 'Description' },
  { key: 'bank_name',       label: 'Bank' },
  { key: 'transaction_id',  label: 'Txn ID' },
  { key: 'stage_code_1',    label: 'Stage Code' },
  { key: 'amount_disbursed', label: 'Amount' },
]

function outColVal(r: OutflowTransaction, col: string): string {
  if (col === 'description')      return r.description ?? ''
  if (col === 'bank_name')        return r.bank_name ?? ''
  if (col === 'transaction_id')   return r.transaction_id ?? ''
  if (col === 'stage_code_1')     return r.stage_code_1 ?? ''
  if (col === 'amount_disbursed') return String(r.amount_disbursed)
  return ''
}

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

export default function Outflows() {
  const { year, dateFrom: yearStart, dateTo: yearEnd } = useYearRange()

  // Filters
  const [dateFrom,        setDateFrom]        = useState(yearStart)
  const [dateTo,          setDateTo]          = useState(yearEnd)
  const [stageCode,       setStageCode]       = useState('')
  const [searchInput,     setSearchInput]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page,            setPage]            = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(0); setSelectedIds(new Set()) }, [dateFrom, dateTo, stageCode, debouncedSearch])

  useEffect(() => {
    setDateFrom(`${year}-01-01`)
    setDateTo(`${year}-12-31`)
    setPage(0)
    setSelectedIds(new Set())
  }, [year])

  // Clear selection on page change
  useEffect(() => { setSelectedIds(new Set()) }, [page])

  // Data controls state
  const outState = useDataViewState({ storageKey: 'out', defaultSortKey: 'date', defaultSortDir: 'desc', defaultPageSize: DEFAULT_PAGE_SIZE })

  // Data
  const { data, count, loading, error, refetch } = useOutflowTransactions({
    dateFrom:  dateFrom  || undefined,
    dateTo:    dateTo    || undefined,
    stageCode: stageCode || undefined,
    search:    debouncedSearch || undefined,
    page,
    pageSize:  outState.pageSize,
  })

  // Summary (disbursed amounts)
  const total   = useMemo(() => data.reduce((s, r) => s + Number(r.amount_disbursed), 0), [data])
  const largest = useMemo(() => data.length ? Math.max(...data.map(r => Number(r.amount_disbursed))) : 0, [data])
  const average = useMemo(() => data.length ? total / data.length : 0, [total, data.length])

  // Client-side sort of current page
  const getOutValue = (r: OutflowTransaction, k: string) => {
    if (k === 'amount_disbursed') return Number(r.amount_disbursed)
    if (k === 'bank_name')        return r.bank_name ?? ''
    if (k === 'description')      return r.description ?? ''
    return r.date
  }

  const sorted = useMemo(() => {
    const adv = outState.advancedSort
    if (adv.length > 0) return multiSortRows(data, getOutValue, adv, OUT_SORT_FIELDS)
    return sortRows(data, getOutValue, outState.sortKey, outState.sortDir, OUT_SORT_FIELDS)
  }, [data, outState.sortKey, outState.sortDir, outState.advancedSort])

  const displayed = useMemo(() => {
    const q = searchInput.trim().toLowerCase()
    const col = outState.searchCol
    if (!q || col === 'all') return sorted
    return sorted.filter(r => outColVal(r, col).toLowerCase().includes(q))
  }, [sorted, searchInput, outState.searchCol])

  // UI state
  const [editRecord,        setEditRecord]        = useState<OutflowTransaction | null>(null)
  const [modalOpen,         setModalOpen]         = useState(false)
  const [deleteId,          setDeleteId]          = useState<string | null>(null)
  const [selectedIds,       setSelectedIds]       = useState<Set<string>>(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting,      setBulkDeleting]      = useState(false)
  const [bulkEditOpen,      setBulkEditOpen]      = useState(false)

  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()
  const { push: toast }                             = useToastStore()
  const { canWrite, canDelete }                     = useRole()
  const { mutate: deleteRecord, loading: deleting } = useDeleteTransaction('outflow_transactions')
  const { banks }                                   = useBanks()
  const { categories }                              = useCategories()

  usePageTitle('Outflows')

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

  const handleExport = () => {
    exportCSV(
      `outflows-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Date', 'Txn ID', 'Description', 'Disbursed (₦)', 'Refunded (₦)', 'Transfer Charge (₦)', 'Net Amount (₦)', 'Stage Code 1', 'Remarks'],
      data.map(r => [
        r.date, r.transaction_id, r.description,
        r.amount_disbursed, r.amount_refunded, r.transfer_charge,
        Number(r.amount_disbursed) - Number(r.amount_refunded) - Number(r.transfer_charge),
        r.stage_code_1, r.remarks,
      ]),
    )
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

  const allOnPageSelected = data.length > 0 && data.every(r => selectedIds.has(r.id))

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
            <button
              onClick={handleExport} disabled={data.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
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
              <select value={stageCode} onChange={e => setStageCode(e.target.value)} className={`${filterInputCls} bg-white`}>
                <option value="">All categories</option>
                {categories.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </FilterGroup>
            {(dateFrom || dateTo || stageCode) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setStageCode(''); setSearchInput('') }}
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
          sortFields={OUT_SORT_FIELDS}
          sortKey={outState.sortKey}
          sortDir={outState.sortDir}
          onSort={outState.setSort}
          defaultSortKey="date"
          defaultSortDir="desc"
          view={outState.view}
          onViewChange={outState.setView}
          search={searchInput}
          onSearchChange={v => { setSearchInput(v) }}
          searchPlaceholder="Search descriptions…"
          searchColumns={OUT_SEARCH_COLS}
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
                      <DescriptionCell id={`card-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-800" />
                    </div>
                    {row.stage_code_1 && <p className="text-[11px] text-gray-400 mt-1">{row.stage_code_1}</p>}
                    {row.remarks && (
                      <div className="text-xs mt-1.5">
                        <DescriptionCell id={`card-rem-${row.id}`} text={row.remarks} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-400" />
                      </div>
                    )}
                  </div>
                  {/* Metrics footer */}
                  <div className={`border-t border-gray-100 bg-gray-50/40 px-4 py-3 ${netDiffers ? 'grid grid-cols-3' : 'grid grid-cols-2'}`}>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide font-semibold mb-0.5 text-red-600/70">Disbursed</p>
                      <p className="text-sm font-mono font-bold tabular-nums text-danger">{formatCurrency(Number(row.amount_disbursed))}</p>
                    </div>
                    {netDiffers && (
                      <div className="border-l border-gray-200/80 pl-4 min-w-0">
                        <p className="text-[10px] uppercase tracking-wide font-semibold mb-0.5 text-gray-400">Net</p>
                        <p className="text-sm font-mono font-bold tabular-nums text-gray-700">{formatCurrency(net)}</p>
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
                    <input
                      type="checkbox"
                      className="w-4 h-4 rounded border-gray-300"
                      checked={allOnPageSelected}
                      onChange={e => setSelectedIds(e.target.checked ? new Set(data.map(r => r.id)) : new Set())}
                    />
                  </th>
                  <SortableHeader field={OUT_SORT_FIELDS[0]} activeSortKey={outState.sortKey} activeSortDir={outState.sortDir} onSort={outState.setSort} className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" />
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Recorded</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Bank</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Txn ID</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Description</th>
                  <SortableHeader field={OUT_SORT_FIELDS[1]} activeSortKey={outState.sortKey} activeSortDir={outState.sortDir} onSort={outState.setSort} rightAlign className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" inactiveCls="text-danger/80 hover:text-danger" />
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right whitespace-nowrap">Refunded (₦)</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right whitespace-nowrap">Net (₦)</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Stage Code 1</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Remarks</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">📎</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider text-left whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 13 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-200 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={13}>
                      <EmptyState icon={TrendingDown} title="No outflow transactions" message="No transactions match your filters." compact />
                    </td>
                  </tr>
                ) : (
                  sorted.map(row => {
                    const net = Number(row.amount_disbursed) - Number(row.amount_refunded) - Number(row.transfer_charge)
                    return (
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
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {row.recorded_at ? formatDate(row.recorded_at.slice(0, 10)) : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{row.bank_name ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-[180px]">
                          <DescriptionCell id={`ref-${row.id}`} text={row.transaction_id ?? null} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-500" />
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-800 max-w-[220px]">
                          <div className="flex items-start gap-1.5 min-w-0">
                            {row.is_pending_deduction && (
                              <span className="inline-flex shrink-0 items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">
                                Pending
                              </span>
                            )}
                            {row.transaction_type && (
                              <span className="inline-flex shrink-0 items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 whitespace-nowrap">
                                {TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type}
                              </span>
                            )}
                            <DescriptionCell id={row.id} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
                          </div>
                        </td>
                        <AmountCell value={Number(row.amount_disbursed)} mode="outflow" />
                        <AmountCell value={Number(row.amount_refunded)} mode="neutral" bold={false} />
                        <AmountCell value={net} mode="neutral" />
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.stage_code_1 ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px]">
                          <DescriptionCell id={`rem-${row.id}`} text={row.remarks} tooltip={descTooltip} setTooltip={setDescTooltip} />
                        </td>
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
        categories={categories}
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

// ── BulkEditOutflowModal ───────────────────────────────────────────────────────

function BulkEditOutflowModal({ open, onClose, ids, banks, categories, onSuccess }: {
  open: boolean
  onClose: () => void
  ids: string[]
  banks: { id: string; name: string }[]
  categories: { id: string; name: string }[]
  onSuccess: () => void
}) {
  const { mutate: update } = useUpdateTransaction('outflow_transactions')
  const { push: toast }    = useToastStore()

  const [bankName,   setBankName]   = useState('')
  const [recordedAt, setRecordedAt] = useState('')
  const [txnType,    setTxnType]    = useState('')
  const [stageCode1, setStageCode1] = useState('')
  const [stageCode2, setStageCode2] = useState('')
  const [saving,     setSaving]     = useState(false)

  useEffect(() => {
    if (open) return
    setBankName('')
    setRecordedAt('')
    setTxnType('')
    setStageCode1('')
    setStageCode2('')
    setSaving(false)
  }, [open])

  const hasChanges = !!bankName || !!recordedAt || !!txnType || !!stageCode1 || !!stageCode2

  const MISSING_COL_RE = /Could not find (?:the ')?(\w+)'? column/

  const handleApply = async () => {
    if (!hasChanges) return
    setSaving(true)
    const baseUpdates: Record<string, unknown> = {}
    if (bankName)   baseUpdates.bank_name        = bankName
    if (recordedAt) baseUpdates.recorded_at      = `${recordedAt}T00:00:00.000Z`
    if (txnType)    baseUpdates.transaction_type  = txnType
    if (stageCode1) baseUpdates.stage_code_1     = stageCode1
    if (stageCode2) baseUpdates.stage_code_2     = stageCode2
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
