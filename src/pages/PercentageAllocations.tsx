import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Percent, AlertCircle, ExternalLink } from 'lucide-react'
import { useAllocationStore } from '../store/allocationStore'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatDate } from '../utils/formatters'
import { DataControlsBar } from '../components/ui/DataControlsBar'
import { SortableHeader } from '../components/ui/SortableHeader'
import { PaginationBar } from '../components/ui/PaginationBar'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows } from '../utils/sortUtils'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields, searchRows } from '../utils/tableColumns'

type PcaRow = { category_name: string; percentage?: number }

const PCA_COLUMNS: TableColumnDef<PcaRow>[] = [
  { key: 'category_name', label: 'Category',   sortType: 'text',    primary: true, accessor: r => r.category_name },
  { key: 'percentage',    label: 'Percentage', sortType: 'numeric', primary: true, accessor: r => String(r.percentage ?? 0), noSearch: true },
]

const PCA_SORT_FIELDS = deriveSortFields(PCA_COLUMNS)

export default function PercentageAllocations() {
  usePageTitle('Percentage Allocations')

  const { configs, loading, error, fetch } = useAllocationStore()
  const [selectedId, setSelectedId] = useState<string>('')
  const pcaState = useDataViewState({ storageKey: 'pca', defaultSortKey: 'category_name', defaultSortDir: 'asc' })

  useEffect(() => { fetch() }, [fetch])

  // Sort newest-first; default to the first one
  const sorted = [...configs].sort((a, b) => b.start_date.localeCompare(a.start_date))
  const config  = selectedId ? configs.find(c => c.id === selectedId) ?? sorted[0] : sorted[0]

  const today  = new Date().toISOString().slice(0, 10)
  const active = sorted.find(c => c.start_date <= today && c.status === 'locked')

  const total   = config?.rows.reduce((s, r) => s + Number(r.percentage), 0) ?? 0
  const balanced = Math.abs(100 - total) < 0.01

  const filteredRows = useMemo(
    () => searchRows(config?.rows ?? [], PCA_COLUMNS, pcaState.search, pcaState.searchCol),
    [config?.rows, pcaState.search, pcaState.searchCol],
  )

  const getPcaValue = (r: { category_name: string; percentage?: number }, k: string) => {
    if (k === 'percentage') return Number(r.percentage ?? 0)
    return r.category_name
  }

  const sortedConfigRows = useMemo(() => {
    const adv = pcaState.advancedSort
    if (adv.length > 0) return multiSortRows(filteredRows, getPcaValue, adv, PCA_SORT_FIELDS)
    return sortRows(filteredRows, getPcaValue, pcaState.sortKey, pcaState.sortDir, PCA_SORT_FIELDS)
  }, [filteredRows, pcaState.sortKey, pcaState.sortDir, pcaState.advancedSort])

  const pcaPage = useMemo(
    () => sortedConfigRows.slice(pcaState.page * pcaState.pageSize, (pcaState.page + 1) * pcaState.pageSize),
    [sortedConfigRows, pcaState.page, pcaState.pageSize],
  )

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Percentage Allocations</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            How inflows are split across categories by percentage
          </p>
        </div>
        <Link
          to="/setup"
          className="flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Manage configs in Setup
        </Link>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {!loading && configs.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Percent className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-gray-800">No allocation configs yet</p>
            <p className="text-sm text-gray-500 mt-1">Create one in Setup → Allocation.</p>
          </div>
          <Link
            to="/setup"
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
          >
            Go to Setup
          </Link>
        </div>
      )}

      {!loading && configs.length > 0 && (
        <>
          {/* Config selector + active badge */}
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={selectedId || config?.id || ''}
              onChange={e => setSelectedId(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary bg-white"
            >
              {sorted.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} — effective {formatDate(c.start_date)}
                  {c.status === 'locked' ? ' ✓' : ' (draft)'}
                </option>
              ))}
            </select>

            {active && config?.id === active.id && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                Currently active
              </span>
            )}

            {config && config.status === 'draft' && (
              <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
                Draft
              </span>
            )}
          </div>

          {/* Allocation table */}
          {config && config.rows.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-400">
              This config has no category rows yet.
            </div>
          )}

          {config && config.rows.length > 0 && (
            <div className="space-y-1.5">
              <DataControlsBar
                columns={PCA_COLUMNS}
                sortKey={pcaState.sortKey}
                sortDir={pcaState.sortDir}
                onSort={pcaState.setSort}
                defaultSortKey="category_name"
                defaultSortDir="asc"
                search={pcaState.search}
                onSearchChange={pcaState.setSearch}
                searchPlaceholder="Search categories…"
                searchCol={pcaState.searchCol}
                onSearchColChange={pcaState.setSearchCol}
                advancedSort={pcaState.advancedSort}
                onAdvancedSort={pcaState.setAdvancedSort}
                pageSize={pcaState.pageSize}
                onPageSizeChange={pcaState.setPageSize}
              />
              <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <div className="px-5 py-3 border-b border-gray-100 text-xs text-gray-500 flex items-center justify-between">
                <span className="font-semibold uppercase tracking-wider">
                  {config.name}
                </span>
                <span>Effective {formatDate(config.start_date)}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <th className="px-5 py-3 text-left font-medium">#</th>
                    <SortableHeader field={PCA_SORT_FIELDS[0]} activeSortKey={pcaState.sortKey} activeSortDir={pcaState.sortDir} onSort={pcaState.setSort} className="px-5 py-3" />
                    <SortableHeader field={PCA_SORT_FIELDS[1]} activeSortKey={pcaState.sortKey} activeSortDir={pcaState.sortDir} onSort={pcaState.setSort} rightAlign className="px-5 py-3" />
                    <th className="px-5 py-3 text-right font-medium hidden sm:table-cell">Per ₦100 received</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {pcaPage.map((row, i) => (
                    <tr key={i} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-gray-400 text-xs">{pcaState.page * pcaState.pageSize + i + 1}</td>
                      <td className="px-5 py-3 font-medium text-gray-800">{row.category_name}</td>
                      <td className="px-5 py-3 text-right">
                        <span className="font-mono font-semibold text-primary">
                          {Number(row.percentage).toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right text-gray-500 hidden sm:table-cell">
                        ₦{Number(row.percentage).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={`border-t-2 font-bold ${balanced ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
                    <td className="px-5 py-3" colSpan={2}>
                      <span className={balanced ? 'text-green-700' : 'text-amber-700'}>
                        Total {balanced ? '✓' : '⚠'}
                      </span>
                    </td>
                    <td className={`px-5 py-3 text-right font-mono ${balanced ? 'text-green-700' : 'text-amber-700'}`}>
                      {total.toFixed(1)}%
                    </td>
                    <td className="px-5 py-3 hidden sm:table-cell" />
                  </tr>
                </tfoot>
              </table>
              </div>
              <PaginationBar
                page={pcaState.page}
                pageSize={pcaState.pageSize}
                total={sortedConfigRows.length}
                onPageChange={pcaState.setPage}
                variant="full"
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
