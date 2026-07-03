import { useEffect, useState, useCallback, useMemo, Fragment } from 'react'
import { Gift, AlertCircle, RefreshCw, TrendingUp, TrendingDown, ChevronDown, ChevronRight } from 'lucide-react'
import { PageHelpBanner } from '../components/ui/PageHelpBanner'
import { exportCSV } from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { supabase } from '../lib/supabase'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatDate, formatCurrency } from '../utils/formatters'
import { friendlyError } from '../utils/friendlyError'
import { useTransactionSyncStore } from '../store/transactionSyncStore'
import { DataControlsBar } from '../components/ui/DataControlsBar'
import { SortableHeader } from '../components/ui/SortableHeader'
import { PaginationBar } from '../components/ui/PaginationBar'
import { useDataViewState } from '../hooks/useDataViewState'
import { sortRows, multiSortRows } from '../utils/sortUtils'
import type { TableColumnDef } from '../utils/tableColumns'
import { deriveSortFields, searchRows } from '../utils/tableColumns'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { useOrgStore } from '../store/orgStore'
import { allocatePercent } from '../utils/financeMath'

// One signed contribution to a designated fund (inflow, opening balance,
// config split, or transfer in/out). Feeds both the balance columns and the
// per-target breakdown in the expandable row.
interface ContributionRow {
  date:   string
  target: string
  amount: number
}

interface GiftRow {
  category:  string
  deposited: number
  withdrawn: number
  balance:   number
  targets:   { target: string; total: number; count: number; latest: string }[]
}

const SG_COLUMNS: TableColumnDef<GiftRow>[] = [
  { key: 'category',  label: 'Category',    sortType: 'text',    primary: true, accessor: r => r.category },
  { key: 'deposited', label: 'Gifts In',    sortType: 'numeric', primary: true },
  { key: 'balance',   label: 'Net Balance', sortType: 'numeric', primary: true },
]

const SG_SORT_FIELDS = deriveSortFields(SG_COLUMNS)

