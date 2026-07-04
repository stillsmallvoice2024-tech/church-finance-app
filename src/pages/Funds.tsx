import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import CategoryLedger from './CategoryLedger'
import PercentageAllocation from './PercentageAllocation'
import SpecificGivings from './SpecificGivings'
import SavingsPortions from './SavingsPortions'
import { CentreTabs, useCentreTab, type CentreTabDef } from '../components/ui/CentreTabs'
import { SimpleShell } from '../components/ui/SimpleShell'
import { useDetailLevel } from '../hooks/useDetailLevel'
import { useFundsSummary, type FundGroup } from '../hooks/useFundsSummary'
import { useCountUp } from '../hooks/useCountUp'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { formatCurrency } from '../utils/formatters'
import { PageEmptyState } from '../components/onboarding/PageEmptyState'

const TABS: CentreTabDef[] = [
  { id: 'accounts',   label: 'Category Accounts' },
  { id: 'regular',    label: 'Regular Funds' },
  { id: 'designated', label: 'Designated Gifts' },
  { id: 'savings',    label: 'Savings Funds' },
]

const GROUP_META: Record<FundGroup, { label: string; color: string; tab: string }> = {
  regular:    { label: 'Regular Funds',    color: '#0D7377', tab: 'regular' },
  designated: { label: 'Designated Gifts', color: '#C89B3C', tab: 'designated' },
  savings:    { label: 'Savings Funds',    color: '#14A085', tab: 'savings' },
}

// Single entry point for fund balances. The four former pages are views over
// the same allocation data. Simple opens with a lean balance summary; Full is
// the current tabbed detail.
export default function Funds() {
  const { active, setActive, visible } = useCentreTab(TABS, 'accounts')
  const { setLevel: setDetail, isSimple } = useDetailLevel('funds')

  if (isSimple) {
    return (
      <SimpleFundsView
        onOpenTab={(tab) => { setActive(tab); setDetail('full') }}
        onViewAll={() => { setActive('accounts'); setDetail('full') }}
      />
    )
  }

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={() => setDetail('simple')}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Show summary
      </button>
      <CentreTabs tabs={visible} active={active} onChange={setActive} />
      {active === 'accounts'   && <CategoryLedger />}
      {active === 'regular'    && <PercentageAllocation />}
      {active === 'designated' && <SpecificGivings />}
      {active === 'savings'    && <SavingsPortions />}
    </div>
  )
}

// ── Simple view ──────────────────────────────────────────────────────────────

const SIMPLE_LIMIT = 8

function SimpleFundsView({ onOpenTab, onViewAll }: {
  onOpenTab: (tab: string) => void
  onViewAll: () => void
}) {
  const { baseCurrencyCode } = useOrgCurrency()
  const summary       = useFundsSummary()
  const animatedTotal = useCountUp(summary.total)
  const [group, setGroup] = useState<'all' | FundGroup>('all')

  const filtered = group === 'all' ? summary.funds : summary.funds.filter(f => f.group === group)
  const shown    = filtered.slice(0, SIMPLE_LIMIT)
  const maxBal   = Math.max(1, ...shown.map(f => Math.abs(f.balance)))

  const hero = (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <p className="text-xs font-medium text-gray-500">Total held across funds</p>
      <p className="text-3xl font-extrabold tabular-nums text-gray-900 mt-1">
        {formatCurrency(animatedTotal, baseCurrencyCode)}
      </p>
      <p className="text-xs text-gray-400 mt-1">
        {summary.funds.length.toLocaleString()} fund{summary.funds.length !== 1 ? 's' : ''}
      </p>
    </div>
  )

  const chips = (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Fund groups">
      {([['all', 'All'], ['regular', 'Regular'], ['designated', 'Designated'], ['savings', 'Savings']] as const).map(([key, label]) => {
        const active = group === key
        return (
          <button
            key={key}
            type="button"
            onClick={() => setGroup(key)}
            aria-pressed={active}
            className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
              active ? 'bg-primary text-white border-primary' : 'bg-white text-gray-600 border-gray-200 hover:border-primary/40 hover:text-primary'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )

  const insightsPanel = (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
      <p className="text-xs font-semibold text-gray-500">Where the money sits</p>
      {(Object.keys(GROUP_META) as FundGroup[]).map(g => {
        const amt = summary.groupTotals[g]
        const pct = summary.total > 0 ? (amt / summary.total) * 100 : 0
        return (
          <button
            key={g}
            type="button"
            onClick={() => onOpenTab(GROUP_META[g].tab)}
            className="w-full text-left"
          >
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-medium text-gray-700">{GROUP_META[g].label}</span>
              <span className="tabular-nums text-gray-500">{formatCurrency(amt, baseCurrencyCode)} · {pct.toFixed(0)}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: GROUP_META[g].color }} />
            </div>
          </button>
        )
      })}
    </div>
  )

  const body = (
    <div>
      {summary.loading && summary.funds.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl border border-gray-100 bg-white animate-pulse" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <PageEmptyState pageId="category-ledger" compact />
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden">
          {shown.map(fund => (
            <button
              key={fund.key}
              type="button"
              onClick={() => onOpenTab(GROUP_META[fund.group].tab)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: GROUP_META[fund.group].color }} />
                  <p className="text-sm text-gray-800 truncate">{fund.name}</p>
                  {group === 'all' && (
                    <span className="text-[10px] font-medium text-gray-400 shrink-0">{GROUP_META[fund.group].label}</span>
                  )}
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(Math.abs(fund.balance) / maxBal) * 100}%`, backgroundColor: GROUP_META[fund.group].color }} />
                </div>
              </div>
              <p className={`text-sm font-mono font-bold tabular-nums shrink-0 ${fund.balance < 0 ? 'text-danger' : 'text-gray-900'}`}>
                {formatCurrency(fund.balance, baseCurrencyCode)}
              </p>
            </button>
          ))}
        </div>
      )}
      {filtered.length > shown.length && (
        <p className="text-xs text-gray-400 mt-2 text-center">+{filtered.length - shown.length} more in the full view</p>
      )}
    </div>
  )

  return (
    <SimpleShell
      pageId="funds"
      hero={hero}
      filters={chips}
      bodyTitle="Your funds"
      insights={insightsPanel}
      body={body}
      onViewAll={onViewAll}
      viewAllLabel="Open fund details"
    />
  )
}
