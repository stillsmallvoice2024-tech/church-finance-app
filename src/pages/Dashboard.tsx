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
import { formatCurrency, formatCurrencyCompact, formatDate, formatWithTimezone, getCurrencyLocale } from '../utils/formatters'
import { ChartEmpty, EmptyState } from '../components/ui/EmptyState'
import { useOrgCurrency }          from '../hooks/useOrgCurrency'
import { useWizardAutoShow }       from '../components/onboarding/SetupWizard'
import { OnboardingChecklist }     from '../components/onboarding/OnboardingChecklist'
import { HelpButton }              from '../components/onboarding/HelpButton'
import { AnnouncementBanner }      from '../components/onboarding/AnnouncementBanner'
import { useFirstVisitTour }       from '../hooks/useFirstVisitTour'
import { useRole }                 from '../hooks/useRole'
import { PageHelpBanner }          from '../components/ui/PageHelpBanner'
import { useOrgStore }             from '../store/orgStore'
import { getOrgTimezone }          from '../utils/timezones'
import { useHealthStore }          from '../store/healthStore'
import { useCountUp }              from '../hooks/useCountUp'
import { ConfidenceGauge }         from '../components/ui/ConfidenceGauge'
import { useThemeStore }           from '../store/themeStore'

// ── Constants ──────────────────────────────────────────────────────────────────

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const visitKey = (userId: string) => `church-finance-visit-${userId}`

interface VisitSnapshot {
  visitedAt:    string
  totalInflow:  number
  totalOutflow: number
  netBalance:   number
}

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

// Mounted only once data is loaded, so the count-up runs exactly once.
function AnimatedStat({ value, format }: { value: number; format: (v: number) => string }) {
  const animated = useCountUp(value)
  return <>{format(animated)}</>
}

