import { useEffect, useState, useCallback, useMemo } from 'react'
import { Gift, AlertCircle, RefreshCw } from 'lucide-react'
import { exportCSV } from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { supabase } from '../lib/supabase'
import { useAccountingYearStore } from '../store/accountingYearStore'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatDate, formatCurrency } from '../utils/formatters'
import { DataControlsBar } from '../components/ui/DataControlsBar'
import { PaginationBar } from '../components/ui/PaginationBar'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows } from '../utils/sortUtils'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields, searchRows } from '../utils/tableColumns'

interface SpecificRow {
  id:                       string
  date:                     string
  stage_code_1:             string | null
  specific_seed_description: string | null
  description:              string | null
  amount:                   number
}

interface GroupedCategory {
  category:    string
  targets:     { target: string; total: number; count: number; latest: string }[]
  total:       number
}

const SG_COLUMNS: TableColumnDef<GroupedCategory>[] = [
  { key: 'category', label: 'Category', sortType: 'text',    primary: true, accessor: g => g.category },
  { key: 'total',    label: 'Total',    sortType: 'numeric', primary: true },
]

const SG_SORT_FIELDS = deriveSortFields(SG_COLUMNS)

function groupRows(rows: SpecificRow[]): GroupedCategory[] {
  const byCategory = new Map<string, Map<string, { total: number; count: number; latest: string }>>()

  for (const row of rows) {
    const cat    = row.stage_code_1 || '(Uncategorised)'
    const target = row.specific_seed_description || row.description || '(No target specified)'

    if (!byCategory.has(cat)) byCategory.set(cat, new Map())
    const targetMap = byCategory.get(cat)!
    const existing  = targetMap.get(target) ?? { total: 0, count: 0, latest: '' }

    targetMap.set(target, {
      total:  existing.total + Number(row.amount),
      count:  existing.count + 1,
      latest: existing.latest < row.date ? row.date : existing.latest,
    })
  }

  return [...byCategory.entries()]
    .map(([category, targets]) => ({
      category,
      targets: [...targets.entries()].map(([target, v]) => ({ target, ...v })),
      total:   [...targets.values()].reduce((s, v) => s + v.total, 0),
    }))
    .sort((a, b) => b.total - a.total)
}

