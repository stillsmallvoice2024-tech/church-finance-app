import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { BookOpen, AlertCircle, RefreshCw, Pencil, ChevronRight, ChevronDown } from 'lucide-react'
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
  const blState = useDataViewState({ storageKey: 'bl', defaultSortKey: 'date', defaultSortDir: 'desc' })
  const [ledgerRows,   setLedgerRows]   = useState<LedgerRow[]>([])
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [dateFrom,     setDateFrom]     = useState('')
  const [dateTo,       setDateTo]       = useState('')
  const [datePreset,   setDatePreset]   = useState<DatePreset | null>(null)
  const [editInflow,   setEditInflow]   = useState<InflowTransaction | null>(null)
  const [editOutflow,  setEditOutflow]  = useState<OutflowTransaction | null>(null)
  const [expandedId,   setExpandedId]   = useState<string | null>(null)
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()

  const load = useCallback(async (bankName: string, openingBalance: number = 0) => {
    if (!bankName) { setLedgerRows([]); return }
    setLoading(true)
    setError(null)

    const [inflowRes, outflowRes] = await Promise.all([
      supabase
        .from('inflow_transactions')
        .select('*')
        .eq('bank_name', bankName)
        .or(`transaction_type.is.null,transaction_type.neq.${BALANCE_BROUGHT_FORWARD_TYPE}`)
        .order('date', { ascending: true })
        .order('import_seq', { ascending: true }),
      supabase
        .from('outflow_transactions')
        .select('*')
        .eq('bank_name', bankName)
        .order('date', { ascending: true })
        .order('import_seq', { ascending: true }),
    ])

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
    load(bank?.name ?? '', bank?.starting_balance ?? 0)
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

  // Offset subtotals (from linked inflow/outflow data on each row)
  const offsetInflowTotal  = dateFiltered.filter(r => r.inflowData?.offset_role  === 'offset').reduce((s, r) => s + r.inflow,  0)
  const offsetOutflowTotal = dateFiltered.filter(r => r.outflowData?.offset_role === 'offset').reduce((s, r) => s + r.outflow, 0)

  const selectedBankObj  = banks.find(b => b.id === selectedBank)
  const selectedBankName = selectedBankObj?.name ?? ''
  const displayCurrency  = selectedBankObj?.currency ?? baseCurrencyCode

  const BL_CSV_HEADERS = ['Date', 'Description', 'Type', `Inflow (${displayCurrency})`, `Outflow (${displayCurrency})`, `Balance (${displayCurrency})`]
  const blCsvRow = (r: LedgerRow) => [
    r.date, r.description ?? '',
    TXN_TYPE_LABELS[r.transaction_type ?? ''] ?? r.transaction_type ?? '',
    r.inflow || '', r.outflow || '', r.balance,
  ]
  const BL_CSV_FILE = `bank-ledger-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(BL_CSV_FILE, BL_CSV_HEADERS, pagedRows.map(blCsvRow))
  const handleExportAll  = () => exportCSV(BL_CSV_FILE, BL_CSV_HEADERS, sortedRows.map(blCsvRow))

  return (
    <div className="space-y-5">
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
            {
              label:   'Total Inflows',
              value:   formatCurrency(totalInflow, displayCurrency),
              color:   'text-green-700',
              tip:     undefined as string | undefined,
              subtext: offsetInflowTotal > 0
                ? `Total includes ${formatCurrency(offsetInflowTotal, displayCurrency)} from offset entries`
                : undefined as string | undefined,
            },
            {
              label:   'Total Outflows',
              value:   formatCurrency(totalOutflow, displayCurrency),
              color:   'text-red-700',
              tip:     undefined as string | undefined,
              subtext: offsetOutflowTotal > 0
                ? `Less ${formatCurrency(offsetOutflowTotal, displayCurrency)} offset · ${formatCurrency(totalOutflow - offsetOutflowTotal, displayCurrency)} effective`
                : undefined as string | undefined,
            },
            {
              label:   'Net Balance',
              value:   formatCurrency(netBalance, displayCurrency),
              color:   netBalance >= 0 ? 'text-green-700' : 'text-red-700',
              tip:     'Running balance at the end of the selected period (opening balance plus all inflows minus all outflows). Matches the balance shown on the last row of the ledger table.',
              subtext: undefined as string | undefined,
            },
          ].map(({ label, value, color, tip, subtext }) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 min-w-0">
              <div className="flex items-center gap-1 mb-1">
                <p className="text-xs text-gray-500 truncate">{label}</p>
                {tip && <HelpTooltip content={tip} placement="top" iconSize="w-3 h-3" />}
              </div>
              {loading
                ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
                : <p className={`text-base font-bold tabular-nums ${color}`}>{value}</p>}
              {!loading && subtext && (
                <p className="mt-0.5 text-[11px] text-gray-400 leading-snug">{subtext}</p>
              )}
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
          <button onClick={() => load(selectedBankName, selectedBankObj?.starting_balance ?? 0)}
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
        onSuccess={() => { setEditInflow(null); load(selectedBankName, selectedBankObj?.starting_balance ?? 0) }}
        editRecord={editInflow}
      />
      <AddOutflowModal
        open={!!editOutflow}
        onClose={() => setEditOutflow(null)}
        onSuccess={() => { setEditOutflow(null); load(selectedBankName, selectedBankObj?.starting_balance ?? 0) }}
        editRecord={editOutflow}
      />
      <DescriptionTooltip tooltip={descTooltip} />
    </div>
  )
}
