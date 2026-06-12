import { useState, useEffect, useMemo, Fragment } from 'react'
import { Undo2, LayoutGrid, LayoutList, AlertCircle, RefreshCw, ChevronRight, ChevronDown, Link2, Pencil } from 'lucide-react'
import { PageHelpBanner } from '../components/ui/PageHelpBanner'
import { exportCSV }       from '../utils/csvExport'
import { ExportDropdown }  from '../components/ui/ExportDropdown'
import { Card }            from '../components/ui/Card'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { useDescriptionExpand } from '../hooks/useDescriptionExpand'
import { usePageTitle }    from '../hooks/usePageTitle'
import { supabase }        from '../lib/supabase'
import { useOrgStore }     from '../store/orgStore'
import { formatDate, formatCurrency } from '../utils/formatters'
import { filterInputCls } from '../components/ui/FormField'
import { DatePresetBar, type DatePreset } from '../components/ui/DatePresetBar'
import { RowDetailPanel, type DetailItem } from '../components/ui/RowDetailPanel'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { AddInflowModal }  from '../components/modals/AddInflowModal'
import { AddOutflowModal } from '../components/modals/AddOutflowModal'
import type { InflowTransaction, OutflowTransaction } from '../hooks/useTransactions'
import { useRole } from '../hooks/useRole'

interface TxnRow {
  id:                      string
  date:                    string
  direction:               'in' | 'out'
  amount:                  number
  description:             string | null
  original_transaction_id: string | null
  bank_name:               string | null
  remarks:                 string | null
  offset_role:             string | null
  root_transaction_id:     string | null
  inflowData?:             InflowTransaction
  outflowData?:            OutflowTransaction
}

interface TxnGroup {
  root:    TxnRow
  offsets: TxnRow[]
}

function groupRows(rows: TxnRow[]): { groups: TxnGroup[]; unmatched: TxnRow[] } {
  const roots         = rows.filter(r => r.offset_role === 'root')
  const effectiveOff  = rows.filter(r => r.root_transaction_id !== null)
  const unmatchedRows = rows.filter(r =>
    r.root_transaction_id === null &&
    (r.offset_role === null || r.offset_role === 'offset')
  )
  const rootIds = new Set(roots.map(r => r.id))
  const byRoot  = new Map<string, TxnRow[]>()
  const orphans: TxnRow[] = []
  for (const off of effectiveOff) {
    const rid = off.root_transaction_id!
    if (rootIds.has(rid)) {
      if (!byRoot.has(rid)) byRoot.set(rid, [])
      byRoot.get(rid)!.push(off)
    } else {
      orphans.push(off)
    }
  }
  const groups = roots
    .map(root => ({
      root,
      offsets: (byRoot.get(root.id) ?? []).sort((a, b) => b.date.localeCompare(a.date)),
    }))
    .sort((a, b) => b.root.date.localeCompare(a.root.date))
  return {
    groups,
    unmatched: [...unmatchedRows, ...orphans].sort((a, b) => b.date.localeCompare(a.date)),
  }
}

const REVERSAL_LIMIT = 5_000

