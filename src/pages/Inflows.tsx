import { useState, useEffect, useMemo } from 'react'
import {
  TrendingUp, Download, Pencil, Trash2,
  ChevronDown, ChevronRight, Search, AlertCircle, RefreshCw,
  LayoutList, LayoutGrid,
} from 'lucide-react'
import { Card }                    from '../components/ui/Card'
import { Pagination }              from '../components/ui/Pagination'
import { DeleteDialog }            from '../components/ui/DeleteDialog'
import { AddInflowModal }          from '../components/modals/AddInflowModal'
import { useInflowTransactions, type InflowTransaction } from '../hooks/useTransactions'
import { useDeleteTransaction }    from '../hooks/useMutations'
import { useToastStore }           from '../store/toastStore'
import { useRole }                 from '../hooks/useRole'
import { usePageTitle }            from '../hooks/usePageTitle'
import { formatDate, formatCurrency, formatCurrencyCompact } from '../utils/formatters'
import { exportCSV }               from '../utils/csvExport'
import { useYearRange }            from '../hooks/useYearRange'
import { useIncomeTypes }          from '../hooks/useIncomeTypes'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'

const PAGE_SIZE = 25

const TXN_TYPE_LABELS: Record<string, string> = {
  refund:              'Refund',
  reversal:            'Reversal',
  bank_deposit:        'Bank Deposit',
  intrabank_transfer:  'Intrabank Transfer',
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

  useEffect(() => { setPage(0) }, [dateFrom, dateTo, debouncedSearch])

  // Reset to new year range when accounting year changes
  useEffect(() => {
    setDateFrom(`${year}-01-01`)
    setDateTo(`${year}-12-31`)
    setPage(0)
  }, [year])

  // Data
  const { data, count, loading, error, refetch } = useInflowTransactions({
    dateFrom:  dateFrom  || undefined,
    dateTo:    dateTo    || undefined,
    search:    debouncedSearch || undefined,
    page,
    pageSize:  PAGE_SIZE,
  })

  // Summary
  const total   = useMemo(() => data.reduce((s, r) => s + Number(r.amount), 0), [data])
  const largest = useMemo(() => data.length ? Math.max(...data.map(r => Number(r.amount))) : 0, [data])
  const average = useMemo(() => data.length ? total / data.length : 0, [total, data.length])

  // UI state
  const [editRecord,  setEditRecord]  = useState<InflowTransaction | null>(null)
  const [modalOpen,   setModalOpen]   = useState(false)
  const [deleteId,    setDeleteId]    = useState<string | null>(null)
  const [expandedId,  setExpandedId]  = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<'table' | 'cards'>('table')
  const { expandedIds: descExpanded, tooltip: descTooltip, setTooltip: setDescTooltip, toggle: toggleDesc } = useDescriptionExpand()

  const { push: toast }                             = useToastStore()
  const { canWrite, canDelete }                     = useRole()
  const { mutate: deleteRecord, loading: deleting } = useDeleteTransaction('inflow_transactions')
  const { incomeTypes } = useIncomeTypes()

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

  const handleExport = () => {
    exportCSV(
      `inflows-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Date', 'Description', 'Amount (₦)', 'Stage Code 2', 'Specific Seed', 'Txn Ref', 'Remark'],
      data.map(r => [
        r.date, r.description, r.amount,
        r.stage_code_2, r.specific_seed_description, r.transaction_ref, r.remark,
      ]),
    )
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
            <FilterGroup label="Search" className="flex-1 min-w-[180px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text" placeholder="Search description…" value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  className={`${inputCls} pl-9`}
                />
              </div>
            </FilterGroup>
            {(dateFrom || dateTo || searchInput) && (
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
        <SummaryStrip total={total} count={count} largest={largest} average={average} loading={loading} />

        {/* Cards / Table */}
        {displayMode === 'cards' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-2/3" /><div className="h-6 bg-gray-200 rounded w-1/2" />
                </div>
              ))
            ) : data.length === 0 ? (
              <div className="col-span-full py-16 text-center text-gray-400">
                <TrendingUp className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm">No inflow transactions match your filters.</p>
              </div>
            ) : data.map(row => {
              const it = incomeTypes.find(t => t.id === row.income_type_id)
              return (
                <div key={row.id} className="rounded-xl border border-gray-100 bg-white p-4 space-y-2 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{formatDate(row.date)}</span>
                    <div className="flex items-center gap-1">
                      {it && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ backgroundColor: `${it.color}22`, color: it.color }}>{it.name}</span>
                      )}
                      {row.transaction_type && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 whitespace-nowrap">
                          {TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-lg font-bold text-success">{formatCurrency(Number(row.amount))}</p>
                  <div className="text-sm text-gray-700">
                    <DescriptionCell id={`card-${row.id}`} text={row.description} expanded={descExpanded.has(`card-${row.id}`)} onToggle={() => toggleDesc(`card-${row.id}`)} tooltip={descTooltip} setTooltip={setDescTooltip} />
                  </div>
                  {row.remark && <p className="text-xs text-gray-400 italic truncate">{row.remark}</p>}
                  <div className="flex gap-1 pt-1 border-t border-gray-50">
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
              )
            })}
          </div>
        ) : null}
        {displayMode === 'cards' && <Pagination page={page} pageSize={PAGE_SIZE} total={count} onChange={setPage} />}

        {displayMode === 'table' && <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="w-8" />
                  {['Date', 'Recorded', 'Type', 'Description', 'Amount (₦)', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-200 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : data.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-gray-400">
                        <TrendingUp className="w-10 h-10 text-gray-200" />
                        <p className="text-sm">No inflow transactions match your filters.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  data.flatMap(row => {
                    const expanded = expandedId === row.id
                    const rows = [
                      <tr
                        key={row.id}
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => row.remark && setExpandedId(expanded ? null : row.id)}
                      >
                        <td className="pl-3 pr-0 py-3 text-gray-400 w-8">
                          {row.remark
                            ? (expanded
                              ? <ChevronDown className="w-4 h-4" />
                              : <ChevronRight className="w-4 h-4" />)
                            : null}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {row.recorded_at ? formatDate(row.recorded_at.slice(0, 10)) : '—'}
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
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-slate-100 text-slate-500">
                                {TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type}
                              </span>
                            ) : null}
                            {!incomeTypes.find(t => t.id === row.income_type_id) && !row.transaction_type && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap bg-gray-100 text-gray-400">—</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-800 max-w-[200px]" onClick={e => e.stopPropagation()}>
                          <DescriptionCell id={row.id} text={row.description} expanded={descExpanded.has(row.id)} onToggle={() => toggleDesc(row.id)} tooltip={descTooltip} setTooltip={setDescTooltip} />
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-success whitespace-nowrap">{formatCurrency(Number(row.amount))}</td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
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
                      </tr>,
                    ]
                    if (expanded && row.remark) {
                      rows.push(
                        <tr key={`${row.id}-exp`} className="bg-blue-50/40">
                          <td colSpan={7} className="px-8 py-3">
                            <p className="text-xs font-semibold text-gray-500 mb-0.5">Remark</p>
                            <p className="text-sm text-gray-700">{row.remark}</p>
                          </td>
                        </tr>,
                      )
                    }
                    return rows
                  })
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={count} onChange={setPage} />
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
