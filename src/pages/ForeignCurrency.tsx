import { useState, useMemo, useEffect } from 'react'
import { Plus, TrendingUp, TrendingDown, Pencil, ChevronRight, ChevronDown } from 'lucide-react'
import { useRole } from '../hooks/useRole'
import { usePageTitle } from '../hooks/usePageTitle'
import { useFXTransactions, type FXTransaction } from '../hooks/useFX'
import { AddFXModal } from '../components/modals/AddFXModal'
import { exportCSV } from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { DataControlsBar } from '../components/ui/DataControlsBar'
import { SortableHeader } from '../components/ui/SortableHeader'
import { PaginationBar } from '../components/ui/PaginationBar'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows } from '../utils/sortUtils'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields, searchRows } from '../utils/tableColumns'
import { RowDetailPanel, type DetailItem } from '../components/ui/RowDetailPanel'
import { formatDate, getCurrencyLocale } from '../utils/formatters'
import { useOrgCurrency } from '../hooks/useOrgCurrency'

const FX_COLUMNS: TableColumnDef<FXTransaction>[] = [
  { key: 'date',            label: 'Date',      sortType: 'date',    primary: true, noSearch: true },
  { key: 'amount',          label: 'Amount',    sortType: 'numeric', primary: true, accessor: t => t.deposit > 0 ? t.deposit : t.withdrawal },
  { key: 'narration',       label: 'Narration', sortType: 'text',    accessor: t => t.narration ?? '' },
  { key: 'transaction_ref', label: 'Reference',                      accessor: t => t.transaction_ref ?? '' },
]

const FX_SORT_FIELDS = deriveSortFields(FX_COLUMNS)

