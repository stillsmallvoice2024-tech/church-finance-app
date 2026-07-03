import React, { useState, useEffect, useCallback } from 'react'
import { Printer, Download, AlertCircle, FileText, FilePlus, BarChart2, ChevronRight, ChevronDown, ChevronUp, CalendarDays, TrendingUp, TrendingDown, Users, Globe, ShieldAlert } from 'lucide-react'
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
import { useOrgStore } from '../store/orgStore'
import { HelpButton }       from '../components/onboarding/HelpButton'
import { useFirstVisitTour } from '../hooks/useFirstVisitTour'
import { PageHelpBanner }   from '../components/ui/PageHelpBanner'
import { useOpeningBalanceTotal } from '../hooks/useOpeningBalanceTotal'
import { fetchAllRows } from '../utils/fetchAllRows'

type ReportTab = 'annual' | 'monthly' | 'income_types' | 'outflow_types' | 'departments' | 'fx' | 'audit'

const REPORT_TAB_CARDS: { id: ReportTab; Icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { id: 'annual',        Icon: BarChart2,    label: 'Annual'        },
  { id: 'monthly',       Icon: CalendarDays, label: 'Monthly'       },
  { id: 'income_types',  Icon: TrendingUp,   label: 'Income Types'  },
  { id: 'outflow_types', Icon: TrendingDown, label: 'Outflow Types' },
  { id: 'departments',   Icon: Users,        label: 'Departments'   },
  { id: 'fx',            Icon: Globe,        label: 'FX Holdings'   },
  { id: 'audit',         Icon: ShieldAlert,  label: 'Audit Log'     },
]

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

// Footnote clarifying that Reports Net (inflows − outflows) excludes the bank
// opening balance that the Dashboard's Net Balance includes. Self-hides when
// there is no opening balance to report.
function OpeningBalanceFootnote() {
  const { baseCurrencySymbol: sym, formatLocale } = useOrgCurrency()
  const { total, loading } = useOpeningBalanceTotal()
  if (loading || total <= 0) return null
  return (
    <p className="px-5 py-3 text-xs text-gray-500 border-t border-gray-100">
      Net is inflows − outflows and <span className="font-medium">excludes the opening
      balance of {sym}{fmtAmt(total, formatLocale)}</span>. The Dashboard&apos;s Net
      Balance includes this opening balance.
    </p>
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

// Internal movement types: excluded from all income/expense totals
const INTERNAL_MOVEMENT_TYPES = new Set(['bank_deposit', 'intrabank_transfer'])

function AnnualSummaryPanel() {
  const { baseCurrencySymbol: sym, formatLocale } = useOrgCurrency()
  const activeYear = useAccountingYearStore(s => s.year)
  const orgId = useOrgStore(s => s.orgId)
  const [rows,    setRows]    = useState<AnnualRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    const y = activeYear.toString()

    const [inflowRes, outflowRes] = await Promise.all([
      fetchAllRows(() => supabase.from('inflow_transactions')
        .select('date, amount, offset_role, root_transaction_table, transaction_type')
        .eq('org_id', orgId)
        .gte('date', `${y}-01-01`).lte('date', `${y}-12-31`)),
      fetchAllRows(() => supabase.from('outflow_transactions')
        .select('date, amount_disbursed, offset_role, root_transaction_table, transaction_type')
        .eq('org_id', orgId)
        .gte('date', `${y}-01-01`).lte('date', `${y}-12-31`)),
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
      const txType = (r.transaction_type as string | null) ?? null
      if (INTERNAL_MOVEMENT_TYPES.has(txType ?? '')) continue
      const yr  = parseInt((r.date as string).slice(0, 4))
      const amt = Number(r.amount)
      if (r.offset_role === 'offset' && r.root_transaction_table === 'inflow_transactions') {
        ensure(yr).totalOutflow += amt  // flip: same-table inflow offset → outflow column
      } else {
        ensure(yr).totalInflow += amt
      }
    }
    for (const r of outflowRes.data ?? []) {
      const txType = (r.transaction_type as string | null) ?? null
      if (INTERNAL_MOVEMENT_TYPES.has(txType ?? '')) continue
      const yr  = parseInt((r.date as string).slice(0, 4))
      const amt = Number(r.amount_disbursed || 0)
      if (r.offset_role === 'offset' && r.root_transaction_table === 'outflow_transactions') {
        ensure(yr).totalInflow += amt  // flip: same-table outflow offset → inflow column
      } else {
        ensure(yr).totalOutflow += amt
      }
    }
    for (const row of byYear.values()) row.net = row.totalInflow - row.totalOutflow

    setRows(Array.from(byYear.values()).sort((a, b) => b.year - a.year))
    setLoading(false)
  }, [activeYear, orgId])

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
      {!loading && rows.length > 0 && <OpeningBalanceFootnote />}
    </ReportSection>
  )
}

