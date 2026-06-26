import { useState, useEffect } from 'react'
import { ClipboardList, AlertCircle, RefreshCw, Plus, Trash2 } from 'lucide-react'
import { Card }               from '../components/ui/Card'
import { PaginationBar }      from '../components/ui/PaginationBar'
import { DataControlsBar }    from '../components/ui/DataControlsBar'
import { SortableHeader }     from '../components/ui/SortableHeader'
import { DescriptionCell, DescriptionTooltip } from '../components/ui/DescriptionCell'
import { useDescriptionExpand } from '../hooks/useDescriptionExpand'
import { useActivityLog, type ActivityLogEntry, type ActivityEventType } from '../hooks/useActivityLog'
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
  allocation_configs:   'Distribution Rules',
  fx_transactions:      'FX Transactions',
  project_entries:      'Project Entries',
}

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: '',               label: 'All events'        },
  { value: 'field_change',   label: 'Edits only'        },
  { value: 'record_created', label: 'Created records'   },
  { value: 'record_deleted', label: 'Deleted records'   },
]

const CL_COLUMNS: TableColumnDef<ActivityLogEntry>[] = [
  { key: 'event_at',   label: 'Timestamp', sortType: 'date', primary: true, noSearch: true },
  { key: 'field_name', label: 'Field',     sortType: 'text', primary: true, accessor: e => e.field_name ?? '' },
  { key: 'table_name', label: 'Table',     sortType: 'text', primary: true, accessor: e => TABLE_LABELS[e.table_name ?? ''] ?? (e.table_name ?? '') },
  { key: 'old_value',  label: 'Old Value',                   accessor: e => e.old_value ?? '' },
  { key: 'new_value',  label: 'New Value',                   accessor: e => e.new_value ?? '' },
]

function fmtTs(ts: string, locale: string) {
  return new Date(ts).toLocaleString(locale, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

// Extract a short human-readable summary from a snapshot JSONB blob
function snapshotSummary(data: Record<string, unknown> | null): string {
  if (!data) return '—'
  const parts: string[] = []
  if (data.date)        parts.push(String(data.date))
  if (data.amount)      parts.push(`amt:${data.amount}`)
  if (data.amount_disbursed) parts.push(`amt:${data.amount_disbursed}`)
  if (data.description) parts.push(String(data.description).slice(0, 40))
  if (data.name)        parts.push(String(data.name).slice(0, 40))
  return parts.join(' · ') || '—'
}

// Event type badge for INSERT/DELETE rows
function EventBadge({ type }: { type: ActivityEventType }) {
  if (type === 'record_created') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">
      <Plus className="w-2.5 h-2.5" />Created
    </span>
  )
  if (type === 'record_deleted') return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">
      <Trash2 className="w-2.5 h-2.5" />Deleted
    </span>
  )
  return null
}

