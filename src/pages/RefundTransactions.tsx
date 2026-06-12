import { useState, useEffect, useMemo, Fragment } from 'react'
import { RotateCcw, LayoutGrid, LayoutList, AlertCircle, RefreshCw, Pencil, ChevronRight, ChevronDown, Link2 } from 'lucide-react'
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
import { AddInflowModal }  from '../components/modals/AddInflowModal'
import { AddOutflowModal } from '../components/modals/AddOutflowModal'
import type { InflowTransaction, OutflowTransaction } from '../hooks/useTransactions'
import { useRole } from '../hooks/useRole'
import { filterInputCls } from '../components/ui/FormField'
import { DatePresetBar, type DatePreset } from '../components/ui/DatePresetBar'
import { RowDetailPanel, type DetailItem } from '../components/ui/RowDetailPanel'
import { useOrgCurrency } from '../hooks/useOrgCurrency'

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

const REFUND_LIMIT = 5_000

export default function RefundTransactions() {
  usePageTitle('Refunds')
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()
  const orgId = useOrgStore((s) => s.orgId)

  const { canWrite } = useRole()
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()

  const [rows,        setRows]        = useState<TxnRow[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)
  const [truncated,   setTruncated]   = useState(false)
  const [displayMode, setDisplayMode] = useState<'table' | 'cards'>('table')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [datePreset,  setDatePreset]  = useState<DatePreset | null>(null)
  const [editInflow,  setEditInflow]  = useState<InflowTransaction | null>(null)
  const [editOutflow, setEditOutflow] = useState<OutflowTransaction | null>(null)
  const [expandedId,  setExpandedId]  = useState<string | null>(null)

  function refundDetailItems(row: TxnRow): DetailItem[] {
    return [
      { label: 'Original Txn ID', value: row.original_transaction_id, mono: true, breakAll: true },
      { label: 'Bank',            value: row.bank_name },
      { label: 'Remarks',         value: row.remarks,                 breakAll: true },
      { label: 'Raw Description', value: row.description,             breakAll: true },
      { label: 'Direction',       value: row.direction === 'in' ? 'Inflow' : 'Outflow' },
      {
        label: 'Offset Role',
        value: row.offset_role === 'root' ? 'Root' : row.offset_role === 'offset' ? 'Offset' : null,
        badge: row.offset_role === 'root' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600',
      },
      { label: 'Root Txn ID', value: row.root_transaction_id, mono: true, breakAll: true },
    ]
  }

  const load = async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true); setError(null); setTruncated(false)

    const [inflowRes, outflowRes] = await Promise.all([
      supabase.from('inflow_transactions')
        .select('*', { count: 'exact' }).eq('org_id', orgId)
        .eq('transaction_type', 'refund').order('date', { ascending: false }).limit(REFUND_LIMIT),
      supabase.from('outflow_transactions')
        .select('*', { count: 'exact' }).eq('org_id', orgId)
        .eq('transaction_type', 'refund').order('date', { ascending: false }).limit(REFUND_LIMIT),
    ])

    if (inflowRes.error || outflowRes.error) {
      setError((inflowRes.error ?? outflowRes.error)!.message); setLoading(false); return
    }
    setTruncated((inflowRes.count ?? 0) > REFUND_LIMIT || (outflowRes.count ?? 0) > REFUND_LIMIT)

    const merged: TxnRow[] = [
      ...(inflowRes.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, date: r.date as string, direction: 'in' as const,
        amount: r.amount as number,
        description: r.description as string | null,
        original_transaction_id: r.original_transaction_id as string | null,
        bank_name: r.bank_name as string | null,
        remarks: r.remark as string | null,
        offset_role: r.offset_role as string | null,
        root_transaction_id: r.root_transaction_id as string | null,
        inflowData: r as unknown as InflowTransaction,
      })),
      ...(outflowRes.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, date: r.date as string, direction: 'out' as const,
        amount: r.amount_disbursed as number,
        description: r.description as string | null,
        original_transaction_id: r.original_transaction_id as string | null,
        bank_name: r.bank_name as string | null,
        remarks: r.remarks as string | null,
        offset_role: r.offset_role as string | null,
        root_transaction_id: r.root_transaction_id as string | null,
        outflowData: r as unknown as OutflowTransaction,
      })),
    ].sort((a, b) => b.date.localeCompare(a.date))

    setRows(merged); setLoading(false)
  }

  const handleEdit = (row: TxnRow) => {
    if (row.direction === 'in' && row.inflowData)        setEditInflow(row.inflowData)
    else if (row.direction === 'out' && row.outflowData) setEditOutflow(row.outflowData)
  }

  useEffect(() => { load() }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = rows.filter(r => {
    if (dateFrom && r.date < dateFrom) return false
    if (dateTo   && r.date > dateTo)   return false
    return true
  })

  const { groups, unmatched } = useMemo(() => groupRows(filtered), [filtered])

  const RF_CSV_HEADERS = ['Date', 'Direction', `Amount (${baseCurrencySymbol})`, 'Description', 'Bank', 'Original Txn ID', 'Remarks']
  const rfCsvRow = (r: TxnRow) => [r.date, r.direction === 'in' ? 'Inflow' : 'Outflow', r.amount, r.description ?? '', r.bank_name ?? '', r.original_transaction_id ?? '', r.remarks ?? '']
  const RF_CSV_FILE = `refund-transactions-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(RF_CSV_FILE, RF_CSV_HEADERS, filtered.map(rfCsvRow))
  const handleExportAll  = () => exportCSV(RF_CSV_FILE, RF_CSV_HEADERS, filtered.map(rfCsvRow))

  // connector col + expand col + 7 data cols + optional actions col
  const totalCols = 9 + (canWrite() ? 1 : 0)

  // ── Table row renderer ──────────────────────────────────────────────────────
  const renderTableRow = (
    row:     TxnRow,
    rowKind: 'root' | 'offset' | 'unmatched',
    opts?:   { hasOffsets?: boolean; isLastOffset?: boolean },
  ) => {
    const isExpanded = expandedId === row.id

    const rowCls =
      rowKind === 'root'
        ? 'border-b border-gray-100/80 hover:bg-emerald-50/40 transition-colors'
        : rowKind === 'offset'
        ? 'border-b border-gray-100/80 bg-slate-50/50 hover:bg-slate-100/50 transition-colors'
        : 'border-b border-gray-100/80 hover:bg-gray-50/60 transition-colors'

    // Tree connector cell
    const connectorTd = (() => {
      const base: React.CSSProperties = { position: 'relative', width: 24, minWidth: 24, padding: 0 }

      if (rowKind === 'root') return (
        <td style={base}>
          {opts?.hasOffsets && (
            <div style={{ position: 'absolute', left: 11, top: '50%', bottom: 0, width: 2, background: '#6ee7b7' }} />
          )}
          <div style={{
            position: 'absolute', left: 7, top: '50%', transform: 'translateY(-50%)',
            width: 9, height: 9, borderRadius: '50%',
            background: '#34d399',
            boxShadow: '0 0 0 2px #fff, 0 0 0 3px #a7f3d0',
          }} />
        </td>
      )

      if (rowKind === 'offset') return (
        <td style={base}>
          <div style={{ position: 'absolute', left: 11, top: 0, bottom: '50%', width: 2, background: '#6ee7b7' }} />
          <div style={{ position: 'absolute', left: 11, right: 0, top: '50%', height: 2, transform: 'translateY(-50%)', background: '#6ee7b7' }} />
          {!opts?.isLastOffset && (
            <div style={{ position: 'absolute', left: 11, top: '50%', bottom: 0, width: 2, background: '#6ee7b7' }} />
          )}
          <div style={{
            position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)',
            width: 7, height: 7, borderRadius: '50%',
            background: '#94a3b8',
            boxShadow: '0 0 0 2px #fff',
          }} />
        </td>
      )

      return <td style={base} />
    })()

    return (
      <Fragment key={row.id}>
        <tr className={rowCls}>
          {connectorTd}
          <td className="w-8 pl-1 py-2">
            <button
              onClick={() => setExpandedId(isExpanded ? null : row.id)}
              className="p-1 rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title={isExpanded ? 'Collapse' : 'Expand details'}
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          </td>

          {/* Date + role chip */}
          <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
            <div className="flex items-center gap-2">
              <span>{formatDate(row.date)}</span>
              {rowKind === 'root' && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-emerald-100 text-emerald-700 uppercase tracking-wide leading-none">
                  Original
                </span>
              )}
              {rowKind === 'offset' && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-slate-100 text-slate-500 uppercase tracking-wide leading-none">
                  ↩ Offset
                </span>
              )}
            </div>
          </td>

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
          <td className="px-4 py-3 text-sm font-mono text-gray-400 max-w-[160px] truncate">{row.original_transaction_id ?? '—'}</td>
          <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px]">
            <DescriptionCell id={`rem-${row.id}`} text={row.remarks} tooltip={descTooltip} setTooltip={setDescTooltip} />
          </td>

          {canWrite() && (
            <td className="px-2 py-3">
              <div className="flex items-center gap-0.5">
                <button onClick={() => handleEdit(row)} className="p-1.5 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {row.root_transaction_id === null && row.offset_role !== 'root' && (
                  <button onClick={() => handleEdit(row)} className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors" title="Link to root">
                    <Link2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </td>
          )}
        </tr>
        {isExpanded && <RowDetailPanel items={refundDetailItems(row)} colSpan={totalCols} />}
      </Fragment>
    )
  }

  // ── Card renderer ───────────────────────────────────────────────────────────
  const renderCard = (
    row:     TxnRow,
    rowKind: 'root' | 'offset' | 'unmatched',
    config?: { inCluster?: boolean; bgOverride?: string },
  ) => {
    const inCluster = config?.inCluster ?? false
    const bg        = config?.bgOverride ?? 'bg-white'
    const leftBorder = inCluster ? '' :
      rowKind === 'root'    ? 'border-l-2 border-emerald-300' :
      rowKind === 'offset'  ? 'border-l-2 border-slate-300'   :
                              'border-l-2 border-rose-200'
    const roleLabel =
      rowKind === 'root'   ? 'Original' :
      rowKind === 'offset' ? 'Refund'   : '—'

    return (
      <div className={`${bg} ${leftBorder}`}>
        <div className="px-4 pt-3.5 pb-3">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold text-gray-400">{formatDate(row.date)}</p>
              {rowKind === 'root' && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-emerald-100 text-emerald-700 uppercase tracking-wide leading-none">
                  Original
                </span>
              )}
              {rowKind === 'offset' && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-slate-100 text-slate-500 uppercase tracking-wide leading-none">
                  ↩ Offset
                </span>
              )}
            </div>
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
            <p className="text-[11px] text-gray-400 font-mono truncate">Orig: {row.original_transaction_id}</p>
          )}
          {row.remarks && (
            <div className="text-xs mt-1.5">
              <DescriptionCell id={`card-rem-${row.id}`} text={row.remarks} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-400" />
            </div>
          )}
        </div>
        <div className="border-t border-gray-100 bg-gray-50/40 px-4 py-3 flex items-center justify-between">
          <div>
            <p className={`text-[10px] uppercase tracking-wide font-semibold mb-0.5 ${row.direction === 'in' ? 'text-emerald-600/70' : 'text-red-500/70'}`}>
              {roleLabel}
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
              {row.root_transaction_id === null && row.offset_role !== 'root' && (
                <button onClick={() => handleEdit(row)} className="p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors" title="Link to root">
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
      <p className="font-semibold text-gray-800">Failed to load refunds</p>
      <p className="text-sm text-gray-500">{error}</p>
      <button onClick={load} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  )

  const allOffsets = groups.flatMap(g => g.offsets)

  return (
    <div className="space-y-5">
      <PageHelpBanner storageKey="help-dismissed-refunds" title="Refunds vs Reversals — what's the difference?">
        A <strong>refund</strong> is a real cash movement: money is returned to a donor or reimbursed to the church.
        It is recorded as a new transaction that offsets the original. A <strong>reversal</strong> (see the Reversals page) is an accounting
        correction for an entry that was made in error — no actual cash changes hands; the original record is cancelled out.
      </PageHelpBanner>

      {truncated && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0" />
          Showing first {REFUND_LIMIT.toLocaleString()} refunds. Use a database export for the full dataset.
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-gray-100">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Refund Transactions</h1>
          <p className="text-sm text-gray-500 mt-0.5">Inflow and outflow rows tagged as refunds</p>
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
          { label: 'Total rows', sub: null,
            value: filtered.length.toLocaleString(),
            accent: 'border-gray-100 text-gray-900' },
          { label: 'Originals', sub: 'the entry that got refunded',
            value: `${groups.length.toLocaleString()} · ${formatCurrency(groups.reduce((s, g) => s + g.root.amount, 0), baseCurrencyCode)}`,
            accent: 'border-emerald-200 text-emerald-700' },
          { label: 'Refunds', sub: 'the refund entry',
            value: `${allOffsets.length.toLocaleString()} · ${formatCurrency(allOffsets.reduce((s, r) => s + r.amount, 0), baseCurrencyCode)}`,
            accent: 'border-slate-200 text-slate-600' },
          { label: 'Unmatched', sub: 'no root link found',
            value: unmatched.length.toLocaleString(),
            accent: unmatched.length > 0 ? 'border-rose-200 text-rose-500' : 'border-gray-100 text-gray-900' },
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
          /* ── CARD VIEW ─────────────────────────────────────────────────────── */
          <div className="p-4 space-y-4">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-2xl border border-gray-200 overflow-hidden shadow-sm animate-pulse">
                  <div className="h-8 bg-emerald-50" />
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
              <div className="py-12 text-center text-gray-400">
                <RotateCcw className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-sm">No refund transactions found.</p>
              </div>
            ) : (
              <>
                {/* Matched clusters */}
                {groups.map(({ root, offsets }) => (
                  <div key={root.id} className="rounded-2xl border border-emerald-200/70 shadow-md overflow-hidden">
                    {/* Cluster header strip */}
                    <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 border-b border-emerald-100">
                      <Link2 className="w-3 h-3 text-emerald-500 shrink-0" />
                      <span className="text-xs font-semibold text-emerald-700">
                        Matched pair · 1 original + {offsets.length} {offsets.length === 1 ? 'refund' : 'refunds'}
                      </span>
                    </div>

                    {/* Root card */}
                    {renderCard(root, 'root', { inCluster: true, bgOverride: 'bg-white' })}

                    {/* Offset cards with left gutter connector */}
                    {offsets.map((off, offIdx) => (
                      <div key={off.id} className="flex border-t border-emerald-100/80">
                        {/* Gutter */}
                        <div className="relative flex-shrink-0 w-5 bg-emerald-50/40">
                          <div style={{ position: 'absolute', left: 9, top: 0, bottom: '50%', width: 2, background: '#6ee7b7' }} />
                          {offIdx < offsets.length - 1 && (
                            <div style={{ position: 'absolute', left: 9, top: '50%', bottom: 0, width: 2, background: '#6ee7b7' }} />
                          )}
                          <div style={{ position: 'absolute', left: 9, right: 0, top: '50%', height: 2, transform: 'translateY(-50%)', background: '#6ee7b7' }} />
                        </div>
                        {/* Card */}
                        <div className="flex-1 min-w-0">
                          {renderCard(off, 'offset', { inCluster: true, bgOverride: 'bg-slate-50/60' })}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

                {/* Unmatched section */}
                {unmatched.length > 0 && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center gap-3 px-1">
                      <div className="h-px flex-1 bg-rose-100" />
                      <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest">Unmatched</span>
                      <span className="text-[10px] font-semibold text-rose-400 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-full">
                        {unmatched.length}
                      </span>
                      <div className="h-px flex-1 bg-rose-100" />
                    </div>
                    {unmatched.map(row => (
                      <div key={row.id} className="rounded-xl border border-rose-100/80 shadow-sm overflow-hidden">
                        {renderCard(row, 'unmatched')}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          /* ── TABLE VIEW ────────────────────────────────────────────────────── */
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th style={{ width: 24, minWidth: 24, padding: 0 }} />
                  <th className="w-8" />
                  {['Date', 'Direction', `Amount (${baseCurrencySymbol})`, 'Description', 'Bank', 'Original Txn ID', 'Remarks'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                  {canWrite() && <th className="px-4 py-3 w-10" />}
                </tr>
              </thead>

              {loading ? (
                <tbody>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-100/80">
                      <td style={{ width: 24, padding: 0 }} />
                      {Array.from({ length: totalCols - 1 }).map((_, j) => (
                        <td key={j} className="px-4 py-3">
                          <div className="h-4 bg-gray-200 rounded animate-pulse" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ) : filtered.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={totalCols} className="py-16 text-center">
                      <div className="flex flex-col items-center gap-2 text-gray-400">
                        <RotateCcw className="w-10 h-10 text-gray-200" />
                        <p className="text-sm">No refund transactions found.</p>
                      </div>
                    </td>
                  </tr>
                </tbody>
              ) : (
                <>
                  {/* Matched groups — one <tbody> per group */}
                  {groups.map(({ root, offsets }, groupIndex) => (
                    <tbody key={root.id}>
                      {groupIndex > 0 && (
                        <tr>
                          <td colSpan={totalCols} className="p-0 bg-gray-50/60" style={{ height: 10 }} />
                        </tr>
                      )}
                      {renderTableRow(root, 'root', { hasOffsets: offsets.length > 0 })}
                      {offsets.map((off, i) =>
                        renderTableRow(off, 'offset', { isLastOffset: i === offsets.length - 1 })
                      )}
                    </tbody>
                  ))}

                  {/* Unmatched section */}
                  {unmatched.length > 0 && (
                    <tbody>
                      <tr>
                        <td colSpan={totalCols} className="px-4 pt-6 pb-2">
                          <div className="flex items-center gap-3">
                            <div className="h-px flex-1 bg-rose-100" />
                            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-widest">Unmatched</span>
                            <span className="text-[10px] font-semibold text-rose-400 bg-rose-50 border border-rose-100 px-2 py-0.5 rounded-full">
                              {unmatched.length}
                            </span>
                            <div className="h-px flex-1 bg-rose-100" />
                          </div>
                        </td>
                      </tr>
                      {unmatched.map(row => renderTableRow(row, 'unmatched'))}
                    </tbody>
                  )}
                </>
              )}
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