// ── Monthly Breakdown ──────────────────────────────────────────────────────────

interface MonthlyRow { month: number; totalInflow: number; totalOutflow: number; net: number }

function MonthlyBreakdownPanel() {
  const { baseCurrencySymbol: sym, formatLocale } = useOrgCurrency()
  const activeYear = useAccountingYearStore(s => s.year)
  const orgId = useOrgStore(s => s.orgId)
  const [year,    setYear]    = useState(activeYear)

  useEffect(() => { setYear(activeYear) }, [activeYear])
  const [rows,    setRows]    = useState<MonthlyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)

    const y = year.toString()
    const [inflowRes, outflowRes] = await Promise.all([
      fetchAllRows(() => supabase
        .from('inflow_transactions')
        .select('date, amount, offset_role, root_transaction_table, transaction_type')
        .eq('org_id', orgId)
        .gte('date', `${y}-01-01`)
        .lte('date', `${y}-12-31`)),
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('date, amount_disbursed, offset_role, root_transaction_table, transaction_type')
        .eq('org_id', orgId)
        .gte('date', `${y}-01-01`)
        .lte('date', `${y}-12-31`)),
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
      const txType = (r.transaction_type as string | null) ?? null
      if (INTERNAL_MOVEMENT_TYPES.has(txType ?? '')) continue
      const m   = parseInt((r.date as string).slice(5, 7)) - 1
      const amt = Number(r.amount)
      if (r.offset_role === 'offset' && r.root_transaction_table === 'inflow_transactions') {
        byMonth[m].totalOutflow += amt  // flip: same-table inflow offset → outflow column
      } else {
        byMonth[m].totalInflow += amt
      }
    }
    for (const r of outflowRes.data ?? []) {
      const txType = (r.transaction_type as string | null) ?? null
      if (INTERNAL_MOVEMENT_TYPES.has(txType ?? '')) continue
      const m   = parseInt((r.date as string).slice(5, 7)) - 1
      const amt = Number(r.amount_disbursed || 0)
      if (r.offset_role === 'offset' && r.root_transaction_table === 'outflow_transactions') {
        byMonth[m].totalInflow += amt  // flip: same-table outflow offset → inflow column
      } else {
        byMonth[m].totalOutflow += amt
      }
    }
    for (const row of byMonth) row.net = row.totalInflow - row.totalOutflow

    setRows(byMonth)
    setLoading(false)
  }, [year, orgId])

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
      {!loading && <OpeningBalanceFootnote />}
    </ReportSection>
  )
}

// ── Excluded Transactions Callout ─────────────────────────────────────────────
// Shows only internal movements (bank deposits, intrabank transfers).
// Offset/refund/reversal transactions are NOT excluded — they are netted
// against their root transaction within the type totals above.

interface ExcludedBucket { count: number; amount: number }
interface ExcludedSummary {
  bankDeposits:       ExcludedBucket
  intrabankTransfers: ExcludedBucket
}

function emptyExcluded(): ExcludedSummary {
  return {
    bankDeposits:       { count: 0, amount: 0 },
    intrabankTransfers: { count: 0, amount: 0 },
  }
}

