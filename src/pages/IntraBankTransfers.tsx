import { useState, useEffect, useCallback } from 'react'
import {
  ArrowRightLeft, Pencil, Trash2,
  LayoutGrid, LayoutList, AlertCircle, RefreshCw, X,
  ChevronRight, ChevronDown, Link2,
} from 'lucide-react'
import { Card }         from '../components/ui/Card'
import { DeleteDialog } from '../components/ui/DeleteDialog'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { useDescriptionExpand } from '../hooks/useDescriptionExpand'
import { RowDetailPanel, type DetailItem } from '../components/ui/RowDetailPanel'
import { usePageTitle } from '../hooks/usePageTitle'
import { useBanks }     from '../hooks/useBanks'
import { useRole }      from '../hooks/useRole'
import { useToastStore } from '../store/toastStore'
import { useOrgStore }   from '../store/orgStore'
import { supabase }      from '../lib/supabase'
import { formatDate, formatCurrency } from '../utils/formatters'
import { Field, inputCls, filterInputCls } from '../components/ui/FormField'
import { DatePresetBar, type DatePreset } from '../components/ui/DatePresetBar'
import { SearchableSelect } from '../components/ui/SearchableSelect'
import { exportCSV }   from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { useOrgCurrency }  from '../hooks/useOrgCurrency'
import { PageEmptyState }  from '../components/onboarding/PageEmptyState'
import { AddInflowModal }  from '../components/modals/AddInflowModal'
import { AddOutflowModal } from '../components/modals/AddOutflowModal'
import type { InflowTransaction, OutflowTransaction } from '../hooks/useTransactions'

// ── Types ──────────────────────────────────────────────────────────────────────

