import { useSearchParams } from 'react-router-dom'
import { Clock, RotateCcw, Undo2, ChevronRight, AlertCircle } from 'lucide-react'
import { BarChart, Bar, XAxis, Cell, ResponsiveContainer, Tooltip as RTooltip } from 'recharts'
import PendingDeductions from './PendingDeductions'
import RefundTransactions from './RefundTransactions'
import ReversalTransactions from './ReversalTransactions'
import { CentreTabs, useCentreTab, type CentreTabDef } from '../components/ui/CentreTabs'
import { useAdjustmentsSummary } from '../hooks/useAdjustmentsSummary'
import { useCountUp } from '../hooks/useCountUp'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { formatCurrency } from '../utils/formatters'

const TABS: CentreTabDef[] = [
  { id: 'upcoming',  label: 'Upcoming Deductions' },
  { id: 'refunds',   label: 'Refunds' },
  { id: 'reversals', label: 'Reversals' },
]

// Single entry point for transaction adjustments. Each tab renders the
// existing page component unchanged; old routes (/pending-deductions,
// /refunds, /reversals) redirect here with the matching ?tab= param.
export default function Adjustments() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab')
  const { active, setActive, visible } = useCentreTab(TABS, 'upcoming')

  const showHub = () => setSearchParams({}, { replace: true })

  if (tab === null) {
    return (
      <div className="space-y-5">
        <AdjustmentsHub onSelectTab={setActive} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={showHub}
        className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        ← Show summary
      </button>
      <CentreTabs tabs={visible} active={active} onChange={setActive} />
      {active === 'upcoming'  && <PendingDeductions />}
      {active === 'refunds'   && <RefundTransactions />}
      {active === 'reversals' && <ReversalTransactions />}
    </div>
  )
}

// ── Hub (summary landing) ────────────────────────────────────────────────────────

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7))
  return MONTH_ABBR[m - 1] ?? ym
}

function AdjustmentsHub({ onSelectTab }: { onSelectTab: (id: string) => void }) {
  const { baseCurrencyCode } = useOrgCurrency()
  const { pending, refunds, reversals, loading, error } = useAdjustmentsSummary()
  const animatedPending   = useCountUp(pending.total)
  const animatedRefunds   = useCountUp(refunds.total)
  const animatedReversals = useCountUp(reversals.total)
  const refundChart   = refunds.monthly.map(p => ({ ...p, label: monthLabel(p.month) }))
  const reversalChart = reversals.monthly.map(p => ({ ...p, label: monthLabel(p.month) }))

  if (loading && pending.count === 0 && refunds.count === 0 && reversals.count === 0) {
    return <div className="h-64 rounded-2xl border border-gray-100 bg-white animate-pulse" />
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-medium text-amber-700">Pending Deductions</p>
          <p className="text-2xl font-extrabold tabular-nums text-amber-900 mt-1">{formatCurrency(animatedPending, baseCurrencyCode)}</p>
          <p className="text-xs text-amber-600 mt-1">{pending.count.toLocaleString()} awaiting resolution</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Total Refunds</p>
          <p className="text-2xl font-extrabold tabular-nums text-gray-900 mt-1">{formatCurrency(animatedRefunds, baseCurrencyCode)}</p>
          <p className="text-xs text-gray-400 mt-1">{refunds.count.toLocaleString()} refund{refunds.count !== 1 ? 's' : ''}</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium text-gray-500">Total Reversals</p>
          <p className="text-2xl font-extrabold tabular-nums text-gray-900 mt-1">{formatCurrency(animatedReversals, baseCurrencyCode)}</p>
          <p className="text-xs text-gray-400 mt-1">{reversals.count.toLocaleString()} reversal{reversals.count !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {refundChart.some(d => d.amount !== 0) && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">Monthly refunds</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={refundChart} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <RTooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                formatter={(v: number) => [formatCurrency(v, baseCurrencyCode), 'Refunded']}
                labelFormatter={() => ''}
              />
              <Bar dataKey="amount" radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={40} onClick={() => onSelectTab('refunds')}>
                {refundChart.map(d => <Cell key={d.month} fill={d.amount === 0 ? '#94a3b8' : '#0D7377'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {reversalChart.some(d => d.amount !== 0) && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-semibold text-gray-500 mb-2">Monthly reversals</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={reversalChart} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
              <RTooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                formatter={(v: number) => [formatCurrency(v, baseCurrencyCode), 'Reversed']}
                labelFormatter={() => ''}
              />
              <Bar dataKey="amount" radius={[4, 4, 0, 0]} cursor="pointer" maxBarSize={40} onClick={() => onSelectTab('reversals')}>
                {reversalChart.map(d => <Cell key={d.month} fill={d.amount === 0 ? '#94a3b8' : '#4A5568'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
        <button
          type="button"
          onClick={() => onSelectTab('upcoming')}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Clock className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-sm font-medium text-gray-800">Upcoming Deductions</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
            {pending.count.toLocaleString()} · {formatCurrency(pending.total, baseCurrencyCode)}
            <ChevronRight className="w-4 h-4" />
          </span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('refunds')}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <RotateCcw className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-sm font-medium text-gray-800">Refunds</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
            {refunds.count.toLocaleString()} · {formatCurrency(refunds.total, baseCurrencyCode)}
            <ChevronRight className="w-4 h-4" />
          </span>
        </button>
        <button
          type="button"
          onClick={() => onSelectTab('reversals')}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <Undo2 className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-sm font-medium text-gray-800">Reversals</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
            {reversals.count.toLocaleString()} · {formatCurrency(reversals.total, baseCurrencyCode)}
            <ChevronRight className="w-4 h-4" />
          </span>
        </button>
      </div>
    </div>
  )
}
