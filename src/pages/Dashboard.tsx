import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Layers,
  PlusCircle, MinusCircle, FileSpreadsheet,
  RefreshCw, AlertCircle, Wallet, ShieldCheck, ShieldAlert, ShieldX,
} from 'lucide-react'
import { format } from 'date-fns'

import { Card }                    from '../components/ui/Card'
import { CardSkeleton }            from '../components/ui/LoadingSkeleton'
import { StatCard }                from '../components/ui/StatCard'
import { CanWrite }                from '../components/auth/RoleGates'
import { AddInflowModal }          from '../components/modals/AddInflowModal'
import { AddOutflowModal }         from '../components/modals/AddOutflowModal'
import { ImportModal }             from '../components/modals/ImportModal'

import { useDashboardStats }       from '../hooks/useDashboard'
import { useAccountingYearStore }  from '../store/accountingYearStore'
import { useCategories }           from '../hooks/useCategories'
import { useAuth }                 from '../hooks/useAuth'
import { usePageTitle }            from '../hooks/usePageTitle'
import { supabase }                from '../lib/supabase'
import { formatCurrencyCompact, formatDate, formatWithTimezone, getCurrencyLocale } from '../utils/formatters'
import { ChartEmpty, EmptyState } from '../components/ui/EmptyState'
import { useOrgCurrency }          from '../hooks/useOrgCurrency'
import { useWizardAutoShow }       from '../components/onboarding/SetupWizard'
import { OnboardingChecklist }     from '../components/onboarding/OnboardingChecklist'
import { HelpButton }              from '../components/onboarding/HelpButton'
import { AnnouncementBanner }      from '../components/onboarding/AnnouncementBanner'
import { useFirstVisitTour }       from '../hooks/useFirstVisitTour'
import { useRole }                 from '../hooks/useRole'
import { PageHelpBanner }          from '../components/ui/PageHelpBanner'
import { getStoredHealthStatus }   from '../hooks/useReconciliation'
import { healthStatusLabel } from '../utils/reconciliationAggregator'
import { useOrgStore }             from '../store/orgStore'
import { getOrgTimezone }          from '../utils/timezones'

// ── Constants ──────────────────────────────────────────────────────────────────

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Helpers ────────────────────────────────────────────────────────────────────