export default function SpecificGivings() {
  usePageTitle('Specific Givings')

  const year = useAccountingYearStore(s => s.year)

  const [rows,    setRows]    = useState<SpecificRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const sgState = useDataViewState({ storageKey: 'sg', defaultSortKey: 'total', defaultSortDir: 'desc' })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const start = `${year}-01-01`
    const end   = `${year}-12-31`

    const result = await supabase
      .from('inflow_transactions')
      .select('id, date, stage_code_1, specific_seed_description, description, amount')
      .eq('stage_code_2', 'Specific Seed')
      .gte('date', start)
      .lte('date', end)
      .order('date', { ascending: false })

    if (result.error) {
      setError(result.error.message)
      setLoading(false)
      return
    }

    const txRows = (result.data ?? []) as SpecificRow[]

    // Opening balances from new table
    const cobRes = await supabase
      .from('category_opening_balances')
      .select('amount, category_id, categories(name, id)')
      .eq('budget_portion', 'Specific Seed')

    const cobData = cobRes.error ? [] : (cobRes.data ?? [])

    const cobOpeningRows: SpecificRow[] = cobData
      .map((r): SpecificRow | null => {
        const cats    = r.categories as unknown as { name: string; id: string } | null
        const catName = cats?.name ?? ''
        const catId   = cats?.id ?? ''
        if (!catName) return null
        return {
          id:                        `ob-${catId}`,
          date:                      '0000-01-01',
          stage_code_1:              catName,
          specific_seed_description: 'Opening Balance',
          description:               null,
          amount:                    Number(r.amount),
        }
      })
      .filter((r): r is SpecificRow => r !== null)

    setRows([...cobOpeningRows, ...txRows])
    setLoading(false)
  }, [year])

  useEffect(() => { load() }, [load])

  const allGrouped = useMemo(() => groupRows(rows), [rows])

  const filteredGrouped = useMemo(
    () => searchRows(allGrouped, SG_COLUMNS, sgState.search, sgState.searchCol),
    [allGrouped, sgState.search, sgState.searchCol],
  )

  const getSgValue = (g: GroupedCategory, k: string) => {
    if (k === 'category') return g.category
    return g.total
  }

  const grouped = useMemo(() => {
    const adv = sgState.advancedSort
    if (adv.length > 0) return multiSortRows(filteredGrouped, getSgValue, adv, SG_SORT_FIELDS)
    return sortRows(filteredGrouped, getSgValue, sgState.sortKey, sgState.sortDir, SG_SORT_FIELDS)
  }, [filteredGrouped, sgState.sortKey, sgState.sortDir, sgState.advancedSort])

  const sgPage = useMemo(
    () => grouped.slice(sgState.page * sgState.pageSize, (sgState.page + 1) * sgState.pageSize),
    [grouped, sgState.page, sgState.pageSize],
  )

  const grandTotal = rows.reduce((s, r) => s + Number(r.amount), 0)

  const SG_CSV_HEADERS = ['Category', 'Total (₦)']
  const sgCsvRow = (g: GroupedCategory) => [g.category, g.total]
  const SG_CSV_FILE = `specific-givings-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(SG_CSV_FILE, SG_CSV_HEADERS, sgPage.map(sgCsvRow))
  const handleExportAll  = () => exportCSV(SG_CSV_FILE, SG_CSV_HEADERS, grouped.map(sgCsvRow))

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Specific Givings</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Designated and specific-seed inflows for {year}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportDropdown onExportView={handleExportView} onExportAll={handleExportAll} disabled={grouped.length === 0} />
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {loading && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-24 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Gift className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-gray-800">No specific givings in {year}</p>
            <p className="text-sm text-gray-500 mt-1">
              Transactions tagged as "Specific Seed" type or Stage Code 2 = "Specific Seed" will appear here.
            </p>
          </div>
        </div>
      )}

      {!loading && grouped.length > 0 && (
        <div className="space-y-1.5">
          <DataControlsBar
            columns={SG_COLUMNS}
            sortKey={sgState.sortKey}
            sortDir={sgState.sortDir}
            onSort={sgState.setSort}
            defaultSortKey="total"
            defaultSortDir="desc"
            search={sgState.search}
            onSearchChange={sgState.setSearch}
            searchPlaceholder="Search categories…"
            searchCol={sgState.searchCol}
            onSearchColChange={sgState.setSearchCol}
            advancedSort={sgState.advancedSort}
            onAdvancedSort={sgState.setAdvancedSort}
            pageSize={sgState.pageSize}
            onPageSizeChange={sgState.setPageSize}
          />

          {/* Grand total strip */}
          <div className="bg-primary/5 border border-primary/20 rounded-xl px-5 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-primary">Total Specific Givings ({year})</span>
            <span className="font-mono font-bold text-primary text-base">{formatCurrency(grandTotal)}</span>
          </div>

          {/* Per-category cards */}
          {sgPage.map(group => (
            <div key={group.category} className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              {/* Category header */}
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                <span className="font-semibold text-gray-800 text-sm">{group.category}</span>
                <span className="font-mono font-bold text-gray-700 text-sm">{formatCurrency(group.total)}</span>
              </div>

              {/* Targets table */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 uppercase border-b border-gray-50">
                    <th className="px-5 py-2 text-left font-medium">Target / Recipient</th>
                    <th className="px-5 py-2 text-center font-medium hidden sm:table-cell">Entries</th>
                    <th className="px-5 py-2 text-center font-medium hidden sm:table-cell">Latest</th>
                    <th className="px-5 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {group.targets.sort((a, b) => b.total - a.total).map(t => (
                    <tr key={t.target} className="hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 text-gray-700">{t.target}</td>
                      <td className="px-5 py-3 text-center text-gray-400 text-xs hidden sm:table-cell">
                        {t.count}
                      </td>
                      <td className="px-5 py-3 text-center text-gray-400 text-xs hidden sm:table-cell">
                        {formatDate(t.latest)}
                      </td>
                      <td className="px-5 py-3 text-right font-semibold text-success">
                        {formatCurrency(t.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
          <PaginationBar
            page={sgState.page}
            pageSize={sgState.pageSize}
            total={grouped.length}
            onPageChange={sgState.setPage}
            variant="full"
          />
        </div>
      )}
    </div>
  )
}
