import { useState, useEffect, useMemo } from 'react'
import {
  TrendingDown, Download, Pencil, Trash2,
  Search, AlertCircle, RefreshCw,
} from 'lucide-react'
import { Card }                    from '../components/ui/Card'
import { Modal }                   from '../components/ui/Modal'
import { Pagination }              from '../components/ui/Pagination'
import { DeleteDialog }            from '../components/ui/DeleteDialog'
import { AddOutflowModal }         from '../components/modals/AddOutflowModal'
import { ReceiptBadge }            from '../components/ui/ReceiptBadge'
import { ViewToggle, useViewToggle } from '../components/ui/ViewToggle'
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

  // Data
  const { data, count, loading, error, refetch } = useOutflowTransactions({
    dateFrom:  dateFrom  || undefined,
    dateTo:    dateTo    || undefined,
    stageCode: stageCode || undefined,
    search:    debouncedSearch || undefined,
    page,
    pageSize:  PAGE_SIZE,
  })

  // Summary (disbursed amounts)
  const total   = useMemo(() => data.reduce((s, r) => s + Number(r.amount_disbursed), 0), [data])
  const largest = useMemo(() => data.length ? Math.max(...data.map(r => Number(r.amount_disbursed))) : 0, [data])
  const average = useMemo(() => data.length ? total / data.length : 0, [total, data.length])

  const { view: displayMode, setView: setDisplayMode } = useViewToggle('outflows-view')

  // UI state
  const [editRecord,        setEditRecord]        = useState<OutflowTransaction | null>(null)
  const [modalOpen,         setModalOpen]         = useState(false)
  const [deleteId,          setDeleteId]          = useState<string | null>(null)
  const [selectedIds,       setSelectedIds]       = useState<Set<string>>(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkDeleting,      setBulkDeleting]      = useState(false)
  const [bulkEditOpen,      setBulkEditOpen]      = useState(false)

  const { expandedIds: descExpanded, tooltip: descTooltip, setTooltip: setDescTooltip, toggle: toggleDesc } = useDescriptionExpand()
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
            <ViewToggle storageKey="outflows-view" value={displayMode} onChange={setDisplayMode} />
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
            <FilterGroup label="Search" className="flex-1 min-w-[180px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text" placeholder="Search description…" value={searchInput}
                  onChange={e => setSearchInput(e.target.value)}
                  className={`${filterInputCls} pl-9`}
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
              <div className="col-span-full">
                <EmptyState icon={TrendingDown} title="No outflow transactions" message="No transactions match your filters." compact />
              </div>
            ) : data.map(row => {
              const net = Number(row.amount_disbursed) - Number(row.amount_refunded) - Number(row.transfer_charge)
              return (
                <div key={row.id} className="rounded-xl border border-gray-100 bg-white p-4 space-y-2 hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs text-gray-500">{formatDate(row.date)}</span>
                      {row.bank_name && (
                        <span className="ml-2 text-xs text-gray-400">{row.bank_name}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
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
                  <p className="text-lg font-bold text-danger">{formatCurrency(Number(row.amount_disbursed))}</p>
                  <div className="text-sm text-gray-700">
                    <DescriptionCell id={`card-${row.id}`} text={row.description} expanded={descExpanded.has(`card-${row.id}`)} onToggle={() => toggleDesc(`card-${row.id}`)} tooltip={descTooltip} setTooltip={setDescTooltip} />
                  </div>
                  {row.stage_code_1 && <p className="text-xs text-gray-400">{row.stage_code_1}</p>}
                  {row.remarks && <p className="text-xs text-gray-400 italic truncate">{row.remarks}</p>}
                  {net !== Number(row.amount_disbursed) && (
                    <p className="text-xs text-gray-500">Net: {formatCurrency(net)}</p>
                  )}
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
                  {([
                    ['Date', false], ['Recorded', false], ['Bank', false], ['Txn ID', false],
                    ['Description', false], ['Disbursed (₦)', true], ['Refunded (₦)', true],
                    ['Net (₦)', true], ['Stage Code 1', false], ['Remarks', false], ['📎', false], ['Actions', false],
                  ] as [string, boolean][]).map(([h, right]) => (
                    <th key={h} className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
                      {h}
                    </th>
                  ))}
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
                  data.map(row => {
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
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{row.transaction_id ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-800 max-w-[180px]">
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
                            <DescriptionCell id={row.id} text={row.description} expanded={descExpanded.has(row.id)} onToggle={() => toggleDesc(row.id)} tooltip={descTooltip} setTooltip={setDescTooltip} />
                          </div>
                        </td>
                        <AmountCell value={Number(row.amount_disbursed)} mode="outflow" />
                        <AmountCell value={Number(row.amount_refunded)} mode="neutral" bold={false} />
                        <AmountCell value={net} mode="neutral" />
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.stage_code_1 ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px]">
                          <DescriptionCell id={`rem-${row.id}`} text={row.remarks} expanded={descExpanded.has(`rem-${row.id}`)} onToggle={() => toggleDesc(`rem-${row.id}`)} tooltip={descTooltip} setTooltip={setDescTooltip} />
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
          <Pagination page={page} pageSize={PAGE_SIZE} total={count} onChange={setPage} />
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
    if (!open) return
    setBankName('')
    setRecordedAt('')
    setTxnType('')
    setStageCode1('')
    setStageCode2('')
  }, [open])

  const hasChanges = !!bankName || !!recordedAt || !!txnType || !!stageCode1 || !!stageCode2

  const MISSING_COL_RE = /Could not find (?:the ')?(\w+)'? column/

  const handleApply = async () => {
    if (!hasChanges) return
    setSaving(true)
    let updates: Record<string, unknown> = {}
    if (bankName)   updates.bank_name        = bankName
    if (recordedAt) updates.recorded_at      = `${recordedAt}T00:00:00.000Z`
    if (txnType)    updates.transaction_type  = txnType
    if (stageCode1) updates.stage_code_1     = stageCode1
    if (stageCode2) updates.stage_code_2     = stageCode2
    let failed = 0
    const strippedCols: string[] = []
    for (const id of ids) {
      try {
        await update({ id, updates })
      } catch (err: unknown) {
        const col = (err instanceof Error ? err.message : '').match(MISSING_COL_RE)?.[1]
        if (col && col in updates) {
          const stripped = { ...updates }
          delete stripped[col]
          updates = stripped
          if (!strippedCols.includes(col)) strippedCols.push(col)
          try { await update({ id, updates }) } catch { failed++ }
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