function ExcludedCallout({
  excluded,
  sym,
  formatLocale,
}: {
  excluded:     ExcludedSummary
  sym:          string
  formatLocale: string
}) {
  const [open, setOpen] = useState(false)

  const totalCount  = excluded.bankDeposits.count + excluded.intrabankTransfers.count
  const totalAmount = excluded.bankDeposits.amount + excluded.intrabankTransfers.amount

  if (totalCount === 0) return null

  const rows = [
    { label: 'Bank deposits',       ...excluded.bankDeposits },
    { label: 'Intrabank transfers', ...excluded.intrabankTransfers },
  ].filter(r => r.count > 0)

  return (
    <div className="border-t border-dashed border-amber-200 bg-amber-50/60 px-5 py-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-xs font-medium text-amber-700 hover:text-amber-900 transition-colors"
      >
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {totalCount.toLocaleString()} internal movement{totalCount !== 1 ? 's' : ''} excluded from total
        <span className="font-normal text-amber-600">({sym}{fmtAmt(totalAmount, formatLocale)})</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-amber-700">
            Internal movements are excluded — they represent fund transfers, not income or expense.
            Refunds and reversals are netted within their respective type totals above.
          </p>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-amber-600 uppercase">
                <th className="py-1 text-left font-medium">Category</th>
                <th className="py-1 text-right font-medium">Transactions</th>
                <th className="py-1 text-right font-medium">Amount ({sym})</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
              {rows.map(r => (
                <tr key={r.label}>
                  <td className="py-1.5 text-gray-700">{r.label}</td>
                  <td className="py-1.5 text-right text-gray-500">{r.count.toLocaleString()}</td>
                  <td className="py-1.5 text-right font-medium text-gray-700">{sym}{fmtAmt(r.amount, formatLocale)}</td>
                </tr>
              ))}
              <tr className="font-semibold border-t border-amber-200">
                <td className="pt-2 text-amber-800">Total excluded</td>
                <td className="pt-2 text-right text-amber-700">{totalCount.toLocaleString()}</td>
                <td className="pt-2 text-right text-amber-800">{sym}{fmtAmt(totalAmount, formatLocale)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
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
  const orgId = useOrgStore(s => s.orgId)
  const { incomeTypes } = useIncomeTypes()

  const filter  = useReportDateFilter(activeYear)
  const [rows,          setRows]          = useState<IncomeTypeRow[]>([])
  const [excluded,      setExcluded]      = useState<ExcludedSummary>(emptyExcluded())
  const [offsetCredits, setOffsetCredits] = useState({ amount: 0, count: 0 })
  const [loading,       setLoading]       = useState(true)
  const [error,         setError]         = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true); setError(null)
    const { lo, queryHi, col } = filter.range

    const [inflowRes, outOffsetRes] = await Promise.all([
      fetchAllRows(() => supabase
        .from('inflow_transactions')
        .select('id, amount, income_type_id, transaction_type, offset_role, root_transaction_table')
        .eq('org_id', orgId)
        .gte(col, lo)
        .lte(col, queryHi)),
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('amount_disbursed')
        .eq('org_id', orgId)
        .eq('offset_role', 'offset')
        .eq('root_transaction_table', 'outflow_transactions')
        .gte(col, lo)
        .lte(col, queryHi)),
    ])

    if (inflowRes.error || outOffsetRes.error) {
      setError(inflowRes.error?.message ?? outOffsetRes.error?.message ?? 'Unknown error')
      setLoading(false)
      return
    }

    const exc = emptyExcluded()

    const agg = new Map<string | null, { amount: number; count: number }>()
    const addToType = (id: string | null, amt: number, countDelta = 1) => {
      const cur = agg.get(id) ?? { amount: 0, count: 0 }
      cur.amount += amt
      cur.count  += countDelta
      agg.set(id, cur)
    }

    for (const r of inflowRes.data ?? []) {
      const txType     = (r.transaction_type as string | null) ?? null
      const offsetRole = (r.offset_role as string | null) ?? null
      const rootTable  = (r.root_transaction_table as string | null) ?? null
      const amt        = Number(r.amount)

      if (txType === 'bank_deposit') {
        exc.bankDeposits.count += 1; exc.bankDeposits.amount += amt; continue
      }
      if (txType === 'intrabank_transfer') {
        exc.intrabankTransfers.count += 1; exc.intrabankTransfers.amount += amt; continue
      }

      if (offsetRole === 'offset' && rootTable === 'inflow_transactions') {
        // Flip: same-table inflow offset moves to outflow column — skip from income types
        continue
      }

      // Regular inflow OR cross-table offset (outflow-rooted offset recorded on inflow side)
      const id = (r.income_type_id as string | null) ?? null
      addToType(id, amt, 1)
    }

    // Outflow same-table offsets flip into the inflow column as "Offset credits"
    const credits = (outOffsetRes.data ?? []).reduce(
      (acc, r) => ({ amount: acc.amount + Number(r.amount_disbursed || 0), count: acc.count + 1 }),
      { amount: 0, count: 0 },
    )

    const result: IncomeTypeRow[] = []
    for (const it of incomeTypes) {
      const agged = agg.get(it.id)
      if (!agged || agged.amount === 0) continue
      result.push({ id: it.id, name: it.name, color: it.color, ...agged })
    }
    const unclassified = agg.get(null)
    if (unclassified && unclassified.amount !== 0) {
      result.push({ id: null, name: 'Unclassified', color: '#94a3b8', ...unclassified })
    }
    result.sort((a, b) => b.amount - a.amount)
    setRows(result)
    setExcluded(exc)
    setOffsetCredits(credits)
    setLoading(false)
  }, [filter.range, incomeTypes, orgId])

  useEffect(() => { load() }, [load])

  const grandTotal  = rows.reduce((s, r) => s + r.amount, 0) + offsetCredits.amount
  const periodLabel = filter.periodLabel

  const handleExport = () => {
    const excTotal = excluded.bankDeposits.amount + excluded.intrabankTransfers.amount
    const excCount = excluded.bankDeposits.count  + excluded.intrabankTransfers.count
    exportCSV(
      `income_type_breakdown_${periodLabel.replace(/ /g, '_')}`,
      ['Income Type', `Total (${sym})`, 'Count', '% of Total'],
      [
        ...rows.map(r => [
          r.name,
          r.amount,
          r.count,
          grandTotal > 0 ? ((r.amount / grandTotal) * 100).toFixed(1) + '%' : '0%',
        ]),
        ...(offsetCredits.count > 0 ? [['Offset credits (from expense adjustments)', offsetCredits.amount, offsetCredits.count, grandTotal > 0 ? ((offsetCredits.amount / grandTotal) * 100).toFixed(1) + '%' : '0%']] : []),
        ['--- TOTAL ---', grandTotal, rows.reduce((s, r) => s + r.count, 0) + offsetCredits.count, '100%'],
        [],
        ['--- EXCLUDED: INTERNAL MOVEMENTS (not income) ---', '', '', ''],
        ...(excluded.bankDeposits.count > 0       ? [['Bank deposits',       excluded.bankDeposits.amount,       excluded.bankDeposits.count,       '']] : []),
        ...(excluded.intrabankTransfers.count > 0 ? [['Intrabank transfers', excluded.intrabankTransfers.amount, excluded.intrabankTransfers.count, '']] : []),
        ...(excCount > 0 ? [['--- EXCLUDED TOTAL ---', excTotal, excCount, '']] : []),
      ],
    )
  }

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
              {offsetCredits.count > 0 && (
                <tr className="hover:bg-gray-50 italic">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full shrink-0 bg-emerald-300" />
                      <span className="text-emerald-700 text-xs font-medium">
                        Offset credits (from expense adjustments)
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-500">{offsetCredits.count.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-semibold text-success">{sym}{fmtAmt(offsetCredits.amount, formatLocale)}</td>
                  <td className="px-5 py-3 text-right text-gray-400">
                    {grandTotal > 0 ? ((offsetCredits.amount / grandTotal) * 100).toFixed(1) : '0'}%
                  </td>
                  <td />
                </tr>
              )}
              <tr className="bg-gray-50 font-bold border-t border-gray-200">
                <td className="px-5 py-3 text-gray-700">Total — {periodLabel}</td>
                <td className="px-5 py-3 text-right text-gray-500">
                  {(rows.reduce((s, r) => s + r.count, 0) + offsetCredits.count).toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right text-success">{sym}{fmtAmt(grandTotal, formatLocale)}</td>
                <td className="px-5 py-3 text-right text-gray-400">100%</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {!loading && (
        <ExcludedCallout excluded={excluded} sym={sym} formatLocale={formatLocale} />
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
  const orgId = useOrgStore(s => s.orgId)
  const { outflowTypes } = useOutflowTypes()

  const filter  = useReportDateFilter(activeYear)
  const [rows,            setRows]            = useState<OutflowTypeRow[]>([])
  const [excluded,        setExcluded]        = useState<ExcludedSummary>(emptyExcluded())
  const [incomeReversals, setIncomeReversals] = useState({ amount: 0, count: 0 })
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true); setError(null)
    const { lo, queryHi, col } = filter.range

    const [outflowRes, inOffsetRes] = await Promise.all([
      fetchAllRows(() => supabase
        .from('outflow_transactions')
        .select('id, amount_disbursed, outflow_type_id, transaction_type, offset_role, root_transaction_table')
        .eq('org_id', orgId)
        .gte(col, lo)
        .lte(col, queryHi)),
      fetchAllRows(() => supabase
        .from('inflow_transactions')
        .select('amount')
        .eq('org_id', orgId)
        .eq('offset_role', 'offset')
        .eq('root_transaction_table', 'inflow_transactions')
        .gte(col, lo)
        .lte(col, queryHi)),
    ])

    if (outflowRes.error || inOffsetRes.error) {
      setError(outflowRes.error?.message ?? inOffsetRes.error?.message ?? 'Unknown error')
      setLoading(false)
      return
    }

    const exc = emptyExcluded()

    const agg = new Map<string | null, { amount: number; count: number }>()
    const addToType = (id: string | null, amt: number, countDelta = 1) => {
      const cur = agg.get(id) ?? { amount: 0, count: 0 }
      cur.amount += amt
      cur.count  += countDelta
      agg.set(id, cur)
    }

    for (const r of outflowRes.data ?? []) {
      const txType     = (r.transaction_type as string | null) ?? null
      const offsetRole = (r.offset_role as string | null) ?? null
      const rootTable  = (r.root_transaction_table as string | null) ?? null
      const amt        = Number(r.amount_disbursed || 0)

      if (txType === 'bank_deposit') {
        exc.bankDeposits.count += 1; exc.bankDeposits.amount += amt; continue
      }
      if (txType === 'intrabank_transfer') {
        exc.intrabankTransfers.count += 1; exc.intrabankTransfers.amount += amt; continue
      }

      if (offsetRole === 'offset' && rootTable === 'outflow_transactions') {
        // Flip: same-table outflow offset moves to inflow column — skip from outflow types
        continue
      }

      // Regular outflow OR cross-table offset (inflow-rooted offset recorded on outflow side)
      const id = (r.outflow_type_id as string | null) ?? null
      addToType(id, amt, 1)
    }

    // Inflow same-table offsets flip into the outflow column as "Income reversals"
    const reversals = (inOffsetRes.data ?? []).reduce<{ amount: number; count: number }>(
      (acc, r) => ({ amount: acc.amount + Number(r.amount || 0), count: acc.count + 1 }),
      { amount: 0, count: 0 },
    )

    const result: OutflowTypeRow[] = []
    for (const ot of outflowTypes) {
      const agged = agg.get(ot.id)
      if (!agged || agged.amount === 0) continue
      result.push({ id: ot.id, name: ot.name, color: ot.color, ...agged })
    }
    const unclassified = agg.get(null)
    if (unclassified && unclassified.amount !== 0) {
      result.push({ id: null, name: 'Unclassified', color: '#94a3b8', ...unclassified })
    }
    result.sort((a, b) => b.amount - a.amount)
    setRows(result)
    setExcluded(exc)
    setIncomeReversals(reversals)
    setLoading(false)
  }, [filter.range, outflowTypes, orgId])

  useEffect(() => { load() }, [load])

  const grandTotal  = rows.reduce((s, r) => s + r.amount, 0) + incomeReversals.amount
  const periodLabel = filter.periodLabel

  const handleExport = () => {
    const excTotal = excluded.bankDeposits.amount + excluded.intrabankTransfers.amount
    const excCount = excluded.bankDeposits.count  + excluded.intrabankTransfers.count
    exportCSV(
      `outflow_type_breakdown_${periodLabel.replace(/ /g, '_')}`,
      ['Outflow Type', `Total (${sym})`, 'Count', '% of Total'],
      [
        ...rows.map(r => [
          r.name,
          r.amount,
          r.count,
          grandTotal > 0 ? ((r.amount / grandTotal) * 100).toFixed(1) + '%' : '0%',
        ]),
        ...(incomeReversals.count > 0 ? [['Income reversals (offset from income)', incomeReversals.amount, incomeReversals.count, grandTotal > 0 ? ((incomeReversals.amount / grandTotal) * 100).toFixed(1) + '%' : '0%']] : []),
        ['--- TOTAL ---', grandTotal, rows.reduce((s, r) => s + r.count, 0) + incomeReversals.count, '100%'],
        [],
        ['--- EXCLUDED: INTERNAL MOVEMENTS (not expense) ---', '', '', ''],
        ...(excluded.bankDeposits.count > 0       ? [['Bank deposits',       excluded.bankDeposits.amount,       excluded.bankDeposits.count,       '']] : []),
        ...(excluded.intrabankTransfers.count > 0 ? [['Intrabank transfers', excluded.intrabankTransfers.amount, excluded.intrabankTransfers.count, '']] : []),
        ...(excCount > 0 ? [['--- EXCLUDED TOTAL ---', excTotal, excCount, '']] : []),
      ],
    )
  }

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
              {incomeReversals.count > 0 && (
                <tr className="hover:bg-gray-50 italic">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full shrink-0 bg-orange-300" />
                      <span className="text-orange-700 text-xs font-medium">
                        Income reversals (offset from income)
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right text-gray-500">{incomeReversals.count.toLocaleString()}</td>
                  <td className="px-5 py-3 text-right font-semibold text-danger">{sym}{fmtAmt(incomeReversals.amount, formatLocale)}</td>
                  <td className="px-5 py-3 text-right text-gray-400">
                    {grandTotal > 0 ? ((incomeReversals.amount / grandTotal) * 100).toFixed(1) : '0'}%
                  </td>
                  <td />
                </tr>
              )}
              <tr className="bg-gray-50 font-bold border-t border-gray-200">
                <td className="px-5 py-3 text-gray-700">Total — {periodLabel}</td>
                <td className="px-5 py-3 text-right text-gray-500">
                  {(rows.reduce((s, r) => s + r.count, 0) + incomeReversals.count).toLocaleString()}
                </td>
                <td className="px-5 py-3 text-right text-danger">{sym}{fmtAmt(grandTotal, formatLocale)}</td>
                <td className="px-5 py-3 text-right text-gray-400">100%</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {!loading && (
        <ExcludedCallout excluded={excluded} sym={sym} formatLocale={formatLocale} />
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

    const { data, error: err } = await fetchAllRows(() => supabase
      .from('outflow_transactions')
      .select('amount_disbursed, department_id')
      .gte(col, lo)
      .lte(col, queryHi))

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
                  <tr className="border-b-2 border-black/[0.06] dark:border-white/[0.07]">
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

  const visibleTabCards = REPORT_TAB_CARDS.filter(c => c.id !== 'audit' || isAdmin())

  return (
    <div className="space-y-5">
      {/* Header */}
      <div data-tour="page-header" className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-900">Reports</h1>
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

      <PageHelpBanner storageKey="help-dismissed-reports" title="Financial Reports">
        Generate income, outflow, and allocation summaries across any date range. Switch between chart
        and table views, or use <strong>Print</strong> for a formatted copy. Use <strong>Financial
        Reports</strong> or <strong>Dynamic Reports</strong> (linked above) for more detailed,
        customisable views.
      </PageHelpBanner>

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
            href:  '/reports?tab=financial',
            active: false,
          },
          {
            icon:  FilePlus,
            label: 'Dynamic Reports',
            desc:  'Create live-updating named reports with custom filters',
            href:  '/reports?tab=custom',
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
        <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Clariva Financial Report</h1>
        <p className="text-sm text-gray-500">Generated: {new Date().toLocaleDateString()}</p>
      </div>

      {/* Mobile: icon card grid */}
      <div className="grid grid-cols-4 gap-2 md:hidden print:hidden">
        {visibleTabCards.map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl transition-colors ${
              tab === id
                ? 'bg-primary text-white'
                : 'bg-gray-100 text-gray-500 active:bg-gray-200'
            }`}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium leading-tight text-center">{label}</span>
          </button>
        ))}
      </div>

      {/* Desktop: sidebar nav + content */}
      <div data-tour="report-template" className="flex gap-7 items-start">
        <nav className="hidden md:flex flex-col w-48 shrink-0 gap-0.5 print:hidden">
          {visibleTabCards.map(({ id, Icon, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors leading-tight ${
                tab === id
                  ? 'bg-gray-100 text-gray-900 font-semibold'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        <div className="flex-1 min-w-0 print:space-y-8">
          {tab === 'annual'        && <AnnualSummaryPanel />}
          {tab === 'monthly'       && <MonthlyBreakdownPanel />}
          {tab === 'income_types'  && <IncomeTypeBreakdownPanel />}
          {tab === 'outflow_types' && <OutflowTypeBreakdownPanel />}
          {tab === 'departments'   && <DepartmentBreakdownPanel />}
          {tab === 'fx'            && <FXHoldingsPanel />}
          {tab === 'audit'         && isAdmin() && <AuditLogPanel />}
        </div>
      </div>
    </div>
  )
}
