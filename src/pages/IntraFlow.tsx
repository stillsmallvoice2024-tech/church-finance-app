import { useState, useEffect, Fragment } from 'react'
import BulkReallocation from './BulkReallocation'
import {
  ArrowLeftRight, Plus, Pencil, Trash2,
  AlertCircle, RefreshCw, ChevronRight, ChevronDown,
} from 'lucide-react'
import { PageHelpBanner } from '../components/ui/PageHelpBanner'
import { Card }                    from '../components/ui/Card'
import { DataControlsBar }         from '../components/ui/DataControlsBar'
import { SortableHeader }          from '../components/ui/SortableHeader'
import { PaginationBar }           from '../components/ui/PaginationBar'
import { DeleteDialog }            from '../components/ui/DeleteDialog'
import { AddIntraFlowModal }       from '../components/modals/AddIntraFlowModal'
import { useIntraFlows, type IntraFlowRow } from '../hooks/useTransactions'
import { useDeleteTransaction, useBulkDeleteTransaction } from '../hooks/useMutations'
import { useToastStore }           from '../store/toastStore'
import { useRole }                 from '../hooks/useRole'
import { usePageTitle }            from '../hooks/usePageTitle'
import { useDataViewState }        from '../hooks/useDataViewState'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields } from '../utils/tableColumns'
import { formatDate, formatCurrency, formatCurrencyCompact } from '../utils/formatters'
import { exportCSV }               from '../utils/csvExport'
import { supabase }                from '../lib/supabase'
import { ExportDropdown }          from '../components/ui/ExportDropdown'
import { useCategories }  from '../hooks/useCategories'
import { useYearRange }   from '../hooks/useYearRange'
import { useDescriptionExpand }    from '../hooks/useDescriptionExpand'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { filterInputCls }         from '../components/ui/FormField'
import { DatePresetBar, type DatePreset } from '../components/ui/DatePresetBar'
import { SearchableSelect }       from '../components/ui/SearchableSelect'
import { RowDetailPanel, type DetailItem } from '../components/ui/RowDetailPanel'
import { BulkActionBar }          from '../components/ui/BulkActionBar'
import { BulkEditIntraFlowModal } from '../components/modals/BulkEditIntraFlowModal'
import { useBulkSelection }       from '../hooks/useBulkSelection'
import { useOrgCurrency } from '../hooks/useOrgCurrency'

// ── Sort / search config ───────────────────────────────────────────────────────

const IFL_COLUMNS: TableColumnDef<IntraFlowRow>[] = [
  { key: 'date',         label: 'Date',        sortType: 'date',    primary: true, noSearch: true },
  { key: 'total_amount', label: 'Amount',      sortType: 'numeric', primary: true },
  { key: 'account_from', label: 'From',        sortType: 'text',    accessor: r => r.account_from ?? '' },
  { key: 'account_to',   label: 'To',          sortType: 'text',    accessor: r => r.account_to ?? '' },
  { key: 'description',  label: 'Description', sortType: 'text',    accessor: r => r.description ?? '' },
]

const IFL_SORT_FIELDS = deriveSortFields(IFL_COLUMNS)

const IFL_SORT_COLS = new Set(['date', 'total_amount', 'account_from', 'account_to', 'description'])
const IFL_SEARCH_COLS = new Set(['description', 'account_from', 'account_to'])

// ── Summary strip ──────────────────────────────────────────────────────────────

