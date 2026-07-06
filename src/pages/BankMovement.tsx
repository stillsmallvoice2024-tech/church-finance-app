import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Landmark, ArrowRightLeft, Pencil, Trash2,
  ChevronDown, ChevronUp, AlertCircle, RefreshCw,
  ChevronRight, Link2, X, LayoutGrid, LayoutList, Layers,
} from 'lucide-react'
import { BarChart, Bar, XAxis, Cell, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import { RankedBarChart } from '../components/ui/RankedBarChart'
import { useBankMovementSummary } from '../hooks/useBankMovementSummary'
import { useCountUp } from '../hooks/useCountUp'
import { PageHelpBanner }   from '../components/ui/PageHelpBanner'
import { DataControlsBar }  from '../components/ui/DataControlsBar'
import { SortableHeader }   from '../components/ui/SortableHeader'
import { PaginationBar }    from '../components/ui/PaginationBar'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows } from '../utils/sortUtils'
import { friendlyError } from '../utils/friendlyError'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields, searchRows } from '../utils/tableColumns'
import { Card }         from '../components/ui/Card'
import { DeleteDialog } from '../components/ui/DeleteDialog'
import { usePageTitle } from '../hooks/usePageTitle'
import { useBanks }     from '../hooks/useBanks'
import { useRole }      from '../hooks/useRole'
import { useToastStore } from '../store/toastStore'
import { useOrgStore }   from '../store/orgStore'
import { supabase }      from '../lib/supabase'
import { formatDate, formatCurrency } from '../utils/formatters'
import { useDescriptionExpand } from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { filterInputCls } from '../components/ui/FormField'
import { DatePresetBar, type DatePreset } from '../components/ui/DatePresetBar'
import { PageEmptyState }  from '../components/onboarding/PageEmptyState'
import { RowDetailPanel, type DetailItem } from '../components/ui/RowDetailPanel'
import { exportCSV }   from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { useOrgCurrency }  from '../hooks/useOrgCurrency'
import { SearchableSelect } from '../components/ui/SearchableSelect'
import { AddInflowModal }  from '../components/modals/AddInflowModal'
import { AddOutflowModal } from '../components/modals/AddOutflowModal'
import { LinkDepositGroupModal } from '../components/modals/LinkDepositGroupModal'
import type { InflowTransaction, OutflowTransaction } from '../hooks/useTransactions'

// ── Types ──────────────────────────────────────────────────────────────────────

interface DepositRow {
  id:                  string
  date:                string
  bank_id:             string | null
  bank_name:           string | null
  amount:              number
  description:         string | null
  transaction_ref:     string | null
  remarks:             string | null
  source:              'bank_deposits' | 'inflow' | 'outflow'
  offset_role:         string | null
  root_transaction_id: string | null
  deposit_group_id:    string | null
  import_seq?:         number
  inflowData?:         InflowTransaction
  outflowData?:        OutflowTransaction
}

interface TransferRow {
  id:                  string
  date:                string
  from_bank_id:        string | null
  from_bank_name:      string | null
  to_bank_id:          string | null
  to_bank_name:        string | null
  amount:              number
  description:         string | null
  transaction_ref:     string | null
  remarks:             string | null
  source:              'intrabank_transfers' | 'inflow' | 'outflow'
  offset_role:         string | null
  root_transaction_id: string | null
  import_seq?:         number
  inflowData?:         InflowTransaction
  outflowData?:        OutflowTransaction
}

// ── Deposits sort config ───────────────────────────────────────────────────────

const BD_COLUMNS: TableColumnDef<DepositRow>[] = [
  { key: 'date',            label: 'Date',        sortType: 'date',    primary: true, noSearch: true },
  { key: 'amount',          label: 'Amount',      sortType: 'numeric', primary: true, accessor: r => String(r.amount) },
  { key: 'bank_name',       label: 'Bank',        sortType: 'text',    primary: true, accessor: r => r.bank_name ?? '' },
  { key: 'description',     label: 'Description',                      accessor: r => r.description ?? '' },
  { key: 'transaction_ref', label: 'Reference',   sortType: 'text',    accessor: r => r.transaction_ref ?? '' },
]
const BD_SORT_FIELDS = deriveSortFields(BD_COLUMNS)

type Tab = 'deposits' | 'transfers'

// ── Shell ──────────────────────────────────────────────────────────────────────

export default function BankMovement() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') as Tab | null

  usePageTitle(tab === 'deposits' ? 'Bank Deposits' : tab === 'transfers' ? 'Intrabank Transfers' : 'Bank Deposits & Transfers')

  const setTab = (t: Tab) => setSearchParams({ tab: t }, { replace: true })
  const showHub = () => setSearchParams({}, { replace: true })

  return (
    <div className="space-y-5">
      <PageHelpBanner storageKey="help-dismissed-bank-movement" title="Bank Deposits vs Intrabank Transfers">
        <strong>Bank Deposits</strong> record physical cash being deposited into a bank account —
        separate from inflows, they document when cash arrives at the bank for reconciliation purposes.{' '}
        <strong>Intrabank Transfers</strong> record fund movements between two of your own bank accounts.
        Both use root/offset linking to pair the originating entry with its corresponding record.
      </PageHelpBanner>

      <div className="pb-4 border-b border-gray-100">
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Bank Deposits &amp; Transfers</h1>
        <p className="text-sm text-gray-500 mt-0.5">Deposits into banks and transfers between banks</p>
      </div>

      {tab === null ? (
        <BankMovementHub onSelectTab={setTab} />
      ) : (
        <>
          <button
            type="button"
            onClick={showHub}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Show summary
          </button>

          {/* Tab strip */}
          <div className="flex border-b border-gray-200">
            {([
              { key: 'deposits'  as Tab, label: 'Bank Deposits',      icon: Landmark       },
              { key: 'transfers' as Tab, label: 'Intrabank Transfers', icon: ArrowRightLeft },
            ]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-semibold border-b-2 transition-colors ${
                  tab === key
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {tab === 'deposits' ? <DepositsPanel /> : <TransfersPanel />}
        </>
      )}
    </div>
  )
}

// ── Hub (summary landing) ────────────────────────────────────────────────────────

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7))
  return MONTH_ABBR[m - 1] ?? ym
}

