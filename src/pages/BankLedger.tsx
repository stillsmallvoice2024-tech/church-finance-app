import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { BookOpen, AlertCircle, RefreshCw, Pencil, ChevronRight, ChevronDown, ArrowLeft, X, AlertTriangle, Landmark } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import { useDetailLevel } from '../hooks/useDetailLevel'
import { SimpleShell } from '../components/ui/SimpleShell'
import { useCountUp } from '../hooks/useCountUp'
import { useBankBalances, type BankBalance } from '../hooks/useBankBalances'
import { fetchAllRows } from '../utils/fetchAllRows'
import { Card }          from '../components/ui/Card'
import { filterInputCls } from '../components/ui/FormField'
import { DatePresetBar, type DatePreset } from '../components/ui/DatePresetBar'
import { HelpTooltip }   from '../components/ui/HelpTooltip'
import { usePageTitle }  from '../hooks/usePageTitle'
import { useBanks }      from '../hooks/useBanks'
import { useRole }       from '../hooks/useRole'
import { supabase }      from '../lib/supabase'
import { ReceiptBadge }  from '../components/ui/ReceiptBadge'
import { formatDate, formatCurrency } from '../utils/formatters'
import { exportCSV }     from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { AddInflowModal }  from '../components/modals/AddInflowModal'
import { AddOutflowModal } from '../components/modals/AddOutflowModal'
import { MarkDepositedModal } from '../components/modals/MarkDepositedModal'
import type { InflowTransaction, OutflowTransaction } from '../hooks/useTransactions'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { EmptyState } from '../components/ui/EmptyState'
import { PageEmptyState } from '../components/onboarding/PageEmptyState'
import { AmountCell } from '../components/ui/AmountCell'
import { RowDetailPanel } from '../components/ui/RowDetailPanel'
import { inflowDetailItems, outflowDetailItems } from '../utils/rowDetailItems'
import { DataControlsBar } from '../components/ui/DataControlsBar'
import { SortableHeader } from '../components/ui/SortableHeader'
import { PaginationBar } from '../components/ui/PaginationBar'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows } from '../utils/sortUtils'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields, searchRows } from '../utils/tableColumns'
import { SearchableSelect } from '../components/ui/SearchableSelect'
import { BALANCE_BROUGHT_FORWARD_TYPE, BF_DESCRIPTION } from '../utils/bankOpeningBalance'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { useOrgStore }    from '../store/orgStore'
import { HelpButton }      from '../components/onboarding/HelpButton'
import { PageHelpBanner }  from '../components/ui/PageHelpBanner'
import { useFirstVisitTour } from '../hooks/useFirstVisitTour'

// ── Types ──────────────────────────────────────────────────────────────────────

const MARK_DEPOSITED_HELP = 'Mark this cash as deposited — automatically creates the matching bank outflow for you, so you don’t have to enter it by hand.'

const TXN_TYPE_LABELS: Record<string, string> = {
  refund:                   'Refund',
  reversal:                 'Reversal',
  bank_deposit:             'Bank Deposit',
  intrabank_transfer:       'Intrabank Transfer',
  balance_brought_forward:  'Balance Brought Forward',
  fx_conversion:            'FX Conversion',
}

interface LedgerRow {
  id:                  string
  date:                string
  description:         string | null
  inflow:              number
  outflow:             number
  balance:             number   // running
  transaction_type:    string | null
  entity_type:         'inflow' | 'outflow'
  import_seq?:         number
  inflowData?:         InflowTransaction
  outflowData?:        OutflowTransaction
}

// ── Sort fields ────────────────────────────────────────────────────────────────

const BL_COLUMNS: TableColumnDef<LedgerRow>[] = [
  { key: 'date',        label: 'Date',        sortType: 'date',    primary: true, noSearch: true },
  { key: 'inflow',      label: 'Inflow',      sortType: 'numeric', primary: true, accessor: r => r.inflow > 0 ? String(r.inflow) : '' },
  { key: 'outflow',     label: 'Outflow',     sortType: 'numeric', primary: true, accessor: r => r.outflow > 0 ? String(r.outflow) : '' },
  { key: 'balance',     label: 'Balance',     sortType: 'numeric', primary: true },
  { key: 'description', label: 'Description',                      accessor: r => r.description ?? '' },
]

const BL_SORT_FIELDS = deriveSortFields(BL_COLUMNS)