interface TransferRow {
  id:              string
  date:            string
  from_bank_id:    string | null
  from_bank_name:  string | null
  to_bank_id:      string | null
  to_bank_name:    string | null
  amount:          number
  description:     string | null
  transaction_ref: string | null
  remarks:         string | null
  source:              'intrabank_transfers' | 'inflow' | 'outflow'
  offset_role:         string | null
  root_transaction_id: string | null
  inflowData?:         InflowTransaction
  outflowData?:        OutflowTransaction
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function IntraBankTransfers() {
  usePageTitle('Intrabank Transfers')
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()
  const orgId = useOrgStore((s) => s.orgId)

  const { banks } = useBanks()
  const { canWrite, canDelete } = useRole()
  const { push: toast } = useToastStore()
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()

  const [rows,        setRows]        = useState<TransferRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<'table' | 'cards'>('table')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [datePreset,  setDatePreset]  = useState<DatePreset | null>(null)
  const [bankFilter,  setBankFilter]  = useState('')

  const [editInflow,   setEditInflow]   = useState<InflowTransaction | null>(null)
  const [editOutflow,  setEditOutflow]  = useState<OutflowTransaction | null>(null)
  const [deleteId,    setDeleteId]    = useState<string | null>(null)
  const [deleting,    setDeleting]    = useState(false)
  const [expandedId,  setExpandedId]  = useState<string | null>(null)

  const transferDetailItems = (row: TransferRow): DetailItem[] => [
    { label: 'Transaction Ref',  value: row.transaction_ref, mono: true, breakAll: true },
    { label: 'Remarks',          value: row.remarks,         breakAll: true },
    { label: 'From Bank',        value: row.from_bank_name },
    { label: 'To Bank',          value: row.to_bank_name },
    { label: 'Raw Description',  value: row.description,     breakAll: true },
    {
      label: 'Offset Role',
      value: row.offset_role === 'root' ? 'Root' : row.offset_role === 'offset' ? 'Offset' : null,
      badge: row.offset_role === 'root' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
    },
  ]

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const [transferRes, inflowRes, outflowRes] = await Promise.all([
      supabase.from('intrabank_transfers').select('*').order('date', { ascending: false }),
      ...(orgId ? [
        supabase.from('inflow_transactions').select('*').eq('org_id', orgId).eq('transaction_type', 'intrabank_transfer').order('date', { ascending: false }),
        supabase.from('outflow_transactions').select('*').eq('org_id', orgId).eq('transaction_type', 'intrabank_transfer').order('date', { ascending: false }),
      ] : [Promise.resolve({ data: [], error: null }), Promise.resolve({ data: [], error: null })]),
    ])
    if (transferRes.error) { setError(transferRes.error.message); setLoading(false); return }
    const transferRows: TransferRow[] = (transferRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...(r as TransferRow),
      source:              'intrabank_transfers' as const,
      offset_role:         null,
      root_transaction_id: null,
    }))
    const inRows: TransferRow[] = (inflowRes.data ?? []).map((r: Record<string, unknown>) => ({
      id:              r.id as string,
      date:            r.date as string,
      from_bank_id:    null,
      from_bank_name:  r.bank_name as string | null,
      to_bank_id:      null,
      to_bank_name:    null,
      amount:          r.amount as number,
      description:     r.description as string | null,
      transaction_ref: r.transaction_ref as string | null,
      remarks:         r.remark as string | null,
      source:          'inflow' as const,
      offset_role:     r.offset_role         as string | null,
      root_transaction_id: r.root_transaction_id as string | null,
      inflowData:      r as unknown as InflowTransaction,
    }))
    const outRows: TransferRow[] = (outflowRes.data ?? []).map((r: Record<string, unknown>) => ({
      id:              r.id as string,
      date:            r.date as string,
      from_bank_id:    null,
      from_bank_name:  r.bank_name as string | null,
      to_bank_id:      null,
      to_bank_name:    null,
      amount:          r.amount_disbursed as number,
      description:     r.description as string | null,
      transaction_ref: r.transaction_id as string | null,
      remarks:         r.remarks as string | null,
      source:          'outflow' as const,
      offset_role:     r.offset_role         as string | null,
      root_transaction_id: r.root_transaction_id as string | null,
      outflowData:     r as unknown as OutflowTransaction,
    }))
    setRows([...transferRows, ...inRows, ...outRows].sort((a, b) => b.date.localeCompare(a.date)))
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load])

  const filtered = rows.filter(r => {
    if (dateFrom    && r.date < dateFrom)    return false
    if (dateTo      && r.date > dateTo)      return false
    if (bankFilter  && r.from_bank_id !== bankFilter && r.to_bank_id !== bankFilter) return false
    return true
  })

  const handleLinkRoot = (row: TransferRow) => {
    if (row.source === 'inflow' && row.inflowData) setEditInflow(row.inflowData)
    else if (row.source === 'outflow' && row.outflowData) setEditOutflow(row.outflowData)
  }

  const IBT_CSV_HEADERS = ['Date', 'From Bank', 'To Bank', `Amount (${baseCurrencySymbol})`, 'Description', 'Ref', 'Remarks']
  const ibtCsvRow = (r: TransferRow) => [
    r.date, r.from_bank_name ?? '', r.to_bank_name ?? '', r.amount,
    r.description ?? '', r.transaction_ref ?? '', r.remarks ?? '',
  ]
  const IBT_CSV_FILE = `intrabank-transfers-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(IBT_CSV_FILE, IBT_CSV_HEADERS, filtered.map(ibtCsvRow))
  const handleExportAll  = () => exportCSV(IBT_CSV_FILE, IBT_CSV_HEADERS, filtered.map(ibtCsvRow))

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    const { error: err } = await supabase.from('intrabank_transfers').delete().eq('id', deleteId)
    setDeleting(false)
    if (err) { toast(err.message, 'error'); return }
    toast('Transfer deleted', 'success')
    setDeleteId(null)
    load()
  }

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load intrabank transfers</p>
      <p className="text-sm text-gray-500">{error}</p>
      <button onClick={load} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light">
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
            <h1 className="text-2xl font-bold text-gray-900">Intrabank Transfers</h1>
            <p className="text-sm text-gray-500 mt-0.5">Bank-to-bank fund movements</p>
          </div>
          <div className="flex items-center gap-2">
            <ExportDropdown
              onExportView={handleExportView}
              onExportAll={handleExportAll}
              disabled={filtered.length === 0}
            />
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
        </div>

        {/* Filters */}
        <Card>
          <div className="space-y-3">
            <DatePresetBar
              activePreset={datePreset}
              onPreset={(preset, from, to) => { setDatePreset(preset); setDateFrom(from); setDateTo(to) }}
              onCustom={() => setDatePreset('custom')}
            />
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">From</label>
                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setDatePreset('custom') }} className={filterInputCls} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">To</label>
                <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setDatePreset('custom') }} className={filterInputCls} />
              </div>
              <div className="flex flex-col gap-1 min-w-[160px]">
                <label className="text-xs font-medium text-gray-500">Bank</label>
                <SearchableSelect value={bankFilter} onChange={setBankFilter}
                  options={banks.map(b => ({ value: b.id, label: b.name }))}
                  placeholder="All banks" className={filterInputCls} />
              </div>
              {(dateFrom || dateTo || bankFilter || datePreset) && (
                <button onClick={() => { setDateFrom(''); setDateTo(''); setDatePreset(null); setBankFilter('') }}
                  className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg flex items-center gap-1">
                  <X className="w-3.5 h-3.5" /> Clear
                </button>
              )}
            </div>
          </div>
        </Card>

        {/* Summary strip */}
        {(() => {
          const offsetEligible = filtered.filter(r => r.source !== 'intrabank_transfers')
          const roots    = offsetEligible.filter(r => r.offset_role === 'root')
          const offsets  = offsetEligible.filter(r => r.offset_role === 'offset')
          const untagged = offsetEligible.filter(r => !r.offset_role)
          const cards = [
            { label: 'Total rows',   sub: null,                                value: filtered.length.toLocaleString(),                                                                                                   accent: 'border-gray-100 text-gray-900' },
            { label: 'Originals',    sub: 'the source transfer entry',         value: `${roots.length.toLocaleString()} · ${formatCurrency(roots.reduce((s, r) => s + r.amount, 0), baseCurrencyCode)}`,     accent: 'border-green-200 text-green-700' },
            { label: 'Transfers',    sub: 'the offset entry',                  value: `${offsets.length.toLocaleString()} · ${formatCurrency(offsets.reduce((s, r) => s + r.amount, 0), baseCurrencyCode)}`,  accent: 'border-amber-200 text-amber-700' },
            { label: 'Needs review', sub: "hasn't been classified yet",        value: untagged.length.toLocaleString(),                                                                                                accent: untagged.length > 0 ? 'border-red-200 text-red-600' : 'border-gray-100 text-gray-900' },
          ]
          return (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {cards.map(({ label, sub, value, accent }) => (
                <div key={label} className={`bg-white rounded-xl border shadow-sm px-4 py-3 ${accent.split(' ')[0]}`}>
                  <p className="text-xs font-semibold text-gray-700 mb-0.5">{label}</p>
                  {sub && <p className="text-[10px] text-gray-400 mb-1 leading-tight">{sub}</p>}
                  {loading
                    ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4 mt-1" />
                    : <p className={`text-base font-bold tabular-nums ${accent.split(' ')[1]}`}>{value}</p>}
                </div>
              ))}
            </div>
          )
        })()}

        {/* Table / Cards */}
        <Card padding={false}>
          {displayMode === 'cards' ? (
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
              ) : filtered.length === 0 ? (
                <PageEmptyState pageId="intrabank-transfers" compact />
              ) : filtered.map(row => (
                <div key={row.id} className="rounded-xl border overflow-hidden shadow-sm bg-white border-gray-200">
                  {/* Card header */}
                  <div className="px-4 pt-3.5 pb-3">
                    <p className="text-[11px] font-semibold mb-2 text-gray-400">{formatDate(row.date)}</p>
                    <div className="flex items-center gap-2 text-sm text-gray-700 mb-1">
                      <span className="font-medium truncate">{row.from_bank_name ?? '—'}</span>
                      <ArrowRightLeft className="w-3 h-3 text-gray-400 shrink-0" />
                      <span className="font-medium truncate">{row.to_bank_name ?? '—'}</span>
                    </div>
                    {row.description && (
                      <div className="text-sm mt-1.5">
                        <DescriptionCell id={`card-desc-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-600" />
                      </div>
                    )}
                    {row.transaction_ref && <p className="text-[11px] text-gray-400 font-mono mt-1">{row.transaction_ref}</p>}
                  </div>
                  {/* Metrics footer */}
                  <div className="grid grid-cols-2 border-t border-gray-100 bg-gray-50/40 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide font-semibold mb-0.5 text-gray-500">Transfer</p>
                      <p className="text-sm font-mono font-bold tabular-nums text-primary">{formatCurrency(row.amount, baseCurrencyCode)}</p>
                    </div>
                    <div className="border-l border-gray-200/80 pl-4 min-w-0 flex items-center justify-end gap-0.5">
                      {row.source === 'intrabank_transfers' && canWrite()  && (
                        <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {(row.source === 'inflow' || row.source === 'outflow') && canWrite() && (
                        <>
                          <button onClick={() => handleLinkRoot(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {row.offset_role === 'root' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700" title="This is a root transaction">R</span>
                          )}
                          {row.offset_role !== 'root' && row.root_transaction_id === null && (
                            <button onClick={() => handleLinkRoot(row)} className="p-1.5 rounded-lg text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Link to root transaction">
                              <Link2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="w-8" />
                    {['Date', 'From Bank', 'To Bank', `Amount (${baseCurrencySymbol})`, 'Description', 'Ref', 'Remarks', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
                      ))}</tr>
                    ))
                  ) : filtered.length === 0 ? (
                    <tr><td colSpan={8}>
                      <PageEmptyState pageId="intrabank-transfers" compact />
                    </td></tr>
                  ) : filtered.flatMap(row => {
                    const isExpanded = expandedId === row.id
                    return [
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="w-8 px-1 py-3">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : row.id)}
                          className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          title={isExpanded ? 'Collapse' : 'Expand details'}
                        >
                          {isExpanded
                            ? <ChevronDown className="w-3.5 h-3.5" />
                            : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.from_bank_name ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.to_bank_name ?? '—'}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-primary whitespace-nowrap">{formatCurrency(row.amount, baseCurrencyCode)}</td>
                      <td className="px-4 py-3 text-sm text-gray-800 max-w-[180px]">
                        <DescriptionCell id={row.id} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
                      </td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-500 whitespace-nowrap">{row.transaction_ref ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-[140px]">
                        <DescriptionCell id={`rem-${row.id}`} text={row.remarks} tooltip={descTooltip} setTooltip={setDescTooltip} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {row.source === 'intrabank_transfers' && canDelete() && (
                            <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50" title="Delete">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                          {(row.source === 'inflow' || row.source === 'outflow') && canWrite() && (
                            <>
                              <button onClick={() => handleLinkRoot(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                                <Pencil className="w-4 h-4" />
                              </button>
                              {row.offset_role === 'root' && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700" title="This is a root transaction">R</span>
                              )}
                              {row.offset_role !== 'root' && row.root_transaction_id === null && (
                                <button onClick={() => handleLinkRoot(row)} className="p-1.5 rounded-lg text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Link to root transaction">
                                  <Link2 className="w-4 h-4" />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>,
                    isExpanded && <RowDetailPanel key={`${row.id}-detail`} items={transferDetailItems(row)} colSpan={9} />,
                    ]
                  }).filter(Boolean)}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <AddInflowModal
        open={!!editInflow}
        onClose={() => setEditInflow(null)}
        onSuccess={() => { setEditInflow(null); load() }}
        editRecord={editInflow}
      />
      <AddOutflowModal
        open={!!editOutflow}
        onClose={() => setEditOutflow(null)}
        onSuccess={() => { setEditOutflow(null); load() }}
        editRecord={editOutflow}
      />
      <DeleteDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        loading={deleting}
        label="this intrabank transfer"
      />
      <DescriptionTooltip tooltip={descTooltip} />
    </>
  )
}