export default function ChangeLog() {
  usePageTitle('Activity History')
  const { formatLocale } = useOrgCurrency()

  const [tableFilter,     setTableFilter]     = useState('')
  const [eventTypeFilter, setEventTypeFilter] = useState('')
  const [dateFrom,        setDateFrom]        = useState('')
  const [dateTo,          setDateTo]          = useState('')
  const [datePreset,      setDatePreset]      = useState<DatePreset | null>(null)

  const clState = useDataViewState({
    storageKey:      'cl',
    defaultSortKey:  'event_at',
    defaultSortDir:  'desc',
    defaultPageSize: 50,
  })

  useEffect(() => { clState.setPage(0) }, [tableFilter, eventTypeFilter, dateFrom, dateTo, clState.setPage])

  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(clState.search), 400)
    return () => clearTimeout(t)
  }, [clState.search])

  const eventTypes = eventTypeFilter
    ? [eventTypeFilter as ActivityEventType]
    : undefined

  const { entries, count, loading, error, refetch } = useActivityLog({
    tableName:    tableFilter || undefined,
    dateFrom:     dateFrom    || undefined,
    dateTo:       dateTo      || undefined,
    eventTypes,
    page:         clState.page,
    pageSize:     clState.pageSize,
    search:       debouncedSearch || undefined,
    searchCol:    clState.searchCol,
    sortAscending: clState.sortDir === 'asc',
  })

  const { tooltip: descTooltip, setTooltip: setDescTooltip } = useDescriptionExpand()

  const isMigrationError = !!error && /activity_log_view|does not exist/i.test(error)

  if (error && !isMigrationError) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load activity log</p>
      <p className="text-sm text-gray-500">{error}</p>
      <button onClick={refetch} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  )

  const CL_CSV_HEADERS = ['Timestamp', 'User', 'Event', 'Table', 'Record ID', 'Field', 'Old Value', 'New Value']
  const clCsvRow = (e: ActivityLogEntry) => [
    fmtTs(e.event_at, formatLocale),
    e.user_full_name ?? e.user_email ?? e.user_id ?? '—',
    e.event_type,
    TABLE_LABELS[e.table_name ?? ''] ?? (e.table_name ?? '—'),
    e.record_id ?? '—',
    e.field_name ?? '—',
    e.old_value ?? '',
    e.new_value ?? '',
  ]
  const CL_CSV_FILE = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`

  const handleExportView = () => {
    exportCSV(CL_CSV_FILE, CL_CSV_HEADERS, entries.map(clCsvRow))
  }

  const handleExportAll = async () => {
    // Export up to 10k rows from the view with current filters
    let query = supabase
      .from('activity_log_view')
      .select('*')
      .limit(10000)
      .order('event_at', { ascending: clState.sortDir === 'asc' })
    if (tableFilter)      query = query.eq('table_name', tableFilter)
    if (dateFrom)         query = query.gte('event_at', dateFrom)
    if (dateTo)           query = query.lte('event_at', dateTo + 'T23:59:59')
    if (eventTypes?.length) query = query.in('event_type', eventTypes)
    if (debouncedSearch) {
      const s = debouncedSearch.replace(/[%_\\()\[\],{}]/g, '')
      query = query.or(`field_name.ilike.%${s}%,table_name.ilike.%${s}%,old_value.ilike.%${s}%,new_value.ilike.%${s}%`)
    }
    const { data: rows } = await query
    if (!rows) return
    exportCSV(CL_CSV_FILE, CL_CSV_HEADERS, (rows as unknown as ActivityLogEntry[]).map(clCsvRow))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 border-b border-gray-100">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" /> Activity History
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Field edits, record creations and deletions</p>
        </div>
        <ExportDropdown
          onExportView={handleExportView}
          onExportAll={handleExportAll}
          disabled={entries.length === 0}
        />
      </div>

      {isMigrationError && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            The <code className="font-mono text-xs">activity_log_view</code> is missing.
            Run the Audit Feature migration SQL from <strong>Internal Audit → database setup</strong> to enable unified event tracking.
          </span>
        </div>
      )}

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
              <label className="text-xs font-medium text-gray-500">Event Type</label>
              <select value={eventTypeFilter} onChange={e => setEventTypeFilter(e.target.value)} className={filterInputCls}>
                {EVENT_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
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
            {(tableFilter || eventTypeFilter || dateFrom || dateTo || datePreset) && (
              <button
                onClick={() => { setTableFilter(''); setEventTypeFilter(''); setDateFrom(''); setDateTo(''); setDatePreset(null) }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </Card>

      <DataControlsBar
        columns={CL_COLUMNS}
        sortKey={clState.sortKey}
        sortDir={clState.sortDir}
        onSort={clState.setSort}
        defaultSortKey="event_at"
        defaultSortDir="desc"
        view={clState.view}
        onViewChange={clState.setView}
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

      <Card padding={false}>
        {clState.view === 'cards' ? (
          <div className="p-3 space-y-2">
            {loading && entries.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />
              ))
            ) : entries.length === 0 ? (
              <EmptyState icon={ClipboardList} title="No activity recorded yet." compact />
            ) : (
              entries.map(e => {
                const isEdit    = e.event_type === 'field_change'
                const isCreated = e.event_type === 'record_created'
                const isDeleted = e.event_type === 'record_deleted'
                return (
                  <div
                    key={e.id}
                    className={`rounded-xl border px-3 py-3 space-y-2 ${
                      isCreated ? 'bg-green-50/50 border-green-100'
                      : isDeleted ? 'bg-red-50/50 border-red-100'
                      : 'bg-white border-gray-100'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {isEdit ? (
                          <p className="text-sm font-medium text-gray-800 break-words">{e.field_name}</p>
                        ) : (
                          <EventBadge type={e.event_type} />
                        )}
                        <p className="text-xs text-gray-500 mt-0.5">
                          {TABLE_LABELS[e.table_name ?? ''] ?? e.table_name}
                          <span className="text-gray-400 font-mono"> · {(e.record_id ?? '').slice(0, 8)}…</span>
                        </p>
                      </div>
                      <p className="text-xs text-gray-500 whitespace-nowrap shrink-0">{fmtTs(e.event_at, formatLocale)}</p>
                    </div>
                    {isEdit ? (
                      <div className="space-y-1">
                        <div className="rounded-lg bg-red-50/70 border border-red-100 px-2.5 py-1.5">
                          <p className="text-xs uppercase tracking-wide text-red-400">Old</p>
                          <p className="text-sm text-red-700 break-words">{e.old_value ?? '—'}</p>
                        </div>
                        <div className="rounded-lg bg-green-50/70 border border-green-100 px-2.5 py-1.5">
                          <p className="text-xs uppercase tracking-wide text-green-500">New</p>
                          <p className="text-sm text-green-800 break-words">{e.new_value ?? '—'}</p>
                        </div>
                      </div>
                    ) : (
                      <div className={`rounded-lg px-2.5 py-1.5 text-xs ${isCreated ? 'bg-green-50 border border-green-100 text-green-800' : 'bg-red-50 border border-red-100 text-red-800'}`}>
                        {snapshotSummary(e.snapshot_data)}
                      </div>
                    )}
                    <p className="text-xs text-gray-500">
                      {e.user_full_name ?? e.user_email ?? 'Unknown user'}
                    </p>
                  </div>
                )
              })
            )}
          </div>
        ) : (
          <div className="overflow-x-auto scroll-x-fade">
            <table className="min-w-full table-sticky-col">
              <thead>
                <tr className="border-b-2 border-black/[0.06] dark:border-white/[0.07]">
                  <SortableHeader
                    field={{ key: 'event_at', label: 'Timestamp', type: 'date' } satisfies SortField}
                    activeSortKey={clState.sortKey}
                    activeSortDir={clState.sortDir}
                    onSort={clState.setSort}
                    className="text-left text-xs font-semibold whitespace-nowrap"
                  />
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">User</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">Event</th>
                  <SortableHeader
                    field={{ key: 'table_name', label: 'Table', type: 'text' } satisfies SortField}
                    activeSortKey={clState.sortKey}
                    activeSortDir={clState.sortDir}
                    onSort={clState.setSort}
                    className="text-left text-xs font-semibold whitespace-nowrap"
                  />
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">Record ID</th>
                  <SortableHeader
                    field={{ key: 'field_name', label: 'Field / Summary', type: 'text' } satisfies SortField}
                    activeSortKey={clState.sortKey}
                    activeSortDir={clState.sortDir}
                    onSort={clState.setSort}
                    className="text-left text-xs font-semibold whitespace-nowrap"
                  />
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">Old Value</th>
                  <th className="px-4 py-3 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest whitespace-nowrap">New Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {loading && entries.length === 0 ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((_, j) => (
                        <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>
                      ))}
                    </tr>
                  ))
                ) : entries.length === 0 ? (
                  <tr>
                    <td colSpan={8}>
                      <EmptyState icon={ClipboardList} title="No activity recorded yet." compact />
                    </td>
                  </tr>
                ) : (
                  entries.map(e => {
                    const isEdit    = e.event_type === 'field_change'
                    const isCreated = e.event_type === 'record_created'
                    const rowCls    = isCreated
                      ? 'bg-green-50/30 hover:bg-green-50/60'
                      : e.event_type === 'record_deleted'
                      ? 'bg-red-50/30 hover:bg-red-50/60'
                      : 'hover:bg-black/[0.02] dark:hover:bg-white/[0.03]'
                    return (
                      <tr key={e.id} className={`${rowCls} transition-colors`}>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtTs(e.event_at, formatLocale)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                          {e.user_full_name ?? e.user_email ?? <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {isEdit
                            ? <span className="text-xs font-medium text-amber-700 px-1.5 py-0.5 rounded-full bg-amber-50">Edit</span>
                            : <EventBadge type={e.event_type} />
                          }
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                          {TABLE_LABELS[e.table_name ?? ''] ?? e.table_name}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono max-w-[160px] break-all">
                          {e.record_id ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-800 max-w-[160px]">
                          {isEdit
                            ? (e.field_name ?? '—')
                            : <span className="text-xs text-gray-500 italic">{snapshotSummary(e.snapshot_data)}</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-sm max-w-[160px]">
                          {isEdit && (e.old_value != null
                            ? <DescriptionCell id={`old-${e.id}`} text={e.old_value} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-red-600" />
                            : <span className="text-gray-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm max-w-[160px]">
                          {isEdit && (e.new_value != null
                            ? <DescriptionCell id={`new-${e.id}`} text={e.new_value} tooltip={descTooltip} setTooltip={setDescTooltip} textCls="text-green-700" />
                            : <span className="text-gray-300">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
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