// ── Page ───────────────────────────────────────────────────────────────────────

export default function BankLedger() {
  usePageTitle('Bank Ledger')
  useFirstVisitTour('bank-ledger')
  const { baseCurrencyCode } = useOrgCurrency()

  const { banks, loading: banksLoading, error: banksError } = useBanks()
  const { canWrite } = useRole()
  const orgId = useOrgStore(s => s.orgId)

  const [selectedBank, setSelectedBank] = useState('')
  const didAutoSelect = useRef(false)
  const { setLevel: setDetail, isSimple } = useDetailLevel('bank-ledger')
  const { balances, loading: balancesLoading, error: balancesError } = useBankBalances()
  const blState = useDataViewState({ storageKey: 'bl', defaultSortKey: 'date', defaultSortDir: 'desc' })
  const [ledgerRows,   setLedgerRows]   = useState<LedgerRow[]>([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [datePreset,   setDatePreset]   = useState<DatePreset | null>(null)
  const [editInflow,   setEditInflow]   = useState<InflowTransaction | null>(null)
  const [editOutflow,  setEditOutflow]  = useState<OutflowTransaction | null>(null)
  const [depositRow,   setDepositRow]   = useState<InflowTransaction | null>(null)
  const [expandedId,   setExpandedId]   = useState<string | null>(null)
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()

  const load = useCallback(async (bankId: string, bankName: string, openingBalance: number = 0) => {
    if (!bankId || !bankName || !orgId) { setLedgerRows([]); setLoading(false); return }
    setLoading(true)
    setError(null)

    // bank_id is the authoritative link (added so renames don't orphan
    // history); bank_name is still matched for rows written before the
    // bank_id backfill ran (bank_id IS NULL) or on a not-yet-migrated DB.
    const [inflowById, inflowByName, outflowById, outflowByName] = await Promise.all([
      fetchAllRows(() => supabase
        .from('inflow_transactions')
        .select('*')
        .eq('org_id', orgId)
        .eq('bank_id', bankId)
        .or(`transaction_type.is.null,transaction_type.neq.${BALANCE_BROUGHT_FORWARD_TYPE}`)),
      fetchAllRows(() => supabase
        .from('inflow_transactions')
        .select('*')
        .eq('org_id', orgId)
        .is('bank_id', null)
        .eq('bank_name', bankName)
        .or(`transaction_type.is.null,transaction_type.neq.${BALANCE_BROUGHT_FORWARD_TYPE}`)),
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('*')
        .eq('org_id', orgId)
        .eq('bank_id', bankId)),
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('*')
        .eq('org_id', orgId)
        .is('bank_id', null)
        .eq('bank_name', bankName)),
    ])

    const inflowRes  = { data: [...(inflowById.data ?? []), ...(inflowByName.data ?? [])], error: inflowById.error ?? inflowByName.error }
    const outflowRes = { data: [...(outflowById.data ?? []), ...(outflowByName.data ?? [])], error: outflowById.error ?? outflowByName.error }

    if (inflowRes.error || outflowRes.error) {
      setError((inflowRes.error ?? outflowRes.error)!.message)
      setLoading(false)
      return
    }

    // Merge & sort chronologically
    type RawRow = { id: string; date: string; description: string | null; inflow: number; outflow: number; transaction_type: string | null; entity_type: 'inflow' | 'outflow'; import_seq?: number; inflowData?: InflowTransaction; outflowData?: OutflowTransaction }
    const merged: RawRow[] = [
      ...(inflowRes.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, date: r.date as string,
        description: r.description as string | null,
        inflow: r.amount as number, outflow: 0,
        transaction_type: (r.transaction_type as string | null) ?? null,
        entity_type: 'inflow' as const,
        import_seq: (r.import_seq as number | null) ?? undefined,
        inflowData: r as unknown as InflowTransaction,
      })),
      ...(outflowRes.data ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string, date: r.date as string,
        description: (r.description as string | null) ?? (r.bank_description as string | null),
        inflow: 0, outflow: r.amount_disbursed as number,
        transaction_type: (r.transaction_type as string | null) ?? null,
        entity_type: 'outflow' as const,
        import_seq: (r.import_seq as number | null) ?? undefined,
        outflowData: r as unknown as OutflowTransaction,
      })),
    ].sort((a, b) => a.date.localeCompare(b.date) || (a.import_seq ?? 0) - (b.import_seq ?? 0))

    // Running balance starts from opening balance so all subsequent rows are correct
    let running = openingBalance
    const withBalance: LedgerRow[] = merged.map(r => {
      running += r.inflow - r.outflow
      return { ...r, balance: running }
    })

    // Synthetic B/F row — generated from bank.starting_balance, filter-immune
    const rows: LedgerRow[] = openingBalance > 0
      ? [
          {
            id:          '__bf__',
            date:        '1900-01-01',
            description: BF_DESCRIPTION,
            inflow:              openingBalance,
            outflow:             0,
            balance:             openingBalance,
            transaction_type:    BALANCE_BROUGHT_FORWARD_TYPE,
            entity_type:         'inflow',
          },
          ...withBalance,
        ]
      : withBalance

    setLedgerRows(rows)
    setLoading(false)
  }, [orgId])

  useEffect(() => {
    const bank = banks.find(b => b.id === selectedBank)
    load(bank?.id ?? '', bank?.name ?? '', bank?.starting_balance ?? 0)
  }, [selectedBank, banks, load])

  // Auto-select first bank on initial load (fires once when banks become available)
  useEffect(() => {
    if (didAutoSelect.current || banksLoading || banks.length === 0) return
    didAutoSelect.current = true
    setSelectedBank(banks[0].id)
  }, [banks, banksLoading])

  // Reset page when bank or date changes
  useEffect(() => { blState.setPage(0) }, [selectedBank, dateFrom, dateTo, blState.setPage])

  // Date-range filter — B/F row always shown regardless of date filter
  const dateFiltered = useMemo(() => ledgerRows.filter(r => {
    if (r.transaction_type === BALANCE_BROUGHT_FORWARD_TYPE) return true
    if (dateFrom && r.date < dateFrom) return false
    if (dateTo   && r.date > dateTo)   return false
    return true
  }), [ledgerRows, dateFrom, dateTo])

  // Search filter
  const searchFiltered = useMemo(
    () => searchRows(dateFiltered, BL_COLUMNS, blState.search, blState.searchCol),
    [dateFiltered, blState.search, blState.searchCol],
  )

  const getBlValue = (r: LedgerRow, k: string) => {
    if (k === 'inflow')      return r.inflow
    if (k === 'outflow')     return r.outflow
    if (k === 'balance')     return r.balance
    if (k === 'description') return r.description ?? ''
    return r.date
  }

  // Sort
  const sortedRows = useMemo(() => {
    const adv = blState.advancedSort
    if (adv.length > 0) return multiSortRows(searchFiltered, getBlValue, adv, BL_SORT_FIELDS)
    if (blState.sortKey === 'date') {
      const dir = blState.sortDir
      return [...searchFiltered].sort((a, b) => {
        const dateCmp = a.date.localeCompare(b.date)
        if (dateCmp !== 0) return dir === 'desc' ? -dateCmp : dateCmp
        const seqA = a.import_seq ?? 0
        const seqB = b.import_seq ?? 0
        return dir === 'desc' ? seqB - seqA : seqA - seqB
      })
    }
    return sortRows(searchFiltered, getBlValue, blState.sortKey, blState.sortDir, BL_SORT_FIELDS)
  }, [searchFiltered, blState.sortKey, blState.sortDir, blState.advancedSort])

  // Pagination
  const pagedRows = useMemo(() => {
    const start = blState.page * blState.pageSize
    return sortedRows.slice(start, start + blState.pageSize)
  }, [sortedRows, blState.page, blState.pageSize])

  // Totals based on date-filtered (not search-filtered or paged) — summary strip unchanged
  const totalInflow  = dateFiltered.reduce((s, r) => s + r.inflow,  0)
  const totalOutflow = dateFiltered.reduce((s, r) => s + r.outflow, 0)
  const netBalance   = dateFiltered[dateFiltered.length - 1]?.balance ?? 0

  const selectedBankObj  = banks.find(b => b.id === selectedBank)
  const selectedBankName = selectedBankObj?.name ?? ''
  const displayCurrency  = selectedBankObj?.currency ?? baseCurrencyCode

  const canMarkDeposited = (row: LedgerRow) =>
    !!selectedBankObj?.is_system && row.entity_type === 'inflow' && !!row.inflowData && !row.inflowData.deposit_group_id

  const BL_CSV_HEADERS = ['Date', 'Description', 'Type', `Inflow (${displayCurrency})`, `Outflow (${displayCurrency})`, `Balance (${displayCurrency})`]
  const blCsvRow = (r: LedgerRow) => [
    r.date, r.description ?? '',
    TXN_TYPE_LABELS[r.transaction_type ?? ''] ?? r.transaction_type ?? '',
    r.inflow || '', r.outflow || '', r.balance,
  ]
  const BL_CSV_FILE = `bank-ledger-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(BL_CSV_FILE, BL_CSV_HEADERS, pagedRows.map(blCsvRow))
  const handleExportAll  = () => exportCSV(BL_CSV_FILE, BL_CSV_HEADERS, sortedRows.map(blCsvRow))

  if (isSimple) {
    return (
      <SimpleBankLedgerView
        balances={balances}
        loading={balancesLoading}
        error={balancesError}
        baseCurrencyCode={baseCurrencyCode}
        selectedBank={selectedBank}
        onSelectBank={id => { didAutoSelect.current = true; setSelectedBank(id) }}
        onViewAll={() => setDetail('full')}
      />
    )
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => setDetail('simple')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Show summary
      </button>

      {/* Header */}
      <div data-tour="page-header" className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-gray-100">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Bank Ledger</h1>
          <p className="text-sm text-gray-500 mt-0.5">Per-bank transaction history with running balance</p>
        </div>
        <div className="flex items-center gap-2" data-tour="export-button">
          <HelpButton tourId="banksTour" size="sm" />
          <ExportDropdown
            onExportView={handleExportView}
            onExportAll={handleExportAll}
            disabled={sortedRows.length === 0}
          />
        </div>
      </div>

      <PageHelpBanner storageKey="help-dismissed-bank-ledger" title="Bank Ledger">
        Shows every transaction for a selected bank account with a running balance. Choose a bank and date
        range below to view or export its full history. The opening balance is set when the bank is first
        configured under <strong>Settings</strong>.
      </PageHelpBanner>

      {/* Bank selector + date filters */}
      <Card>
        <div className="space-y-3">
          <DatePresetBar
            activePreset={datePreset}
            onPreset={(preset, from, to) => { setDatePreset(preset); setDateFrom(from); setDateTo(to) }}
            onCustom={() => setDatePreset('custom')}
          />
          <div className="flex flex-wrap gap-3 items-end">
            <div data-tour="bank-selector" className="flex flex-col gap-1 w-full sm:w-auto sm:min-w-[200px]">
              <label className="text-xs font-medium text-gray-500">Bank</label>
              <SearchableSelect
                value={selectedBank}
                onChange={v => { didAutoSelect.current = true; setSelectedBank(v) }}
                options={banks.map(b => ({ value: b.id, label: b.name }))}
                placeholder={banksLoading ? '— Loading banks… —' : banks.length === 0 ? '— No banks configured —' : '— Select a bank —'}
                disabled={banksLoading}
                className={filterInputCls}
              />
            </div>
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
                Clear dates
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Summary bar */}
      {selectedBank && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { label: 'Total Inflows',  value: formatCurrency(totalInflow, displayCurrency),  color: 'text-green-700', tip: undefined },
            { label: 'Total Outflows', value: formatCurrency(totalOutflow, displayCurrency), color: 'text-red-700',   tip: undefined },
            { label: 'Net Balance',    value: formatCurrency(netBalance, displayCurrency),   color: netBalance >= 0 ? 'text-green-700' : 'text-red-700',
              tip: 'Running balance at the end of the selected period (opening balance plus all inflows minus all outflows). Matches the balance shown on the last row of the ledger table.' },
          ].map(({ label, value, color, tip }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 min-w-0">
              <div className="flex items-center gap-1 mb-1">
                <p className="text-xs text-gray-500 truncate">{label}</p>
                {tip && <HelpTooltip content={tip} placement="top" iconSize="w-3 h-3" />}
              </div>
              {loading
                ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
                : <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Banks load error */}
      {banksError && (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          <AlertCircle className="w-10 h-10 text-danger" />
          <p className="font-semibold text-gray-800">Failed to load banks</p>
          <p className="text-sm text-gray-500">{banksError}</p>
        </div>
      )}

      {/* Empty — no banks configured */}
      {!banksLoading && !banksError && banks.length === 0 && (
        <Card>
          <PageEmptyState pageId="bank-ledger" compact />
        </Card>
      )}

      {/* Error state */}
      {error && (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          <AlertCircle className="w-10 h-10 text-danger" />
          <p className="font-semibold text-gray-800">Failed to load ledger</p>
          <p className="text-sm text-gray-500">{error}</p>
          <button onClick={() => load(selectedBank, selectedBankName, selectedBankObj?.starting_balance ?? 0)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      )}

      {/* Empty — no bank selected */}
      {!selectedBank && !error && !banksError && banks.length > 0 && (
        <Card>
          <div className="py-16 flex flex-col items-center gap-3 text-gray-400">
            <BookOpen className="w-12 h-12 text-gray-200" />
            <p className="text-sm">Select a bank above to view its ledger.</p>
          </div>
        </Card>
      )}

      {/* DataControlsBar */}
      {selectedBank && !error && (
        <DataControlsBar
          columns={BL_COLUMNS}
          sortKey={blState.sortKey}
          sortDir={blState.sortDir}
          onSort={blState.setSort}
          defaultSortKey="date"
          defaultSortDir="desc"
          view={blState.view}
          onViewChange={blState.setView}
          search={blState.search}
          onSearchChange={blState.setSearch}
          searchPlaceholder="Search descriptions…"
          searchCol={blState.searchCol}
          onSearchColChange={blState.setSearchCol}
          advancedSort={blState.advancedSort}
          onAdvancedSort={blState.setAdvancedSort}
          pageSize={blState.pageSize}
          onPageSizeChange={blState.setPageSize}
        />
      )}

      {/* Compact pagination — above card */}
      {selectedBank && !error && (
        <PaginationBar
          page={blState.page}
          pageSize={blState.pageSize}
          total={sortedRows.length}
          onPageChange={blState.setPage}
          variant="compact"
        />
      )}

      {/* Ledger table / cards */}
      {selectedBank && !error && (
        <Card padding={false} data-tour="ledger-table">
          {blState.view === 'cards' ? (
            <div className="p-4 space-y-3">
              {loading && sortedRows.length === 0 ? (
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
              ) : sortedRows.length === 0 ? (
                <EmptyState icon={BookOpen} title="No transactions" message={`No transactions found for ${selectedBankName}.`} compact />
              ) : pagedRows.map(row => {
                const isBF     = row.transaction_type === BALANCE_BROUGHT_FORWARD_TYPE
                const isTableRow = false
                return (
                <div key={row.id} className={`rounded-xl border overflow-hidden shadow-sm bg-white ${isBF ? 'border-blue-200' : 'border-gray-200'}`}>
                  {/* Card header */}
                  <div className={`px-4 pt-3.5 pb-3 ${isBF ? 'bg-blue-50/60' : ''}`}>
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <p className="text-xs font-semibold text-gray-400">{isBF ? 'Opening' : formatDate(row.date)}</p>
                      <div className="flex items-center gap-1.5">
                        {row.transaction_type && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${isBF ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                            {TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type}
                          </span>
                        )}
                        {canWrite() && canMarkDeposited(row) && (
                          <span className="flex items-center">
                            <button
                              onClick={() => row.inflowData && setDepositRow(row.inflowData)}
                              className="touch-target p-1 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
                              title="Mark Deposited" aria-label="Mark Deposited"
                            >
                              <Landmark className="w-3.5 h-3.5" />
                            </button>
                            <HelpTooltip content={MARK_DEPOSITED_HELP} iconSize="w-3 h-3" />
                          </span>
                        )}
                        {canWrite() && !isBF && !isTableRow && (
                          <button
                            onClick={() => row.entity_type === 'inflow' && row.inflowData
                              ? setEditInflow(row.inflowData)
                              : row.outflowData && setEditOutflow(row.outflowData)}
                            className="touch-target p-1 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
                            title="Edit source record" aria-label="Edit source record"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                    {isBF ? (
                      <p className="text-sm text-blue-700 font-medium">{row.description}</p>
                    ) : row.description && (
                      <div className="text-sm">
                        <DescriptionCell id={`card-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-800" />
                      </div>
                    )}
                  </div>
                  {/* Metrics footer */}
                  <div className="grid grid-cols-2 border-t border-gray-100 bg-gray-50/40 px-4 py-3">
                    <div className="min-w-0">
                      <p className={`text-xs uppercase tracking-wide font-semibold mb-0.5 ${row.inflow > 0 ? 'text-green-600/70' : 'text-red-600/70'}`}>
                        {row.inflow > 0 ? 'Inflow' : 'Outflow'}
                      </p>
                      <p className={`text-sm font-mono font-bold tabular-nums ${row.inflow > 0 ? 'text-success' : 'text-danger'}`}>
                        {row.inflow > 0 ? formatCurrency(row.inflow, displayCurrency) : formatCurrency(row.outflow, displayCurrency)}
                      </p>
                    </div>
                    <div className="border-l border-gray-200/80 pl-4 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-xs uppercase tracking-wide font-semibold text-gray-400">Balance</p>
                        <ReceiptBadge entityType={row.entity_type} entityId={row.id} />
                      </div>
                      <p className={`text-sm font-mono font-bold tabular-nums ${row.balance >= 0 ? 'text-gray-900' : 'text-danger'}`}>
                        {formatCurrency(row.balance, displayCurrency)}
                      </p>
                    </div>
                  </div>
                </div>
              )})}
            </div>
          ) : (
            <div className="overflow-x-auto scroll-x-fade">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b-2 border-black/[0.06] dark:border-white/[0.07]">
                    <th className="w-8" />
                    <SortableHeader field={BL_SORT_FIELDS[0]} activeSortKey={blState.sortKey} activeSortDir={blState.sortDir} onSort={blState.setSort} className="px-4 py-3" />
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-left">Description</th>
                    <SortableHeader field={BL_SORT_FIELDS[1]} activeSortKey={blState.sortKey} activeSortDir={blState.sortDir} onSort={blState.setSort} rightAlign className="px-4 py-3" inactiveCls="text-success/80 hover:text-success" />
                    <SortableHeader field={BL_SORT_FIELDS[2]} activeSortKey={blState.sortKey} activeSortDir={blState.sortDir} onSort={blState.setSort} rightAlign className="px-4 py-3" inactiveCls="text-danger/80 hover:text-danger" />
                    <SortableHeader field={BL_SORT_FIELDS[3]} activeSortKey={blState.sortKey} activeSortDir={blState.sortDir} onSort={blState.setSort} rightAlign className="px-4 py-3" />
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-left">📎</th>
                    {canWrite() && <th className="px-4 py-3 w-10" />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.05]">
                  {loading && sortedRows.length === 0 ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>{Array.from({ length: 5 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
                      ))}</tr>
                    ))
                  ) : sortedRows.length === 0 ? (
                    <tr><td colSpan={7 + (canWrite() ? 1 : 0)}>
                      <EmptyState icon={BookOpen} title="No transactions" message={`No transactions found for ${selectedBankName}.`} compact />
                    </td></tr>
                  ) : pagedRows.flatMap(row => {
                    const isBF     = row.transaction_type === BALANCE_BROUGHT_FORWARD_TYPE
                    const isTableRow = false
                    const isExpanded = expandedId === row.id
                    const detailItems = !isBF && !isTableRow
                      ? (row.inflowData  ? inflowDetailItems(row.inflowData, baseCurrencyCode)
                        : row.outflowData ? outflowDetailItems(row.outflowData, baseCurrencyCode)
                        : [])
                      : []
                    return [
                    <tr key={row.id} className={`transition-colors ${isBF ? 'bg-blue-50/60 hover:bg-blue-50' : 'hover:bg-gray-50'}`}>
                      <td className="w-8 px-1 py-3">
                        {!isBF && !isTableRow && (
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : row.id)}
                            className="touch-target p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                            title={isExpanded ? 'Collapse' : 'Expand details'}
                          >
                            {isExpanded
                              ? <ChevronDown className="w-3.5 h-3.5" />
                              : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{isBF ? '—' : formatDate(row.date)}</td>
                      <td className="px-4 py-3 text-sm max-w-[280px]">
                        <div className="flex items-start gap-1.5 min-w-0">
                          {row.transaction_type && (
                            <span className={`inline-flex shrink-0 items-center px-1.5 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${isBF ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                              {TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type}
                            </span>
                          )}
                          {isBF ? (
                            <span className="text-blue-700 font-medium">{row.description}</span>
                          ) : (
                            <DescriptionCell id={row.id} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
                          )}
                        </div>
                      </td>
                      <AmountCell value={row.inflow}   mode="inflow"  currency={displayCurrency} />
                      <AmountCell value={row.outflow}  mode="outflow" currency={displayCurrency} />
                      <AmountCell value={row.balance}  mode="balance" currency={displayCurrency} showZero />
                      <td className="px-2 py-3">
                        {!isBF && !isTableRow && <ReceiptBadge entityType={row.entity_type} entityId={row.id} />}
                      </td>
                      {canWrite() && (
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-1">
                            {canMarkDeposited(row) && (
                              <span className="flex items-center">
                                <button
                                  onClick={() => row.inflowData && setDepositRow(row.inflowData)}
                                  className="touch-target p-1.5 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
                                  title="Mark Deposited" aria-label="Mark Deposited"
                                >
                                  <Landmark className="w-3.5 h-3.5" />
                                </button>
                                <HelpTooltip content={MARK_DEPOSITED_HELP} iconSize="w-3 h-3" />
                              </span>
                            )}
                            {!isBF && !isTableRow && (
                              <button
                                onClick={() => row.entity_type === 'inflow' && row.inflowData
                                  ? setEditInflow(row.inflowData)
                                  : row.outflowData && setEditOutflow(row.outflowData)}
                                className="touch-target p-1.5 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
                                title="Edit source record" aria-label="Edit source record"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>,
                    isExpanded && <RowDetailPanel key={`${row.id}-detail`} items={detailItems} colSpan={7 + (canWrite() ? 1 : 0)} />,
                    ]
                  }).filter(Boolean)}

                </tbody>
              </table>
            </div>
          )}
          <PaginationBar
            page={blState.page}
            pageSize={blState.pageSize}
            total={sortedRows.length}
            onPageChange={blState.setPage}
            variant="full"
          />
        </Card>
      )}

      <AddInflowModal
        open={!!editInflow}
        onClose={() => setEditInflow(null)}
        onSuccess={() => { setEditInflow(null); load(selectedBank, selectedBankName, selectedBankObj?.starting_balance ?? 0) }}
        editRecord={editInflow}
      />
      <AddOutflowModal
        open={!!editOutflow}
        onClose={() => setEditOutflow(null)}
        onSuccess={() => { setEditOutflow(null); load(selectedBank, selectedBankName, selectedBankObj?.starting_balance ?? 0) }}
        editRecord={editOutflow}
      />
      <MarkDepositedModal
        open={!!depositRow}
        onClose={() => setDepositRow(null)}
        onSuccess={() => { setDepositRow(null); load(selectedBank, selectedBankName, selectedBankObj?.starting_balance ?? 0) }}
        inflow={depositRow}
      />
      <DescriptionTooltip tooltip={descTooltip} />
    </div>
  )
}

// ── Simple view ──────────────────────────────────────────────────────────────
// Bank Ledger is a single-bank drill-down by design (pick a bank, see its
// ledger) — there is no "all banks at a glance" view today. Simple adds one:
// a donut of base-currency bank balances (hero = true net total, including
// any overdrawn accounts) + a compact list, with foreign-currency banks in
// their own strip below (their balances can't be summed with the base
// currency, or with each other across different FX currencies, into one
// chart). Tapping a bank selects it — the same selectedBank the Full view's
// bank picker already uses — so "View full ledger" opens straight into it.

const DONUT_COLORS = ['#0D7377', '#C89B3C', '#1A2C42', '#14A085', '#4A5568']

function SimpleBankLedgerView({
  balances, loading, error, baseCurrencyCode, selectedBank, onSelectBank, onViewAll,
}: {
  balances: BankBalance[]
  loading: boolean
  error: string | null
  baseCurrencyCode: string
  selectedBank: string
  onSelectBank: (id: string) => void
  onViewAll: () => void
}) {
  const baseBanks = useMemo(() => balances.filter(b => !b.isForeign), [balances])
  const fxBanks    = useMemo(() => balances.filter(b => b.isForeign), [balances])

  const netTotal = baseBanks.reduce((s, b) => s + b.balance, 0)
  const animatedTotal = useCountUp(netTotal)

  // Only positive balances can render as a donut slice — an overdrawn bank
  // still counts in the true net total above, but is flagged in the list
  // instead of pretending to be a slice.
  const positiveBanks = useMemo(() => baseBanks.filter(b => b.balance > 0), [baseBanks])

  const selected = selectedBank ? (balances.find(b => b.id === selectedBank) ?? null) : null

  const selectBank = (id: string) => onSelectBank(id === selectedBank ? '' : id)

  const hero = (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-xs font-medium text-gray-500">Total across banks</p>
      <p className={`text-3xl font-extrabold tabular-nums mt-1 ${netTotal >= 0 ? 'text-gray-900' : 'text-danger'}`}>
        {formatCurrency(animatedTotal, baseCurrencyCode)}
      </p>
      <p className="text-xs text-gray-400 mt-1">
        {baseBanks.length.toLocaleString()} bank{baseBanks.length !== 1 ? 's' : ''} in {baseCurrencyCode}
      </p>
    </div>
  )

  const body = loading && balances.length === 0 ? (
    <div className="h-48 rounded-2xl border border-gray-100 bg-white animate-pulse" />
  ) : baseBanks.length === 0 ? (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-2xl border border-dashed border-gray-200 bg-gray-50">
      <BookOpen className="w-8 h-8 text-primary/60" />
      <p className="text-sm text-gray-500">No banks configured yet.</p>
    </div>
  ) : (
    <div className="space-y-3">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
        </div>
      )}

      {selected && (
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-gray-800 min-w-0 truncate">{selected.name}</p>
            <div className="flex items-center gap-2 shrink-0">
              <p className={`text-sm font-mono font-bold tabular-nums ${selected.balance >= 0 ? 'text-gray-900' : 'text-danger'}`}>
                {formatCurrency(selected.balance, selected.currency)}
              </p>
              <button type="button" onClick={() => onSelectBank('')} aria-label="Close bank detail" className="p-1 -m-1 rounded text-gray-400 hover:text-gray-600 hover:bg-black/5 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          {selected.balance < 0 && (
            <p className="text-xs text-danger mt-1.5 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />Overdrawn</p>
          )}
        </div>
      )}

      {positiveBanks.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-[11px] text-gray-400 mb-2">Tap a bank to see its detail</p>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={positiveBanks}
                dataKey="balance"
                nameKey="name"
                innerRadius="55%"
                outerRadius="85%"
                paddingAngle={2}
                onClick={(d: { id?: string }) => { if (d?.id) selectBank(d.id) }}
                cursor="pointer"
                isAnimationActive={false}
              >
                {positiveBanks.map((b, i) => (
                  <Cell
                    key={b.id}
                    fill={DONUT_COLORS[i % DONUT_COLORS.length]}
                    fillOpacity={!selectedBank || b.id === selectedBank ? 1 : 0.35}
                  />
                ))}
              </Pie>
              <RTooltip formatter={(v: number, _n: string, entry: { payload?: { name?: string } }) => [formatCurrency(v, baseCurrencyCode), entry?.payload?.name ?? '']} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
        {baseBanks.map(b => {
          const colorIdx = positiveBanks.findIndex(p => p.id === b.id)
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => selectBank(b.id)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: colorIdx >= 0 ? DONUT_COLORS[colorIdx % DONUT_COLORS.length] : '#94a3b8' }}
                />
                <span className="text-sm text-gray-800 truncate">{b.name}</span>
                {b.balance < 0 && (
                  <span className="text-[10px] font-semibold text-danger bg-red-50 px-1.5 py-0.5 rounded-full shrink-0">Overdrawn</span>
                )}
              </span>
              <span className={`text-sm font-mono font-bold tabular-nums shrink-0 ${b.balance >= 0 ? 'text-gray-900' : 'text-danger'}`}>
                {formatCurrency(b.balance, baseCurrencyCode)}
              </span>
            </button>
          )
        })}
      </div>

      {fxBanks.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">Foreign currency accounts</p>
          <p className="text-[11px] text-gray-400 mb-3">Shown in each account's own currency — see the Foreign Currency page for full detail.</p>
          <div className="space-y-2">
            {fxBanks.map(b => (
              <div key={b.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{b.name}</span>
                <span className={`font-mono font-semibold ${b.balance >= 0 ? 'text-gray-800' : 'text-danger'}`}>
                  {formatCurrency(b.balance, b.currency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <SimpleShell
      pageId="bank-ledger"
      hero={hero}
      bodyTitle="Balances by bank"
      body={body}
      onViewAll={onViewAll}
      viewAllLabel="View full ledger"
    />
  )
}
