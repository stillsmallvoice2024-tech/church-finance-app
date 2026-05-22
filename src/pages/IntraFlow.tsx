import { useState, useEffect, useMemo } from 'react'
import {
  ArrowLeftRight, Plus, Download, Pencil, Trash2,
  AlertCircle, RefreshCw,
} from 'lucide-react'
import { Card }                    from '../components/ui/Card'
import { DataControlsBar }         from '../components/ui/DataControlsBar'
import { SortableHeader }          from '../components/ui/SortableHeader'
import { PaginationBar }           from '../components/ui/PaginationBar'
import { DeleteDialog }            from '../components/ui/DeleteDialog'
import { AddIntraFlowModal }       from '../components/modals/AddIntraFlowModal'
import { useIntraFlows, type IntraFlowRow } from '../hooks/useTransactions'
import { useDeleteTransaction }    from '../hooks/useMutations'
import { useToastStore }           from '../store/toastStore'
import { useRole }                 from '../hooks/useRole'
import { usePageTitle }            from '../hooks/usePageTitle'
import { useDataViewState }        from '../hooks/useDataViewState'
import { sortRows, multiSortRows } from '../utils/sortUtils'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields, searchRows } from '../utils/tableColumns'
import { formatDate, formatCurrency, formatCurrencyCompact } from '../utils/formatters'
import { exportCSV }               from '../utils/csvExport'
import { useCategories }  from '../hooks/useCategories'
import { useYearRange }   from '../hooks/useYearRange'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { filterInputCls } from '../components/ui/FormField'

// ── Sort / search config ───────────────────────────────────────────────────────

const IFL_COLUMNS: TableColumnDef<IntraFlowRow>[] = [
  { key: 'date',         label: 'Date',        sortType: 'date',    primary: true, noSearch: true },
  { key: 'total_amount', label: 'Amount',      sortType: 'numeric', primary: true },
  { key: 'account_from', label: 'From',        sortType: 'text',    accessor: r => r.account_from ?? '' },
  { key: 'account_to',   label: 'To',          sortType: 'text',    accessor: r => r.account_to ?? '' },
  { key: 'description',  label: 'Description', sortType: 'text',    accessor: r => r.description ?? '' },
]

const IFL_SORT_FIELDS = deriveSortFields(IFL_COLUMNS)

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

