import { useState, useEffect } from 'react'
import { ClipboardList, AlertCircle, RefreshCw } from 'lucide-react'
import { Card }               from '../components/ui/Card'
import { PaginationBar }      from '../components/ui/PaginationBar'
import { DataControlsBar }    from '../components/ui/DataControlsBar'
import { SortableHeader }     from '../components/ui/SortableHeader'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { useDescriptionExpand } from '../hooks/useDescriptionExpand'
import { useFieldChanges }    from '../hooks/useFieldChanges'
import type { FieldChangeEntry } from '../hooks/useFieldChanges'
import { usePageTitle }       from '../hooks/usePageTitle'
import { useDataViewState }   from '../hooks/useDataViewState'
import { exportCSV }          from '../utils/csvExport'
import { supabase }           from '../lib/supabase'
import { ExportDropdown }     from '../components/ui/ExportDropdown'
import type { SortField } from '../utils/sortUtils'
import type { TableColumnDef } from '../utils/tableColumns'
import { filterInputCls }     from '../components/ui/FormField'
import { DatePresetBar, type DatePreset } from '../components/ui/DatePresetBar'
import { EmptyState }         from '../components/ui/EmptyState'
import { useOrgCurrency }     from '../hooks/useOrgCurrency'

const TABLE_LABELS: Record<string, string> = {
  inflow_transactions:  'Inflow Transactions',
  outflow_transactions: 'Outflow Transactions',
  intra_flows:          'IntraBank Transfers',
  categories:           'Categories',
  banks:                'Banks',
  allocation_configs:   'Allocation Configs',
  fx_transactions:      'FX Transactions',
  project_entries:      'Project Entries',
}

const CL_COLUMNS: TableColumnDef<FieldChangeEntry>[] = [
  { key: 'changed_at', label: 'Timestamp', sortType: 'date', primary: true, noSearch: true },
  { key: 'field_name', label: 'Field',     sortType: 'text', primary: true, accessor: e => e.field_name },
  { key: 'table_name', label: 'Table',     sortType: 'text', primary: true, accessor: e => TABLE_LABELS[e.table_name] ?? e.table_name },
  { key: 'old_value',  label: 'Old Value',                   accessor: e => e.old_value ?? '' },
  { key: 'new_value',  label: 'New Value',                   accessor: e => e.new_value ?? '' },
]

const CL_SORT_COLS = new Set(['changed_at', 'field_name', 'table_name'])
const CL_SEARCH_COLS = new Set(['field_name', 'table_name', 'old_value', 'new_value'])

