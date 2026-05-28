import { useState, useEffect, useCallback } from 'react'
import { Printer, Download, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useRole } from '../hooks/useRole'
import { usePageTitle } from '../hooks/usePageTitle'
import { useFXTransactions } from '../hooks/useFX'
import { useAuditLog } from '../hooks/useAuditLog'
import { exportCSV } from '../utils/csvExport'
import { useAccountingYearStore } from '../store/accountingYearStore'
import { useIncomeTypes } from '../hooks/useIncomeTypes'
import { useOutflowTypes } from '../hooks/useOutflowTypes'
import { ReportDateFilter, useReportDateFilter } from '../components/ui/ReportDateFilter'

type ReportTab = 'annual' | 'monthly' | 'income_types' | 'outflow_types' | 'fx' | 'audit'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS        = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i)
const MONTH_NAMES  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Shared helpers ─────────────────────────────────────────────────────────────

function fmtNGN(n: number) {
  return n.toLocaleString('en-NG', { minimumFractionDigits: 2 })
}

function ErrBox({ msg }: { msg: string }) {
  return (
    <div className="m-5 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
      {msg}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-2 p-5">
      {[1, 2, 3, 4, 5].map(i => (
        <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />
      ))}
    </div>
  )
}

function EmptyState() {
  return <div className="py-16 text-center text-sm text-gray-400">No data available.</div>
}

function ReportSection({
  title,
  onExport,
  extra,
  children,
}: {
  title: string
  onExport?: () => void
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden print:shadow-none print:rounded-none">
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2 print:hidden">
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        <div className="flex items-center gap-2">
          {extra}
          {onExport && (
            <button
              onClick={onExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              <Download className="w-3 h-3" /> CSV
            </button>
          )}
        </div>
      </div>
      <div className="print:block">{children}</div>
    </div>
  )
}

// ── Annual Summary ─────────────────────────────────────────────────────────────

interface AnnualRow { year: number; totalInflow: number; totalOutflow: number; net: number }

function AnnualSummaryPanel() {
  const activeYear = useAccountingYearStore(s => s.year)
  const [rows,    setRows]    = useState<AnnualRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const y = activeYear.toString()

    const [inflowRes, outflowRes] = await Promise.all([
      supabase.from('inflow_transactions').select('date, amount')
        .gte('date', `${y}-01-01`).lte('date', `${y}-12-31`),
      supabase.from('outflow_transactions').select('date, actual_amount, amount_disbursed')
        .gte('date', `${y}-01-01`).lte('date', `${y}-12-31`),
    ])

    if (inflowRes.error || outflowRes.error) {
      setError(inflowRes.error?.message ?? outflowRes.error?.message ?? 'Unknown error')
      setLoading(false)
      return
    }

    const byYear = new Map<number, AnnualRow>()
    const ensure = (y: number) => {
      if (!byYear.has(y)) byYear.set(y, { year: y, totalInflow: 0, totalOutflow: 0, net: 0 })
      return byYear.get(y)!
    }

    for (const r of inflowRes.data ?? []) {
      ensure(parseInt((r.date as string).slice(0, 4))).totalInflow += Number(r.amount)
    }
    for (const r of outflowRes.data ?? []) {
      ensure(parseInt((r.date as string).slice(0, 4))).totalOutflow += Number(r.actual_amount || r.amount_disbursed || 0)
    }
    for (const row of byYear.values()) row.net = row.totalInflow - row.totalOutflow

    setRows(Array.from(byYear.values()).sort((a, b) => b.year - a.year))
    setLoading(false)
  }, [activeYear])

  useEffect(() => { load() }, [load])

  const handleExport = () =>
    exportCSV(
      'annual_summary',
      ['Year', 'Total Inflow (₦)', 'Total Outflow (₦)', 'Net (₦)'],
      rows.map(r => [r.year, r.totalInflow, r.totalOutflow, r.net]),
    )

  return (
    <ReportSection title="Annual Summary" onExport={handleExport}>
      {error   && <ErrBox msg={error} />}
      {loading && <Skeleton />}
      {!loading && rows.length === 0 && <EmptyState />}
      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-5 py-3 text-left font-medium">Year</th>
                <th className="px-5 py-3 text-right font-medium">Total Inflow</th>
                <th className="px-5 py-3 text-right font-medium">Total Outflow</th>
                <th className="px-5 py-3 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <tr key={r.year} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-semibold text-gray-800">{r.year}</td>
                  <td className="px-5 py-3 text-right text-success">₦{fmtNGN(r.totalInflow)}</td>
                  <td className="px-5 py-3 text-right text-danger">₦{fmtNGN(r.totalOutflow)}</td>
                  <td className={`px-5 py-3 text-right font-bold ${r.net >= 0 ? 'text-success' : 'text-danger'}`}>
                    ₦{fmtNGN(r.net)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportSection>
  )
}