export default function ReversalTransactions() {
  usePageTitle('Reversals')
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()
  const orgId = useOrgStore((s) => s.orgId)

  const [rows,        setRows]        = useState<TxnRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [truncated,   setTruncated]   = useState(false)
  const [displayMode, setDisplayMode] = useState<'table' | 'cards'>('table')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [datePreset,  setDatePreset]  = useState<DatePreset | null>(null)
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()
  const [expandedId,  setExpandedId]  = useState<string | null>(null)
  const { canWrite } = useRole()
  const [editInflow,  setEditInflow]  = useState<InflowTransaction | null>(null)
  const [editOutflow, setEditOutflow] = useState<OutflowTransaction | null>(null)

  function reversalDetailItems(row: TxnRow): DetailItem[] {
    return [
      { label: 'Original Txn ID',   value: row.original_transaction_id, mono: true, breakAll: true },
      { label: 'Bank',              value: row.bank_name },
      { label: 'Remarks',           value: row.remarks,                 breakAll: true },
      { label: 'Raw Description',   value: row.description,             breakAll: true },
      { label: 'Direction',         value: row.direction === 'in' ? 'Inflow' : 'Outflow' },
      {
        label: 'Offset Role',
        value: row.offset_role === 'root' ? 'Root' : row.offset_role === 'offset' ? 'Offset' : null,
        badge: row.offset_role === 'root' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
      },
      { label: 'Root Txn ID',       value: row.root_transaction_id,     mono: true, breakAll: true },
    ]
  }

  const load = async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    setTruncated(false)

    const [inflowRes, outflowRes] = await Promise.all([
      supabase.from('inflow_transactions')
        .select('*', { count: 'exact' })
        .eq('org_id', orgId)
        .eq('transaction_type', 'reversal')
        .order('date', { ascending: false })
        .limit(REVERSAL_LIMIT),
      supabase.from('outflow_transactions')
        .select('*', { count: 'exact' })
        .eq('org_id', orgId)
        .eq('transaction_type', 'reversal')
        .order('date', { ascending: false })
        .limit(REVERSAL_LIMIT),
    ])

    if (inflowRes.error || outflowRes.error) {
      setError((inflowRes.error ?? outflowRes.error)!.message)
      setLoading(false)
      return
    }

    const isCapped =
      (inflowRes.count ?? 0) > REVERSAL_LIMIT ||
      (outflowRes.count ?? 0) > REVERSAL_LIMIT
    setTruncated(isCapped)

    const merged: TxnRow[] = [
      ...(inflowRes.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, date: r.date as string, direction: 'in' as const,
        amount:                  r.amount                  as number,
        description:             r.description             as string | null,
        original_transaction_id: r.original_transaction_id as string | null,
        bank_name:               r.bank_name               as string | null,
        remarks:                 r.remark                  as string | null,
        offset_role:             r.offset_role             as string | null,
        root_transaction_id:     r.root_transaction_id     as string | null,
        inflowData:              r as unknown as InflowTransaction,
      })),
      ...(outflowRes.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, date: r.date as string, direction: 'out' as const,
        amount:                  r.amount_disbursed         as number,
        description:             r.description              as string | null,
        original_transaction_id: r.original_transaction_id  as string | null,
        bank_name:               r.bank_name                as string | null,
        remarks:                 r.remarks                  as string | null,
        offset_role:             r.offset_role              as string | null,
        root_transaction_id:     r.root_transaction_id      as string | null,
        outflowData:             r as unknown as OutflowTransaction,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date))

    setRows(merged)
    setLoading(false)
  }

  const handleEdit = (row: TxnRow) => {
    if (row.direction === 'in' && row.inflowData)   setEditInflow(row.inflowData)
    else if (row.direction === 'out' && row.outflowData) setEditOutflow(row.outflowData)
  }

  useEffect(() => { load() }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = rows.filter(r => {
    if (dateFrom && r.date < dateFrom) return false
    if (dateTo   && r.date > dateTo)   return false
    return true
  })

  const { groups, unmatched } = useMemo(() => groupRows(filtered), [filtered])

  const RV_CSV_HEADERS = ['Date', 'Direction', `Amount (${baseCurrencySymbol})`, 'Description', 'Bank', 'Original Txn ID', 'Remarks']
  const rvCsvRow = (r: TxnRow) => [r.date, r.direction === 'in' ? 'Inflow' : 'Outflow', r.amount, r.description ?? '', r.bank_name ?? '', r.original_transaction_id ?? '', r.remarks ?? '']
  const RV_CSV_FILE = `reversal-transactions-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(RV_CSV_FILE, RV_CSV_HEADERS, filtered.map(rvCsvRow))
  const handleExportAll  = () => exportCSV(RV_CSV_FILE, RV_CSV_HEADERS, filtered.map(rvCsvRow))

  const totalCols = 8 + (canWrite() ? 1 : 0)

  const renderTableRow = (row: TxnRow, rowKind: 'root' | 'offset' | 'unmatched') => {
    const isExpanded = expandedId === row.id
    const rowCls =
      rowKind === 'root'
        ? 'hover:bg-green-50/30 border-l-4 border-green-400 transition-colors'
        : rowKind === 'offset'
        ? 'hover:bg-amber-50/30 border-l-4 border-amber-300 bg-amber-50/20 transition-colors'
        : 'hover:bg-gray-50 border-l-4 border-gray-200 transition-colors'
    const datePl = rowKind === 'offset' ? 'pl-8' : 'pl-4'
    return (
      <Fragment key={row.id}>
        <tr className={rowCls}>
          <td className="w-8 pl-2">
            <button
              onClick={() => setExpandedId(isExpanded ? null : row.id)}
              className="p-1 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
              aria-label={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </td>
          <td className={`${datePl} py-3 text-sm text-gray-600 whitespace-nowrap`}>{formatDate(row.date)}</td>
          <td className="px-4 py-3">
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${row.direction === 'in' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {row.direction === 'in' ? 'Inflow' : 'Outflow'}
            </span>
          </td>
          <td className="px-4 py-3 text-sm font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(row.amount, baseCurrencyCode)}</td>
          <td className="px-4 py-3 text-sm text-gray-800 max-w-[200px]">
            <DescriptionCell id={row.id} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
          </td>
          <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{row.bank_name ?? '—'}</td>
          <td className="px-4 py-3 text-sm font-mono text-gray-500 max-w-[160px] truncate">{row.original_transaction_id ?? '—'}</td>
          <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px]">
            <DescriptionCell id={`rem-${row.id}`} text={row.remarks} tooltip={descTooltip} setTooltip={setDescTooltip} />
          </td>
          {canWrite() && (
            <td className="px-2 py-3">
              <div className="flex items-center gap-0.5">
                <button onClick={() => handleEdit(row)} className="p-1.5 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {row.offset_role === 'root' && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700" title="Root transaction">R</span>
                )}
                {row.root_transaction_id === null && row.offset_role !== 'root' && (
                  <button onClick={() => handleEdit(row)} className="p-1.5 rounded text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Link to root">
                    <Link2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </td>
          )}
        </tr>
        {isExpanded && <RowDetailPanel items={reversalDetailItems(row)} colSpan={totalCols} />}
      </Fragment>
    )
  }

  const renderCard = (row: TxnRow, rowKind: 'root' | 'offset' | 'unmatched') => {
    const borderCls =
      rowKind === 'root'    ? 'border-l-4 border-green-400' :
      rowKind === 'offset'  ? 'border-l-4 border-amber-300' :
                              'border-l-4 border-gray-200'
    const label = rowKind === 'root' ? 'Original' : 'Reversal'
    return (
      <div className={`bg-white ${borderCls}`}>
        <div className="px-4 pt-3.5 pb-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <p className="text-[11px] font-semibold text-gray-400">{formatDate(row.date)}</p>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${row.direction === 'in' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
              {row.direction === 'in' ? 'Inflow' : 'Outflow'}
            </span>
          </div>
          {row.bank_name && <p className="text-[11px] text-gray-400 mb-1.5">{row.bank_name}</p>}
          {row.description && (
            <div className="text-sm mb-1">
              <DescriptionCell id={`card-desc-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-800" />
            </div>
          )}
          {row.original_transaction_id && (
            <p className="text-[11px] text-gray-400 font-mono">Orig: {row.original_transaction_id}</p>
          )}
          {row.remarks && (
            <div className="text-xs mt-1.5">
              <DescriptionCell id={`card-rem-${row.id}`} text={row.remarks} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-400" />
            </div>
          )}
        </div>
        <div className="border-t border-gray-100 bg-gray-50/40 px-4 py-3 flex items-center justify-between">
          <div>
            <p className={`text-[10px] uppercase tracking-wide font-semibold mb-0.5 ${row.direction === 'in' ? 'text-green-600/70' : 'text-red-600/70'}`}>
              {label}
            </p>
            <p className={`text-sm font-mono font-bold tabular-nums ${row.direction === 'in' ? 'text-success' : 'text-danger'}`}>
              {formatCurrency(row.amount, baseCurrencyCode)}
            </p>
          </div>
          {canWrite() && (
            <div className="flex items-center gap-0.5">
              <button onClick={() => handleEdit(row)} className="p-1.5 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              {row.offset_role === 'root' && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700" title="Root transaction">R</span>
              )}
              {row.root_transaction_id === null && row.offset_role !== 'root' && (
                <button onClick={() => handleEdit(row)} className="p-1.5 rounded text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Link to root">
                  <Link2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load reversals</p>
      <p className="text-sm text-gray-500">{error}</p>
      <button onClick={load} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  )

  const allOffsets = groups.flatMap(g => g.offsets)

  return (
    <div className="space-y-5">
      <PageHelpBanner storageKey="help-dismissed-reversals" title="Refunds vs Reversals — what's the difference?">
        A <strong>reversal</strong> is an accounting correction: it cancels a transaction that was recorded in error.
        No real cash moves — the original entry is negated in the ledger.
        A <strong>refund</strong> (see the Refunds page) is a real cash movement where money is physically returned or reimbursed.
      </PageHelpBanner>

      {truncated && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Showing first {REVERSAL_LIMIT.toLocaleString()} reversals. Use a database export for the full dataset.
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-gray-100">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Reversal Transactions</h1>
          <p className="text-sm text-gray-500 mt-0.5">Inflow and outflow rows tagged as reversals</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportDropdown onExportView={handleExportView} onExportAll={handleExportAll} disabled={filtered.length === 0} />
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
            {(dateFrom || dateTo || datePreset) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); setDatePreset(null) }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                Clear
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Summary strip */}
      {(() => {
        const summaryCards = [
          {
            label: 'Total rows',
            sub:   null,
            value: filtered.length.toLocaleString(),
            accent: 'border-gray-100 text-gray-900',
          },
          {
            label:  'Originals',
            sub:    'the entry that got reversed',
            value:  `${groups.length.toLocaleString()} · ${formatCurrency(groups.reduce((s, g) => s + g.root.amount, 0), baseCurrencyCode)}`,
            accent: 'border-green-200 text-green-700',
          },
          {
            label:  'Reversals',
            sub:    'the correcting entry',
            value:  `${allOffsets.length.toLocaleString()} · ${formatCurrency(allOffsets.reduce((s, r) => s + r.amount, 0), baseCurrencyCode)}`,
            accent: 'border-amber-200 text-amber-700',
          },
          {
            label:  'Unmatched',
            sub:    'no root link found',
            value:  unmatched.length.toLocaleString(),
            accent: unmatched.length > 0 ? 'border-red-200 text-red-600' : 'border-gray-100 text-gray-900',
          },
        ]
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {summaryCards.map(({ label, sub, value, accent }) => (
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
                  <div className="border-t border-gray-100 bg-gray-50/40 px-4 py-3">
                    <div className="h-8 bg-gray-200 rounded w-1/2" />
                  </div>
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <Undo2 className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm">No reversal transactions found.</p>
              </div>
            ) : (
              <>
                {groups.map(({ root, offsets }) => (
                  <div key={root.id} className="rounded-xl border border-gray-200 shadow-sm overflow-hidden divide-y divide-gray-100">
                    {renderCard(root, 'root')}
                    {offsets.map(off => (
                      <div key={off.id} className="ml-4">
                        {renderCard(off, 'offset')}
                      </div>
                    ))}
                  </div>
                ))}
                {unmatched.length > 0 && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-2 px-1">
                      <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">
                        Unmatched · {unmatched.length}
                      </span>
                      <div className="flex-1 h-px bg-gray-100" />
                    </div>
                    {unmatched.map(row => (
                      <div key={row.id} className="rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                        {renderCard(row, 'unmatched')}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="w-8" />
                  {['Date', 'Direction', `Amount (${baseCurrencySymbol})`, 'Description', 'Bank', 'Original Txn ID', 'Remarks'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                  {canWrite() && <th className="px-2 py-3 w-20" />}
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
                  <tr><td colSpan={totalCols} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Undo2 className="w-10 h-10 text-gray-200" />
                      <p className="text-sm">No reversal transactions found.</p>
                    </div>
                  </td></tr>
                ) : (
                  <>
                    {groups.length > 0 && (
                      <>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <td colSpan={totalCols} className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            Matched Pairs · {groups.length} {groups.length === 1 ? 'group' : 'groups'}
                          </td>
                        </tr>
                        {groups.map(({ root, offsets }) => (
                          <Fragment key={root.id}>
                            {renderTableRow(root, 'root')}
                            {offsets.map(off => renderTableRow(off, 'offset'))}
                          </Fragment>
                        ))}
                      </>
                    )}
                    {unmatched.length > 0 && (
                      <>
                        <tr className="bg-red-50/60 border-b border-t border-red-100">
                          <td colSpan={totalCols} className="px-4 py-2 text-xs font-semibold text-red-400 uppercase tracking-wide">
                            Unmatched · {unmatched.length}
                          </td>
                        </tr>
                        {unmatched.map(row => renderTableRow(row, 'unmatched'))}
                      </>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <DescriptionTooltip tooltip={descTooltip} />
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
    </div>
  )
}