function fmtTs(ts: string, locale: string) {
  return new Date(ts).toLocaleString(locale, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function ChangeLog() {
  usePageTitle('Activity History')
  const { formatLocale } = useOrgCurrency()

  const [tableFilter, setTableFilter] = useState('')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [datePreset,  setDatePreset]  = useState<DatePreset | null>(null)

  const clState = useDataViewState({
    storageKey:      'cl',
    defaultSortKey:  'changed_at',
    defaultSortDir:  'desc',
    defaultPageSize: 50,
  })

  useEffect(() => { clState.setPage(0) }, [tableFilter, dateFrom, dateTo, clState.setPage])

  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(clState.search), 400)
    return () => clearTimeout(t)
  }, [clState.search])

  const { entries, count, loading, error, refetch } = useFieldChanges({
    tableName:    tableFilter || undefined,
    dateFrom:     dateFrom    || undefined,
    dateTo:       dateTo      || undefined,
    page:         clState.page,
    pageSize:     clState.pageSize,
    search:       debouncedSearch || undefined,
    searchCol:    clState.searchCol,
    sortColumn:   clState.advancedSort.length === 0 ? clState.sortKey : undefined,
    sortAscending: clState.advancedSort.length === 0 ? (clState.sortDir === 'asc') : undefined,
    advancedSort: clState.advancedSort.length > 0 ? clState.advancedSort : undefined,
  })

  const displayed = entries

  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load change log</p>
      <p className="text-sm text-gray-500">{error}</p>
      <p className="text-xs text-gray-400 max-w-md">
        If this is a new installation, run the following SQL in Supabase:
      </p>
      <pre className="bg-gray-900 text-green-300 text-xs rounded-lg px-4 py-3 text-left max-w-2xl overflow-x-auto">{`-- Run the full schema.sql or apply migrations in order.
-- field_changes is written by server-side DB triggers only.
-- See supabase/migrations/20260605000001_server_side_audit_triggers.sql`}</pre>
      <button onClick={refetch} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  )

  const CL_CSV_HEADERS = ['Timestamp', 'User', 'Table', 'Record ID', 'Field', 'Old Value', 'New Value']
  const clCsvRow = (e: FieldChangeEntry) => [
    fmtTs(e.changed_at, formatLocale),
    e.profiles?.full_name ?? e.profiles?.email ?? e.user_id ?? '—',
    TABLE_LABELS[e.table_name] ?? e.table_name,
    e.record_id, e.field_name, e.old_value ?? '', e.new_value ?? '',
  ]
  const CL_CSV_FILE = `change-log-${new Date().toISOString().slice(0, 10)}.csv`

  const handleExportView = () => {
    exportCSV(CL_CSV_FILE, CL_CSV_HEADERS, displayed.map(clCsvRow))
  }

  const handleExportAll = async () => {
    let query = supabase
      .from('field_changes')
      .select(`id, user_id, table_name, record_id, field_name, old_value, new_value, changed_at, profiles:user_id ( full_name, email )`)
      .limit(10000)
    const adv = clState.advancedSort
    if (adv.length > 0) {
      for (const l of adv) {
        if (CL_SORT_COLS.has(l.key)) query = query.order(l.key, { ascending: l.dir === 'asc' })
      }
    } else if (CL_SORT_COLS.has(clState.sortKey)) {
      query = query.order(clState.sortKey, { ascending: clState.sortDir === 'asc' })
    } else {
      query = query.order('changed_at', { ascending: false })
    }
    if (tableFilter) query = query.eq('table_name', tableFilter)
    if (dateFrom)    query = query.gte('changed_at', dateFrom)
    if (dateTo)      query = query.lte('changed_at', dateTo + 'T23:59:59')
    if (debouncedSearch) {
      if (!clState.searchCol || clState.searchCol === 'all') {
        query = query.or(`field_name.ilike.%${debouncedSearch}%,table_name.ilike.%${debouncedSearch}%,old_value.ilike.%${debouncedSearch}%,new_value.ilike.%${debouncedSearch}%`)
      } else if (CL_SEARCH_COLS.has(clState.searchCol)) {
        query = query.ilike(clState.searchCol, `%${debouncedSearch}%`)
      }
    }
    const { data: rows } = await query
    if (!rows) return
    exportCSV(CL_CSV_FILE, CL_CSV_HEADERS, (rows as unknown as FieldChangeEntry[]).map(clCsvRow))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-gray-100">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" /> Activity History
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Per-field record of every edit made</p>
        </div>
        <ExportDropdown
          onExportView={handleExportView}
          onExportAll={handleExportAll}
          disabled={entries.length === 0}
        />
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
              <label className="text-xs font-medium text-gray-500">Table</label>
              <select value={tableFilter} onChange={e => setTableFilter(e.target.value)} className={filterInputCls}>
                <option value="">All tables</option>
                {Object.entries(TABLE_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">From</label>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setDatePreset('custom') }} className={filterInputCls} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-gray-500">To</label>
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setDatePreset('custom') }} className={filterInputCls} />
            </div>
            {(tableFilter || dateFrom || dateTo || datePreset) && (
              <button
                onClick={() => { setTableFilter(''); setDateFrom(''); setDateTo(''); setDatePreset(null) }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </Card>

      {/* Sort / Search / Page-size controls */}
      <DataControlsBar
        columns={CL_COLUMNS}
        sortKey={clState.sortKey}
        sortDir={clState.sortDir}
        onSort={clState.setSort}
        defaultSortKey="changed_at"
        defaultSortDir="desc"
        search={clState.search}
        onSearchChange={v => { clState.setSearch(v); clState.setPage(0) }}
        searchCol={clState.searchCol}
        onSearchColChange={clState.setSearchCol}
        advancedSort={clState.advancedSort}
        onAdvancedSort={clState.setAdvancedSort}
        pageSize={clState.pageSize}
        onPageSizeChange={clState.setPageSize}
        pageSizeOptions={[25, 50, 100, 200]}
      />

      {/* Table */}
      <Card padding={false}>
        <div className="overflow-x-auto scroll-x-fade">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <SortableHeader
                  field={{ key: 'changed_at', label: 'Timestamp', type: 'date' } satisfies SortField}
                  activeSortKey={clState.sortKey}
                  activeSortDir={clState.sortDir}
                  onSort={clState.setSort}
                  className="text-left text-xs font-semibold whitespace-nowrap"
                />
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                  User
                </th>
                <SortableHeader
                  field={{ key: 'table_name', label: 'Table', type: 'text' } satisfies SortField}
                  activeSortKey={clState.sortKey}
                  activeSortDir={clState.sortDir}
                  onSort={clState.setSort}
                  className="text-left text-xs font-semibold whitespace-nowrap"
                />
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                  Record ID
                </th>
                <SortableHeader
                  field={{ key: 'field_name', label: 'Field', type: 'text' } satisfies SortField}
                  activeSortKey={clState.sortKey}
                  activeSortDir={clState.sortDir}
                  onSort={clState.setSort}
                  className="text-left text-xs font-semibold whitespace-nowrap"
                />
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                  Old Value
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">
                  New Value
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 7 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-gray-200 rounded animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : displayed.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState icon={ClipboardList} title="No field changes recorded yet." compact />
                  </td>
                </tr>
              ) : (
                displayed.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtTs(e.changed_at, formatLocale)}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {e.profiles?.full_name ?? e.profiles?.email ?? <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                      {TABLE_LABELS[e.table_name] ?? e.table_name}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono max-w-[120px] truncate" title={e.record_id}>
                      {e.record_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-800">{e.field_name}</td>
                    <td className="px-4 py-3 text-sm max-w-[160px]">
                      {e.old_value == null
                        ? <span className="text-gray-300">—</span>
                        : <DescriptionCell id={`old-${e.id}`} text={e.old_value} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-red-600" />
                      }
                    </td>
                    <td className="px-4 py-3 text-sm max-w-[160px]">
                      {e.new_value == null
                        ? <span className="text-gray-300">—</span>
                        : <DescriptionCell id={`new-${e.id}`} text={e.new_value} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-green-700" />
                      }
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar
          variant="full"
          page={clState.page}
          pageSize={clState.pageSize}
          total={count}
          onPageChange={clState.setPage}
        />
      </Card>
      <DescriptionTooltip tooltip={descTooltip} />
    </div>
  )
}