function SummaryStrip({ total, count, largest, average, loading }: {
  total: number; count: number; largest: number; average: number; loading: boolean
}) {
  const { baseCurrencyCode } = useOrgCurrency()
  const items = [
    { label: 'Total (page)', value: formatCurrencyCompact(total, baseCurrencyCode) },
    { label: 'Records',      value: count.toLocaleString() },
    { label: 'Largest',      value: formatCurrencyCompact(largest, baseCurrencyCode) },
    { label: 'Average',      value: formatCurrencyCompact(average, baseCurrencyCode) },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(({ label, value }) => (
        <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 min-w-0">
          <p className="text-xs text-gray-500 mb-1 truncate">{label}</p>
          {loading
            ? <div className="h-6 bg-gray-200 rounded animate-pulse w-3/4" />
            : <p className="text-base font-bold text-gray-900 tabular-nums">{value}</p>}
        </div>
      ))}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function IntraFlow() {
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()
  const { year, dateFrom: yearStart, dateTo: yearEnd } = useYearRange()

  // Filters
  const [dateFrom,    setDateFrom]    = useState(yearStart)
  const [dateTo,      setDateTo]      = useState(yearEnd)
  const [datePreset,  setDatePreset]  = useState<DatePreset | null>(null)
  const [accountFrom, setAccountFrom] = useState('')
  const [accountTo,   setAccountTo]   = useState('')

  const iflState = useDataViewState({ storageKey: 'ifl', defaultSortKey: 'date', defaultSortDir: 'desc' })

  // Debounce search for server (description ilike when col='all')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(iflState.search), 400)
    return () => clearTimeout(t)
  }, [iflState.search])

  useEffect(() => { iflState.setPage(0) }, [dateFrom, dateTo, accountFrom, accountTo, debouncedSearch, iflState.setPage])

  useEffect(() => {
    setDateFrom(`${year}-01-01`)
    setDateTo(`${year}-12-31`)
    iflState.setPage(0)
  }, [year]) // eslint-disable-line react-hooks/exhaustive-deps

  // Data
  const { data, count, loading, error, refetch } = useIntraFlows({
    dateFrom:     dateFrom    || undefined,
    dateTo:       dateTo      || undefined,
    accountFrom:  accountFrom || undefined,
    accountTo:    accountTo   || undefined,
    search:       debouncedSearch || undefined,
    searchCol:    iflState.searchCol,
    page:         iflState.page,
    pageSize:     iflState.pageSize,
    sortColumn:   iflState.advancedSort.length === 0 ? iflState.sortKey : undefined,
    sortAscending: iflState.advancedSort.length === 0 ? (iflState.sortDir === 'asc') : undefined,
    advancedSort: iflState.advancedSort.length > 0 ? iflState.advancedSort : undefined,
  })

  const displayed = data
  const { selectedIds, toggleRow, clearAll, selectAllRows, headerRef } = useBulkSelection(displayed)

  // Summary
  const total   = data.reduce((s, r) => s + Number(r.total_amount), 0)
  const largest = data.length ? Math.max(...data.map(r => Number(r.total_amount))) : 0
  const average = data.length ? total / data.length : 0

  // UI state
  const [editRecord,   setEditRecord]   = useState<IntraFlowRow | null>(null)
  const [modalOpen,    setModalOpen]    = useState(false)
  const [deleteId,     setDeleteId]     = useState<string | null>(null)
  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false)

  function intraFlowDetailItems(row: IntraFlowRow): DetailItem[] {
    return [
      { label: 'Transaction Ref',  value: row.transaction_ref, mono: true, breakAll: true },
      { label: 'Description',      value: row.description, breakAll: true },
      { label: 'Remark',           value: row.remark, breakAll: true },
      { label: 'From Stage 2',     value: row.account_from_stage2 },
      { label: 'To Stage 2',       value: row.account_to_stage2 },
    ]
  }

  const { push: toast }                             = useToastStore()
  const { canWrite, canDelete }                     = useRole()
  const { mutate: deleteRecord, loading: deleting }    = useDeleteTransaction('intra_flows')
  const { execute: bulkDelete, loading: bulkDeleting } = useBulkDeleteTransaction('intra_flows')
  const { categories } = useCategories()

  usePageTitle('Internal Transfers')
  const [tab, setTab] = useState<'transfers' | 'reallocation'>('transfers')

  const openAdd  = () => { setEditRecord(null); setModalOpen(true) }
  const openEdit = (r: IntraFlowRow) => { setEditRecord(r); setModalOpen(true) }

  const handleModalSuccess = () => {
    toast(editRecord ? 'Transfer updated' : 'Transfer recorded successfully', 'success')
    refetch()
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await deleteRecord(deleteId)
      toast('Transfer deleted', 'success')
      setDeleteId(null)
      refetch()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error')
    }
  }

  // Clear selection on filter, sort, page, or tab change
  useEffect(() => { clearAll() }, [iflState.page, iflState.sortKey, iflState.sortDir, dateFrom, dateTo, accountFrom, accountTo, debouncedSearch, tab, clearAll]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds)
    const { failed, total } = await bulkDelete(ids)
    if (failed === 0) toast(`Deleted ${total} transfer${total !== 1 ? 's' : ''}`, 'success')
    else              toast(`${total - failed} deleted, ${failed} failed`, 'error')
    clearAll()
    setBulkDeleteConfirmOpen(false)
    refetch()
  }

  const IFL_CSV_HEADERS = ['Date', 'From Category', 'To Category', `Amount (${baseCurrencySymbol})`, 'From Stage 1', 'From Stage 2', 'To Stage 1', 'To Stage 2', 'Description', 'Remark']
  const iflCsvRow = (r: IntraFlowRow) => [
    r.date, r.account_from ?? '', r.account_to ?? '', r.total_amount,
    r.account_from_stage1, r.account_from_stage2,
    r.account_to_stage1, r.account_to_stage2,
    r.description, r.remark,
  ]
  const IFL_CSV_FILE = `intra-flows-${new Date().toISOString().slice(0, 10)}.csv`

  const handleExportView = () => {
    exportCSV(IFL_CSV_FILE, IFL_CSV_HEADERS, displayed.map(iflCsvRow))
  }

  const handleExportAll = async () => {
    let query = supabase.from('intra_flows').select('*').limit(10000)
    const adv = iflState.advancedSort
    if (adv.length > 0) {
      for (const l of adv) {
        if (IFL_SORT_COLS.has(l.key)) query = query.order(l.key, { ascending: l.dir === 'asc' })
      }
    } else if (IFL_SORT_COLS.has(iflState.sortKey)) {
      query = query.order(iflState.sortKey, { ascending: iflState.sortDir === 'asc' })
    } else {
      query = query.order('date', { ascending: false })
    }
    if (dateFrom)    query = query.gte('date', dateFrom)
    if (dateTo)      query = query.lte('date', dateTo)
    if (accountFrom) query = query.ilike('account_from', `%${accountFrom}%`)
    if (accountTo)   query = query.ilike('account_to', `%${accountTo}%`)
    if (debouncedSearch) {
      if (!iflState.searchCol || iflState.searchCol === 'all') {
        query = query.or(`description.ilike.%${debouncedSearch}%,account_from.ilike.%${debouncedSearch}%,account_to.ilike.%${debouncedSearch}%`)
      } else if (IFL_SEARCH_COLS.has(iflState.searchCol)) {
        query = query.ilike(iflState.searchCol, `%${debouncedSearch}%`)
      }
    }
    const { data: rows } = await query
    if (!rows) return
    exportCSV(IFL_CSV_FILE, IFL_CSV_HEADERS, (rows as IntraFlowRow[]).map(iflCsvRow))
  }

  const hasActiveFilters = dateFrom || dateTo || accountFrom || accountTo || datePreset

  return (
    <>
      {/* Tab bar */}
      <div className="border-b border-gray-200 mb-5 -mt-1">
        <nav className="-mb-px flex">
          {(['transfers', 'reallocation'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {t === 'transfers' ? 'Internal Transfers' : 'Bulk Reallocation'}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'reallocation' ? (
        <BulkReallocation />
      ) : tab === 'transfers' && (
        <PageHelpBanner storageKey="help-dismissed-intraflow" title="What is an Internal Transfer?">
          An internal transfer moves money between two bank accounts within the organisation.
          It is not income or expenditure — no money enters or leaves the church.
          Record a transfer when, for example, cash collected in one account is consolidated into your main operating account.
        </PageHelpBanner>
      )}
      {error ? (
        <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
          <AlertCircle className="w-10 h-10 text-danger" />
          <p className="font-semibold text-gray-800">Failed to load internal transfers</p>
          <p className="text-sm text-gray-500">{error}</p>
          <button onClick={refetch} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors">
            <RefreshCw className="w-4 h-4" /> Retry
          </button>
        </div>
      ) : (
      <div className="space-y-5">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Internal Transfers</h1>
            <p className="text-sm text-gray-500 mt-0.5">Movements between accounts</p>
          </div>
          <div className="flex items-center gap-2">
            <ExportDropdown
              onExportView={handleExportView}
              onExportAll={handleExportAll}
              disabled={data.length === 0}
            />
            <button
              onClick={openAdd}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Transfer
            </button>
          </div>
        </div>

        {/* Filter bar */}
        <Card>
          <div className="space-y-3">
            <DatePresetBar
              activePreset={datePreset}
              onPreset={(preset, from, to) => { setDatePreset(preset); setDateFrom(from); setDateTo(to) }}
              onCustom={() => setDatePreset('custom')}
            />
            <div className="flex flex-wrap gap-3 items-end">
              <FilterGroup label="From">
                <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setDatePreset('custom') }} className={filterInputCls} />
              </FilterGroup>
              <FilterGroup label="To">
                <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setDatePreset('custom') }} className={filterInputCls} />
              </FilterGroup>
              <FilterGroup label="From Category" className="min-w-[180px]">
                <SearchableSelect value={accountFrom} onChange={setAccountFrom}
                  options={categories.map(c => ({ value: c.name, label: c.name }))}
                  placeholder="All categories" className={`${filterInputCls} bg-white`} />
              </FilterGroup>
              <FilterGroup label="To Category" className="min-w-[180px]">
                <SearchableSelect value={accountTo} onChange={setAccountTo}
                  options={categories.map(c => ({ value: c.name, label: c.name }))}
                  placeholder="All categories" className={`${filterInputCls} bg-white`} />
              </FilterGroup>
              {hasActiveFilters && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo(''); setDatePreset(null); setAccountFrom(''); setAccountTo('') }}
                  className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </Card>

        {/* Data controls bar */}
        <DataControlsBar
          columns={IFL_COLUMNS}
          sortKey={iflState.sortKey}
          sortDir={iflState.sortDir}
          onSort={iflState.setSort}
          defaultSortKey="date"
          defaultSortDir="desc"
          view={iflState.view}
          onViewChange={iflState.setView}
          search={iflState.search}
          onSearchChange={v => { iflState.setSearch(v) }}
          searchCol={iflState.searchCol}
          onSearchColChange={iflState.setSearchCol}
          advancedSort={iflState.advancedSort}
          onAdvancedSort={iflState.setAdvancedSort}
          pageSize={iflState.pageSize}
          onPageSizeChange={iflState.setPageSize}
        />

        {/* Summary strip */}
        <SummaryStrip total={total} count={count} largest={largest} average={average} loading={loading} />

        {/* Table / Card view */}
        <Card padding={false}>
          {iflState.view === 'cards' ? (
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
              ) : displayed.length === 0 ? (
                <div className="py-12 text-center text-gray-400">
                  <ArrowLeftRight className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm">No internal transfers match your filters.</p>
                </div>
              ) : (
                displayed.map(row => (
                  <div key={row.id} className="rounded-xl border overflow-hidden shadow-sm bg-white border-gray-200">
                    {/* Card header */}
                    <div className="px-4 pt-3.5 pb-3">
                      <p className="text-[11px] font-semibold mb-2 text-gray-400">{formatDate(row.date)}</p>
                      <div className="flex items-center gap-2 text-sm text-gray-700 mb-1">
                        <span className="font-medium truncate">{row.account_from ?? '—'}</span>
                        <ArrowLeftRight className="w-3 h-3 text-gray-400 shrink-0" />
                        <span className="font-medium truncate">{row.account_to ?? '—'}</span>
                      </div>
                      {row.description && (
                        <div className="text-sm mt-1.5">
                          <DescriptionCell id={`card-desc-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-600" />
                        </div>
                      )}
                      {row.remark && (
                        <div className="text-xs mt-1.5">
                          <DescriptionCell id={`card-rem-${row.id}`} text={row.remark} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-gray-400" />
                        </div>
                      )}
                    </div>
                    {/* Metrics footer */}
                    <div className="grid grid-cols-2 border-t border-gray-100 bg-gray-50/40 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-wide font-semibold mb-0.5 text-gray-500">Transfer</p>
                        <p className="text-sm font-mono font-bold tabular-nums text-primary">{formatCurrency(Number(row.total_amount), baseCurrencyCode)}</p>
                      </div>
                      <div className="border-l border-gray-200/80 pl-4 min-w-0 flex items-center justify-end gap-0.5">
                        {canWrite() && (
                          <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canDelete() && (
                          <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <>
              <BulkActionBar
                count={selectedIds.size}
                onClear={clearAll}
                actions={[
                  {
                    key: 'edit',
                    label: 'Edit selected',
                    icon: <Pencil className="w-3.5 h-3.5" />,
                    onClick: () => setBulkEditOpen(true),
                    show: canWrite(),
                  },
                  {
                    key: 'delete',
                    label: 'Delete selected',
                    icon: <Trash2 className="w-3.5 h-3.5" />,
                    variant: 'danger',
                    onClick: () => setBulkDeleteConfirmOpen(true),
                    loading: bulkDeleting,
                    show: canDelete(),
                  },
                ]}
              />
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="w-10 pl-4 pr-2">
                      <input
                        type="checkbox"
                        ref={headerRef}
                        onChange={e => e.target.checked ? selectAllRows() : clearAll()}
                        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                        aria-label="Select all"
                      />
                    </th>
                    <th className="w-8" />
                    <SortableHeader
                      field={IFL_SORT_FIELDS[0]}
                      activeSortKey={iflState.sortKey}
                      activeSortDir={iflState.sortDir}
                      onSort={iflState.setSort}
                      className="px-4 py-3 text-xs font-semibold"
                    />
                    <SortableHeader
                      field={IFL_SORT_FIELDS[2]}
                      activeSortKey={iflState.sortKey}
                      activeSortDir={iflState.sortDir}
                      onSort={iflState.setSort}
                      className="px-4 py-3 text-xs font-semibold"
                    />
                    <SortableHeader
                      field={IFL_SORT_FIELDS[3]}
                      activeSortKey={iflState.sortKey}
                      activeSortDir={iflState.sortDir}
                      onSort={iflState.setSort}
                      className="px-4 py-3 text-xs font-semibold"
                    />
                    <SortableHeader
                      field={IFL_SORT_FIELDS[1]}
                      activeSortKey={iflState.sortKey}
                      activeSortDir={iflState.sortDir}
                      onSort={iflState.setSort}
                      className="px-4 py-3 text-xs font-semibold"
                      rightAlign
                    />
                    <SortableHeader
                      field={IFL_SORT_FIELDS[4]}
                      activeSortKey={iflState.sortKey}
                      activeSortDir={iflState.sortDir}
                      onSort={iflState.setSort}
                      className="px-4 py-3 text-xs font-semibold"
                    />
                    {['Remark', 'Actions'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 9 }).map((_, j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-4 bg-gray-200 rounded animate-pulse" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : displayed.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-gray-400">
                          <ArrowLeftRight className="w-10 h-10 text-gray-200" />
                          <p className="text-sm">No internal transfers match your filters.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    displayed.map(row => {
                      const isExpanded = expandedId === row.id
                      return (
                        <Fragment key={row.id}>
                          <tr className={`transition-colors ${selectedIds.has(row.id) ? 'bg-primary/5 hover:bg-primary/10' : 'hover:bg-gray-50'}`}>
                            <td className="w-10 pl-4 pr-2">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(row.id)}
                                onChange={() => toggleRow(row.id)}
                                className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
                                aria-label="Select row"
                              />
                            </td>
                            <td className="w-8 pl-2">
                              <button
                                onClick={() => setExpandedId(isExpanded ? null : row.id)}
                                className="p-1 rounded text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors"
                                aria-label={isExpanded ? 'Collapse' : 'Expand'}
                              >
                                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                              </button>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                            <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.account_from ?? '—'}</td>
                            <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{row.account_to ?? '—'}</td>
                            <td className="px-4 py-3 text-sm font-semibold text-primary whitespace-nowrap text-right">{formatCurrency(Number(row.total_amount), baseCurrencyCode)}</td>
                            <td className="px-4 py-3 text-sm text-gray-500 max-w-[200px]">
                              <DescriptionCell id={`desc-${row.id}`} text={row.description} tooltip={descTooltip} setTooltip={setDescTooltip} />
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500 max-w-[160px]">
                              <DescriptionCell id={`rem-${row.id}`} text={row.remark} tooltip={descTooltip} setTooltip={setDescTooltip} />
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1">
                                {canWrite() && (
                                  <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-primary/10 transition-colors" title="Edit">
                                    <Pencil className="w-4 h-4" />
                                  </button>
                                )}
                                {canDelete() && (
                                  <button onClick={() => setDeleteId(row.id)} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors" title="Delete">
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isExpanded && <RowDetailPanel items={intraFlowDetailItems(row)} colSpan={9} />}
                        </Fragment>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
            </>
          )}
          <PaginationBar
            page={iflState.page}
            pageSize={iflState.pageSize}
            total={count}
            onPageChange={iflState.setPage}
            variant="full"
          />
        </Card>
      </div>
      )}

      <AddIntraFlowModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={handleModalSuccess}
        editRecord={editRecord}
      />
      <DeleteDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={handleDelete}
        loading={deleting}
        label="this internal transfer"
      />
      <BulkEditIntraFlowModal
        open={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        ids={Array.from(selectedIds)}
        onSuccess={() => { clearAll(); refetch() }}
      />
      <DeleteDialog
        open={bulkDeleteConfirmOpen}
        onClose={() => setBulkDeleteConfirmOpen(false)}
        onConfirm={handleBulkDelete}
        loading={bulkDeleting}
        label={`${selectedIds.size} internal transfer${selectedIds.size !== 1 ? 's' : ''}`}
      />
      <DescriptionTooltip tooltip={descTooltip} />
    </>
  )
}

// ── Local helpers ──────────────────────────────────────────────────────────────

function FilterGroup({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <label className="text-xs font-medium text-gray-500">{label}</label>
      {children}
    </div>
  )
}