export default function IntraFlow() {
  const { year, dateFrom: yearStart, dateTo: yearEnd } = useYearRange()

  // Filters
  const [dateFrom,    setDateFrom]    = useState(yearStart)
  const [dateTo,      setDateTo]      = useState(yearEnd)
  const [accountFrom, setAccountFrom] = useState('')
  const [accountTo,   setAccountTo]   = useState('')

  const iflState = useDataViewState({ storageKey: 'ifl', defaultSortKey: 'date', defaultSortDir: 'desc' })

  // Debounce search for server (description ilike when col='all')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(iflState.search), 400)
    return () => clearTimeout(t)
  }, [iflState.search])

  useEffect(() => { iflState.setPage(0) }, [dateFrom, dateTo, accountFrom, accountTo, debouncedSearch, iflState.setPage])

  useEffect(() => {
    setDateFrom(`${year}-01-01`)
    setDateTo(`${year}-12-31`)
    iflState.setPage(0)
  }, [year]) // eslint-disable-line react-hooks/exhaustive-deps

  // Data
  const { data, count, loading, error, refetch } = useIntraFlows({
    dateFrom:    dateFrom    || undefined,
    dateTo:      dateTo      || undefined,
    accountFrom: accountFrom || undefined,
    accountTo:   accountTo   || undefined,
    search:      (iflState.searchCol === 'all' ? debouncedSearch : '') || undefined,
    page:        iflState.page,
    pageSize:    iflState.pageSize,
  })

  // Sort + filter
  const getIflValue = (r: IntraFlowRow, k: string) => {
    if (k === 'total_amount') return Number(r.total_amount)
    if (k === 'account_from') return r.account_from ?? ''
    if (k === 'account_to')   return r.account_to ?? ''
    if (k === 'description')  return r.description ?? ''
    return r.date
  }

  const sorted = useMemo(() => {
    const adv = iflState.advancedSort
    if (adv.length > 0) return multiSortRows(data, getIflValue, adv, IFL_SORT_FIELDS)
    return sortRows(data, getIflValue, iflState.sortKey, iflState.sortDir, IFL_SORT_FIELDS)
  }, [data, iflState.sortKey, iflState.sortDir, iflState.advancedSort]) // eslint-disable-line react-hooks/exhaustive-deps

  const displayed = useMemo(
    () => iflState.searchCol === 'all' ? sorted : searchRows(sorted, IFL_COLUMNS, iflState.search, iflState.searchCol),
    [sorted, iflState.search, iflState.searchCol],
  )

  // Summary
  const total   = useMemo(() => data.reduce((s, r) => s + Number(r.total_amount), 0), [data])
  const largest = useMemo(() => data.length ? Math.max(...data.map(r => Number(r.total_amount))) : 0, [data])
  const average = useMemo(() => data.length ? total / data.length : 0, [total, data.length])

  // UI state
  const [editRecord,   setEditRecord]   = useState<IntraFlowRow | null>(null)
  const [modalOpen,    setModalOpen]    = useState(false)
  const [deleteId,     setDeleteId]     = useState<string | null>(null)
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()

  const { push: toast }                             = useToastStore()
  const { canWrite, canDelete }                     = useRole()
  const { mutate: deleteRecord, loading: deleting } = useDeleteTransaction('intra_flows')
  const { categories } = useCategories()

  usePageTitle('Internal Transfers')

  const openAdd  = () => { setEditRecord(null); setModalOpen(true) }
  const openEdit = (r: IntraFlowRow) => { setEditRecord(r); setModalOpen(true) }

  const handleModalSuccess = () => {
    toast(editRecord ? 'Transfer updated' : 'Transfer recorded successfully', 'success')
    refetch()
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteRecord(deleteId)
      toast('Transfer deleted', 'success')
      setDeleteId(null)
      refetch()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error')
    }
  }

  const handleExport = () => {
    exportCSV(
      `intra-flows-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Date', 'From Category', 'To Category', 'Amount (₦)', 'From Stage 1', 'From Stage 2', 'To Stage 1', 'To Stage 2', 'Description', 'Remark'],
      data.map(r => [
        r.date,
        r.account_from ?? '',
        r.account_to   ?? '',
        r.total_amount,
        r.account_from_stage1, r.account_from_stage2,
        r.account_to_stage1,   r.account_to_stage2,
        r.description, r.remark,
      ]),
    )
  }

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load internal transfers</p>
      <p className="text-sm text-gray-500">{error}</p>
      <button onClick={refetch} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  )

  const hasActiveFilters = dateFrom || dateTo || accountFrom || accountTo

  return (
    <>
      <div className="space-y-5">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Internal Transfers</h1>
            <p className="text-sm text-gray-500 mt-0.5">Movements between accounts</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport} disabled={data.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
            <button
              onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Transfer
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
            <FilterGroup label="From Category" className="min-w-[180px]">
              <select value={accountFrom} onChange={e => setAccountFrom(e.target.value)} className={`${filterInputCls} bg-white`}>
                <option value="">All categories</option>
                {categories.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </FilterGroup>
            <FilterGroup label="To Category" className="min-w-[180px]">
              <select value={accountTo} onChange={e => setAccountTo(e.target.value)} className={`${filterInputCls} bg-white`}>
                <option value="">All categories</option>
                {categories.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </FilterGroup>
            {hasActiveFilters && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setAccountFrom(''); setAccountTo('') }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </Card>

        {/* Data controls bar */}
        <DataControlsBar
          columns={IFL_COLUMNS}
          sortKey={iflState.sortKey}
          sortDir={iflState.sortDir}
          onSort={iflState.setSort}
          defaultSortKey="date"
          defaultSortDir="desc"
          view={iflState.view}
          onViewChange={iflState.setView}
          search={iflState.search}
          onSearchChange={v => { iflState.setSearch(v) }}
          searchCol={iflState.searchCol}
          onSearchColChange={iflState.setSearchCol}
          advancedSort={iflState.advancedSort}
          onAdvancedSort={iflState.setAdvancedSort}
          pageSize={iflState.pageSize}
          onPageSizeChange={iflState.setPageSize}
        />

        {/* Summary strip */}
        <SummaryStrip total={total} count={count} largest={largest} average={average} loading={loading} />

        {/* Table / Card view */}
        <Card padding={false}>
          {iflState.view === 'cards' ? (
            <div className="p-4 space-y-3">
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
              ) : displayed.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  <ArrowLeftRight className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm">No internal transfers match your filters.</p>
                </div>
              ) : (
                displayed.map(row => (
                  <div key={row.id} className="rounded-xl border overflow-hidden shadow-sm bg-white border-gray-200">
                    {/* Card header */}
                    <div className="px-4 pt-3.5 pb-3">
                      <p className="text-[11px] font-semibold mb-2 text-gray-400">{formatDate(row.date)}</p>
                      <div className="flex items-center gap-2 text-sm text-gray-700 mb-1">
                        <span className="font-medium truncate">{row.account_from ?? '—'}</span>
                        <ArrowLeftRight className="w-3 h-3 text-gray-400 shrink-0" />
                        <span className="font-medium truncate">{row.account_to ?? '—'}</span>
                      </div>
                      {row.description && (
                        <div className="text-sm mt-1.5">
                          <DescriptionCell id={`card-desc-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-600" />
                        </div>
                      )}
                      {row.remark && (
                        <div className="text-xs mt-1.5">
                          <DescriptionCell id={`card-rem-${row.id}`} text={row.remark} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-400" />
                        </div>
                      )}
                    </div>
                    {/* Metrics footer */}
                    <div className="grid grid-cols-2 border-t border-gray-100 bg-gray-50/40 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide font-semibold mb-0.5 text-gray-500">Transfer</p>
                        <p className="text-sm font-mono font-bold tabular-nums text-primary">{formatCurrency(Number(row.total_amount))}</p>
                      </div>
                      <div className="border-l border-gray-200/80 pl-4 min-w-0 flex items-center justify-end gap-0.5">
                        {canWrite() && (
                          <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete() && (
                          <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <SortableHeader
                      field={IFL_SORT_FIELDS[0]}
                      activeSortKey={iflState.sortKey}
                      activeSortDir={iflState.sortDir}
                      onSort={iflState.setSort}
                      className="px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                    />
                    <SortableHeader
                      field={IFL_SORT_FIELDS[2]}
                      activeSortKey={iflState.sortKey}
                      activeSortDir={iflState.sortDir}
                      onSort={iflState.setSort}
                      className="px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                    />
                    <SortableHeader
                      field={IFL_SORT_FIELDS[3]}
                      activeSortKey={iflState.sortKey}
                      activeSortDir={iflState.sortDir}
                      onSort={iflState.setSort}
                      className="px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                    />
                    <SortableHeader
                      field={IFL_SORT_FIELDS[1]}
                      activeSortKey={iflState.sortKey}
                      activeSortDir={iflState.sortDir}
                      onSort={iflState.setSort}
                      className="px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                      rightAlign
                    />
                    {['From Stage', 'To Stage', 'Remark', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 8 }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-4 bg-gray-200 rounded animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : displayed.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-gray-400">
                          <ArrowLeftRight className="w-10 h-10 text-gray-200" />
                          <p className="text-sm">No internal transfers match your filters.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    displayed.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.account_from ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.account_to ?? '—'}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-primary whitespace-nowrap text-right">{formatCurrency(Number(row.total_amount))}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{row.account_from_stage1 ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{row.account_to_stage1 ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px]">
                          <DescriptionCell id={`rem-${row.id}`} text={row.remark} tooltip={descTooltip} setTooltip={setDescTooltip} />
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
          <PaginationBar
            page={iflState.page}
            pageSize={iflState.pageSize}
            total={count}
            onPageChange={iflState.setPage}
            variant="full"
          />
        </Card>
      </div>

      <AddIntraFlowModal
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
        label="this internal transfer"
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