function fillMonthlyGaps(
  year: number,
  data: { month: string; inflow: number; outflow: number; net: number }[],
) {
  const byMonth = new Map(data.map(d => [d.month, d]))
  return MONTH_LABELS.map((label, i) => {
    const key = `${year}-${String(i + 1).padStart(2, '0')}`
    const row = byMonth.get(key)
    return {
      month:   label,
      inflow:  row?.inflow  ?? 0,
      outflow: row?.outflow ?? 0,
    }
  })
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, profile } = useAuth()
  const { foreignCurrencies, baseCurrencyCode } = useOrgCurrency()
  const { role } = useRole()
  const year        = useAccountingYearStore(s => s.year)
  const storedTz    = useOrgStore(s => s.timezone)
  const orgTimezone = getOrgTimezone(storedTz, baseCurrencyCode)
  const stats  = useDashboardStats(year)
  const { categories, loading: categoriesLoading } = useCategories()

  usePageTitle('Dashboard')
  useWizardAutoShow()
  useFirstVisitTour('dashboard')

  const [showAddInflow,  setShowAddInflow]  = useState(false)
  const [showAddOutflow, setShowAddOutflow] = useState(false)
  const [showImport,     setShowImport]     = useState(false)

  const storedHealth = getStoredHealthStatus()

  // ── Real-time subscription ─────────────────────────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel('dashboard:live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'inflow_transactions' },
        () => { stats.refetch() },
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [stats.refetch])

  // ── Derived data ───────────────────────────────────────────────────────────
  const chartData = useMemo(
    () => fillMonthlyGaps(year, stats.monthlyTotals),
    [stats.monthlyTotals],
  )

  const fxMap = useMemo(
    () => new Map(stats.fxBalances.map(f => [f.currency, f.balance])),
    [stats.fxBalances],
  )

  const isLoading = stats.loading || categoriesLoading

  const firstName =
    profile?.full_name?.split(' ')[0] ??
    user?.email?.split('@')[0] ??
    'there'

  // ── Error state ────────────────────────────────────────────────────────────
  if (stats.error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <AlertCircle className="w-10 h-10 text-danger" />
        <div>
          <p className="font-semibold text-gray-800">Failed to load dashboard</p>
          <p className="text-sm text-gray-500 mt-1">{stats.error}</p>
        </div>
        <button
          onClick={stats.refetch}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-6">

        {/* ── Announcement banner ───────────────────────────────────────────── */}
        <AnnouncementBanner />

        {/* ── Viewer orientation banner (first-visit only) ──────────────── */}
        {role === 'viewer' && (
          <PageHelpBanner storageKey="help-dismissed-dashboard-viewer" title="You have view-only access">
            You can see all financial reports, summaries, and transaction history but cannot add, edit, or delete records.
            To request write access, contact your organisation administrator.
          </PageHelpBanner>
        )}

        {/* ── Welcome + Quick Actions ──────────────────────────────────────── */}
        <div data-tour="dashboard-header" className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {greeting()}, {firstName}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {format(new Date(), 'EEEE, d MMMM yyyy')} &nbsp;·&nbsp; {year} overview
            </p>
          </div>
          <CanWrite>
            <div className="flex flex-wrap gap-2 shrink-0">
              <HelpButton tourId="dashboardTour" size="sm" />
              <button
                onClick={() => setShowAddInflow(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-success rounded-lg hover:bg-green-700 transition-colors"
              >
                <PlusCircle className="w-4 h-4" />
                Add Inflow
              </button>
              <button
                onClick={() => setShowAddOutflow(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <MinusCircle className="w-4 h-4" />
                Add Outflow
              </button>
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Import
              </button>
            </div>
          </CanWrite>
        </div>

        {/* ── Onboarding checklist ─────────────────────────────────────────── */}
        <OnboardingChecklist />

        {/* ── Health status strip ──────────────────────────────────────────── */}
        {storedHealth && (
          <Link
            to="/reconciliation"
            className={`flex items-center gap-2.5 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
              storedHealth.status === 'critical' ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' :
              storedHealth.status === 'warning'  ? 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100' :
              'bg-green-50 border-green-200 text-green-700 hover:bg-green-100'
            }`}
          >
            {storedHealth.status === 'critical' ? <ShieldX     className="w-4 h-4 shrink-0" /> :
             storedHealth.status === 'warning'  ? <ShieldAlert className="w-4 h-4 shrink-0" /> :
             <ShieldCheck className="w-4 h-4 shrink-0" />}
            <span>
              System health: <strong>{healthStatusLabel(storedHealth.status)}</strong>
            </span>
            <span className="text-xs opacity-60 hidden sm:inline">
              · last checked {formatWithTimezone(storedHealth.runAt, orgTimezone)}
            </span>
            <span className="ml-auto text-xs font-semibold opacity-70 hover:opacity-100 shrink-0">View →</span>
          </Link>
        )}

        {/* ── KPI stat cards ───────────────────────────────────────────────── */}
        <div data-tour="summary-cards" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {isLoading ? (
            <>
              <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
            </>
          ) : (
            <>
              <StatCard
                title={`Total Inflows (${year})`}
                value={formatCurrencyCompact(stats.totalInflow, baseCurrencyCode)}
                icon={<TrendingUp className="w-5 h-5 text-success" />}
                iconBgClass="bg-green-50"
                href="/inflows"
              />
              <StatCard
                title={`Total Outflows (${year})`}
                value={formatCurrencyCompact(stats.totalOutflow, baseCurrencyCode)}
                icon={<TrendingDown className="w-5 h-5 text-danger" />}
                iconBgClass="bg-red-50"
                href="/outflows"
              />
              <StatCard
                title="Net Balance"
                value={formatCurrencyCompact(stats.netBalance, baseCurrencyCode)}
                icon={<Wallet className="w-5 h-5 text-primary" />}
                iconBgClass="bg-primary-100"
                href="/bank-ledger"
              />
              <StatCard
                title="Categories"
                value={String(categories.length)}
                icon={<Layers className="w-5 h-5 text-accent" />}
                iconBgClass="bg-yellow-50"
                href="/categories"
              />
            </>
          )}
        </div>

        {/* ── Monthly area chart ───────────────────────────────────────────── */}
        <Card data-tour="dashboard-chart">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">
              Monthly Inflows vs Outflows
            </h2>
            <span className="text-xs text-gray-400">{year}</span>
          </div>

          {isLoading ? (
            <div className="h-72 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : chartData.every(d => d.inflow === 0 && d.outflow === 0) ? (
            <div className="h-72 flex items-center justify-center">
              <ChartEmpty message={`No transactions recorded for ${year} yet.`} />
            </div>
          ) : (
            <>
              <div
                role="img"
                aria-label={`Monthly Inflows vs Outflows for ${year}`}
                className="h-72"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#065F46" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#065F46" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="outflowGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#991B1B" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#991B1B" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                    <YAxis
                      tickFormatter={v => formatCurrencyCompact(v, baseCurrencyCode)}
                      tick={{ fontSize: 11, fill: '#6B7280' }}
                      axisLine={false} tickLine={false} width={64}
                    />
                    <Tooltip
                      formatter={(v: number) => [formatCurrencyCompact(v, baseCurrencyCode)]}
                      contentStyle={{ borderRadius: '0.75rem', border: '1px solid #E5E7EB', fontSize: '13px' }}
                    />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '13px' }} />
                    <Area type="monotone" dataKey="inflow"  name="Inflows"  stroke="#065F46" strokeWidth={2} fill="url(#inflowGrad)" />
                    <Area type="monotone" dataKey="outflow" name="Outflows" stroke="#991B1B" strokeWidth={2} fill="url(#outflowGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {/* Visually hidden data table for screen readers */}
              <table className="sr-only">
                <caption>Monthly Inflows vs Outflows — {year}</caption>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Inflows</th>
                    <th scope="col">Outflows</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map(d => (
                    <tr key={d.month}>
                      <td>{d.month}</td>
                      <td>{formatCurrencyCompact(d.inflow,  baseCurrencyCode)}</td>
                      <td>{formatCurrencyCompact(d.outflow, baseCurrencyCode)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>

        {/* ── Recent transactions ──────────────────────────────────────────── */}
        <Card padding={false} data-tour="recent-transactions">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Recent Transactions</h2>
            <span className="text-xs text-gray-400">Last 10 inflows</span>
          </div>

          {isLoading ? (
            <div className="divide-y divide-gray-100">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-3 animate-pulse">
                  <div className="h-4 bg-gray-100 rounded w-20 shrink-0" />
                  <div className="h-4 bg-gray-100 rounded flex-1" />
                  <div className="h-4 bg-gray-100 rounded w-24 shrink-0" />
                </div>
              ))}
            </div>
          ) : stats.recentTransactions.length === 0 ? (
            <EmptyState icon={TrendingUp} title="No recent transactions." compact />
          ) : (
            <div className="divide-y divide-gray-100">
              {stats.recentTransactions.map(tx => (
                <div key={tx.id} className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition-colors">
                  <span className="text-xs text-gray-400 whitespace-nowrap w-20 shrink-0">
                    {formatDate(tx.date)}
                  </span>
                  <span className="text-sm text-gray-700 truncate flex-1">
                    {tx.display_description || tx.description || '—'}
                  </span>
                  <span className="text-sm font-semibold text-success whitespace-nowrap shrink-0 font-mono">
                    +{formatCurrencyCompact(tx.amount, baseCurrencyCode)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* ── FX currency strip ────────────────────────────────────────────── */}
        <Card>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Foreign Currency Holdings
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {foreignCurrencies.map(fx => {
              const balance  = fxMap.get(fx.code) ?? 0
              const hasValue = balance > 0
              return (
                <div key={fx.code} className={`${!hasValue ? 'opacity-40' : ''}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-sm leading-none">{fx.flag}</span>
                    <span className="text-xs font-semibold text-gray-400">{fx.code}</span>
                  </div>
                  {isLoading ? (
                    <div className="h-5 bg-gray-100 rounded animate-pulse w-3/4" />
                  ) : (
                    <p className={`text-base font-bold font-mono ${hasValue ? 'text-gray-900' : 'text-gray-400'}`}>
                      {fx.symbol}{balance.toLocaleString(getCurrencyLocale(fx.code), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </Card>

      </div>

      {/* ── Modals ────────────────────────────────────────────────────────────── */}
      <AddInflowModal
        open={showAddInflow}
        onClose={() => setShowAddInflow(false)}
        onSuccess={() => stats.refetch()}
      />
      <AddOutflowModal
        open={showAddOutflow}
        onClose={() => setShowAddOutflow(false)}
        onSuccess={() => stats.refetch()}
      />
      <ImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
      />
    </>
  )
}