function BankMovementHub({ onSelectTab }: { onSelectTab: (t: Tab) => void }) {
  const { baseCurrencyCode } = useOrgCurrency()
  const { deposits, transfers, loading, error } = useBankMovementSummary()
  const animatedDeposits  = useCountUp(deposits.total)
  const animatedTransfers = useCountUp(transfers.total)
  const chartData = deposits.monthly.map(p => ({ ...p, label: monthLabel(p.month) }))

  if (loading && deposits.count === 0 && transfers.count === 0) {
    return <div className="h-64 rounded-2xl border border-gray-100 bg-white animate-pulse" />
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Total Deposits</p>
          <p className="text-2xl font-extrabold tabular-nums text-gray-900 mt-1">{formatCurrency(animatedDeposits, baseCurrencyCode)}</p>
          <p className="text-xs text-gray-400 mt-1">{deposits.count.toLocaleString()} deposit{deposits.count !== 1 ? 's' : ''}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Total Transfers</p>
          <p className="text-2xl font-extrabold tabular-nums text-gray-900 mt-1">{formatCurrency(animatedTransfers, baseCurrencyCode)}</p>
          <p className="text-xs text-gray-400 mt-1">{transfers.count.toLocaleString()} transfer{transfers.count !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {chartData.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">Monthly deposits</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <RTooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                formatter={(v: number) => [formatCurrency(v, baseCurrencyCode), 'Deposited']}
                labelFormatter={() => ''}
              />
              <Bar dataKey="amount" radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={40} onClick={() => onSelectTab('deposits')}>
                {chartData.map(d => <Cell key={d.month} fill="#0D7377" />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {transfers.byBank.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">Transfer activity by bank</p>
          <RankedBarChart items={transfers.byBank} color="#0D7377" activeName={null} onSelect={() => onSelectTab('transfers')} />
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
        <button
          type="button"
          onClick={() => onSelectTab('deposits')}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Landmark className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-sm font-medium text-gray-800">Bank Deposits</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
            {deposits.count.toLocaleString()} · {formatCurrency(deposits.total, baseCurrencyCode)}
            <ChevronRight className="w-4 h-4" />
          </span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('transfers')}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <ArrowRightLeft className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-sm font-medium text-gray-800">Intrabank Transfers</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
            {transfers.count.toLocaleString()} · {formatCurrency(transfers.total, baseCurrencyCode)}
            <ChevronRight className="w-4 h-4" />
          </span>
        </button>
      </div>
    </div>
  )
}

// ── Deposits panel ─────────────────────────────────────────────────────────────

function DepositsPanel() {
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()
  const { banks }             = useBanks()
  const { isAdmin, canWrite } = useRole()
  const { push }              = useToastStore()
  const admin                 = isAdmin()
  const orgId                 = useOrgStore((s) => s.orgId)

  const [rows,         setRows]         = useState<DepositRow[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const bdState = useDataViewState({ storageKey: 'bd', defaultSortKey: 'date', defaultSortDir: 'desc' })
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [datePreset,   setDatePreset]   = useState<DatePreset | null>(null)
  const [bankFilter,   setBankFilter]   = useState('')
  const [editInflow,       setEditInflow]       = useState<InflowTransaction | null>(null)
  const [editOutflow,      setEditOutflow]      = useState<OutflowTransaction | null>(null)
  const [deleteTarget,     setDeleteTarget]     = useState<DepositRow | null>(null)
  const [linkGroupTarget,  setLinkGroupTarget]  = useState<DepositRow | null>(null)
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()
  const [deleting,     setDeleting]     = useState(false)
  const [showRecon,    setShowRecon]    = useState(false)
  const [reconData,    setReconData]    = useState<{ inflowTaggedTotal: number; outflowTaggedTotal: number } | null>(null)
  const [reconLoading, setReconLoading] = useState(false)
  const [expandedId,   setExpandedId]   = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    const [depRes, inflowRes, outflowRes] = await Promise.all([
      supabase
        .from('bank_deposits')
        .select('id, date, bank_id, bank_name, amount, description, transaction_ref, remarks, import_seq')
        .eq('org_id', orgId)
        .order('date', { ascending: false })
        .order('import_seq', { ascending: false }),
      supabase.from('inflow_transactions').select('*').eq('org_id', orgId).eq('transaction_type', 'bank_deposit').order('date', { ascending: false }),
      supabase.from('outflow_transactions').select('*').eq('org_id', orgId).eq('transaction_type', 'bank_deposit').order('date', { ascending: false }),
    ])
    if (depRes.error) { setError(friendlyError(depRes.error, 'load deposits')); setLoading(false); return }

    const depositRows: DepositRow[] = (depRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...(r as Omit<DepositRow, 'source' | 'offset_role' | 'root_transaction_id' | 'deposit_group_id'>),
      source: 'bank_deposits' as const, offset_role: null, root_transaction_id: null, deposit_group_id: null,
      import_seq: r.import_seq as number | undefined,
    }))
    const inflowRows: DepositRow[] = (inflowRes.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string, date: r.date as string, bank_id: null,
      bank_name: r.bank_name as string | null, amount: r.amount as number,
      description: r.description as string | null, transaction_ref: r.transaction_ref as string | null,
      remarks: r.remark as string | null, source: 'inflow' as const,
      offset_role: r.offset_role as string | null, root_transaction_id: r.root_transaction_id as string | null,
      deposit_group_id: r.deposit_group_id as string | null ?? null,
      import_seq: r.import_seq as number | undefined,
      inflowData: r as unknown as InflowTransaction,
    }))
    const outflowRows: DepositRow[] = (outflowRes.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string, date: r.date as string, bank_id: null,
      bank_name: r.bank_name as string | null, amount: r.amount_disbursed as number,
      description: r.description as string | null, transaction_ref: r.transaction_id as string | null,
      remarks: r.remarks as string | null, source: 'outflow' as const,
      offset_role: r.offset_role as string | null, root_transaction_id: r.root_transaction_id as string | null,
      deposit_group_id: r.deposit_group_id as string | null ?? null,
      import_seq: r.import_seq as number | undefined,
      outflowData: r as unknown as OutflowTransaction,
    }))

    setRows([...depositRows, ...inflowRows, ...outflowRows].sort((a, b) => b.date.localeCompare(a.date) || (b.import_seq ?? 0) - (a.import_seq ?? 0)))
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load])

  const loadRecon = async () => {
    if (!orgId) return
    setReconLoading(true)
    const [infRes, outRes] = await Promise.all([
      supabase.from('inflow_transactions').select('amount').eq('org_id', orgId).eq('transaction_type', 'bank_deposit'),
      supabase.from('outflow_transactions').select('amount_disbursed').eq('org_id', orgId).eq('transaction_type', 'bank_deposit'),
    ])
    setReconData({
      inflowTaggedTotal:  (infRes.data ?? []).reduce((s, r) => s + (r.amount ?? 0), 0),
      outflowTaggedTotal: (outRes.data ?? []).reduce((s, r) => s + (r.amount_disbursed ?? 0), 0),
    })
    setReconLoading(false)
  }

  const toggleRecon = () => { if (!showRecon && !reconData) loadRecon(); setShowRecon(v => !v) }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    const { error: err } = await supabase.from('bank_deposits').delete().eq('id', deleteTarget.id)
    setDeleting(false); setDeleteTarget(null)
    if (err) { push(friendlyError(err, 'delete the record'), 'error'); return }
    push('Deposit deleted.', 'success'); load()
  }

  const selectedBankName = bankFilter ? (banks.find(b => b.id === bankFilter)?.name ?? null) : null

  useEffect(() => { bdState.setPage(0) }, [dateFrom, dateTo, bankFilter, bdState.setPage])

  const dateFiltered = useMemo(() => rows.filter(r => {
    if (dateFrom && r.date < dateFrom) return false
    if (dateTo   && r.date > dateTo)   return false
    if (bankFilter) {
      if (r.source === 'bank_deposits') { if (r.bank_id !== bankFilter) return false }
      else { if (selectedBankName && r.bank_name !== selectedBankName) return false }
    }
    return true
  }), [rows, dateFrom, dateTo, bankFilter, selectedBankName])

  const searchFiltered = useMemo(
    () => searchRows(dateFiltered, BD_COLUMNS, bdState.search, bdState.searchCol),
    [dateFiltered, bdState.search, bdState.searchCol],
  )

  const getBdValue = (r: DepositRow, k: string) => {
    if (k === 'amount')          return r.amount
    if (k === 'bank_name')       return r.bank_name ?? ''
    if (k === 'description')     return r.description ?? ''
    if (k === 'transaction_ref') return r.transaction_ref ?? ''
    return r.date
  }

  const sortedRows = useMemo(() => {
    const adv = bdState.advancedSort
    if (adv.length > 0) return multiSortRows(searchFiltered, getBdValue, adv, BD_SORT_FIELDS)
    return sortRows(searchFiltered, getBdValue, bdState.sortKey, bdState.sortDir, BD_SORT_FIELDS)
  }, [searchFiltered, bdState.sortKey, bdState.sortDir, bdState.advancedSort])

  const pagedRows = useMemo(() => {
    const start = bdState.page * bdState.pageSize
    return sortedRows.slice(start, start + bdState.pageSize)
  }, [sortedRows, bdState.page, bdState.pageSize])

  const handleLinkRoot = (row: DepositRow) => {
    if (row.source === 'inflow' && row.inflowData) setEditInflow(row.inflowData)
    else if (row.source === 'outflow' && row.outflowData) setEditOutflow(row.outflowData)
  }

  const depositDetailItems = (row: DepositRow): DetailItem[] => [
    { label: 'Transaction Ref', value: row.transaction_ref, mono: true, breakAll: true },
    { label: 'Remarks',         value: row.remarks,         breakAll: true },
    { label: 'Source',          value: row.source === 'bank_deposits' ? 'Bank Deposit Record' : row.source === 'inflow' ? 'Inflow Transaction' : 'Outflow Transaction' },
    { label: 'Raw Description', value: row.description,     breakAll: true },
    {
      label: 'Offset Role',
      value: row.offset_role === 'root' ? 'Root' : row.offset_role === 'offset' ? 'Offset' : null,
      badge: row.offset_role === 'root' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
    },
    { label: 'Group ID', value: row.deposit_group_id, mono: true, breakAll: true },
  ]

  const depositGroupFooter = (row: DepositRow): React.ReactNode => {
    if (!row.deposit_group_id) return undefined
    const members = rows.filter(
      r => r.deposit_group_id === row.deposit_group_id &&
        !(r.source === row.source && r.id === row.id),
    )
    if (members.length === 0) return undefined
    const rootTotal   = members.filter(m => m.offset_role === 'root').reduce((s, m) => s + m.amount, 0)
      + (row.offset_role === 'root' ? row.amount : 0)
    const offsetTotal = members.filter(m => m.offset_role === 'offset').reduce((s, m) => s + m.amount, 0)
      + (row.offset_role === 'offset' ? row.amount : 0)
    const balanced = Math.abs(rootTotal - offsetTotal) < 0.01
    return (
      <div className="col-span-full mt-3 pt-3 border-t border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400">
            Linked Group Members ({members.length})
          </p>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${balanced ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
            {balanced ? 'Balanced' : 'Mismatch'}
          </span>
        </div>
        <div className="space-y-1.5">
          {members.map(m => (
            <div key={`${m.source}-${m.id}`} className="flex items-center gap-2 text-xs">
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                m.offset_role === 'root' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {m.offset_role === 'root' ? 'Root' : 'Offset'}
              </span>
              <span className="text-gray-500 shrink-0">{formatDate(m.date)}</span>
              <span className="text-gray-700 shrink-0">{m.bank_name ?? '—'}</span>
              <span className="font-mono font-semibold text-gray-900 shrink-0">{formatCurrency(m.amount, baseCurrencyCode)}</span>
              {m.description && <span className="text-gray-400 truncate">{m.description}</span>}
            </div>
          ))}
        </div>
      </div>
    )
  }

  const BD_CSV_HEADERS = ['Date', 'Bank', 'Description', `Amount (${baseCurrencySymbol})`, 'Ref', 'Remarks', 'Source']
  const BD_SRC: Record<string, string> = { bank_deposits: 'Deposit', inflow: 'Inflow', outflow: 'Outflow' }
  const bdCsvRow = (r: DepositRow) => [r.date, r.bank_name ?? '', r.description ?? '', r.amount, r.transaction_ref ?? '', r.remarks ?? '', BD_SRC[r.source] ?? r.source]
  const BD_CSV_FILE = `bank-deposits-${new Date().toISOString().slice(0, 10)}.csv`

  const colCount = 8

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load bank deposits</p>
      <p className="text-sm text-gray-500">{error}</p>
      <button onClick={load} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Export */}
      <div className="flex justify-end">
        <ExportDropdown
          onExportView={() => exportCSV(BD_CSV_FILE, BD_CSV_HEADERS, pagedRows.map(bdCsvRow))}
          onExportAll={()  => exportCSV(BD_CSV_FILE, BD_CSV_HEADERS, sortedRows.map(bdCsvRow))}
          disabled={sortedRows.length === 0}
        />
      </div>

      {/* Filters */}
      <Card>
        <div className="space-y-3">
          <DatePresetBar activePreset={datePreset} onPreset={(p, f, t) => { setDatePreset(p); setDateFrom(f); setDateTo(t) }} onCustom={() => setDatePreset('custom')} />
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">From</label>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setDatePreset('custom') }} className={filterInputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">To</label>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setDatePreset('custom') }} className={filterInputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">Bank</label>
              <select value={bankFilter} onChange={e => setBankFilter(e.target.value)} className={filterInputCls}>
                <option value="">All banks</option>
                {banks.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            {(dateFrom || dateTo || bankFilter || datePreset) && (
              <button onClick={() => { setDateFrom(''); setDateTo(''); setDatePreset(null); setBankFilter('') }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                Clear
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Summary strip */}
      {(() => {
        const el = dateFiltered.filter(r => r.source !== 'bank_deposits')
        const roots = el.filter(r => r.offset_role === 'root'), offsets = el.filter(r => r.offset_role === 'offset'), untagged = el.filter(r => !r.offset_role)
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total rows',   sub: null,                         value: dateFiltered.length.toLocaleString(),                                                                                             accent: 'border-gray-100 text-gray-900'  },
              { label: 'Originals',    sub: 'the root deposit source',    value: `${roots.length.toLocaleString()} · ${formatCurrency(roots.reduce((s,r)=>s+r.amount,0), baseCurrencyCode)}`,   accent: 'border-green-200 text-green-700' },
              { label: 'Deposits',     sub: 'the offset entry',           value: `${offsets.length.toLocaleString()} · ${formatCurrency(offsets.reduce((s,r)=>s+r.amount,0), baseCurrencyCode)}`, accent: 'border-amber-200 text-amber-700' },
              { label: 'Needs review', sub: "hasn't been classified yet", value: untagged.length.toLocaleString(),                                                                                             accent: untagged.length > 0 ? 'border-red-200 text-red-600' : 'border-gray-100 text-gray-900' },
            ].map(({ label, sub, value, accent }) => (
              <div key={label} className={`bg-white rounded-xl border shadow-sm px-4 py-3 ${accent.split(' ')[0]}`}>
                <p className="text-xs font-semibold text-gray-700 mb-0.5">{label}</p>
                {sub && <p className="text-xs text-gray-500 mb-1 leading-tight">{sub}</p>}
                {loading ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4 mt-1" />
                  : <p className={`text-base font-bold tabular-nums ${accent.split(' ')[1]}`}>{value}</p>}
              </div>
            ))}
          </div>
        )
      })()}

      {/* Reconciliation panel */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <button onClick={toggleRecon}
          className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-gray-700 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
          <span className="flex items-center gap-2"><Landmark className="w-4 h-4 text-primary" />Reconciliation — Tagged Inflows vs Tagged Outflows</span>
          {showRecon ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </button>
        {showRecon && (
          <div className="px-4 pb-4 border-t border-gray-100">
            {reconLoading ? (
              <div className="py-6 flex justify-center"><div className="h-5 w-48 bg-gray-200 rounded animate-pulse" /></div>
            ) : reconData ? (
              <div className="mt-3 space-y-2">
                <ReconRow label="Inflow rows tagged 'bank_deposit'"  value={reconData.inflowTaggedTotal} />
                <ReconRow label="Outflow rows tagged 'bank_deposit'" value={reconData.outflowTaggedTotal} />
                <div className="border-t border-gray-200 pt-2">
                  <ReconRow label="Net (Inflows − Outflows)" value={reconData.inflowTaggedTotal - reconData.outflowTaggedTotal} highlight />
                </div>
                <button onClick={loadRecon} className="mt-2 text-xs text-primary hover:underline flex items-center gap-1">
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Table / Cards */}
      <Card padding={false}>
        <div className="p-3 border-b border-gray-100">
          <DataControlsBar
            columns={BD_COLUMNS} sortKey={bdState.sortKey} sortDir={bdState.sortDir} onSort={bdState.setSort}
            defaultSortKey="date" defaultSortDir="desc" view={bdState.view} onViewChange={bdState.setView}
            search={bdState.search} onSearchChange={bdState.setSearch} searchPlaceholder="Search deposits…"
            searchCol={bdState.searchCol} onSearchColChange={bdState.setSearchCol}
            advancedSort={bdState.advancedSort} onAdvancedSort={bdState.setAdvancedSort}
            pageSize={bdState.pageSize} onPageSizeChange={bdState.setPageSize}
          />
        </div>
        <PaginationBar page={bdState.page} pageSize={bdState.pageSize} total={sortedRows.length} onPageChange={bdState.setPage} variant="compact" />
        {bdState.view === 'cards' ? (
          <div className="p-4 space-y-3">
            {loading ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-gray-200 overflow-hidden shadow-sm animate-pulse">
                <div className="px-4 pt-3.5 pb-3 space-y-2"><div className="h-3 bg-gray-200 rounded w-1/4" /><div className="h-4 bg-gray-200 rounded w-3/4" /></div>
                <div className="border-t border-gray-100 bg-gray-50/40 px-4 py-3 grid grid-cols-2 gap-4"><div className="h-8 bg-gray-200 rounded" /><div className="h-8 bg-gray-200 rounded" /></div>
              </div>
            )) : sortedRows.length === 0 ? (
              <PageEmptyState pageId="bank-deposits" compact />
            ) : pagedRows.map(row => (
              <div key={`${row.source}-${row.id}`} className="rounded-xl border overflow-hidden shadow-sm bg-white border-gray-200">
                <div className="px-4 pt-3.5 pb-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-xs font-semibold text-gray-400">{formatDate(row.date)}</p>
                    <SourceBadge source={row.source} />
                  </div>
                  {row.bank_name && <p className="text-xs text-gray-500 mb-1.5">{row.bank_name}</p>}
                  {row.description && (
                    <div className="text-sm mb-1">
                      <DescriptionCell id={`card-desc-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-800" />
                    </div>
                  )}
                  {row.transaction_ref && <p className="text-xs text-gray-500 font-mono">Ref: {row.transaction_ref}</p>}
                  {row.remarks && (
                    <div className="text-xs mt-1.5">
                      <DescriptionCell id={`card-rem-${row.id}`} text={row.remarks} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-400" />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 border-t border-gray-100 bg-gray-50/40 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide font-semibold mb-0.5 text-gray-500">Amount</p>
                    <p className="text-sm font-mono font-bold tabular-nums text-gray-900">{formatCurrency(row.amount, baseCurrencyCode)}</p>
                  </div>
                  <div className="border-l border-gray-200/80 pl-4 min-w-0 flex items-center justify-end gap-0.5">
                    {admin && row.source === 'bank_deposits' && (
                      <button onClick={() => setDeleteTarget(row)} className="touch-target p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-danger transition-colors" title="Delete" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                    {canWrite() && (row.source === 'inflow' || row.source === 'outflow') && (
                      <>
                        <button onClick={() => handleLinkRoot(row)} className="touch-target p-1.5 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit" aria-label="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                        {row.deposit_group_id && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700 flex items-center gap-0.5" title="Part of a deposit group">
                            <Layers className="w-2.5 h-2.5" />G
                          </span>
                        )}
                        {!row.deposit_group_id && row.offset_role === 'root' && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700" title="Root transaction">R</span>
                        )}
                        {!row.deposit_group_id && row.root_transaction_id === null && row.offset_role !== 'root' && (
                          <button onClick={() => setLinkGroupTarget(row)} className="touch-target p-1.5 rounded text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Add to deposit group" aria-label="Add to deposit group"><Link2 className="w-3.5 h-3.5" /></button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto scroll-x-fade">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="w-8" />
                  <SortableHeader field={BD_SORT_FIELDS[0]} activeSortKey={bdState.sortKey} activeSortDir={bdState.sortDir} onSort={bdState.setSort} className="px-4 py-3" />
                  <SortableHeader field={BD_SORT_FIELDS[2]} activeSortKey={bdState.sortKey} activeSortDir={bdState.sortDir} onSort={bdState.setSort} className="px-4 py-3" />
                  <SortableHeader field={BD_SORT_FIELDS[1]} activeSortKey={bdState.sortKey} activeSortDir={bdState.sortDir} onSort={bdState.setSort} rightAlign className="px-4 py-3" />
                  {['Description', 'Remarks', 'Source', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: colCount }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>)}</tr>
                )) : sortedRows.length === 0 ? (
                  <tr><td colSpan={colCount}><PageEmptyState pageId="bank-deposits" compact /></td></tr>
                ) : pagedRows.flatMap(row => {
                  const isExpanded = expandedId === `${row.source}-${row.id}`
                  return [
                    <tr key={`${row.source}-${row.id}`} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                      <td className="w-8 px-1 py-3">
                        <button onClick={() => setExpandedId(isExpanded ? null : `${row.source}-${row.id}`)}
                          className="touch-target p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.bank_name ?? '—'}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-gray-900 whitespace-nowrap">{formatCurrency(row.amount, baseCurrencyCode)}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 max-w-[300px]">
                        <DescriptionCell id={`${row.source}-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px]">
                        <DescriptionCell id={`rem-${row.source}-${row.id}`} text={row.remarks} tooltip={descTooltip} setTooltip={setDescTooltip} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap"><SourceBadge source={row.source} /></td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {admin && row.source === 'bank_deposits' && (
                            <button onClick={() => setDeleteTarget(row)} className="touch-target p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-danger transition-colors" title="Delete" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                          {canWrite() && (row.source === 'inflow' || row.source === 'outflow') && (
                            <>
                              <button onClick={() => handleLinkRoot(row)} className="touch-target p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-primary transition-colors" title="Edit" aria-label="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                              {row.deposit_group_id && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-violet-100 text-violet-700 flex items-center gap-0.5" title="Part of a deposit group">
                                  <Layers className="w-2.5 h-2.5" />G
                                </span>
                              )}
                              {!row.deposit_group_id && row.offset_role === 'root' && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700" title="Root transaction">R</span>
                              )}
                              {!row.deposit_group_id && row.root_transaction_id === null && row.offset_role !== 'root' && (
                                <button onClick={() => setLinkGroupTarget(row)} className="touch-target p-1.5 rounded text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Add to deposit group" aria-label="Add to deposit group"><Link2 className="w-3.5 h-3.5" /></button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>,
                    isExpanded && <RowDetailPanel key={`${row.source}-${row.id}-detail`} items={depositDetailItems(row)} colSpan={colCount} footer={depositGroupFooter(row)} />,
                  ]
                }).filter(Boolean)}
              </tbody>
            </table>
          </div>
        )}
        <PaginationBar page={bdState.page} pageSize={bdState.pageSize} total={sortedRows.length} onPageChange={bdState.setPage} variant="full" />
      </Card>

      <AddInflowModal open={!!editInflow} onClose={() => setEditInflow(null)} onSuccess={() => { setEditInflow(null); load() }} editRecord={editInflow} />
      <AddOutflowModal open={!!editOutflow} onClose={() => setEditOutflow(null)} onSuccess={() => { setEditOutflow(null); load() }} editRecord={editOutflow} />
      <DeleteDialog
        open={!!deleteTarget}
        label={deleteTarget ? `deposit of ${formatCurrency(deleteTarget.amount, baseCurrencyCode)} on ${formatDate(deleteTarget.date)}` : 'this record'}
        loading={deleting} onConfirm={handleDelete} onClose={() => setDeleteTarget(null)}
      />
      {linkGroupTarget && (
        <LinkDepositGroupModal
          open={!!linkGroupTarget}
          onClose={() => setLinkGroupTarget(null)}
          onSuccess={() => { setLinkGroupTarget(null); load() }}
          targetRow={linkGroupTarget as unknown as import('../components/modals/LinkDepositGroupModal').GroupableRow}
          allRows={
            rows.filter((r): r is DepositRow & { source: 'inflow' | 'outflow' } =>
              r.source === 'inflow' || r.source === 'outflow',
            )
          }
        />
      )}
      <DescriptionTooltip tooltip={descTooltip} />
    </div>
  )
}

// ── Transfers panel ────────────────────────────────────────────────────────────

function TransfersPanel() {
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
  const [editInflow,  setEditInflow]  = useState<InflowTransaction | null>(null)
  const [editOutflow, setEditOutflow] = useState<OutflowTransaction | null>(null)
  const [deleteId,    setDeleteId]    = useState<string | null>(null)
  const [deleting,    setDeleting]    = useState(false)
  const [expandedId,  setExpandedId]  = useState<string | null>(null)

  const transferDetailItems = (row: TransferRow): DetailItem[] => [
    { label: 'Transaction Ref', value: row.transaction_ref, mono: true, breakAll: true },
    { label: 'Remarks',         value: row.remarks,         breakAll: true },
    { label: 'From Bank',       value: row.from_bank_name },
    { label: 'To Bank',         value: row.to_bank_name },
    { label: 'Raw Description', value: row.description,     breakAll: true },
    {
      label: 'Offset Role',
      value: row.offset_role === 'root' ? 'Root' : row.offset_role === 'offset' ? 'Offset' : null,
      badge: row.offset_role === 'root' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
    },
  ]

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const [transferRes, inflowRes, outflowRes] = await Promise.all([
      supabase.from('intrabank_transfers').select('*').order('date', { ascending: false }).order('import_seq', { ascending: false }),
      ...(orgId ? [
        supabase.from('inflow_transactions').select('*').eq('org_id', orgId).eq('transaction_type', 'intrabank_transfer').order('date', { ascending: false }),
        supabase.from('outflow_transactions').select('*').eq('org_id', orgId).eq('transaction_type', 'intrabank_transfer').order('date', { ascending: false }),
      ] : [Promise.resolve({ data: [], error: null }), Promise.resolve({ data: [], error: null })]),
    ])
    if (transferRes.error) { setError(friendlyError(transferRes.error, 'load transfers')); setLoading(false); return }

    const transferRows: TransferRow[] = (transferRes.data ?? []).map((r: Record<string, unknown>) => ({
      ...(r as unknown as TransferRow), source: 'intrabank_transfers' as const, offset_role: null, root_transaction_id: null,
      import_seq: r.import_seq as number | undefined,
    }))
    const inRows: TransferRow[] = (inflowRes.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string, date: r.date as string, from_bank_id: null, from_bank_name: r.bank_name as string | null,
      to_bank_id: null, to_bank_name: null, amount: r.amount as number,
      description: r.description as string | null, transaction_ref: r.transaction_ref as string | null,
      remarks: r.remark as string | null, source: 'inflow' as const,
      offset_role: r.offset_role as string | null, root_transaction_id: r.root_transaction_id as string | null,
      import_seq: r.import_seq as number | undefined,
      inflowData: r as unknown as InflowTransaction,
    }))
    const outRows: TransferRow[] = (outflowRes.data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id as string, date: r.date as string, from_bank_id: null, from_bank_name: r.bank_name as string | null,
      to_bank_id: null, to_bank_name: null, amount: r.amount_disbursed as number,
      description: r.description as string | null, transaction_ref: r.transaction_id as string | null,
      remarks: r.remarks as string | null, source: 'outflow' as const,
      offset_role: r.offset_role as string | null, root_transaction_id: r.root_transaction_id as string | null,
      import_seq: r.import_seq as number | undefined,
      outflowData: r as unknown as OutflowTransaction,
    }))
    setRows([...transferRows, ...inRows, ...outRows].sort((a, b) => b.date.localeCompare(a.date) || (b.import_seq ?? 0) - (a.import_seq ?? 0)))
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load])

  const filtered = rows.filter(r => {
    if (dateFrom   && r.date < dateFrom)   return false
    if (dateTo     && r.date > dateTo)     return false
    if (bankFilter && r.from_bank_id !== bankFilter && r.to_bank_id !== bankFilter) return false
    return true
  })

  const handleLinkRoot = (row: TransferRow) => {
    if (row.source === 'inflow' && row.inflowData) setEditInflow(row.inflowData)
    else if (row.source === 'outflow' && row.outflowData) setEditOutflow(row.outflowData)
  }

  const IBT_CSV_HEADERS = ['Date', 'From Bank', 'To Bank', `Amount (${baseCurrencySymbol})`, 'Description', 'Ref', 'Remarks']
  const ibtCsvRow = (r: TransferRow) => [r.date, r.from_bank_name ?? '', r.to_bank_name ?? '', r.amount, r.description ?? '', r.transaction_ref ?? '', r.remarks ?? '']
  const IBT_CSV_FILE = `intrabank-transfers-${new Date().toISOString().slice(0, 10)}.csv`

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    const { error: err } = await supabase.from('intrabank_transfers').delete().eq('id', deleteId)
    setDeleting(false)
    if (err) { toast(friendlyError(err, 'delete the transfer'), 'error'); return }
    toast('Transfer deleted.', 'success'); setDeleteId(null); load()
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
    <div className="space-y-5">
      {/* Export + view toggle */}
      <div className="flex items-center justify-end gap-2">
        <ExportDropdown
          onExportView={() => exportCSV(IBT_CSV_FILE, IBT_CSV_HEADERS, filtered.map(ibtCsvRow))}
          onExportAll={()  => exportCSV(IBT_CSV_FILE, IBT_CSV_HEADERS, filtered.map(ibtCsvRow))}
          disabled={filtered.length === 0}
        />
        <div className="flex items-center gap-0.5 p-1 bg-gray-100 rounded-lg">
          <button onClick={() => setDisplayMode('table')} title="Table view" aria-label="Table view"
            className={`touch-target p-1.5 rounded-md transition-colors ${displayMode === 'table' ? 'bg-white shadow-sm text-primary' : 'text-gray-400 hover:text-gray-600'}`}>
            <LayoutList className="w-4 h-4" />
          </button>
          <button onClick={() => setDisplayMode('cards')} title="Card view" aria-label="Card view"
            className={`touch-target p-1.5 rounded-md transition-colors ${displayMode === 'cards' ? 'bg-white shadow-sm text-primary' : 'text-gray-400 hover:text-gray-600'}`}>
            <LayoutGrid className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <div className="space-y-3">
          <DatePresetBar activePreset={datePreset} onPreset={(p, f, t) => { setDatePreset(p); setDateFrom(f); setDateTo(t) }} onCustom={() => setDatePreset('custom')} />
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
                options={banks.map(b => ({ value: b.id, label: b.name }))} placeholder="All banks" className={filterInputCls} />
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
        const el = filtered.filter(r => r.source !== 'intrabank_transfers')
        const roots = el.filter(r => r.offset_role === 'root'), offsets = el.filter(r => r.offset_role === 'offset'), untagged = el.filter(r => !r.offset_role)
        return (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Total rows',   sub: null,                              value: filtered.length.toLocaleString(),                                                                                               accent: 'border-gray-100 text-gray-900'  },
              { label: 'Originals',    sub: 'the source transfer entry',       value: `${roots.length.toLocaleString()} · ${formatCurrency(roots.reduce((s,r)=>s+r.amount,0), baseCurrencyCode)}`,   accent: 'border-green-200 text-green-700' },
              { label: 'Transfers',    sub: 'the offset entry',                value: `${offsets.length.toLocaleString()} · ${formatCurrency(offsets.reduce((s,r)=>s+r.amount,0), baseCurrencyCode)}`, accent: 'border-amber-200 text-amber-700' },
              { label: 'Needs review', sub: "hasn't been classified yet",      value: untagged.length.toLocaleString(),                                                                                               accent: untagged.length > 0 ? 'border-red-200 text-red-600' : 'border-gray-100 text-gray-900' },
            ].map(({ label, sub, value, accent }) => (
              <div key={label} className={`bg-white rounded-xl border shadow-sm px-4 py-3 ${accent.split(' ')[0]}`}>
                <p className="text-xs font-semibold text-gray-700 mb-0.5">{label}</p>
                {sub && <p className="text-xs text-gray-500 mb-1 leading-tight">{sub}</p>}
                {loading ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4 mt-1" />
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
            {loading ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-gray-200 overflow-hidden shadow-sm animate-pulse">
                <div className="px-4 pt-3.5 pb-3 space-y-2"><div className="h-3 bg-gray-200 rounded w-1/4" /><div className="h-4 bg-gray-200 rounded w-3/4" /></div>
                <div className="border-t border-gray-100 bg-gray-50/40 px-4 py-3 grid grid-cols-2 gap-4"><div className="h-8 bg-gray-200 rounded" /><div className="h-8 bg-gray-200 rounded" /></div>
              </div>
            )) : filtered.length === 0 ? (
              <PageEmptyState pageId="intrabank-transfers" compact />
            ) : filtered.map(row => (
              <div key={row.id} className="rounded-xl border overflow-hidden shadow-sm bg-white border-gray-200">
                <div className="px-4 pt-3.5 pb-3">
                  <p className="text-xs font-semibold mb-2 text-gray-400">{formatDate(row.date)}</p>
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
                  {row.transaction_ref && <p className="text-xs text-gray-500 font-mono mt-1">{row.transaction_ref}</p>}
                </div>
                <div className="grid grid-cols-2 border-t border-gray-100 bg-gray-50/40 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide font-semibold mb-0.5 text-gray-500">Transfer</p>
                    <p className="text-sm font-mono font-bold tabular-nums text-primary">{formatCurrency(row.amount, baseCurrencyCode)}</p>
                  </div>
                  <div className="border-l border-gray-200/80 pl-4 min-w-0 flex items-center justify-end gap-0.5">
                    {row.source === 'intrabank_transfers' && canWrite() && (
                      <button onClick={() => setDeleteId(row.id)} className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors" title="Delete" aria-label="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                    {(row.source === 'inflow' || row.source === 'outflow') && canWrite() && (
                      <>
                        <button onClick={() => handleLinkRoot(row)} className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit" aria-label="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                        {row.offset_role === 'root' && <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700" title="Root transaction">R</span>}
                        {row.offset_role !== 'root' && row.root_transaction_id === null && (
                          <button onClick={() => handleLinkRoot(row)} className="touch-target p-1.5 rounded-lg text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Link to root" aria-label="Link to root"><Link2 className="w-3.5 h-3.5" /></button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto scroll-x-fade">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="w-8" />
                  {['Date', 'From Bank', 'To Bank', `Amount (${baseCurrencySymbol})`, 'Description', 'Ref', 'Remarks', 'Actions'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loading ? Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>{Array.from({ length: 9 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>)}</tr>
                )) : filtered.length === 0 ? (
                  <tr><td colSpan={9}><PageEmptyState pageId="intrabank-transfers" compact /></td></tr>
                ) : filtered.flatMap(row => {
                  const isExpanded = expandedId === row.id
                  return [
                    <tr key={row.id} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                      <td className="w-8 px-1 py-3">
                        <button onClick={() => setExpandedId(isExpanded ? null : row.id)}
                          className="touch-target p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
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
                            <button onClick={() => setDeleteId(row.id)} className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50" title="Delete" aria-label="Delete"><Trash2 className="w-4 h-4" /></button>
                          )}
                          {(row.source === 'inflow' || row.source === 'outflow') && canWrite() && (
                            <>
                              <button onClick={() => handleLinkRoot(row)} className="touch-target p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit" aria-label="Edit"><Pencil className="w-4 h-4" /></button>
                              {row.offset_role === 'root' && <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700" title="Root transaction">R</span>}
                              {row.offset_role !== 'root' && row.root_transaction_id === null && (
                                <button onClick={() => handleLinkRoot(row)} className="touch-target p-1.5 rounded-lg text-amber-400 hover:text-amber-600 hover:bg-amber-50 transition-colors" title="Link to root" aria-label="Link to root"><Link2 className="w-4 h-4" /></button>
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

      <AddInflowModal open={!!editInflow} onClose={() => setEditInflow(null)} onSuccess={() => { setEditInflow(null); load() }} editRecord={editInflow} />
      <AddOutflowModal open={!!editOutflow} onClose={() => setEditOutflow(null)} onSuccess={() => { setEditOutflow(null); load() }} editRecord={editOutflow} />
      <DeleteDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDelete} loading={deleting} label="this intrabank transfer" />
      <DescriptionTooltip tooltip={descTooltip} />
    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<DepositRow['source'], string> = { bank_deposits: 'Deposit', inflow: 'Inflow', outflow: 'Outflow' }
const SOURCE_CLS:   Record<DepositRow['source'], string> = { bank_deposits: 'bg-primary/10 text-primary', inflow: 'bg-green-100 text-green-700', outflow: 'bg-red-100 text-red-700' }

function SourceBadge({ source }: { source: DepositRow['source'] }) {
  return <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${SOURCE_CLS[source]}`}>{SOURCE_LABEL[source]}</span>
}

function ReconRow({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  const { baseCurrencyCode } = useOrgCurrency()
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-600">{label}</span>
      <span className={`font-semibold ${highlight && value !== 0 ? 'text-amber-600' : 'text-gray-900'}`}>
        {formatCurrency(value, baseCurrencyCode)}
      </span>
    </div>
  )
}
