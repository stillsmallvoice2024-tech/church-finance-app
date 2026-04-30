import { useState, useEffect } from 'react'
import { ClipboardList, Download, AlertCircle, RefreshCw } from 'lucide-react'
import { Card }               from '../components/ui/Card'
import { Pagination }         from '../components/ui/Pagination'
import { useFieldChanges }    from '../hooks/useFieldChanges'
import { useRole }            from '../hooks/useRole'
import { usePageTitle }       from '../hooks/usePageTitle'
import { exportCSV }          from '../utils/csvExport'

const PAGE_SIZE = 200

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

function fmtTs(ts: string) {
  return new Date(ts).toLocaleString('en-NG', {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function ChangeLog() {
  const { isAdmin } = useRole()
  usePageTitle('Change Log')

  const [tableFilter, setTableFilter] = useState('')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')
  const [page,        setPage]        = useState(0)

  useEffect(() => { setPage(0) }, [tableFilter, dateFrom, dateTo])

  const { entries, count, loading, error, refetch } = useFieldChanges({
    tableName: tableFilter || undefined,
    dateFrom:  dateFrom    || undefined,
    dateTo:    dateTo      || undefined,
    page,
    pageSize:  PAGE_SIZE,
  })

  if (!isAdmin()) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Admin access required</p>
      <p className="text-sm text-gray-500">Only administrators can view the change log.</p>
    </div>
  )

  if (error) return (
    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
      <AlertCircle className="w-10 h-10 text-danger" />
      <p className="font-semibold text-gray-800">Failed to load change log</p>
      <p className="text-sm text-gray-500">{error}</p>
      <p className="text-xs text-gray-400 max-w-md">
        If this is a new installation, run the following SQL in Supabase:
      </p>
      <pre className="bg-gray-900 text-green-300 text-xs rounded-lg px-4 py-3 text-left max-w-2xl overflow-x-auto">{`CREATE TABLE IF NOT EXISTS public.field_changes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  table_name text NOT NULL,
  record_id  text NOT NULL,
  field_name text NOT NULL,
  old_value  text,
  new_value  text,
  changed_at timestamptz DEFAULT now()
);
ALTER TABLE public.field_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read field_changes" ON public.field_changes
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );
CREATE POLICY "Auth insert field_changes" ON public.field_changes
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);`}</pre>
      <button onClick={refetch} className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors">
        <RefreshCw className="w-4 h-4" /> Retry
      </button>
    </div>
  )

  const handleExport = () => {
    exportCSV(
      `change-log-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Timestamp', 'User', 'Table', 'Record ID', 'Field', 'Old Value', 'New Value'],
      entries.map(e => [
        fmtTs(e.changed_at),
        e.profiles?.full_name ?? e.profiles?.email ?? e.user_id ?? '—',
        TABLE_LABELS[e.table_name] ?? e.table_name,
        e.record_id,
        e.field_name,
        e.old_value ?? '',
        e.new_value ?? '',
      ]),
    )
  }

  const inputCls = 'px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white'

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ClipboardList className="w-6 h-6 text-primary" /> Change Log
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Per-field record of every edit made</p>
        </div>
        <button
          onClick={handleExport}
          disabled={entries.length === 0}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Table</label>
            <select value={tableFilter} onChange={e => setTableFilter(e.target.value)} className={inputCls}>
              <option value="">All tables</option>
              {Object.entries(TABLE_LABELS).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className={inputCls} />
          </div>
          {(tableFilter || dateFrom || dateTo) && (
            <button
              onClick={() => { setTableFilter(''); setDateFrom(''); setDateTo('') }}
              className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card padding={false}>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100">
                {['Timestamp', 'User', 'Table', 'Record ID', 'Field', 'Old Value', 'New Value'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
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
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-16 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <ClipboardList className="w-10 h-10 text-gray-200" />
                      <p className="text-sm">No field changes recorded yet.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                entries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtTs(e.changed_at)}</td>
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
                    <td className="px-4 py-3 text-sm text-red-600 max-w-[160px] truncate" title={e.old_value ?? ''}>
                      {e.old_value ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-green-700 max-w-[160px] truncate" title={e.new_value ?? ''}>
                      {e.new_value ?? <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={PAGE_SIZE} total={count} onChange={setPage} />
      </Card>
    </div>
  )
}
