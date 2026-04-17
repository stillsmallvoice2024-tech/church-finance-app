import { useState, useMemo } from 'react'
import { useYearRange } from '../hooks/useYearRange'
import { Clock, CheckCircle2, Pencil, AlertCircle, RefreshCw } from 'lucide-react'
import { Card }                     from '../components/ui/Card'
import { Pagination }               from '../components/ui/Pagination'
import { AddOutflowModal }          from '../components/modals/AddOutflowModal'
import { CanWrite }                 from '../components/auth/RoleGates'
import { useOutflowTransactions, type OutflowTransaction } from '../hooks/useTransactions'
import { useUpdateTransaction }     from '../hooks/useMutations'
import { useToastStore }            from '../store/toastStore'
import { usePageTitle }             from '../hooks/usePageTitle'
import { useAccountCodesStore }     from '../store/accountCodesStore'
import { formatDate, formatCurrency, formatCurrencyCompact } from '../utils/formatters'

const PAGE_SIZE = 25

export default function PendingDeductions() {
  const { dateFrom, dateTo } = useYearRange()
  const [page, setPage] = useState(0)
  const [editRecord, setEditRecord] = useState<OutflowTransaction | null>(null)
  const [modalOpen, setModalOpen]   = useState(false)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const { data, count, loading, error, refetch } = useOutflowTransactions({
    pendingOnly: true,
    dateFrom,
    dateTo,
    page,
    pageSize: PAGE_SIZE,
  })

  const total   = useMemo(() => data.reduce((s, r) => s + Number(r.amount_disbursed), 0), [data])
  const largest = useMemo(() => data.length ? Math.max(...data.map(r => Number(r.amount_disbursed))) : 0, [data])

  const { push: toast } = useToastStore()
  const { getLabel: accountLabel } = useAccountCodesStore()
  const updateMutation = useUpdateTransaction('outflow_transactions')

  usePageTitle('Pending Deductions')

  const handleResolve = async (row: OutflowTransaction) => {
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

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load pending deductions</p>
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

        {/* Table */}
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Date', 'Description', 'Disbursed (₦)', 'Transfer Charge (₦)', 'Net (₦)', 'Stage Code', 'Remarks', 'Actions'].map(h => (
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
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-200 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : data.length === 0 ? (
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
                  data.map(row => {
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
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{row.stage_code_1 ? accountLabel(row.stage_code_1) : '—'}</td>
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
          <Pagination page={page} pageSize={PAGE_SIZE} total={count} onChange={setPage} />
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
