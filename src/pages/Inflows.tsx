import { useState, useEffect, useMemo } from 'react'
import {
  TrendingUp, Plus, Download, Pencil, Trash2,
  ChevronDown, ChevronRight, Search, AlertCircle, RefreshCw, FileSpreadsheet,
} from 'lucide-react'
import { Card }                    from '../components/ui/Card'
import { Pagination }              from '../components/ui/Pagination'
import { DeleteDialog }            from '../components/ui/DeleteDialog'
import { AddInflowModal }          from '../components/modals/AddInflowModal'
import { ImportModal }             from '../components/modals/ImportModal'
import { CanWrite }                from '../components/auth/RoleGates'
import { useInflowTransactions, type InflowTransaction } from '../hooks/useTransactions'
import { useDeleteTransaction }    from '../hooks/useMutations'
import { useToastStore }           from '../store/toastStore'
import { useRole }                 from '../hooks/useRole'
import { usePageTitle }            from '../hooks/usePageTitle'
import { formatDate, formatCurrency, formatCurrencyCompact } from '../utils/formatters'
import { exportCSV }               from '../utils/csvExport'
import { ACCOUNT_NAMES, accountLabel } from '../utils/accountNames'

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

export default function Inflows() {
  // Filters
  const [dateFrom,        setDateFrom]        = useState('')
  const [dateTo,          setDateTo]          = useState('')
  const [stageCode,       setStageCode]       = useState('')
  const [searchInput,     setSearchInput]     = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [page,            setPage]            = useState(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 400)
    return () => clearTimeout(t)
  }, [searchInput])

  useEffect(() => { setPage(0) }, [dateFrom, dateTo, stageCode, debouncedSearch])

  // Data
  const { data, count, loading, error, refetch } = useInflowTransactions({
    dateFrom:  dateFrom  || undefined,
    dateTo:    dateTo    || undefined,
    stageCode: stageCode || undefined,
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
  const [importOpen,  setImportOpen]  = useState(false)

  const { push: toast }                             = useToastStore()
  const { canWrite, canDelete }                     = useRole()
  const { mutate: deleteRecord, loading: deleting } = useDeleteTransaction('inflow_transactions')

  usePageTitle('Inflows')

  const openAdd  = () => { setEditRecord(null); setModalOpen(true) }
  const openEdit = (r: InflowTransaction) => { setEditRecord(r); setModalOpen(true) }

  // Keyboard shortcut: Ctrl+N / Cmd+N opens Add modal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && canWrite()) {
        e.preventDefault()
        openAdd()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [canWrite])

  const handleModalSuccess = () => {
    toast(editRecord ? 'Transaction updated' : 'Inflow added successfully', 'success')
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
      ['Date', 'Description', 'Amount (₦)', 'Stage Code 1', 'Stage Code 2', 'Specific Seed', 'Txn Ref', 'Remark'],
      data.map(r => [
        r.date, r.description, r.amount, r.stage_code_1,
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
            <button
              onClick={handleExport} disabled={data.length === 0}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
            >
              <Download className="w-4 h-4" /> Export CSV
            </button>
            <CanWrite>
              <button
                onClick={openAdd}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-success rounded-lg hover:bg-green-700 transition-colors"
              >
                <Plus className="w-4 h-4" /> Add Inflow
              </button>
            </CanWrite>
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
            <FilterGroup label="Stage Code" className="min-w-[200px]">
              <select value={stageCode} onChange={e => setStageCode(e.target.value)} className={`${inputCls} bg-white`}>
                <option value="">All accounts</option>
                {ACCOUNT_NAMES.map(a => (
                  <option key={a.code} value={a.code}>{a.code} — {a.name}</option>
                ))}
              </select>
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
            {(dateFrom || dateTo || stageCode || searchInput) && (
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

        {/* Table */}
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="w-8" />
                  {['Date', 'Description', 'Stage Code 1', 'Stage Code 2', 'Specific Seed', 'Amount (₦)', 'Actions'].map(h => (
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
                        <td className="px-4 py-3 text-sm text-gray-800 max-w-[200px] truncate">{row.description ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.stage_code_1 ? accountLabel(row.stage_code_1) : '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{row.stage_code_2 ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-[140px] truncate">{row.specific_seed_description ?? '—'}</td>
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
                          <td colSpan={8} className="px-8 py-3">
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
        </Card>
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
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />

      {/* Floating import button */}
      <CanWrite>
        <button
          onClick={() => setImportOpen(true)}
          className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-3 bg-accent text-white text-sm font-medium rounded-full shadow-lg hover:bg-accent/90 transition-colors"
          title="Import from Excel"
        >
          <FileSpreadsheet className="w-4 h-4" /> Import Excel
        </button>
      </CanWrite>
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
