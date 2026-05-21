import { useState, useEffect, useMemo } from 'react'
import { useYearRange } from '../hooks/useYearRange'
import { Clock, CheckCircle2, Pencil, AlertCircle, RefreshCw, Terminal } from 'lucide-react'
import { Card }                     from '../components/ui/Card'
import { DataControlsBar }          from '../components/ui/DataControlsBar'
import { SortableHeader }           from '../components/ui/SortableHeader'
import { PaginationBar }            from '../components/ui/PaginationBar'
import { useDataViewState }         from '../hooks/useDataViewState'
import { sortRows, multiSortRows }  from '../utils/sortUtils'
import type { SortField }           from '../utils/sortUtils'
import { AddOutflowModal }          from '../components/modals/AddOutflowModal'
import { CanWrite }                 from '../components/auth/RoleGates'
import { useOutflowTransactions, type OutflowTransaction } from '../hooks/useTransactions'
import { useUpdateTransaction }     from '../hooks/useMutations'
import { useToastStore }            from '../store/toastStore'
import { usePageTitle }             from '../hooks/usePageTitle'
import { formatDate, formatCurrency, formatCurrencyCompact } from '../utils/formatters'

// ── Sort / search config ───────────────────────────────────────────────────────

const PD_SORT_FIELDS: SortField[] = [
  { key: 'date',             label: 'Date',      type: 'date',    primary: true },
  { key: 'amount_disbursed', label: 'Disbursed', type: 'numeric', primary: true },
]

const PD_SEARCH_COLS = [
  { key: 'all',         label: 'All Columns' },
  { key: 'description', label: 'Description' },
  { key: 'bank_name',   label: 'Bank' },
]

// ── Column value helper ────────────────────────────────────────────────────────