// ── Monthly Breakdown ──────────────────────────────────────────────────────────

interface MonthlyRow { month: number; totalInflow: number; totalOutflow: number; net: number }

function MonthlyBreakdownPanel() {
  const activeYear = useAccountingYearStore(s => s.year)
  const [year,    setYear]    = useState(activeYear)

  useEffect(() => { setYear(activeYear) }, [activeYear])
  const [rows,    setRows]    = useState<MonthlyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const y = year.toString()
    const [inflowRes, outflowRes] = await Promise.all([
      supabase
        .from('inflow_transactions')
        .select('date, amount')
        .gte('date', `${y}-01-01`)
        .lte('date', `${y}-12-31`),
      supabase
        .from('outflow_transactions')
        .select('date, actual_amount, amount_disbursed')
        .gte('date', `${y}-01-01`)
        .lte('date', `${y}-12-31`),
    ])

    if (inflowRes.error || outflowRes.error) {
      setError(inflowRes.error?.message ?? outflowRes.error?.message ?? 'Unknown error')
      setLoading(false)
      return
    }

    const byMonth: MonthlyRow[] = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1, totalInflow: 0, totalOutflow: 0, net: 0,
    }))

    for (const r of inflowRes.data ?? []) {
      const m = parseInt((r.date as string).slice(5, 7)) - 1
      byMonth[m].totalInflow += Number(r.amount)
    }
    for (const r of outflowRes.data ?? []) {
      const m = parseInt((r.date as string).slice(5, 7)) - 1
      byMonth[m].totalOutflow += Number(r.actual_amount || r.amount_disbursed || 0)
    }
    for (const row of byMonth) row.net = row.totalInflow - row.totalOutflow

    setRows(byMonth)
    setLoading(false)
  }, [year])

  useEffect(() => { load() }, [load])

  const grandInflow  = rows.reduce((s, r) => s + r.totalInflow, 0)
  const grandOutflow = rows.reduce((s, r) => s + r.totalOutflow, 0)
  const grandNet     = grandInflow - grandOutflow

  const handleExport = () =>
    exportCSV(
      `monthly_breakdown_${year}`,
      ['Month', 'Total Inflow (₦)', 'Total Outflow (₦)', 'Net (₦)'],
      rows.map(r => [MONTH_NAMES[r.month - 1], r.totalInflow, r.totalOutflow, r.net]),
    )

  return (
    <ReportSection
      title="Monthly Breakdown"
      onExport={handleExport}
      extra={
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-primary/30"
        >
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      }
    >
      {error   && <ErrBox msg={error} />}
      {loading && <Skeleton />}
      {!loading && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-5 py-3 text-left font-medium">Month</th>
                <th className="px-5 py-3 text-right font-medium">Inflow</th>
                <th className="px-5 py-3 text-right font-medium">Outflow</th>
                <th className="px-5 py-3 text-right font-medium">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => (
                <tr key={r.month} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-700">
                    {MONTH_NAMES[r.month - 1]} {year}
                  </td>
                  <td className="px-5 py-3 text-right text-success">₦{fmtNGN(r.totalInflow)}</td>
                  <td className="px-5 py-3 text-right text-danger">₦{fmtNGN(r.totalOutflow)}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${r.net >= 0 ? 'text-success' : 'text-danger'}`}>
                    ₦{fmtNGN(r.net)}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-gray-50 font-bold border-t border-gray-200">
                <td className="px-5 py-3 text-gray-700">Total {year}</td>
                <td className="px-5 py-3 text-right text-success">₦{fmtNGN(grandInflow)}</td>
                <td className="px-5 py-3 text-right text-danger">₦{fmtNGN(grandOutflow)}</td>
                <td className={`px-5 py-3 text-right ${grandNet >= 0 ? 'text-success' : 'text-danger'}`}>
                  ₦{fmtNGN(grandNet)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </ReportSection>
  )
}

// ── Income Type Breakdown ──────────────────────────────────────────────────────

interface IncomeTypeRow {
  id:     string | null  // null = unclassified
  name:   string
  color:  string
  amount: number
  count:  number
}

function IncomeTypeBreakdownPanel() {
  const activeYear = useAccountingYearStore(s => s.year)
  const { incomeTypes } = useIncomeTypes()

  const filter  = useReportDateFilter(activeYear)
  const [rows,    setRows]    = useState<IncomeTypeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const { lo, queryHi, col } = filter.range

    const { data, error: err } = await supabase
      .from('inflow_transactions')
      .select('amount, income_type_id')
      .gte(col, lo)
      .lte(col, queryHi)

    if (err) { setError(err.message); setLoading(false); return }

    const agg = new Map<string | null, { amount: number; count: number }>()
    for (const r of data ?? []) {
      const id  = (r.income_type_id as string | null) ?? null
      const cur = agg.get(id) ?? { amount: 0, count: 0 }
      cur.amount += Number(r.amount)
      cur.count  += 1
      agg.set(id, cur)
    }

    const result: IncomeTypeRow[] = []
    for (const it of incomeTypes) {
      const agged = agg.get(it.id)
      if (!agged) continue
      result.push({ id: it.id, name: it.name, color: it.color, ...agged })
    }
    const unclassified = agg.get(null)
    if (unclassified) {
      result.push({ id: null, name: 'Unclassified', color: '#94a3b8', ...unclassified })
    }
    result.sort((a, b) => b.amount - a.amount)
    setRows(result)
    setLoading(false)
  }, [filter.range, incomeTypes])

  useEffect(() => { load() }, [load])

  const grandTotal  = rows.reduce((s, r) => s + r.amount, 0)
  const periodLabel = filter.periodLabel

  const handleExport = () =>
    exportCSV(
      `income_type_breakdown_${periodLabel.replace(/ /g, '_')}`,
      ['Income Type', 'Total (₦)', 'Count', '% of Total'],
      rows.map(r => [
        r.name,
        r.amount,
        r.count,
        grandTotal > 0 ? ((r.amount / grandTotal) * 100).toFixed(1) + '%' : '0%',
      ]),
    )

  return (
    <ReportSection
      title="Income Type Breakdown"
      onExport={rows.length > 0 ? handleExport : undefined}
      extra={<ReportDateFilter hook={filter} />}
    >
      {error   && <ErrBox msg={error} />}
      {loading && <Skeleton />}
      {!loading && rows.length === 0 && (
        <div className="py-16 text-center space-y-2">
          <p className="text-sm text-gray-400">No income-type-tagged transactions for {periodLabel}.</p>
          {incomeTypes.length === 0 && (
            <p className="text-xs text-gray-400">
              Set up income types in <span className="font-medium">Setup → Income Types</span>, then tag transactions when adding or importing.
            </p>
          )}
        </div>
      )}
      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-5 py-3 text-left font-medium">Income Type</th>
                <th className="px-5 py-3 text-right font-medium">Transactions</th>
                <th className="px-5 py-3 text-right font-medium">Total (₦)</th>
                <th className="px-5 py-3 text-right font-medium">% Share</th>
                <th className="px-5 py-3 w-40" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => {
                const pct = grandTotal > 0 ? (r.amount / grandTotal) * 100 : 0
                return (
                  <tr key={r.id ?? '__unclassified__'} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                        <span className={`font-medium ${r.id ? 'text-gray-800' : 'text-gray-400 italic'}`}>
                          {r.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right text-gray-500">{r.count.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right font-semibold text-success">₦{fmtNGN(r.amount)}</td>
                    <td className="px-5 py-3 text-right text-gray-500">{pct.toFixed(1)}%</td>
                    <td className="px-5 py-3">
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: r.color }}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-gray-50 font-bold border-t border-gray-200">
                <td className="px-5 py-3 text-gray-700">Total — {periodLabel}</td>
                <td className="px-5 py-3 text-right text-gray-500">
                  {rows.reduce((s, r) => s + r.count, 0).toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right text-success">₦{fmtNGN(grandTotal)}</td>
                <td className="px-5 py-3 text-right text-gray-400">100%</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </ReportSection>
  )
}

// ── Outflow Type Breakdown ─────────────────────────────────────────────────────

interface OutflowTypeRow {
  id:     string | null
  name:   string
  color:  string
  amount: number
  count:  number
}

function OutflowTypeBreakdownPanel() {
  const activeYear = useAccountingYearStore(s => s.year)
  const { outflowTypes } = useOutflowTypes()

  const filter  = useReportDateFilter(activeYear)
  const [rows,    setRows]    = useState<OutflowTypeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const { lo, queryHi, col } = filter.range

    const { data, error: err } = await supabase
      .from('outflow_transactions')
      .select('actual_amount, amount_disbursed, outflow_type_id')
      .gte(col, lo)
      .lte(col, queryHi)

    if (err) { setError(err.message); setLoading(false); return }

    const agg = new Map<string | null, { amount: number; count: number }>()
    for (const r of data ?? []) {
      const id  = (r.outflow_type_id as string | null) ?? null
      const amt = Number((r as { actual_amount?: number }).actual_amount || r.amount_disbursed || 0)
      const cur = agg.get(id) ?? { amount: 0, count: 0 }
      cur.amount += amt
      cur.count  += 1
      agg.set(id, cur)
    }

    const result: OutflowTypeRow[] = []
    for (const ot of outflowTypes) {
      const agged = agg.get(ot.id)
      if (!agged) continue
      result.push({ id: ot.id, name: ot.name, color: ot.color, ...agged })
    }
    const unclassified = agg.get(null)
    if (unclassified) {
      result.push({ id: null, name: 'Unclassified', color: '#94a3b8', ...unclassified })
    }
    result.sort((a, b) => b.amount - a.amount)
    setRows(result)
    setLoading(false)
  }, [filter.range, outflowTypes])

  useEffect(() => { load() }, [load])

  const grandTotal  = rows.reduce((s, r) => s + r.amount, 0)
  const periodLabel = filter.periodLabel

  const handleExport = () =>
    exportCSV(
      `outflow_type_breakdown_${periodLabel.replace(/ /g, '_')}`,
      ['Outflow Type', 'Total (₦)', 'Count', '% of Total'],
      rows.map(r => [
        r.name,
        r.amount,
        r.count,
        grandTotal > 0 ? ((r.amount / grandTotal) * 100).toFixed(1) + '%' : '0%',
      ]),
    )

  return (
    <ReportSection
      title="Outflow Type Breakdown"
      onExport={rows.length > 0 ? handleExport : undefined}
      extra={<ReportDateFilter hook={filter} />}
    >
      {error   && <ErrBox msg={error} />}
      {loading && <Skeleton />}
      {!loading && rows.length === 0 && (
        <div className="py-16 text-center space-y-2">
          <p className="text-sm text-gray-400">No outflow-type-tagged transactions for {periodLabel}.</p>
          {outflowTypes.length === 0 && (
            <p className="text-xs text-gray-400">
              Set up outflow types in <span className="font-medium">Setup → Outflow Types</span>, then tag transactions when adding or importing.
            </p>
          )}
        </div>
      )}
      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-5 py-3 text-left font-medium">Outflow Type</th>
                <th className="px-5 py-3 text-right font-medium">Transactions</th>
                <th className="px-5 py-3 text-right font-medium">Total (₦)</th>
                <th className="px-5 py-3 text-right font-medium">% Share</th>
                <th className="px-5 py-3 w-40" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(r => {
                const pct = grandTotal > 0 ? (r.amount / grandTotal) * 100 : 0
                return (
                  <tr key={r.id ?? '__unclassified__'} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                        <span className={`font-medium ${r.id ? 'text-gray-800' : 'text-gray-400 italic'}`}>
                          {r.name}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right text-gray-500">{r.count.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right font-semibold text-danger">₦{fmtNGN(r.amount)}</td>
                    <td className="px-5 py-3 text-right text-gray-500">{pct.toFixed(1)}%</td>
                    <td className="px-5 py-3">
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, backgroundColor: r.color }}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-gray-50 font-bold border-t border-gray-200">
                <td className="px-5 py-3 text-gray-700">Total — {periodLabel}</td>
                <td className="px-5 py-3 text-right text-gray-500">
                  {rows.reduce((s, r) => s + r.count, 0).toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right text-danger">₦{fmtNGN(grandTotal)}</td>
                <td className="px-5 py-3 text-right text-gray-400">100%</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </ReportSection>
  )
}

// ── FX Holdings ────────────────────────────────────────────────────────────────

const FX_META = [
  { code: 'USD', symbol: '$', flag: '🇺🇸', name: 'US Dollar'     },
  { code: 'GBP', symbol: '£', flag: '🇬🇧', name: 'British Pound' },
  { code: 'EUR', symbol: '€', flag: '🇪🇺', name: 'Euro'          },
  { code: 'CNY', symbol: '¥', flag: '🇨🇳', name: 'Chinese Yuan'  },
]

function FXHoldingsPanel() {
  const { summaries, loading, error } = useFXTransactions()

  const handleExport = () =>
    exportCSV(
      'fx_holdings',
      ['Currency', 'Name', 'Current Balance', 'Total Deposits', 'Total Withdrawals', 'Transactions'],
      FX_META.map(m => {
        const s = summaries.find(x => x.currency === m.code)
        return [m.code, m.name, s?.currentBalance ?? 0, s?.totalDeposits ?? 0, s?.totalWithdrawals ?? 0, s?.transactionCount ?? 0]
      }),
    )

  return (
    <ReportSection title="FX Holdings" onExport={handleExport}>
      {error   && <ErrBox msg={error} />}
      {loading && <Skeleton />}
      {!loading && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-5 py-3 text-left font-medium">Currency</th>
                <th className="px-5 py-3 text-right font-medium">Current Balance</th>
                <th className="px-5 py-3 text-right font-medium">Total Deposits</th>
                <th className="px-5 py-3 text-right font-medium">Total Withdrawals</th>
                <th className="px-5 py-3 text-right font-medium">Transactions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {FX_META.map(meta => {
                const s   = summaries.find(x => x.currency === meta.code)
                const bal = s?.currentBalance ?? 0
                return (
                  <tr key={meta.code} className="hover:bg-gray-50">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{meta.flag}</span>
                        <span className="font-mono font-semibold text-xs">{meta.code}</span>
                        <span className="text-gray-400 text-xs">{meta.name}</span>
                      </div>
                    </td>
                    <td className={`px-5 py-3 text-right font-bold font-mono ${bal > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                      {meta.symbol}{bal.toLocaleString(undefined, { minimumFractionDigits: 4 })}
                    </td>
                    <td className="px-5 py-3 text-right text-success font-mono">
                      {meta.symbol}{(s?.totalDeposits ?? 0).toLocaleString(undefined, { minimumFractionDigits: 4 })}
                    </td>
                    <td className="px-5 py-3 text-right text-danger font-mono">
                      {meta.symbol}{(s?.totalWithdrawals ?? 0).toLocaleString(undefined, { minimumFractionDigits: 4 })}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-500">
                      {s?.transactionCount ?? 0}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </ReportSection>
  )
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

function AuditLogPanel() {
  const { entries, loading, error } = useAuditLog(500)

  const handleExport = () =>
    exportCSV(
      'audit_log',
      ['Timestamp', 'User', 'Email', 'Action', 'Table', 'Record ID'],
      entries.map(e => [
        e.created_at,
        e.profiles?.full_name ?? '—',
        e.profiles?.email ?? '—',
        e.action,
        e.table_name ?? '—',
        e.record_id ?? '—',
      ]),
    )

  return (
    <ReportSection title="Audit Log (last 500 events)" onExport={handleExport}>
      {error   && <ErrBox msg={error} />}
      {loading && <Skeleton />}
      {!loading && entries.length === 0 && <EmptyState />}
      {!loading && entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-5 py-3 text-left font-medium">Timestamp</th>
                <th className="px-5 py-3 text-left font-medium">User</th>
                <th className="px-5 py-3 text-left font-medium">Action</th>
                <th className="px-5 py-3 text-left font-medium">Table</th>
                <th className="px-5 py-3 text-left font-medium">Record ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {entries.map(e => (
                <tr key={e.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800">
                      {e.profiles?.full_name ?? 'System'}
                    </div>
                    <div className="text-xs text-gray-400">{e.profiles?.email ?? '—'}</div>
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        e.action === 'INSERT'
                          ? 'bg-green-50 text-success'
                          : e.action === 'DELETE'
                          ? 'bg-red-50 text-danger'
                          : 'bg-yellow-50 text-amber-600'
                      }`}
                    >
                      {e.action}
                    </span>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-500">
                    {e.table_name ?? '—'}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-400 max-w-[160px] truncate">
                    {e.record_id ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportSection>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Reports() {
  const [tab, setTab] = useState<ReportTab>('annual')
  const { isAdmin }   = useRole()

  usePageTitle('Reports')

  const allTabs: { id: ReportTab; label: string; adminOnly?: boolean }[] = [
    { id: 'annual',        label: 'Annual Summary'         },
    { id: 'monthly',       label: 'Monthly Breakdown'      },
    { id: 'income_types',  label: 'Income Type Breakdown'  },
    { id: 'outflow_types', label: 'Outflow Type Breakdown' },
    { id: 'fx',            label: 'FX Holdings'            },
    { id: 'audit',         label: 'Audit Log', adminOnly: true },
  ]

  const visibleTabs = allTabs.filter(t => !t.adminOnly || isAdmin())

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Financial summaries and analytics</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
        >
          <Printer className="w-4 h-4" /> Print
        </button>
      </div>

      {/* Print-only heading */}
      <div className="hidden print:block mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Church Finance Report</h1>
        <p className="text-sm text-gray-500">Generated: {new Date().toLocaleDateString()}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit max-w-full print:hidden overflow-x-auto">
        {visibleTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === t.id ? 'bg-white text-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Report content */}
      <div className="print:space-y-8">
        {tab === 'annual'        && <AnnualSummaryPanel />}
        {tab === 'monthly'       && <MonthlyBreakdownPanel />}
        {tab === 'income_types'  && <IncomeTypeBreakdownPanel />}
        {tab === 'outflow_types' && <OutflowTypeBreakdownPanel />}
        {tab === 'fx'            && <FXHoldingsPanel />}
        {tab === 'audit'         && isAdmin() && <AuditLogPanel />}
      </div>
    </div>
  )
}
