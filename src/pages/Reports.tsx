import { useState, useEffect, useCallback } from 'react'
import { Printer, Download, AlertCircle, FileText, FilePlus, BarChart2, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useRole } from '../hooks/useRole'
import { usePageTitle } from '../hooks/usePageTitle'
import { useFXTransactions } from '../hooks/useFX'
import { useAuditLog } from '../hooks/useAuditLog'
import { exportCSV } from '../utils/csvExport'
import { useAccountingYearStore } from '../store/accountingYearStore'
import { useIncomeTypes } from '../hooks/useIncomeTypes'
import { useOutflowTypes } from '../hooks/useOutflowTypes'
import { useDepartments } from '../hooks/useDepartments'
import { ReportDateFilter, useReportDateFilter } from '../components/ui/ReportDateFilter'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { HelpButton }      from '../components/onboarding/HelpButton'
import { useFirstVisitTour } from '../hooks/useFirstVisitTour'

type ReportTab = 'annual' | 'monthly' | 'income_types' | 'outflow_types' | 'departments' | 'fx' | 'audit'

const CURRENT_YEAR = new Date().getFullYear()
const YEARS        = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i)
const MONTH_NAMES  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Shared helpers ─────────────────────────────────────────────────────────────

function fmtAmt(n: number, locale: string) {
  return n.toLocaleString(locale, { minimumFractionDigits: 2 })
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
  const { baseCurrencySymbol: sym, formatLocale } = useOrgCurrency()
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
      supabase.from('outflow_transactions').select('date, amount_disbursed')
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
      ensure(parseInt((r.date as string).slice(0, 4))).totalOutflow += Number(r.amount_disbursed || 0)
    }
    for (const row of byYear.values()) row.net = row.totalInflow - row.totalOutflow

    setRows(Array.from(byYear.values()).sort((a, b) => b.year - a.year))
    setLoading(false)
  }, [activeYear])

  useEffect(() => { load() }, [load])

  const handleExport = () =>
    exportCSV(
      'annual_summary',
      ['Year', `Total Inflow (${sym})`, `Total Outflow (${sym})`, `Net (${sym})`],
      rows.map(r => [r.year, r.totalInflow, r.totalOutflow, r.net]),
    )

  return (
    <ReportSection title="Annual Summary" onExport={handleExport}>
      {error   && <ErrBox msg={error} />}
      {loading && <Skeleton />}
      {!loading && rows.length === 0 && <EmptyState />}
      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto scroll-x-fade">
          <table className="w-full text-sm table-sticky-col">
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
                  <td className="px-5 py-3 text-right text-success">{sym}{fmtAmt(r.totalInflow, formatLocale)}</td>
                  <td className="px-5 py-3 text-right text-danger">{sym}{fmtAmt(r.totalOutflow, formatLocale)}</td>
                  <td className={`px-5 py-3 text-right font-bold ${r.net >= 0 ? 'text-success' : 'text-danger'}`}>
                    {sym}{fmtAmt(r.net, formatLocale)}
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
  const { baseCurrencySymbol: sym, formatLocale } = useOrgCurrency()
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
        .select('date, amount_disbursed')
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
      byMonth[m].totalOutflow += Number(r.amount_disbursed || 0)
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
      ['Month', `Total Inflow (${sym})`, `Total Outflow (${sym})`, `Net (${sym})`],
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
        <div className="overflow-x-auto scroll-x-fade">
          <table className="w-full text-sm table-sticky-col">
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
                  <td className="px-5 py-3 text-right text-success">{sym}{fmtAmt(r.totalInflow, formatLocale)}</td>
                  <td className="px-5 py-3 text-right text-danger">{sym}{fmtAmt(r.totalOutflow, formatLocale)}</td>
                  <td className={`px-5 py-3 text-right font-semibold ${r.net >= 0 ? 'text-success' : 'text-danger'}`}>
                    {sym}{fmtAmt(r.net, formatLocale)}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-gray-50 font-bold border-t border-gray-200">
                <td className="px-5 py-3 text-gray-700">Total {year}</td>
                <td className="px-5 py-3 text-right text-success">{sym}{fmtAmt(grandInflow, formatLocale)}</td>
                <td className="px-5 py-3 text-right text-danger">{sym}{fmtAmt(grandOutflow, formatLocale)}</td>
                <td className={`px-5 py-3 text-right ${grandNet >= 0 ? 'text-success' : 'text-danger'}`}>
                  {sym}{fmtAmt(grandNet, formatLocale)}
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
  const { baseCurrencySymbol: sym, formatLocale } = useOrgCurrency()
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
      ['Income Type', `Total (${sym})`, 'Count', '% of Total'],
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
      extra={<span data-tour="period-selector"><ReportDateFilter hook={filter} /></span>}
    >
      {error   && <ErrBox msg={error} />}
      {loading && <Skeleton />}
      {!loading && rows.length === 0 && (
        <div className="py-16 text-center space-y-2">
          <p className="text-sm text-gray-400">No income-type-tagged transactions for {periodLabel}.</p>
          {incomeTypes.length === 0 && (
            <p className="text-xs text-gray-500">
              Set up income types in <span className="font-medium">Setup → Income Types</span>, then tag transactions when adding or importing.
            </p>
          )}
        </div>
      )}
      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto scroll-x-fade">
          <table className="w-full text-sm table-sticky-col">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-5 py-3 text-left font-medium">Income Type</th>
                <th className="px-5 py-3 text-right font-medium">Transactions</th>
                <th className="px-5 py-3 text-right font-medium">Total ({sym})</th>
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
                    <td className="px-5 py-3 text-right font-semibold text-success">{sym}{fmtAmt(r.amount, formatLocale)}</td>
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
                <td className="px-5 py-3 text-right text-success">{sym}{fmtAmt(grandTotal, formatLocale)}</td>
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
  const { baseCurrencySymbol: sym, formatLocale } = useOrgCurrency()
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
      .select('amount_disbursed, outflow_type_id')
      .gte(col, lo)
      .lte(col, queryHi)

    if (err) { setError(err.message); setLoading(false); return }

    const agg = new Map<string | null, { amount: number; count: number }>()
    for (const r of data ?? []) {
      const id  = (r.outflow_type_id as string | null) ?? null
      const amt = Number(r.amount_disbursed || 0)
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
      ['Outflow Type', `Total (${sym})`, 'Count', '% of Total'],
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
            <p className="text-xs text-gray-500">
              Set up outflow types in <span className="font-medium">Setup → Outflow Types</span>, then tag transactions when adding or importing.
            </p>
          )}
        </div>
      )}
      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto scroll-x-fade">
          <table className="w-full text-sm table-sticky-col">
            <thead>
              <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                <th className="px-5 py-3 text-left font-medium">Outflow Type</th>
                <th className="px-5 py-3 text-right font-medium">Transactions</th>
                <th className="px-5 py-3 text-right font-medium">Total ({sym})</th>
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
                    <td className="px-5 py-3 text-right font-semibold text-danger">{sym}{fmtAmt(r.amount, formatLocale)}</td>
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
                <td className="px-5 py-3 text-right text-danger">{sym}{fmtAmt(grandTotal, formatLocale)}</td>
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

