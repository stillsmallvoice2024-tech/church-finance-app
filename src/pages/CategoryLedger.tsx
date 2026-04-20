import { useEffect, useState, useCallback } from 'react'
import { LayoutList, AlertCircle, RefreshCw, Percent, Gift, Archive } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAllocationStore } from '../store/allocationStore'
import { useCategories } from '../hooks/useCategories'
import { usePageTitle } from '../hooks/usePageTitle'
import { formatCurrency } from '../utils/formatters'

interface CategoryRow {
  name:         string
  percentage:   number | null   // from active allocation config
  specificSeed: number          // sum of specific seed inflows
  savingsIn:    number          // savings inflows
  savingsOut:   number          // savings outflows
}

export default function CategoryLedger() {
  usePageTitle('Category Ledger')

  const { categories }                               = useCategories()
  const { configs, fetch: fetchConfigs, loaded }     = useAllocationStore()

  const [rows,    setRows]    = useState<CategoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => { if (!loaded) fetchConfigs() }, [loaded, fetchConfigs])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const [seedRes, savInRes, savOutRes] = await Promise.all([
      // Specific seed inflows: stage_code_2 = 'Specific Seed'
      supabase
        .from('inflow_transactions')
        .select('stage_code_1, amount')
        .eq('stage_code_2', 'Specific Seed'),

      // Savings inflows
      supabase
        .from('inflow_transactions')
        .select('stage_code_1, amount')
        .eq('stage_code_2', 'Savings'),

      // Savings outflows
      supabase
        .from('outflow_transactions')
        .select('stage_code_1, actual_amount, amount_disbursed')
        .eq('stage_code_2', 'Savings'),
    ])

    if (seedRes.error || savInRes.error || savOutRes.error) {
      setError(seedRes.error?.message ?? savInRes.error?.message ?? savOutRes.error?.message ?? 'Failed to load')
      setLoading(false)
      return
    }

    // Today's active allocation config
    const today  = new Date().toISOString().slice(0, 10)
    const active = configs
      .filter(c => c.start_date <= today && c.status === 'locked')
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0] ?? null

    // Build lookup for percentage allocation
    const pctMap = new Map<string, number>()
    if (active) {
      for (const r of active.rows) {
        pctMap.set(r.category_name, Number(r.percentage))
      }
    }

    // Accumulate data
    const map = new Map<string, Omit<CategoryRow, 'name' | 'percentage'>>()
    const ensure = (cat: string) => {
      if (!map.has(cat)) map.set(cat, { specificSeed: 0, savingsIn: 0, savingsOut: 0 })
      return map.get(cat)!
    }

    for (const r of seedRes.data ?? []) {
      const cat = (r.stage_code_1 as string | null) || '(Uncategorised)'
      ensure(cat).specificSeed += Number(r.amount)
    }
    for (const r of savInRes.data ?? []) {
      const cat = (r.stage_code_1 as string | null) || '(Uncategorised)'
      ensure(cat).savingsIn += Number(r.amount)
    }
    for (const r of savOutRes.data ?? []) {
      const cat = (r.stage_code_1 as string | null) || '(Uncategorised)'
      ensure(cat).savingsOut += Number(r.actual_amount ?? r.amount_disbursed ?? 0)
    }

    // Merge category list from categories table + allocation config + transaction data
    const allNames = new Set<string>([
      ...categories.map(c => c.name),
      ...pctMap.keys(),
      ...map.keys(),
    ])

    const result: CategoryRow[] = [...allNames].map(name => {
      const d = map.get(name) ?? { specificSeed: 0, savingsIn: 0, savingsOut: 0 }
      return {
        name,
        percentage: pctMap.has(name) ? pctMap.get(name)! : null,
        ...d,
      }
    }).sort((a, b) => a.name.localeCompare(b.name))

    setRows(result)
    setLoading(false)
  }, [categories, configs])

  useEffect(() => { load() }, [load])

  const totals = rows.reduce(
    (acc, r) => ({
      pct:  acc.pct  + (r.percentage ?? 0),
      seed: acc.seed + r.specificSeed,
      sav:  acc.sav  + (r.savingsIn - r.savingsOut),
    }),
    { pct: 0, seed: 0, sav: 0 },
  )

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Category Ledger</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Unified view of all three portion types per category
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-3 gap-3">
        <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
          <Percent className="w-4 h-4 text-primary shrink-0" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-primary">Percentage</p>
            <p className="text-[10px] text-gray-500">From active allocation config</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          <Gift className="w-4 h-4 text-amber-600 shrink-0" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">Specific Seed</p>
            <p className="text-[10px] text-gray-500">All-time inflows tagged</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2">
          <Archive className="w-4 h-4 text-success shrink-0" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-success">Savings</p>
            <p className="text-[10px] text-gray-500">Net balance (in − out)</p>
          </div>
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
          {[1, 2, 3, 4].map(i => <div key={i} className="h-12 rounded-xl bg-gray-100 animate-pulse" />)}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <LayoutList className="w-8 h-8 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-gray-800">No categories found</p>
            <p className="text-sm text-gray-500 mt-1">
              Create categories and tag transactions with Stage Codes to populate this view.
            </p>
          </div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-5 py-3 text-left font-medium">Category</th>
                <th className="px-4 py-3 text-right font-medium">
                  <span className="flex items-center justify-end gap-1">
                    <Percent className="w-3 h-3" />
                    Allocation %
                  </span>
                </th>
                <th className="px-4 py-3 text-right font-medium hidden md:table-cell">
                  <span className="flex items-center justify-end gap-1">
                    <Gift className="w-3 h-3" />
                    Specific Seed
                  </span>
                </th>
                <th className="px-5 py-3 text-right font-medium">
                  <span className="flex items-center justify-end gap-1">
                    <Archive className="w-3 h-3" />
                    Savings Net
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(row => (
                <tr key={row.name} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-3 font-medium text-gray-800">{row.name}</td>

                  {/* Percentage allocation */}
                  <td className="px-4 py-3 text-right">
                    {row.percentage !== null ? (
                      <span className="font-mono font-semibold text-primary">
                        {Number(row.percentage).toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>

                  {/* Specific seed */}
                  <td className="px-4 py-3 text-right hidden md:table-cell">
                    {row.specificSeed > 0 ? (
                      <span className="font-mono text-amber-700">{formatCurrency(row.specificSeed)}</span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>

                  {/* Savings net */}
                  <td className="px-5 py-3 text-right">
                    {row.savingsIn > 0 || row.savingsOut > 0 ? (
                      <span className={`font-mono font-semibold ${
                        row.savingsIn - row.savingsOut >= 0 ? 'text-success' : 'text-danger'
                      }`}>
                        {formatCurrency(row.savingsIn - row.savingsOut)}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-50 border-t-2 border-gray-200 font-bold text-xs">
                <td className="px-5 py-3 text-gray-700">Totals</td>
                <td className="px-4 py-3 text-right font-mono text-primary">
                  {totals.pct > 0 ? `${totals.pct.toFixed(1)}%` : '—'}
                </td>
                <td className="px-4 py-3 text-right font-mono text-amber-700 hidden md:table-cell">
                  {totals.seed > 0 ? formatCurrency(totals.seed) : '—'}
                </td>
                <td className={`px-5 py-3 text-right font-mono ${totals.sav >= 0 ? 'text-success' : 'text-danger'}`}>
                  {formatCurrency(totals.sav)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