export default function SpecificGivings() {
  usePageTitle('Designated Gifts')
  const { baseCurrencySymbol, baseCurrencyCode } = useOrgCurrency()
  const orgId = useOrgStore(s => s.orgId)

  const [rows,    setRows]    = useState<GiftRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null)

  const sgState = useDataViewState({ storageKey: 'sg', defaultSortKey: 'balance', defaultSortDir: 'desc' })
  const intraflowVersion = useTransactionSyncStore(s => s.intraflowVersion)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    const [directRes, outflowRes, configSplitRes, cobRes, intraflowRes] = await Promise.all([
      supabase
        .from('inflow_transactions')
        .select('date, stage_code_1, specific_seed_description, description, amount')
        .eq('org_id', orgId)
        .eq('stage_code_2', 'Specific Seed'),
      supabase
        .from('outflow_transactions')
        .select('stage_code_1, amount_disbursed, offset_role')
        .eq('org_id', orgId)
        .eq('stage_code_2', 'Specific Seed'),
      supabase
        .from('inflow_transactions')
        .select('id, date, amount, description, allocation_config_id')
        .eq('org_id', orgId)
        .not('allocation_config_id', 'is', null)
        .is('stage_code_2', null)
        .is('transaction_type', null),
      supabase
        .from('category_opening_balances')
        .select('amount, categories(name)')
        .eq('org_id', orgId)
        .eq('budget_portion', 'Specific Seed'),
      supabase
        .from('intra_flows')
        .select('date, account_from, account_from_stage2, account_to, account_to_stage2, total_amount')
        .eq('org_id', orgId)
        .eq('status', 'active'),
    ])

    if (directRes.error || outflowRes.error) {
      setError(friendlyError(directRes.error ?? outflowRes.error, 'load'))
      setLoading(false)
      return
    }

    // Per-category accumulator + per-category contribution list for the
    // expandable target breakdown.
    const map = new Map<string, { deposited: number; withdrawn: number }>()
    const contribs = new Map<string, ContributionRow[]>()
    const ensure = (cat: string) => {
      if (!map.has(cat)) { map.set(cat, { deposited: 0, withdrawn: 0 }); contribs.set(cat, []) }
      return map.get(cat)!
    }
    const addContrib = (cat: string, row: ContributionRow) => { contribs.get(cat)!.push(row) }

    for (const r of directRes.data ?? []) {
      const cat = (r.stage_code_1 as string | null) || '(Uncategorised)'
      const amt = Number(r.amount)
      ensure(cat).deposited += amt
      addContrib(cat, {
        date:   r.date as string,
        target: (r.specific_seed_description as string | null) || (r.description as string | null) || '(No target specified)',
        amount: amt,
      })
    }

    for (const r of outflowRes.data ?? []) {
      const cat = (r.stage_code_1 as string | null) || '(Uncategorised)'
      const amt = Number(r.amount_disbursed || 0)
      const isOffset = (r as Record<string, unknown>).offset_role === 'offset'
      ensure(cat).withdrawn += isOffset ? -amt : amt
    }

    for (const ob of cobRes.error ? [] : (cobRes.data ?? [])) {
      const catName = (ob.categories as unknown as { name: string } | null)?.name ?? ''
      if (!catName) continue
      const amt = Number(ob.amount)
      ensure(catName).deposited += amt
      addContrib(catName, { date: '0000-01-01', target: 'Opening Balance', amount: amt })
    }

    // Config-split inflows: allocation_config_id set, stage_code_2 null —
    // route each config row tagged 'Specific Seed' to its category.
    const configSplitData = (configSplitRes.data ?? []) as Array<{
      id: string; date: string; amount: number; description: string | null; allocation_config_id: string
    }>
    if (configSplitData.length > 0) {
      const configIds = [...new Set(configSplitData.map(r => r.allocation_config_id))]
      const configsRes = await supabase
        .from('allocation_configs')
        .select('id, rows')
        .eq('org_id', orgId)
        .in('id', configIds)

      type ConfigRowShape = { category_name: string; budget_portion?: string; percentage?: number }
      const configMap = new Map<string, ConfigRowShape[]>(
        (configsRes.data ?? []).map(c => [c.id as string, c.rows as ConfigRowShape[]])
      )

      for (const inflow of configSplitData) {
        const cfgRows = configMap.get(inflow.allocation_config_id) ?? []
        for (const row of cfgRows) {
          if (row.budget_portion !== 'Specific Seed') continue
          const pct = Number(row.percentage ?? 0)
          if (pct <= 0) continue
          const allocAmount = allocatePercent(Number(inflow.amount), pct)
          if (allocAmount <= 0) continue
          const cat = row.category_name || '(Uncategorised)'
          ensure(cat).deposited += allocAmount
          addContrib(cat, { date: inflow.date, target: inflow.description || '(No target specified)', amount: allocAmount })
        }
      }
    }

    for (const r of intraflowRes.error ? [] : (intraflowRes.data ?? [])) {
      const amount    = Number(r.total_amount)
      if (amount <= 0) continue
      const fromCat   = (r.account_from        as string | null) || ''
      const fromStage = (r.account_from_stage2 as string | null) || ''
      const toCat     = (r.account_to          as string | null) || ''
      const toStage   = (r.account_to_stage2   as string | null) || ''
      if (fromCat === toCat && fromStage === toStage) continue
      if (toStage === 'Specific Seed' && toCat) {
        ensure(toCat).deposited += amount
        addContrib(toCat, { date: r.date as string, target: `Transfer In (from ${fromCat || 'unknown'})`, amount })
      }
      if (fromStage === 'Specific Seed' && fromCat) {
        ensure(fromCat).withdrawn += amount
        addContrib(fromCat, { date: r.date as string, target: `Transfer Out (to ${toCat || 'unknown'})`, amount: -amount })
      }
    }

    const result: GiftRow[] = [...map.entries()].map(([category, v]) => {
      const targetMap = new Map<string, { total: number; count: number; latest: string }>()
      for (const c of contribs.get(category) ?? []) {
        const existing = targetMap.get(c.target) ?? { total: 0, count: 0, latest: '' }
        targetMap.set(c.target, {
          total:  existing.total + c.amount,
          count:  existing.count + 1,
          latest: existing.latest < c.date ? c.date : existing.latest,
        })
      }
      return {
        category,
        deposited: v.deposited,
        withdrawn: v.withdrawn,
        balance:   v.deposited - v.withdrawn,
        targets:   [...targetMap.entries()].map(([target, t]) => ({ target, ...t })).sort((a, b) => b.total - a.total),
      }
    }).sort((a, b) => b.balance - a.balance)

    setRows(result)
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load, intraflowVersion])

  const visibleRows = useMemo(
    () => searchRows(rows, SG_COLUMNS, sgState.search, sgState.searchCol),
    [rows, sgState.search, sgState.searchCol],
  )

  const getSgValue = (r: GiftRow, k: string) => {
    if (k === 'category') return r.category
    if (k === 'deposited') return r.deposited
    return r.balance
  }

  const sortedRows = useMemo(() => {
    const adv = sgState.advancedSort
    if (adv.length > 0) return multiSortRows(visibleRows, getSgValue, adv, SG_SORT_FIELDS)
    return sortRows(visibleRows, getSgValue, sgState.sortKey, sgState.sortDir, SG_SORT_FIELDS)
  }, [visibleRows, sgState.sortKey, sgState.sortDir, sgState.advancedSort])

  const sgPage = useMemo(
    () => sortedRows.slice(sgState.page * sgState.pageSize, (sgState.page + 1) * sgState.pageSize),
    [sortedRows, sgState.page, sgState.pageSize],
  )

  const SG_CSV_HEADERS = ['Category', `Gifts In (${baseCurrencySymbol})`, `Withdrawn (${baseCurrencySymbol})`, `Balance (${baseCurrencySymbol})`]
  const sgCsvRow = (r: GiftRow) => [r.category, r.deposited, r.withdrawn, r.balance]
  const SG_CSV_FILE = `specific-givings-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(SG_CSV_FILE, SG_CSV_HEADERS, sgPage.map(sgCsvRow))
  const handleExportAll  = () => exportCSV(SG_CSV_FILE, SG_CSV_HEADERS, sortedRows.map(sgCsvRow))

  // Totals reflect visible (filtered) data
  const totalDeposited = visibleRows.reduce((s, r) => s + r.deposited, 0)
  const totalWithdrawn = visibleRows.reduce((s, r) => s + r.withdrawn, 0)
  const totalBalance   = visibleRows.reduce((s, r) => s + r.balance, 0)

  return (
    <div className="space-y-5">

      <PageHelpBanner storageKey="help-dismissed-specific-givings" title="What are Designated Gifts?">
        These are donations earmarked for a particular purpose — for example, a gift specifically for the Building Fund or a mission project.
        Unlike general offerings, designated gifts are restricted: the money should only be used for the stated purpose.
        This page shows the running balance for each designated fund; expand a row to see the breakdown by target or recipient.
      </PageHelpBanner>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Designated Gifts</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Designated gift balances per category — all time
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportDropdown onExportView={handleExportView} onExportAll={handleExportAll} disabled={sortedRows.length === 0} />
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
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
          {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Gift className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-gray-800">No designated gifts recorded yet</p>
            <p className="text-sm text-gray-500 mt-1">
              Transactions tagged with Fund Type = "Designated Gift" will appear here.
            </p>
          </div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-success mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Total Gifts In</span>
              </div>
              <p className="font-mono font-bold text-success text-base">{formatCurrency(totalDeposited, baseCurrencyCode)}</p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-danger mb-1">
                <TrendingDown className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Withdrawn</span>
              </div>
              <p className="font-mono font-bold text-danger text-base">{formatCurrency(totalWithdrawn, baseCurrencyCode)}</p>
            </div>
            <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 text-center">
              <div className="flex items-center justify-center gap-1.5 text-primary mb-1">
                <Gift className="w-4 h-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Net Balance</span>
              </div>
              <p className={`font-mono font-bold text-base ${totalBalance >= 0 ? 'text-primary' : 'text-danger'}`}>
                {formatCurrency(totalBalance, baseCurrencyCode)}
              </p>
            </div>
          </div>

          {/* Per-category table */}
          <div className="space-y-1.5">
            <DataControlsBar
              columns={SG_COLUMNS}
              sortKey={sgState.sortKey}
              sortDir={sgState.sortDir}
              onSort={sgState.setSort}
              defaultSortKey="balance"
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
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm table-sticky-col">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="w-8 px-2 py-3" />
                  <SortableHeader field={SG_SORT_FIELDS[0]} activeSortKey={sgState.sortKey} activeSortDir={sgState.sortDir} onSort={sgState.setSort} className="px-5 py-3" />
                  <SortableHeader field={SG_SORT_FIELDS[1]} activeSortKey={sgState.sortKey} activeSortDir={sgState.sortDir} onSort={sgState.setSort} rightAlign className="px-5 py-3" inactiveCls="text-success/80 hover:text-success" />
                  <th className="px-5 py-3 text-right font-medium hidden sm:table-cell">Withdrawn</th>
                  <SortableHeader field={SG_SORT_FIELDS[2]} activeSortKey={sgState.sortKey} activeSortDir={sgState.sortDir} onSort={sgState.setSort} rightAlign className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {sgPage.map(row => {
                  const isExpanded = expandedCategory === row.category
                  return (
                    <Fragment key={row.category}>
                      <tr className="hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                        <td className="w-8 px-2 py-3">
                          <button
                            onClick={() => setExpandedCategory(isExpanded ? null : row.category)}
                            className="touch-target p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                            title={isExpanded ? 'Collapse' : 'Show targets'}
                            aria-expanded={isExpanded}
                          >
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                        <td className="px-5 py-3 font-medium text-gray-800">{row.category}</td>
                        <td className="px-5 py-3 text-right text-success font-mono">
                          {formatCurrency(row.deposited, baseCurrencyCode)}
                        </td>
                        <td className="px-5 py-3 text-right text-danger font-mono hidden sm:table-cell">
                          {row.withdrawn > 0 ? formatCurrency(row.withdrawn, baseCurrencyCode) : '—'}
                        </td>
                        <td className={`px-5 py-3 text-right font-bold font-mono ${row.balance >= 0 ? 'text-gray-800' : 'text-danger'}`}>
                          {formatCurrency(row.balance, baseCurrencyCode)}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={5} className="px-5 pb-4 pt-1 bg-gray-50/60">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                                  <th className="px-3 py-2 text-left font-medium">Target / Recipient</th>
                                  <th className="px-3 py-2 text-center font-medium hidden sm:table-cell">Entries</th>
                                  <th className="px-3 py-2 text-center font-medium hidden sm:table-cell">Latest</th>
                                  <th className="px-3 py-2 text-right font-medium">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {row.targets.map(t => (
                                  <tr key={t.target}>
                                    <td className="px-3 py-2 text-gray-700">{t.target}</td>
                                    <td className="px-3 py-2 text-center text-gray-500 text-xs hidden sm:table-cell">{t.count}</td>
                                    <td className="px-3 py-2 text-center text-gray-500 text-xs hidden sm:table-cell">
                                      {t.latest === '0000-01-01' ? '—' : formatDate(t.latest)}
                                    </td>
                                    <td className={`px-3 py-2 text-right font-semibold ${t.total >= 0 ? 'text-success' : 'text-danger'}`}>
                                      {formatCurrency(t.total, baseCurrencyCode)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold">
                  <td className="w-8 px-2 py-3" />
                  <td className="px-5 py-3 text-gray-700">Total</td>
                  <td className="px-5 py-3 text-right text-success font-mono">{formatCurrency(totalDeposited, baseCurrencyCode)}</td>
                  <td className="px-5 py-3 text-right text-danger font-mono hidden sm:table-cell">
                    {totalWithdrawn > 0 ? formatCurrency(totalWithdrawn, baseCurrencyCode) : '—'}
                  </td>
                  <td className={`px-5 py-3 text-right font-mono ${totalBalance >= 0 ? 'text-primary' : 'text-danger'}`}>
                    {formatCurrency(totalBalance, baseCurrencyCode)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <PaginationBar
            page={sgState.page}
            pageSize={sgState.pageSize}
            total={sortedRows.length}
            onPageChange={sgState.setPage}
            variant="full"
          />
          </div>
        </>
      )}
    </div>
  )
}
