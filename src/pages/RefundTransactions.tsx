import { useState, useEffect } from 'react'
import { RotateCcw, LayoutGrid, LayoutList, AlertCircle, RefreshCw } from 'lucide-react'
import { Card }            from '../components/ui/Card'
import { usePageTitle }    from '../hooks/usePageTitle'
import { supabase }        from '../lib/supabase'
import { formatDate, formatCurrency } from '../utils/formatters'

interface TxnRow {
  id:                      string
  date:                    string
  direction:               'in' | 'out'
  amount:                  number
  description:             string | null
  original_transaction_id: string | null
  bank_name:               string | null
  remarks:                 string | null
}

export default function RefundTransactions() {
  usePageTitle('Refunds')

  const [rows,        setRows]        = useState<TxnRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<'table' | 'cards'>('table')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')

  const load = async () => {
    setLoading(true)
    setError(null)

    const [inflowRes, outflowRes] = await Promise.all([
      supabase.from('inflow_transactions')
        .select('id, date, amount, description, original_transaction_id, bank_name, remark')
        .eq('transaction_type', 'refund')
        .order('date', { ascending: false }),
      supabase.from('outflow_transactions')
        .select('id, date, amount_disbursed, description, original_transaction_id, bank_name, remarks')
        .eq('transaction_type', 'refund')
        .order('date', { ascending: false }),
    ])

    if (inflowRes.error || outflowRes.error) {
      setError((inflowRes.error ?? outflowRes.error)!.message)
      setLoading(false)
      return
    }

    const merged: TxnRow[] = [
      ...(inflowRes.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, date: r.date as string, direction: 'in' as const,
        amount: r.amount as number,
        description: r.description as string | null,
        original_transaction_id: r.original_transaction_id as string | null,
        bank_name: r.bank_name as string | null,
        remarks: r.remark as string | null,
      })),
      ...(outflowRes.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, date: r.date as string, direction: 'out' as const,
        amount: r.amount_disbursed as number,
        description: r.description as string | null,
        original_transaction_id: r.original_transaction_id as string | null,
        bank_name: r.bank_name as string | null,
        remarks: r.remarks as string | null,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date))

    setRows(merged)
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = rows.filter(r => {
    if (dateFrom && r.date < dateFrom) return false
    if (dateTo   && r.date > dateTo)   return false
    return true
  })

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load refunds</p>
      <p className="text-sm text-gray-500">{error}</p>
      <button onClick={load} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Refund Transactions</h1>
          <p className="text-sm text-gray-500 mt-0.5">Inflow and outflow rows tagged as refunds</p>
        </div>
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
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputCls} />
          </div>
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo('') }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              Clear
            </button>
          )}
        </div>
      </Card>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'Total rows',    value: filtered.length.toLocaleString() },
          { label: 'Total inflow',  value: formatCurrency(filtered.filter(r => r.direction === 'in').reduce((s, r) => s + r.amount, 0)) },
          { label: 'Total outflow', value: formatCurrency(filtered.filter(r => r.direction === 'out').reduce((s, r) => s + r.amount, 0)) },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
            <p className="text-xs text-gray-500 mb-1">{label}</p>
            {loading
              ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
              : <p className="text-lg font-bold text-gray-900">{value}</p>}
          </div>
        ))}
      </div>

      {/* Table / Cards */}
      <Card padding={false}>
        {displayMode === 'cards' ? (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-3 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-2/3" /><div className="h-6 bg-gray-200 rounded w-1/2" />
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div className="col-span-full py-16 text-center text-gray-400">
                <RotateCcw className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm">No refund transactions found.</p>
              </div>
            ) : filtered.map(row => (
              <div key={row.id} className="rounded-xl border border-gray-100 bg-white p-4 space-y-2 hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">{formatDate(row.date)}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${row.direction === 'in' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {row.direction === 'in' ? 'Inflow' : 'Outflow'}
                  </span>
                </div>
                <p className="text-base font-bold text-gray-900">{formatCurrency(row.amount)}</p>
                {row.description && <p className="text-xs text-gray-600 truncate">{row.description}</p>}
                {row.bank_name   && <p className="text-xs text-gray-400">{row.bank_name}</p>}
                {row.original_transaction_id && (
                  <p className="text-xs text-gray-500">Orig ID: <span className="font-mono">{row.original_transaction_id}</span></p>
                )}
                {row.remarks && <p className="text-xs text-gray-400 italic truncate">{row.remarks}</p>}
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Date', 'Direction', 'Amount (₦)', 'Description', 'Bank', 'Original Txn ID', 'Remarks'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
                    ))}</tr>
                  ))
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <RotateCcw className="w-10 h-10 text-gray-200" />
                      <p className="text-sm">No refund transactions found.</p>
                    </div>
                  </td></tr>
                ) : filtered.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${row.direction === 'in' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {row.direction === 'in' ? 'Inflow' : 'Outflow'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(row.amount)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 max-w-[200px] truncate">{row.description ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{row.bank_name ?? '—'}</td>
                    <td className="px-4 py-3 text-sm font-mono text-gray-500 max-w-[160px] truncate">{row.original_transaction_id ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px] truncate">{row.remarks ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'