function pdColVal(r: OutflowTransaction, col: string): string {
  if (col === 'description') return r.description ?? ''
  if (col === 'bank_name')   return r.bank_name ?? ''
  return ''
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function PendingDeductions() {
  const { dateFrom, dateTo } = useYearRange()

  const pdState = useDataViewState({ storageKey: 'pd', defaultSortKey: 'date', defaultSortDir: 'desc' })

  const [editRecord, setEditRecord] = useState<OutflowTransaction | null>(null)
  const [modalOpen, setModalOpen]   = useState(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const { data, count, loading, error, refetch } = useOutflowTransactions({
    pendingOnly: true,
    dateFrom,
    dateTo,
    page: pdState.page,
    pageSize: pdState.pageSize,
  })

  const total   = useMemo(() => data.reduce((s, r) => s + Number(r.amount_disbursed), 0), [data])
  const largest = useMemo(() => data.length ? Math.max(...data.map(r => Number(r.amount_disbursed))) : 0, [data])

  const { push: toast } = useToastStore()
  const updateMutation = useUpdateTransaction('outflow_transactions')

  usePageTitle('Pending Deductions')

  // Reset page when search changes
  useEffect(() => { pdState.setPage(0) }, [pdState.search, pdState.setPage])

  // Sort
  const getPdValue = (r: OutflowTransaction, k: string) => {
    if (k === 'amount_disbursed') return Number(r.amount_disbursed)
    return r.date
  }
  const sorted = useMemo(() => {
    const adv = pdState.advancedSort
    if (adv.length > 0) return multiSortRows(data, getPdValue, adv, PD_SORT_FIELDS)
    return sortRows(data, getPdValue, pdState.sortKey, pdState.sortDir, PD_SORT_FIELDS)
  }, [data, pdState.sortKey, pdState.sortDir, pdState.advancedSort])

  // Search filter (client-side — pending list is small)
  const displayed = useMemo(() => {
    const q = pdState.search.trim().toLowerCase()
    const col = pdState.searchCol
    if (!q || col === 'all') return sorted
    return sorted.filter(r => pdColVal(r, col).toLowerCase().includes(q))
  }, [sorted, pdState.search, pdState.searchCol])

  const handleResolve = async (row: OutflowTransaction) => {
    if (!row.stage_code_1?.trim() || !row.stage_code_2?.trim()) {
      toast('Fill in both stage codes before resolving', 'error')
      openEdit(row)
      return
    }
    setResolvingId(row.id)
    try {
      await updateMutation.mutate({
        id: row.id,
        updates: { is_pending_deduction: false },
      })
      toast('Transaction marked as resolved', 'success')
      refetch()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Update failed', 'error')
    } finally {
      setResolvingId(null)
    }
  }

  const openEdit = (r: OutflowTransaction) => { setEditRecord(r); setModalOpen(true) }

  const handleModalSuccess = () => {
    toast('Transaction updated', 'success')
    refetch()
  }

  if (error) {
    const isMissingCol = error.includes('is_pending_deduction') || error.includes('column')
    return (
      <div className="space-y-4 max-w-2xl">
        <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            {isMissingCol ? (
              <>
                <p className="font-semibold">Database migration required</p>
                <p className="mt-0.5 text-amber-700">
                  The <code className="font-mono bg-amber-100 px-1 rounded">is_pending_deduction</code> column
                  is missing from <code className="font-mono bg-amber-100 px-1 rounded">outflow_transactions</code>.
                  Run the SQL below in your Supabase SQL Editor, then click Retry.
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold">Failed to load pending deductions</p>
                <p className="mt-0.5 text-amber-700">{error}</p>
              </>
            )}
          </div>
        </div>
        {isMissingCol && (
          <div className="rounded-xl border border-gray-200 bg-gray-900 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 bg-gray-800 border-b border-gray-700">
              <Terminal className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-xs text-gray-400 font-mono">Supabase SQL Editor</span>
            </div>
            <pre className="px-4 py-4 text-xs text-green-300 font-mono overflow-x-auto whitespace-pre">{
`ALTER TABLE outflow_transactions
  ADD COLUMN IF NOT EXISTS is_pending_deduction boolean NOT NULL DEFAULT false;`
            }</pre>
          </div>
        )}
        <button onClick={refetch} className="flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-5">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Clock className="w-6 h-6 text-amber-500" />
            Pending Deductions
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Outflow transactions awaiting deduction from the account — {count} pending
          </p>
        </div>

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Pending Count',  value: count.toLocaleString() },
            { label: 'Total (page)',   value: formatCurrencyCompact(total) },
            { label: 'Largest',        value: formatCurrencyCompact(largest) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-white rounded-xl border border-amber-100 shadow-sm px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              {loading
                ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
                : <p className="text-lg font-bold text-amber-700">{value}</p>}
            </div>
          ))}
        </div>

        {/* Controls */}
        <DataControlsBar
          sortFields={PD_SORT_FIELDS}
          sortKey={pdState.sortKey}
          sortDir={pdState.sortDir}
          onSort={pdState.setSort}
          defaultSortKey="date"
          defaultSortDir="desc"
          search={pdState.search}
          onSearchChange={pdState.setSearch}
          searchColumns={PD_SEARCH_COLS}
          searchCol={pdState.searchCol}
          onSearchColChange={pdState.setSearchCol}
          advancedSort={pdState.advancedSort}
          onAdvancedSort={pdState.setAdvancedSort}
          pageSize={pdState.pageSize}
          onPageSizeChange={pdState.setPageSize}
        />

        {/* Table */}
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <SortableHeader field={PD_SORT_FIELDS[0]} activeSortKey={pdState.sortKey} activeSortDir={pdState.sortDir} onSort={pdState.setSort} className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" />
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Description</th>
                  <SortableHeader field={PD_SORT_FIELDS[1]} activeSortKey={pdState.sortKey} activeSortDir={pdState.sortDir} onSort={pdState.setSort} className="px-4 py-3 text-xs font-semibold uppercase tracking-wider" />
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Transfer Charge (₦)</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Net (₦)</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Stage Code</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Remarks</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
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
                    <td colSpan={8} className="py-20 text-center">
                      <div className="flex flex-col items-center gap-2 text-gray-400">
                        <CheckCircle2 className="w-10 h-10 text-green-300" />
                        <p className="text-sm font-medium text-gray-600">No pending deductions</p>
                        <p className="text-xs text-gray-400">All outflow transactions have been processed.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  displayed.map(row => {
                    const net = Number(row.amount_disbursed) - Number(row.amount_refunded) - Number(row.transfer_charge)
                    const isResolving = resolvingId === row.id
                    return (
                      <tr key={row.id} className="hover:bg-amber-50/30 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                        <td className="px-4 py-3 text-sm text-gray-800 max-w-[200px] truncate" title={row.description ?? undefined}>
                          {row.description ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-danger whitespace-nowrap">{formatCurrency(Number(row.amount_disbursed))}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {Number(row.transfer_charge) > 0 ? formatCurrency(Number(row.transfer_charge)) : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-700 whitespace-nowrap">{formatCurrency(net)}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.stage_code_1 ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px] truncate" title={row.remarks ?? undefined}>{row.remarks ?? '—'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <CanWrite>
                              <button
                                onClick={() => openEdit(row)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
                                title="Edit"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleResolve(row)}
                                disabled={isResolving}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-50"
                                title="Mark as resolved"
                              >
                                {isResolving
                                  ? <span className="w-3.5 h-3.5 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                                  : <CheckCircle2 className="w-3.5 h-3.5" />}
                                Resolve
                              </button>
                            </CanWrite>
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
            page={pdState.page}
            pageSize={pdState.pageSize}
            total={count}
            onPageChange={pdState.setPage}
            variant="full"
          />
        </Card>
      </div>

      <AddOutflowModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={handleModalSuccess}
        editRecord={editRecord}
      />
    </>
  )
}