// ── Department Breakdown ───────────────────────────────────────────────────────

interface DeptRow {
  id:     string | null
  name:   string
  code:   string | null
  amount: number
  count:  number
}

interface DrillTxn {
  id:               string
  date:             string
  description:      string | null
  bank_description: string | null
  amount_disbursed: number
  outflow_type_id:  string | null
  department_id:    string | null
}

function DepartmentBreakdownPanel() {
  const { baseCurrencySymbol: sym, formatLocale } = useOrgCurrency()
  const activeYear = useAccountingYearStore(s => s.year)
  const { departments } = useDepartments()
  const { outflowTypes } = useOutflowTypes()

  const filter  = useReportDateFilter(activeYear)
  const [rows,    setRows]    = useState<DeptRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  // Drill-down state
  const [drillDeptId,    setDrillDeptId]    = useState<string | null | undefined>(undefined) // undefined = none selected
  const [drillTypeId,    setDrillTypeId]    = useState<string | null>('')  // '' = all
  const [drillTxns,      setDrillTxns]      = useState<DrillTxn[]>([])
  const [drillLoading,   setDrillLoading]   = useState(false)

  // Cross-filter state (independent of drill-down)
  const [filterDeptId, setFilterDeptId]   = useState('')
  const [filterTypeId, setFilterTypeId]   = useState('')
  const [crossTxns,    setCrossTxns]      = useState<DrillTxn[]>([])
  const [crossLoading, setCrossLoading]   = useState(false)
  const [crossError,   setCrossError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const { lo, queryHi, col } = filter.range

    const { data, error: err } = await supabase
      .from('outflow_transactions')
      .select('amount_disbursed, department_id')
      .gte(col, lo)
      .lte(col, queryHi)

    if (err) { setError(err.message); setLoading(false); return }

    const agg = new Map<string | null, { amount: number; count: number }>()
    for (const r of data ?? []) {
      const id  = (r as { department_id: string | null }).department_id ?? null
      const amt = Number(r.amount_disbursed || 0)
      const cur = agg.get(id) ?? { amount: 0, count: 0 }
      cur.amount += amt
      cur.count  += 1
      agg.set(id, cur)
    }

    const result: DeptRow[] = []
    for (const d of departments) {
      const agged = agg.get(d.id)
      if (!agged) continue
      result.push({ id: d.id, name: d.name, code: d.code, ...agged })
    }
    const unassigned = agg.get(null)
    if (unassigned) {
      result.push({ id: null, name: 'Unassigned', code: null, ...unassigned })
    }
    result.sort((a, b) => b.amount - a.amount)
    setRows(result)
    setLoading(false)
  }, [filter.range, departments])

  useEffect(() => { load() }, [load])

  // Drill-down: load transactions for selected department (+ optional outflow type filter)
  const loadDrill = useCallback(async (deptId: string | null, typeId: string | null) => {
    setDrillLoading(true)
    const { lo, queryHi, col } = filter.range
    let q = supabase
      .from('outflow_transactions')
      .select('id, date, description, bank_description, amount_disbursed, outflow_type_id, department_id')
      .gte(col, lo)
      .lte(col, queryHi)
      .order('date', { ascending: false })
      .limit(200)

    if (deptId === null) {
      q = q.is('department_id', null)
    } else {
      q = q.eq('department_id', deptId)
    }
    if (typeId) q = q.eq('outflow_type_id', typeId)

    const { data } = await q
    setDrillTxns((data ?? []) as DrillTxn[])
    setDrillLoading(false)
  }, [filter.range])

  const handleRowClick = (deptId: string | null) => {
    if (drillDeptId === deptId) {
      setDrillDeptId(undefined); setDrillTxns([]); setDrillTypeId('')
    } else {
      setDrillDeptId(deptId); setDrillTypeId('')
      loadDrill(deptId, null)
    }
  }

  // Re-load drill when type filter changes
  useEffect(() => {
    if (drillDeptId === undefined) return
    loadDrill(drillDeptId ?? null, drillTypeId || null)
  }, [drillTypeId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cross-filter load
  const loadCross = useCallback(async () => {
    if (!filterDeptId && !filterTypeId) { setCrossTxns([]); return }
    setCrossLoading(true); setCrossError(null)
    const { lo, queryHi, col } = filter.range
    let q = supabase
      .from('outflow_transactions')
      .select('id, date, description, bank_description, amount_disbursed, outflow_type_id, department_id')
      .gte(col, lo)
      .lte(col, queryHi)
      .order('date', { ascending: false })
      .limit(500)

    if (filterDeptId) q = q.eq('department_id', filterDeptId)
    if (filterTypeId) q = q.eq('outflow_type_id', filterTypeId)

    const { data, error: err } = await q
    if (err) setCrossError(err.message)
    else setCrossTxns((data ?? []) as DrillTxn[])
    setCrossLoading(false)
  }, [filterDeptId, filterTypeId, filter.range])

  useEffect(() => { loadCross() }, [loadCross])

  const grandTotal  = rows.reduce((s, r) => s + r.amount, 0)
  const periodLabel = filter.periodLabel

  const getDeptName = (id: string | null) =>
    id ? (departments.find(d => d.id === id)?.name ?? id) : 'Unassigned'
  const getTypeName = (id: string | null) =>
    id ? (outflowTypes.find(t => t.id === id)?.name ?? id) : 'Unclassified'

  const handleExport = () =>
    exportCSV(
      `department_breakdown_${periodLabel.replace(/ /g, '_')}`,
      ['Department', 'Code', `Total (${sym})`, 'Count', '% of Total'],
      rows.map(r => [
        r.name,
        r.code ?? '',
        r.amount,
        r.count,
        grandTotal > 0 ? ((r.amount / grandTotal) * 100).toFixed(1) + '%' : '0%',
      ]),
    )

  const txnRow = (t: DrillTxn) => (
    <tr key={t.id} className="hover:bg-gray-50 text-xs">
      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{t.date}</td>
      <td className="px-4 py-2 text-gray-700 max-w-[200px] truncate">{t.description ?? t.bank_description ?? '—'}</td>
      <td className="px-4 py-2 text-gray-500">{getTypeName(t.outflow_type_id)}</td>
      <td className="px-4 py-2 text-gray-500">{getDeptName(t.department_id)}</td>
      <td className="px-4 py-2 text-right font-medium text-danger">{sym}{fmtAmt(t.amount_disbursed, formatLocale)}</td>
    </tr>
  )

  return (
    <div className="space-y-6">
      <ReportSection
        title="Department / Unit Breakdown"
        onExport={rows.length > 0 ? handleExport : undefined}
        extra={<ReportDateFilter hook={filter} />}
      >
        {error   && <ErrBox msg={error} />}
        {loading && <Skeleton />}
        {!loading && rows.length === 0 && (
          <div className="py-16 text-center space-y-2">
            <p className="text-sm text-gray-400">No department-tagged transactions for {periodLabel}.</p>
            {departments.length === 0 && (
              <p className="text-xs text-gray-500">
                Set up departments in <span className="font-medium">Setup → Departments</span>, then tag transactions when adding.
              </p>
            )}
          </div>
        )}
        {!loading && rows.length > 0 && (
          <div className="overflow-x-auto scroll-x-fade">
            <table className="w-full text-sm table-sticky-col">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="px-5 py-3 text-left font-medium">Department</th>
                  <th className="px-5 py-3 text-right font-medium">Transactions</th>
                  <th className="px-5 py-3 text-right font-medium">Total ({sym})</th>
                  <th className="px-5 py-3 text-right font-medium">% Share</th>
                  <th className="px-5 py-3 w-40" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => {
                  const pct       = grandTotal > 0 ? (r.amount / grandTotal) * 100 : 0
                  const isExpanded = drillDeptId === r.id
                  return (
                    <>
                      <tr
                        key={r.id ?? '__unassigned__'}
                        className="hover:bg-gray-50 cursor-pointer"
                        onClick={() => handleRowClick(r.id)}
                      >
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${r.id ? 'text-gray-800' : 'text-gray-400 italic'}`}>
                              {r.name}
                            </span>
                            {r.code && (
                              <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{r.code}</span>
                            )}
                            <span className="text-xs text-gray-500">{isExpanded ? '▲' : '▼'}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right text-gray-500">{r.count.toLocaleString()}</td>
                        <td className="px-5 py-3 text-right font-semibold text-danger">{sym}{fmtAmt(r.amount, formatLocale)}</td>
                        <td className="px-5 py-3 text-right text-gray-500">{pct.toFixed(1)}%</td>
                        <td className="px-5 py-3">
                          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${r.id ?? '__unassigned__'}-drill`}>
                          <td colSpan={5} className="px-5 pb-4 pt-0">
                            <div className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden">
                              <div className="px-4 py-2 flex items-center gap-3 border-b border-gray-100 bg-white">
                                <span className="text-xs text-gray-500 font-medium">Filter by Outflow Type:</span>
                                <select
                                  value={drillTypeId ?? ''}
                                  onChange={e => setDrillTypeId(e.target.value || null)}
                                  className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/30"
                                >
                                  <option value="">All Types</option>
                                  {outflowTypes.map(t => (
                                    <option key={t.id} value={t.id}>{t.name}</option>
                                  ))}
                                </select>
                              </div>
                              {drillLoading ? (
                                <div className="py-6 text-center text-xs text-gray-500">Loading…</div>
                              ) : drillTxns.length === 0 ? (
                                <div className="py-6 text-center text-xs text-gray-500">No transactions found.</div>
                              ) : (
                                <table className="w-full">
                                  <thead>
                                    <tr className="text-xs text-gray-500 uppercase border-b border-gray-100">
                                      <th className="px-4 py-2 text-left">Date</th>
                                      <th className="px-4 py-2 text-left">Description</th>
                                      <th className="px-4 py-2 text-left">Outflow Type</th>
                                      <th className="px-4 py-2 text-left">Department</th>
                                      <th className="px-4 py-2 text-right">Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50">
                                    {drillTxns.map(t => txnRow(t))}
                                  </tbody>
                                  <tfoot>
                                    <tr className="bg-gray-50 text-xs font-semibold border-t border-gray-200">
                                      <td colSpan={4} className="px-4 py-2 text-gray-600">
                                        {drillTxns.length} transaction{drillTxns.length !== 1 ? 's' : ''}
                                        {drillTxns.length === 200 && ' (capped at 200)'}
                                      </td>
                                      <td className="px-4 py-2 text-right text-danger">
                                        {sym}{fmtAmt(drillTxns.reduce((s, t) => s + t.amount_disbursed, 0), formatLocale)}
                                      </td>
                                    </tr>
                                  </tfoot>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
                <tr className="bg-gray-50 font-bold border-t border-gray-200">
                  <td className="px-5 py-3 text-gray-700">Total — {periodLabel}</td>
                  <td className="px-5 py-3 text-right text-gray-500">
                    {rows.reduce((s, r) => s + r.count, 0).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-right text-danger">{sym}{fmtAmt(grandTotal, formatLocale)}</td>
                  <td className="px-5 py-3 text-right text-gray-400">100%</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </ReportSection>

      {/* Cross-filter: Department × Outflow Type */}
      <ReportSection title="Cross-Filter: Department × Outflow Type">
        <div className="px-5 pb-4 space-y-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500">Department</p>
              <select
                value={filterDeptId}
                onChange={e => setFilterDeptId(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/30 min-w-[180px]"
              >
                <option value="">All Departments</option>
                {departments.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500">Outflow Type</p>
              <select
                value={filterTypeId}
                onChange={e => setFilterTypeId(e.target.value)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary/30 min-w-[180px]"
              >
                <option value="">All Outflow Types</option>
                {outflowTypes.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
            {(filterDeptId || filterTypeId) && (
              <button
                onClick={() => { setFilterDeptId(''); setFilterTypeId('') }}
                className="text-xs text-gray-500 hover:text-gray-600 px-2 py-1 rounded border border-gray-200 hover:border-gray-300 transition-colors"
              >
                Clear filters
              </button>
            )}
          </div>

          {!filterDeptId && !filterTypeId && (
            <p className="text-sm text-gray-400 py-6 text-center">Select at least one filter above to see matching transactions.</p>
          )}
          {crossError && <ErrBox msg={crossError} />}
          {crossLoading && <Skeleton />}
          {!crossLoading && (filterDeptId || filterTypeId) && crossTxns.length === 0 && (
            <p className="text-sm text-gray-400 py-6 text-center">No transactions match the selected filters for {periodLabel}.</p>
          )}
          {!crossLoading && crossTxns.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="w-full text-sm table-sticky-col">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase border-b border-gray-100">
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Description</th>
                    <th className="px-4 py-3 text-left font-medium">Outflow Type</th>
                    <th className="px-4 py-3 text-left font-medium">Department</th>
                    <th className="px-4 py-3 text-right font-medium">Amount ({sym})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {crossTxns.map(t => txnRow(t))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 text-xs font-bold border-t border-gray-200">
                    <td colSpan={4} className="px-4 py-3 text-gray-600">
                      {crossTxns.length} transaction{crossTxns.length !== 1 ? 's' : ''}
                      {crossTxns.length === 500 && ' (capped at 500)'}
                    </td>
                    <td className="px-4 py-3 text-right text-danger">
                      {sym}{fmtAmt(crossTxns.reduce((s, t) => s + t.amount_disbursed, 0), formatLocale)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </ReportSection>
    </div>
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
        <div className="overflow-x-auto scroll-x-fade">
          <table className="w-full text-sm table-sticky-col">
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
                        <span className="text-gray-500 text-xs">{meta.name}</span>
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
        <div className="overflow-x-auto scroll-x-fade">
          <table className="w-full text-sm table-sticky-col">
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
                  <td className="px-5 py-3 text-gray-500 text-xs whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-5 py-3">
                    <div className="font-medium text-gray-800">
                      {e.profiles?.full_name ?? 'System'}
                    </div>
                    <div className="text-xs text-gray-500">{e.profiles?.email ?? '—'}</div>
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
                  <td className="px-5 py-3 font-mono text-xs text-gray-500 max-w-[160px] truncate">
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
  useFirstVisitTour('reports')

  const allTabs: { id: ReportTab; label: string; adminOnly?: boolean }[] = [
    { id: 'annual',        label: 'Annual Summary'         },
    { id: 'monthly',       label: 'Monthly Breakdown'      },
    { id: 'income_types',  label: 'Income Type Breakdown'  },
    { id: 'outflow_types', label: 'Outflow Type Breakdown' },
    { id: 'departments',   label: 'Departments'            },
    { id: 'fx',            label: 'FX Holdings'            },
    { id: 'audit',         label: 'Audit Log', adminOnly: true },
  ]

  const visibleTabs = allTabs.filter(t => !t.adminOnly || isAdmin())

  return (
    <div className="space-y-5">
      {/* Header */}
      <div data-tour="page-header" className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500 mt-0.5">Financial summaries and analytics</p>
        </div>
        <div className="flex items-center gap-2">
          <HelpButton tourId="reportsTour" size="sm" />
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-50"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      {/* Reports hub strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:hidden">
        {[
          {
            icon:  BarChart2,
            label: 'Aggregated Reports',
            desc:  'Annual, monthly, category and department summaries (this page)',
            href:  null,
            active: true,
          },
          {
            icon:  FileText,
            label: 'Financial Report Builder',
            desc:  'Build custom multi-table reports with drag-and-drop layout',
            href:  '/financial-report',
            active: false,
          },
          {
            icon:  FilePlus,
            label: 'Dynamic Reports',
            desc:  'Create live-updating named reports with custom filters',
            href:  '/dynamic-reports',
            active: false,
          },
        ].map(({ icon: Icon, label, desc, href, active }) => {
          const cls = `flex items-start gap-3 p-3.5 rounded-xl border transition-colors text-left ${
            active
              ? 'border-primary/40 bg-primary/5'
              : 'border-gray-200 hover:border-primary/30 hover:bg-gray-50 cursor-pointer'
          }`
          const inner = (
            <>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${active ? 'bg-primary/20' : 'bg-gray-100'}`}>
                <Icon className={`w-4 h-4 ${active ? 'text-primary' : 'text-gray-500'}`} aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold ${active ? 'text-primary' : 'text-gray-800'}`}>{label}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
              </div>
              {!active && <ChevronRight className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" aria-hidden="true" />}
            </>
          )
          return href
            ? <Link key={label} to={href} className={cls}>{inner}</Link>
            : <div key={label} className={cls}>{inner}</div>
        })}
      </div>

      {/* Print-only heading */}
      <div className="hidden print:block mb-4">
        <h1 className="text-3xl font-semibold text-gray-900">Church Finance Report</h1>
        <p className="text-sm text-gray-500">Generated: {new Date().toLocaleDateString()}</p>
      </div>

      {/* Tabs */}
      <div data-tour="report-template" className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit max-w-full print:hidden overflow-x-auto">
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
        {tab === 'departments'   && <DepartmentBreakdownPanel />}
        {tab === 'fx'            && <FXHoldingsPanel />}
        {tab === 'audit'         && isAdmin() && <AuditLogPanel />}
      </div>
    </div>
  )
}
