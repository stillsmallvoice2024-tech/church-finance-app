import { useState, useEffect, useCallback } from 'react'
import { BookOpen, LayoutGrid, LayoutList, AlertCircle, RefreshCw, Pencil } from 'lucide-react'
import { Card }          from '../components/ui/Card'
import { usePageTitle }  from '../hooks/usePageTitle'
import { useBanks }      from '../hooks/useBanks'
import { useRole }       from '../hooks/useRole'
import { supabase }      from '../lib/supabase'
import { ReceiptBadge }  from '../components/ui/ReceiptBadge'
import { formatDate, formatCurrency } from '../utils/formatters'
import { AddInflowModal }  from '../components/modals/AddInflowModal'
import { AddOutflowModal } from '../components/modals/AddOutflowModal'
import type { InflowTransaction, OutflowTransaction } from '../hooks/useTransactions'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { EmptyState } from '../components/ui/EmptyState'
import { AmountCell } from '../components/ui/AmountCell'

// ── Types ──────────────────────────────────────────────────────────────────────

const TXN_TYPE_LABELS: Record<string, string> = {
  refund:              'Refund',
  reversal:            'Reversal',
  bank_deposit:        'Bank Deposit',
  intrabank_transfer:  'Intrabank Transfer',
}

interface LedgerRow {
  id:               string
  date:             string
  description:      string | null
  inflow:           number
  outflow:          number
  balance:          number   // running
  transaction_type: string | null
  entity_type:      'inflow' | 'outflow'
  inflowData?:      InflowTransaction
  outflowData?:     OutflowTransaction
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BankLedger() {
  usePageTitle('Bank Ledger')

  const { banks } = useBanks()
  const { canWrite } = useRole()

  const [selectedBank, setSelectedBank] = useState('')
  const [displayMode,  setDisplayMode]  = useState<'table' | 'cards'>('table')
  const [ledgerRows,   setLedgerRows]   = useState<LedgerRow[]>([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [editInflow,   setEditInflow]   = useState<InflowTransaction | null>(null)
  const [editOutflow,  setEditOutflow]  = useState<OutflowTransaction | null>(null)
  const { expandedIds: descExpanded, tooltip: descTooltip, setTooltip: setDescTooltip, toggle: toggleDesc } = useDescriptionExpand()

  const load = useCallback(async (bankName: string) => {
    if (!bankName) { setLedgerRows([]); return }
    setLoading(true)
    setError(null)

    const [inflowRes, outflowRes] = await Promise.all([
      supabase
        .from('inflow_transactions')
        .select('*')
        .eq('bank_name', bankName)
        .order('date', { ascending: true }),
      supabase
        .from('outflow_transactions')
        .select('*')
        .eq('bank_name', bankName)
        .order('date', { ascending: true }),
    ])

    if (inflowRes.error || outflowRes.error) {
      setError((inflowRes.error ?? outflowRes.error)!.message)
      setLoading(false)
      return
    }

    // Merge & sort chronologically
    type RawRow = { id: string; date: string; description: string | null; inflow: number; outflow: number; transaction_type: string | null; entity_type: 'inflow' | 'outflow'; inflowData?: InflowTransaction; outflowData?: OutflowTransaction }
    const merged: RawRow[] = [
      ...(inflowRes.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, date: r.date as string,
        description: r.description as string | null,
        inflow: r.amount as number, outflow: 0,
        transaction_type: (r.transaction_type as string | null) ?? null,
        entity_type: 'inflow' as const,
        inflowData: r as unknown as InflowTransaction,
      })),
      ...(outflowRes.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, date: r.date as string,
        description: r.description as string | null,
        inflow: 0, outflow: r.amount_disbursed as number,
        transaction_type: (r.transaction_type as string | null) ?? null,
        entity_type: 'outflow' as const,
        outflowData: r as unknown as OutflowTransaction,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

    // Compute running balance
    let running = 0
    const withBalance: LedgerRow[] = merged.map(r => {
      running += r.inflow - r.outflow
      return { ...r, balance: running }
    })

    setLedgerRows(withBalance)
    setLoading(false)
  }, [])

  useEffect(() => {
    const bankName = banks.find(b => b.id === selectedBank)?.name ?? ''
    load(bankName)
  }, [selectedBank, banks, load])

  const filtered = ledgerRows.filter(r => {
    if (dateFrom && r.date < dateFrom) return false
    if (dateTo   && r.date > dateTo)   return false
    return true
  })

  const totalInflow  = filtered.reduce((s, r) => s + r.inflow,  0)
  const totalOutflow = filtered.reduce((s, r) => s + r.outflow, 0)
  const netBalance   = totalInflow - totalOutflow

  const selectedBankName = banks.find(b => b.id === selectedBank)?.name ?? ''

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bank Ledger</h1>
          <p className="text-sm text-gray-500 mt-0.5">Per-bank transaction history with running balance</p>
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

      {/* Bank selector + date filters */}
      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 min-w-[200px]">
            <label className="text-xs font-medium text-gray-500">Bank</label>
            <select
              value={selectedBank}
              onChange={e => setSelectedBank(e.target.value)}
              className={filterInputCls}
            >
              <option value="">— Select a bank —</option>
              {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={filterInputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={filterInputCls} />
          </div>
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo('') }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
              Clear dates
            </button>
          )}
        </div>
      </Card>

      {/* Summary bar */}
      {selectedBank && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Inflows',  value: formatCurrency(totalInflow),  color: 'text-green-700' },
            { label: 'Total Outflows', value: formatCurrency(totalOutflow), color: 'text-red-700'   },
            { label: 'Net Balance',    value: formatCurrency(netBalance),   color: netBalance >= 0 ? 'text-green-700' : 'text-red-700' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              {loading
                ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
                : <p className={`text-lg font-bold ${color}`}>{value}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          <AlertCircle className="w-10 h-10 text-danger" />
          <p className="font-semibold text-gray-800">Failed to load ledger</p>
          <p className="text-sm text-gray-500">{error}</p>
          <button onClick={() => load(selectedBankName)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      )}

      {/* Empty — no bank selected */}
      {!selectedBank && !error && (
        <Card>
          <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
            <BookOpen className="w-12 h-12 text-gray-200" />
            <p className="text-sm">Select a bank above to view its ledger.</p>
          </div>
        </Card>
      )}

      {/* Ledger table / cards */}
      {selectedBank && !error && (
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
                  <BookOpen className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm">No transactions for {selectedBankName}.</p>
                </div>
              ) : filtered.map(row => (
                <div key={row.id} className="rounded-xl border border-gray-100 bg-white p-4 space-y-2 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-gray-500">{formatDate(row.date)}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-semibold ${row.inflow > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {row.inflow > 0 ? `+${formatCurrency(row.inflow)}` : `-${formatCurrency(row.outflow)}`}
                      </span>
                      {canWrite() && (
                        <button
                          onClick={() => row.entity_type === 'inflow' && row.inflowData
                            ? setEditInflow(row.inflowData)
                            : row.outflowData && setEditOutflow(row.outflowData)}
                          className="p-1 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
                          title="Edit source record"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  {row.transaction_type && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500 whitespace-nowrap">
                      {TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type}
                    </span>
                  )}
                  {row.description && (
                    <div className="text-xs text-gray-600">
                      <DescriptionCell id={`card-${row.id}`} text={row.description} expanded={descExpanded.has(`card-${row.id}`)} onToggle={() => toggleDesc(`card-${row.id}`)} tooltip={descTooltip} setTooltip={setDescTooltip} />
                    </div>
                  )}
                  <div className="flex items-center justify-between pt-1 border-t border-gray-50">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-gray-400">Balance</span>
                      <ReceiptBadge entityType={row.entity_type} entityId={row.id} />
                    </div>
                    <span className={`text-sm font-bold ${row.balance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                      {formatCurrency(row.balance)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {([
                      ['Date', false], ['Description', false],
                      ['Inflow (₦)', true], ['Outflow (₦)', true], ['Balance (₦)', true], ['📎', false],
                    ] as [string, boolean][]).map(([h, right]) => (
                      <th key={h} className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                    {canWrite() && <th className="px-4 py-3 w-10" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
                      ))}</tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={6}>
                      <EmptyState icon={BookOpen} title="No transactions" message={`No transactions found for ${selectedBankName}.`} compact />
                    </td></tr>
                  ) : filtered.map(row => (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 max-w-[280px]">
                        <div className="flex items-start gap-1.5 min-w-0">
                          {row.transaction_type && (
                            <span className="inline-flex shrink-0 items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-500 whitespace-nowrap">
                              {TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type}
                            </span>
                          )}
                          <DescriptionCell id={row.id} text={row.description} expanded={descExpanded.has(row.id)} onToggle={() => toggleDesc(row.id)} tooltip={descTooltip} setTooltip={setDescTooltip} />
                        </div>
                      </td>
                      <AmountCell value={row.inflow}   mode="inflow"  />
                      <AmountCell value={row.outflow}  mode="outflow" />
                      <AmountCell value={row.balance}  mode="balance" showZero />
                      <td className="px-2 py-3">
                        <ReceiptBadge entityType={row.entity_type} entityId={row.id} />
                      </td>
                      {canWrite() && (
                        <td className="px-2 py-3">
                          <button
                            onClick={() => row.entity_type === 'inflow' && row.inflowData
                              ? setEditInflow(row.inflowData)
                              : row.outflowData && setEditOutflow(row.outflowData)}
                            className="p-1.5 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
                            title="Edit source record"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <AddInflowModal
        open={!!editInflow}
        onClose={() => setEditInflow(null)}
        onSuccess={() => { setEditInflow(null); load(selectedBankName) }}
        editRecord={editInflow}
      />
      <AddOutflowModal
        open={!!editOutflow}
        onClose={() => setEditOutflow(null)}
        onSuccess={() => { setEditOutflow(null); load(selectedBankName) }}
        editRecord={editOutflow}
      />
      <DescriptionTooltip tooltip={descTooltip} />
    </div>
  )
}

const filterInputCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'
