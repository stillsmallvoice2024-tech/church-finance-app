import { useState, useEffect, useMemo } from 'react'
import {
  ArrowLeftRight, Plus, Download, Pencil, Trash2,
  Search, AlertCircle, RefreshCw,
  LayoutGrid, LayoutList,
} from 'lucide-react'
import { Card }                    from '../components/ui/Card'
import { Pagination }              from '../components/ui/Pagination'
import { DeleteDialog }            from '../components/ui/DeleteDialog'
import { AddIntraFlowModal }       from '../components/modals/AddIntraFlowModal'
import { useIntraFlows, type IntraFlowRow } from '../hooks/useTransactions'
import { useDeleteTransaction }    from '../hooks/useMutations'
import { useToastStore }           from '../store/toastStore'
import { useRole }                 from '../hooks/useRole'
import { usePageTitle }            from '../hooks/usePageTitle'
import { formatDate, formatCurrency, formatCurrencyCompact } from '../utils/formatters'
import { exportCSV }               from '../utils/csvExport'
import { useCategories }  from '../hooks/useCategories'
import { useYearRange }   from '../hooks/useYearRange'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'

const PAGE_SIZE = 25

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
        <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
          <p className="text-xs text-gray-500 mb-1">{label}</p>
          {loading
            ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
            : <p className="text-lg font-bold text-gray-900">{value}</p>}
        </div>
      ))}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function IntraFlow() {
  const { year, dateFrom: yearStart, dateTo: yearEnd } = useYearRange()

  // Filters
  const [dateFrom,        setDateFrom]        = useState(yearStart)
  const [dateTo,          setDateTo]          = useState(yearEnd)
  const [accountFrom,     setAccountFrom]     = useState('')
  const [accountTo,       setAccountTo]       = useState('')
  const [searchInput,     setSearchInput]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page,            setPage]            = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(0) }, [dateFrom, dateTo, accountFrom, accountTo, debouncedSearch])

  useEffect(() => {
    setDateFrom(`${year}-01-01`)
    setDateTo(`${year}-12-31`)
    setPage(0)
  }, [year])

  // Data
  const { data, count, loading, error, refetch } = useIntraFlows({
    dateFrom:    dateFrom    || undefined,
    dateTo:      dateTo      || undefined,
    accountFrom: accountFrom || undefined,
    accountTo:   accountTo   || undefined,
    search:      debouncedSearch || undefined,
    page,
    pageSize:    PAGE_SIZE,
  })

  // Summary
  const total   = useMemo(() => data.reduce((s, r) => s + Number(r.total_amount), 0), [data])
  const largest = useMemo(() => data.length ? Math.max(...data.map(r => Number(r.total_amount))) : 0, [data])
  const average = useMemo(() => data.length ? total / data.length : 0, [total, data.length])

  // UI state
  const [editRecord,   setEditRecord]   = useState<IntraFlowRow | null>(null)
  const [modalOpen,    setModalOpen]    = useState(false)
  const [deleteId,     setDeleteId]     = useState<string | null>(null)
  const { expandedIds: descExpanded, tooltip: descTooltip, setTooltip: setDescTooltip, toggle: toggleDesc } = useDescriptionExpand()
  const [displayMode,  setDisplayMode]  = useState<'table' | 'cards'>('table')

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

  const hasActiveFilters = dateFrom || dateTo || accountFrom || accountTo || searchInput

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
            {/* View toggle */}
            <div className="flex items-center gap-0.5 p-1 bg-gray-100 rounded-lg">
              <button onClick={() => setDisplayMode('table')} title="Table view"
                className={`p-1.5 rounded-md transition-colors ${displayMode === 'table' ? 'bg-white shadow-sm text-primary' : 'text-gray-400 hover:text-gray-600'}`}>
                <LayoutList className="w-4 h-4" />
              </button>
              <button onClick={() => setDisplayMode('cards')} title="Card view"
                className={`p-1.5 rounded-md transition-colors ${displayMode === 'cards' ? 'bg-white shadow-sm text-primary' : 'text-gray-400 hover:text-gray-600'}`}>
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
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
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
            </FilterGroup>
            <FilterGroup label="To">
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputCls} />
            </FilterGroup>
            <FilterGroup label="From Category" className="min-w-[180px]">
              <select value={accountFrom} onChange={e => setAccountFrom(e.target.value)} className={`${inputCls} bg-white`}>
                <option value="">All categories</option>
                {categories.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </FilterGroup>
            <FilterGroup label="To Category" className="min-w-[180px]">
              <select value={accountTo} onChange={e => setAccountTo(e.target.value)} className={`${inputCls} bg-white`}>
                <option value="">All categories</option>
                {categories.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            </FilterGroup>
            <FilterGroup label="Search" className="flex-1 min-w-[160px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text" placeholder="Search description…" value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  className={`${inputCls} pl-9`}
                />
              </div>
            </FilterGroup>
            {hasActiveFilters && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setAccountFrom(''); setAccountTo(''); setSearchInput('') }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </Card>

        {/* Summary strip */}
        <SummaryStrip total={total} count={count} largest={largest} average={average} loading={loading} />

        {/* Table / Card view */}
        <Card padding={false}>
          {displayMode === 'cards' ? (
            <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3 animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-2/3" />
                    <div className="h-6 bg-gray-200 rounded w-1/2" />
                    <div className="h-4 bg-gray-200 rounded" />
                  </div>
                ))
              ) : data.length === 0 ? (
                <div className="col-span-full py-16 text-center text-gray-400">
                  <ArrowLeftRight className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm">No internal transfers match your filters.</p>
                </div>
              ) : (
                data.map(row => (
                  <div key={row.id} className="rounded-xl border border-gray-100 bg-white p-4 space-y-3 hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-500">{formatDate(row.date)}</span>
                      <span className="text-base font-bold text-primary">{formatCurrency(Number(row.total_amount))}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-700">
                      <span className="font-medium truncate max-w-[100px]">{row.account_from ?? '—'}</span>
                      <ArrowLeftRight className="w-3 h-3 text-gray-400 shrink-0" />
                      <span className="font-medium truncate max-w-[100px]">{row.account_to ?? '—'}</span>
                    </div>
                    {row.description && (
                      <div className="text-xs text-gray-500">
                        <DescriptionCell id={`card-desc-${row.id}`} text={row.description} expanded={descExpanded.has(`card-desc-${row.id}`)} onToggle={() => toggleDesc(`card-desc-${row.id}`)} tooltip={descTooltip} setTooltip={setDescTooltip} />
                      </div>
                    )}
                    {row.remark     && (
                      <div className="text-xs text-gray-400 italic">
                        <DescriptionCell id={`card-rem-${row.id}`} text={row.remark} expanded={descExpanded.has(`card-rem-${row.id}`)} onToggle={() => toggleDesc(`card-rem-${row.id}`)} tooltip={descTooltip} setTooltip={setDescTooltip} />
                      </div>
                    )}
                    {(canWrite() || canDelete()) && (
                      <div className="flex gap-1 pt-1 border-t border-gray-50">
                        {canWrite() && (
                          <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors">
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                        {canDelete() && (
                          <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Date', 'From Category', 'To Category', 'Amount (₦)', 'From Stage', 'To Stage', 'Remark', 'Actions'].map(h => (
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
                  ) : data.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-gray-400">
                          <ArrowLeftRight className="w-10 h-10 text-gray-200" />
                          <p className="text-sm">No internal transfers match your filters.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    data.map(row => (
                      <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.account_from ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.account_to ?? '—'}</td>
                        <td className="px-4 py-3 text-sm font-semibold text-primary whitespace-nowrap">{formatCurrency(Number(row.total_amount))}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{row.account_from_stage1 ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{row.account_to_stage1 ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px]">
                          <DescriptionCell id={`rem-${row.id}`} text={row.remark} expanded={descExpanded.has(`rem-${row.id}`)} onToggle={() => toggleDesc(`rem-${row.id}`)} tooltip={descTooltip} setTooltip={setDescTooltip} />
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
          <Pagination page={page} pageSize={PAGE_SIZE} total={count} onChange={setPage} />
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

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

function FilterGroup({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-xs font-medium text-gray-500">{label}</label>
      {children}
    </div>
  )
}