// ── Dashboard ──────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user, profile } = useAuth()
  const { foreignCurrencies, baseCurrencyCode } = useOrgCurrency()
  const { role } = useRole()
  const { theme } = useThemeStore()
  const isDark = theme === 'dark'
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
  const [lastVisit,      setLastVisit]      = useState<VisitSnapshot | null>(null)

  const healthStatus  = useHealthStore(s => s.status)
  const healthRunAt   = useHealthStore(s => s.runAt)
  const healthSkipped = useHealthStore(s => s.skipped)
  const setSkipped    = useHealthStore(s => s.setSkipped)
  const cleanSince    = useHealthStore(s => s.cleanSince)

  const stableDays = useMemo(() => {
    if (!cleanSince) return 0
    return Math.floor((Date.now() - new Date(cleanSince).getTime()) / 86_400_000)
  }, [cleanSince])

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

  // ── Since-last-visit snapshot ──────────────────────────────────────────────
  // Must run after isLoading is declared — its dep array reads it during render.
  useEffect(() => {
    if (isLoading || !user) return
    const key = visitKey(user.id)
    try {
      const raw  = localStorage.getItem(key)
      const prev = raw ? (JSON.parse(raw) as VisitSnapshot) : null
      const oneHourAgo = Date.now() - 3_600_000
      if (prev && new Date(prev.visitedAt).getTime() < oneHourAgo) {
        setLastVisit(prev)
      }
      localStorage.setItem(key, JSON.stringify({
        visitedAt:    new Date().toISOString(),
        totalInflow:  stats.totalInflow,
        totalOutflow: stats.totalOutflow,
        netBalance:   stats.netBalance,
      } satisfies VisitSnapshot))
    } catch { /* storage unavailable */ }
  }, [isLoading]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <div data-tour="dashboard-header" className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-4 border-b border-black/[0.06] dark:border-white/[0.07]">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">
              {greeting()}, {firstName}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {format(new Date(), 'EEEE, d MMMM yyyy')} &nbsp;·&nbsp; {year} overview
            </p>
            {!isLoading && stats.recentTransactions.length > 0 && (
              <p className="text-xs text-gray-500 mt-1">
                Records up to date — latest transaction recorded {formatDate(stats.recentTransactions[0].date)}
              </p>
            )}
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
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
              >
                <MinusCircle className="w-4 h-4" />
                Add Outflow
              </button>
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Import
              </button>
            </div>
          </CanWrite>
        </div>

        {/* ── Onboarding checklist ─────────────────────────────────────────── */}
        <OnboardingChecklist />

        {/* ── Record confidence strip ───────────────────────────────────────── */}
        {!healthSkipped && (
          <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border shadow-md text-sm transition-colors ${
            !healthStatus                ? 'bg-gray-50 border-gray-200'                          :
            healthStatus === 'critical'  ? 'bg-red-50 border-red-200'                            :
            healthStatus === 'warning'   ? 'bg-amber-50 border-amber-200'                        :
                                          'bg-green-50 border-green-200'
          }`}>
            <div className="shrink-0">
              {!healthStatus              ? <ShieldCheck className="w-5 h-5 text-gray-300" /> :
               healthStatus === 'critical' ? <ShieldX     className="w-5 h-5 text-red-500" /> :
               healthStatus === 'warning'  ? <ShieldAlert className="w-5 h-5 text-amber-500" /> :
               <ShieldCheck className="w-5 h-5 text-green-600" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${
                !healthStatus              ? 'text-gray-500'    :
                healthStatus === 'critical' ? 'text-red-700'    :
                healthStatus === 'warning'  ? 'text-amber-700'  :
                                             'text-green-700'
              }`}>
                {!healthStatus
                  ? 'Records not yet verified — run a reconciliation check to confirm accuracy'
                  : healthStatus === 'critical'
                  ? 'Action needed: issues found that need your attention'
                  : healthStatus === 'warning'
                  ? 'Review recommended: some items may need attention'
                  : 'All records reconciled — your books are in good order'}
              </p>
              {healthStatus && healthRunAt && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Last verified {formatWithTimezone(healthRunAt, orgTimezone)}
                  {healthStatus === 'healthy' && stableDays >= 7 && (
                    <span className="ml-2 inline-flex items-center gap-1 text-green-600 font-medium">
                      ✓ Stable for {stableDays} days
                    </span>
                  )}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                to="/reconciliation"
                className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                  healthStatus === 'critical' ? 'bg-red-100 text-red-700 hover:bg-red-200'     :
                  healthStatus === 'warning'  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' :
                  healthStatus === 'healthy'  ? 'bg-green-100 text-green-700 hover:bg-green-200' :
                  'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {healthStatus === 'critical' || healthStatus === 'warning' ? 'View issues →' : 'View details →'}
              </Link>
              <button
                onClick={() => setSkipped(true)}
                title="Dismiss"
                className="touch-target p-1 rounded text-gray-300 hover:text-gray-500 transition-colors"
                aria-label="Dismiss health banner"
              >
                <span className="text-lg leading-none">×</span>
              </button>
            </div>
          </div>
        )}
        {healthSkipped && (
          <div className="flex items-center justify-end">
            <button
              onClick={() => setSkipped(false)}
              className="text-xs text-gray-500 hover:text-gray-600 transition-colors"
            >
              Show record health status
            </button>
          </div>
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
                variant="hero"
                title={`Total Inflows (${year})`}
                value={<AnimatedStat value={stats.totalInflow} format={v => formatCurrencyCompact(v, baseCurrencyCode)} />}
                subValue={formatCurrency(stats.totalInflow, baseCurrencyCode)}
                href="/inflows"
              />
              <StatCard
                variant="hero"
                title={`Total Outflows (${year})`}
                value={<AnimatedStat value={stats.totalOutflow} format={v => formatCurrencyCompact(v, baseCurrencyCode)} />}
                subValue={formatCurrency(stats.totalOutflow, baseCurrencyCode)}
                href="/outflows"
              />
              <StatCard
                variant="hero"
                title="Net Balance"
                value={<AnimatedStat value={stats.netBalance} format={v => formatCurrencyCompact(v, baseCurrencyCode)} />}
                subValue={formatCurrency(stats.netBalance, baseCurrencyCode)}
                note={stats.openingBalanceTotal > 0
                  ? `Includes ${formatCurrencyCompact(stats.openingBalanceTotal, baseCurrencyCode)} opening balance`
                  : undefined}
                href="/bank-ledger"
              />
              <StatCard
                variant="hero"
                title="Categories"
                value={<AnimatedStat value={categories.length} format={v => String(Math.round(v))} />}
                href="/categories"
              />
            </>
          )}
        </div>

        {/* ── Since-last-visit note ────────────────────────────────────────── */}
        {lastVisit && !isLoading && (() => {
          const inflowΔ  = stats.totalInflow  - lastVisit.totalInflow
          const outflowΔ = stats.totalOutflow - lastVisit.totalOutflow
          const parts: string[] = []
          if (Math.abs(inflowΔ)  >= 1) parts.push(`inflows ${inflowΔ  > 0 ? '+' : ''}${formatCurrencyCompact(inflowΔ,  baseCurrencyCode)}`)
          if (Math.abs(outflowΔ) >= 1) parts.push(`outflows ${outflowΔ > 0 ? '+' : ''}${formatCurrencyCompact(outflowΔ, baseCurrencyCode)}`)
          if (parts.length === 0) return null
          const days = Math.floor((Date.now() - new Date(lastVisit.visitedAt).getTime()) / 86_400_000)
          const timeAgo = days === 0 ? 'earlier today' : days === 1 ? 'yesterday' : `${days} days ago`
          return (
            <p className="text-xs text-gray-500 text-right -mt-2">
              Since {timeAgo}: {parts.join(' · ')}
            </p>
          )
        })()}

        {/* ── Monthly area chart + Record Confidence ───────────────────────── */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
        <Card data-tour="dashboard-chart" className="xl:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-gray-700">
              Monthly Inflows vs Outflows
            </h2>
            <span className="text-xs text-gray-500">{year}</span>
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
                aria-label={`Monthly Inflows vs Outflows for ${year}. Total inflows ${chartData.reduce((s, d) => s + d.inflow, 0).toLocaleString()}, total outflows ${chartData.reduce((s, d) => s + d.outflow, 0).toLocaleString()}. Peak month ${chartData.reduce((m, d) => (d.inflow > m.inflow ? d : m), chartData[0])?.month ?? ''}.`}
                className="h-72"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={isDark ? '#4ade80' : '#16A34A'} stopOpacity={isDark ? 0.20 : 0.15} />
                        <stop offset="95%" stopColor={isDark ? '#4ade80' : '#16A34A'} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="outflowGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor={isDark ? '#f87171' : '#DC2626'} stopOpacity={isDark ? 0.20 : 0.15} />
                        <stop offset="95%" stopColor={isDark ? '#f87171' : '#DC2626'} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="0" stroke={isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} horizontal={true} vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: isDark ? 'rgba(255,255,255,0.35)' : '#9CA3AF', fontWeight: 600 }} axisLine={false} tickLine={false} />
                    <YAxis
                      tickFormatter={v => formatCurrencyCompact(v, baseCurrencyCode)}
                      tick={{ fontSize: 10, fill: isDark ? 'rgba(255,255,255,0.35)' : '#9CA3AF', fontWeight: 600 }}
                      axisLine={false} tickLine={false} width={64}
                    />
                    <Tooltip
                      formatter={(v: number) => [formatCurrencyCompact(v, baseCurrencyCode)]}
                      contentStyle={{
                        borderRadius: '0.75rem',
                        border: isDark ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(0,0,0,0.07)',
                        background: isDark ? '#1c1c1e' : '#fff',
                        color: isDark ? 'rgba(255,255,255,0.90)' : '#111',
                        fontSize: '13px', fontWeight: 600,
                        boxShadow: isDark ? '0 4px 20px rgba(0,0,0,0.5)' : '0 4px 12px rgba(0,0,0,0.08)',
                      }}
                    />
                    <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: '12px', fontWeight: 600, color: isDark ? 'rgba(255,255,255,0.45)' : '#6B7280' }} />
                    <Area type="monotone" dataKey="inflow"  name="Inflows"  stroke={isDark ? '#4ade80' : '#16A34A'} strokeWidth={2} fill="url(#inflowGrad)" />
                    <Area type="monotone" dataKey="outflow" name="Outflows" stroke={isDark ? '#f87171' : '#DC2626'} strokeWidth={2} fill="url(#outflowGrad)" />
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
        <ConfidenceGauge />
        </div>

        {/* ── Recent transactions ──────────────────────────────────────────── */}
        <Card padding={false} data-tour="recent-transactions">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Recent Transactions</h2>
            <span className="text-xs text-gray-500">Last 10 inflows</span>
          </div>

          {isLoading ? (
            <div className="divide-y divide-black/[0.05]">
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
            <div className="divide-y divide-black/[0.05]">
              {stats.recentTransactions.map(tx => (
                <div key={tx.id} className="flex items-center gap-3 px-6 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
                  <span className="text-xs text-gray-500 whitespace-nowrap w-20 shrink-0">
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
          <h2 className="text-sm font-semibold text-gray-700 mb-4">
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
        onSuccess={() => stats.refetch()}
      />
    </>
  )
}