function fmtFX(n: number, ccyCode: string, dp = 4) {
  return n.toLocaleString(getCurrencyLocale(ccyCode), { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

export default function ForeignCurrency() {
  const { baseCurrencySymbol, baseCurrencyCode, formatLocale, foreignCurrencies: FX_META } = useOrgCurrency()

  function fmtBase(n: number) {
    return n.toLocaleString(formatLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  const [addOpen, setAddOpen]           = useState(false)
  const [editRecord, setEditRecord]     = useState<FXTransaction | null>(null)
  const [filterCcy, setFilterCcy]       = useState<string>('')
  const [expandedId, setExpandedId]     = useState<string | null>(null)
  const fxState = useDataViewState({ storageKey: 'fx', defaultSortKey: 'date', defaultSortDir: 'desc' })
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()
  const [rates, setRates]               = useState<Record<string, number>>({})

  const { canWrite }                                = useRole()
  const { transactions, summaries, loading, error, refetch } =
    useFXTransactions(filterCcy || undefined)

  usePageTitle('Foreign Currency')

  // Map: currency → summary
  const summaryMap = useMemo(() => {
    const m = new Map(summaries.map(s => [s.currency, s]))
    return m
  }, [summaries])

  // Map passed to modal for balance preview
  const currentBalances = useMemo(
    () => new Map(summaries.map(s => [s.currency, s.currentBalance])),
    [summaries],
  )

  const fxSearchFiltered = useMemo(
    () => searchRows(transactions, FX_COLUMNS, fxState.search, fxState.searchCol),
    [transactions, fxState.search, fxState.searchCol],
  )

  const getFxValue = (t: FXTransaction, k: string) => {
    if (k === 'amount')    return t.deposit > 0 ? t.deposit : t.withdrawal
    if (k === 'narration') return t.narration ?? ''
    return t.date
  }

  const fxSorted = useMemo(() => {
    const adv = fxState.advancedSort
    if (adv.length > 0) return multiSortRows(fxSearchFiltered, getFxValue, adv, FX_SORT_FIELDS)
    return sortRows(fxSearchFiltered, getFxValue, fxState.sortKey, fxState.sortDir, FX_SORT_FIELDS)
  }, [fxSearchFiltered, fxState.sortKey, fxState.sortDir, fxState.advancedSort])

  useEffect(() => { fxState.setPage(0) }, [filterCcy, fxState.setPage])

  const fxPage = useMemo(
    () => fxSorted.slice(fxState.page * fxState.pageSize, (fxState.page + 1) * fxState.pageSize),
    [fxSorted, fxState.page, fxState.pageSize],
  )

  const fxDetailItems = (t: FXTransaction): DetailItem[] => [
    { label: 'Ref',          value: t.transaction_ref, mono: true, breakAll: true },
    { label: 'Raw Narration', value: t.narration,      breakAll: true },
    { label: 'Created',      value: t.created_at ? formatDate(t.created_at.slice(0, 10)) : null },
  ]

  const FX_CSV_HEADERS = ['Date', 'Currency', 'Type', 'Amount', 'Running Balance', 'Narration', 'Ref']
  const fxCsvRow = (t: FXTransaction) => [
    t.date, t.currency,
    t.deposit > 0 ? 'Deposit' : 'Withdrawal',
    t.deposit > 0 ? t.deposit : t.withdrawal,
    t.running_balance, t.narration ?? '', t.transaction_ref ?? '',
  ]
  const FX_CSV_FILE = `fx-transactions-${new Date().toISOString().slice(0, 10)}.csv`

  const handleExportView = () => {
    exportCSV(FX_CSV_FILE, FX_CSV_HEADERS, fxPage.map(fxCsvRow))
  }

  const handleExportAll = () => {
    exportCSV(FX_CSV_FILE, FX_CSV_HEADERS, fxSorted.map(fxCsvRow))
  }

  const totalNairaEquivalent = FX_META.reduce((sum, m) => {
    const bal  = summaryMap.get(m.code)?.currentBalance ?? 0
    const rate = rates[m.code]
    return sum + bal * rate
  }, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Foreign Currency</h1>
          <p className="text-sm text-gray-500 mt-0.5">FX holdings in foreign currencies</p>
        </div>
        {canWrite() && (
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light"
          >
            <Plus className="w-4 h-4" /> Add Transaction
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Currency Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {FX_META.map(meta => {
          const s       = summaryMap.get(meta.code)
          const balance = s?.currentBalance ?? 0
          const active  = balance > 0
          return (
            <div
              key={meta.code}
              onClick={() => setFilterCcy(prev => prev === meta.code ? '' : meta.code)}
              className={`rounded-xl border-2 p-4 cursor-pointer transition-all select-none ${
                filterCcy === meta.code
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              } ${!active ? 'opacity-60' : ''}`}
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-2xl">{meta.flag}</span>
                <span className="text-xs font-mono font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                  {meta.code}
                </span>
              </div>
              <div className={`text-xl font-bold ${active ? 'text-gray-900' : 'text-gray-400'}`}>
                {meta.symbol}{fmtFX(balance, meta.code)}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">{meta.name}</div>
              {s && (
                <div className="mt-3 grid grid-cols-2 gap-1 text-xs">
                  <div className="text-success">↑ {meta.symbol}{fmtFX(s.totalDeposits, meta.code)}</div>
                  <div className="text-danger">↓ {meta.symbol}{fmtFX(s.totalWithdrawals, meta.code)}</div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Base Currency Equivalent */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">
          {baseCurrencyCode} Equivalent (Enter Rates)
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {FX_META.map(meta => {
            const bal   = summaryMap.get(meta.code)?.currentBalance ?? 0
            const rate  = rates[meta.code]
            const equiv = bal * rate
            return (
              <div key={meta.code} className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500">
                  {meta.code} Rate ({baseCurrencySymbol} per {meta.code})
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={rates[meta.code] || ''}
                  onChange={e =>
                    setRates(r => ({ ...r, [meta.code]: Number(e.target.value) }))
                  }
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <div className="text-xs text-gray-400">
                  {meta.symbol}{fmtFX(bal, meta.code)} → {baseCurrencySymbol}{fmtBase(equiv)}
                </div>
              </div>
            )
          })}
        </div>
        <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Total {baseCurrencyCode} Equivalent</span>
          <span className="text-lg font-bold text-primary">{baseCurrencySymbol}{fmtBase(totalNairaEquivalent)}</span>
        </div>
      </div>

      {/* Transaction Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Transactions{filterCcy ? ` — ${filterCcy}` : ' (All)'}
            </h2>
            {filterCcy && (
              <button
                onClick={() => setFilterCcy('')}
                className="text-xs text-primary underline"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Currency filter pills */}
            <div className="flex gap-1">
              {FX_META.map(m => (
                <button
                  key={m.code}
                  onClick={() => setFilterCcy(prev => prev === m.code ? '' : m.code)}
                  className={`px-2 py-1 text-xs rounded-md font-mono transition-colors ${
                    filterCcy === m.code
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {m.code}
                </button>
              ))}
            </div>
            <ExportDropdown
              onExportView={handleExportView}
              onExportAll={handleExportAll}
              disabled={transactions.length === 0}
            />
          </div>
        </div>

        <div className="px-4 py-2 border-b border-gray-100">
          <DataControlsBar
            columns={FX_COLUMNS}
            sortKey={fxState.sortKey}
            sortDir={fxState.sortDir}
            onSort={fxState.setSort}
            defaultSortKey="date"
            defaultSortDir="desc"
            search={fxState.search}
            onSearchChange={fxState.setSearch}
            searchPlaceholder="Search narration or ref…"
            searchCol={fxState.searchCol}
            onSearchColChange={fxState.setSearchCol}
            advancedSort={fxState.advancedSort}
            onAdvancedSort={fxState.setAdvancedSort}
            pageSize={fxState.pageSize}
            onPageSizeChange={fxState.setPageSize}
          />
        </div>

        {loading ? (
          <div className="space-y-2 p-5">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : fxSorted.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            No transactions found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="w-8" />
                  <SortableHeader field={FX_SORT_FIELDS[0]} activeSortKey={fxState.sortKey} activeSortDir={fxState.sortDir} onSort={fxState.setSort} className="px-4 py-3" />
                  <th className="px-4 py-3 text-left font-medium">Currency</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <SortableHeader field={FX_SORT_FIELDS[1]} activeSortKey={fxState.sortKey} activeSortDir={fxState.sortDir} onSort={fxState.setSort} rightAlign className="px-4 py-3" />
                  <th className="px-4 py-3 text-right font-medium">Running Balance</th>
                  <th className="px-4 py-3 text-left font-medium">Narration</th>
                  <th className="px-4 py-3 text-left font-medium">Ref</th>
                  {canWrite() && <th className="px-4 py-3 w-10" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {fxPage.flatMap(t => {
                  const isDeposit  = t.deposit > 0
                  const meta       = FX_META.find(m => m.code === t.currency)!
                  const isExpanded = expandedId === t.id
                  return [
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="w-8 px-1 py-3">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : t.id)}
                          className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                          title={isExpanded ? 'Collapse' : 'Expand details'}
                        >
                          {isExpanded
                            ? <ChevronDown className="w-3.5 h-3.5" />
                            : <ChevronRight className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{t.date}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                          {t.currency}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                            isDeposit
                              ? 'bg-green-50 text-success'
                              : 'bg-red-50 text-danger'
                          }`}
                        >
                          {isDeposit
                            ? <TrendingUp className="w-3 h-3" />
                            : <TrendingDown className="w-3 h-3" />}
                          {isDeposit ? 'Deposit' : 'Withdrawal'}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold ${
                          isDeposit ? 'text-success' : 'text-danger'
                        }`}
                      >
                        {meta.symbol}{fmtFX(isDeposit ? t.deposit : t.withdrawal, meta.code)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {meta.symbol}{fmtFX(t.running_balance, meta.code)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[200px]">
                        <DescriptionCell id={t.id} text={t.narration} tooltip={descTooltip} setTooltip={setDescTooltip} />
                      </td>
                      <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                        {t.transaction_ref ?? '—'}
                      </td>
                      {canWrite() && (
                        <td className="px-2 py-3">
                          <button
                            onClick={() => setEditRecord(t)}
                            className="p-1.5 rounded-md text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
                            title="Edit transaction"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>,
                    isExpanded && <RowDetailPanel key={`${t.id}-detail`} items={fxDetailItems(t)} colSpan={8 + (canWrite() ? 1 : 0)} />,
                  ]
                }).filter(Boolean)}
              </tbody>
            </table>
            <PaginationBar
              page={fxState.page}
              pageSize={fxState.pageSize}
              total={fxSorted.length}
              onPageChange={fxState.setPage}
              variant="full"
            />
          </div>
        )}
      </div>

      <DescriptionTooltip tooltip={descTooltip} />
      <AddFXModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={refetch}
        currentBalances={currentBalances}
      />
      <AddFXModal
        open={!!editRecord}
        onClose={() => setEditRecord(null)}
        onSuccess={() => { setEditRecord(null); refetch() }}
        currentBalances={currentBalances}
        editRecord={editRecord}
      />
    </div>
  )
}
