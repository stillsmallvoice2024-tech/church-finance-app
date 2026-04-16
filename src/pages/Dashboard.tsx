import { useEffect, useMemo, useState } from 'react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, Cell,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Wallet, BookOpen,
  PlusCircle, MinusCircle, FileSpreadsheet,
  RefreshCw, AlertCircle,
} from 'lucide-react'
import { format } from 'date-fns'

import { Card }                    from '../components/ui/Card'
import { CardSkeleton }            from '../components/ui/LoadingSkeleton'
import { StatCard }                from '../components/ui/StatCard'
import { Badge }                   from '../components/ui/Badge'
import { CanWrite }                from '../components/auth/RoleGates'
import { AddInflowModal }          from '../components/modals/AddInflowModal'
import { AddOutflowModal }         from '../components/modals/AddOutflowModal'
import { ImportModal }             from '../components/modals/ImportModal'

import { useDashboardStats }       from '../hooks/useDashboard'
import { useAccounts }             from '../hooks/useLedger'
import { useAuth }                 from '../hooks/useAuth'
import { usePageTitle }            from '../hooks/usePageTitle'
import { supabase }                from '../lib/supabase'
import { formatCurrencyCompact, formatDate } from '../utils/formatters'

// ── Constants ──────────────────────────────────────────────────────────────────

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const FX_META = [
  { code: 'USD', symbol: '$', flag: '🇺🇸' },
  { code: 'GBP', symbol: '£', flag: '🇬🇧' },
  { code: 'EUR', symbol: '€', flag: '🇪🇺' },
  { code: 'CNY', symbol: '¥', flag: '🇨🇳' },
]

const BAR_COLORS = ['#1E3A8A','#2547A4','#3B60C4','#5A7BD4','#8099DC','#A8B8E8']

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Ensure all 12 months have an entry (fills gaps with zeros) */
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

const YEAR = new Date().getFullYear()

export default function Dashboard() {
  const { user, profile } = useAuth()
  const stats    = useDashboardStats(YEAR)
  const { accounts, loading: accountsLoading } = useAccounts()

  usePageTitle('Dashboard')

  const [showAddInflow,  setShowAddInflow]  = useState(false)
  const [showAddOutflow, setShowAddOutflow] = useState(false)
  const [showImport,     setShowImport]     = useState(false)

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
  }, [stats.refetch])   // stable ref: stats.refetch is a useCallback

  // ── Derived data ───────────────────────────────────────────────────────────
  const chartData = useMemo(
    () => fillMonthlyGaps(YEAR, stats.monthlyTotals),
    [stats.monthlyTotals],
  )

  const topAccounts = useMemo(
    () =>
      [...accounts]
        .sort((a, b) => b.opening_balance - a.opening_balance)
        .slice(0, 6)
        .map(a => ({ name: a.name, balance: a.opening_balance })),
    [accounts],
  )

  const fxMap = useMemo(
    () => new Map(stats.fxBalances.map(f => [f.currency, f.balance])),
    [stats.fxBalances],
  )

  const isLoading = stats.loading || accountsLoading

  // ── First name ─────────────────────────────────────────────────────────────
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

        {/* ── Welcome banner ──────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              {greeting()}, {firstName}
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {format(new Date(), 'EEEE, d MMMM yyyy')} &nbsp;·&nbsp; {YEAR} overview
            </p>
          </div>
          {profile?.role && (
            <Badge
              label={profile.role.charAt(0).toUpperCase() + profile.role.slice(1)}
              variant={profile.role === 'admin' ? 'primary' : profile.role === 'accountant' ? 'success' : 'neutral'}
            />
          )}
        </div>

        {/* ── KPI stat cards ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {isLoading ? (
            <>
              <CardSkeleton /><CardSkeleton /><CardSkeleton /><CardSkeleton />
            </>
          ) : (
            <>
              <StatCard
                title={`Total Inflows (${YEAR})`}
                value={formatCurrencyCompact(stats.totalInflow)}
                icon={<TrendingUp className="w-5 h-5 text-success" />}
                iconBgClass="bg-green-50"
              />
              <StatCard
                title={`Total Outflows (${YEAR})`}
                value={formatCurrencyCompact(stats.totalOutflow)}
                icon={<TrendingDown className="w-5 h-5 text-danger" />}
                iconBgClass="bg-red-50"
              />
              <StatCard
                title="Net Balance"
                value={formatCurrencyCompact(stats.netBalance)}
                icon={<Wallet className="w-5 h-5 text-primary" />}
                iconBgClass="bg-primary-100"
              />
              <StatCard
                title="Active Accounts"
                value={String(accounts.length)}
                icon={<BookOpen className="w-5 h-5 text-accent" />}
                iconBgClass="bg-yellow-50"
              />
            </>
          )}
        </div>

        {/* ── Monthly area chart ───────────────────────────────────────────── */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">
              Monthly Inflows vs Outflows
            </h2>
            <span className="text-xs text-gray-400">{YEAR}</span>
          </div>

          {isLoading ? (
            <div className="h-72 flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : chartData.every(d => d.inflow === 0 && d.outflow === 0) ? (
            <div className="h-72 flex flex-col items-center justify-center gap-2 text-gray-400">
              <TrendingUp className="w-8 h-8" />
              <p className="text-sm">No transactions recorded for {YEAR} yet.</p>
            </div>
          ) : (
            <div className="h-72">
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
                    tickFormatter={v => formatCurrencyCompact(v)}
                    tick={{ fontSize: 11, fill: '#6B7280' }}
                    axisLine={false} tickLine={false} width={64}
                  />
                  <Tooltip
                    formatter={(v: number) => [formatCurrencyCompact(v)]}
                    contentStyle={{ borderRadius: '0.75rem', border: '1px solid #E5E7EB', fontSize: '13px' }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '13px' }} />
                  <Area type="monotone" dataKey="inflow"  name="Inflows"  stroke="#065F46" strokeWidth={2} fill="url(#inflowGrad)" />
                  <Area type="monotone" dataKey="outflow" name="Outflows" stroke="#991B1B" strokeWidth={2} fill="url(#outflowGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* ── Two-column: top accounts + recent transactions ───────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Top accounts bar chart */}
          <Card>
            <h2 className="text-base font-semibold text-gray-800 mb-4">Top Accounts by Balance</h2>
            {isLoading ? (
              <div className="h-52 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : topAccounts.length === 0 ? (
              <div className="h-52 flex flex-col items-center justify-center gap-2 text-gray-400">
                <BookOpen className="w-8 h-8" />
                <p className="text-sm">No accounts found.</p>
              </div>
            ) : (
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={topAccounts}
                    layout="vertical"
                    margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#F3F4F6" />
                    <XAxis
                      type="number"
                      tickFormatter={v => formatCurrencyCompact(v)}
                      tick={{ fontSize: 11, fill: '#6B7280' }}
                      axisLine={false} tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={{ fontSize: 11, fill: '#374151' }}
                      axisLine={false} tickLine={false}
                      width={110}
                    />
                    <Tooltip
                      formatter={(v: number) => [formatCurrencyCompact(v), 'Balance']}
                      contentStyle={{ borderRadius: '0.75rem', border: '1px solid #E5E7EB', fontSize: '13px' }}
                    />
                    <Bar dataKey="balance" radius={[0, 4, 4, 0]}>
                      {topAccounts.map((_, i) => (
                        <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Recent transactions */}
          <Card padding={false}>
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-800">Recent Transactions</h2>
              <span className="text-xs text-gray-400">Last 10 inflows</span>
            </div>

            {isLoading ? (
              <div className="divide-y divide-gray-50">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-6 py-3 animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-20 shrink-0" />
                    <div className="h-4 bg-gray-200 rounded flex-1" />
                    <div className="h-4 bg-gray-200 rounded w-24 shrink-0" />
                  </div>
                ))}
              </div>
            ) : stats.recentTransactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-gray-400">
                <TrendingUp className="w-8 h-8" />
                <p className="text-sm">No recent transactions.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {stats.recentTransactions.map(tx => (
                  <div key={tx.id} className="flex items-center gap-3 px-6 py-3 hover:bg-gray-50 transition-colors">
                    <span className="text-xs text-gray-400 whitespace-nowrap w-20 shrink-0">
                      {formatDate(tx.date)}
                    </span>
                    <span className="text-sm text-gray-700 truncate flex-1">
                      {tx.description ?? '—'}
                    </span>
                    <span className="text-sm font-semibold text-success whitespace-nowrap shrink-0">
                      +{formatCurrencyCompact(tx.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ── FX currency strip ────────────────────────────────────────────── */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Foreign Currency Holdings
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {FX_META.map(fx => {
              const balance  = fxMap.get(fx.code) ?? 0
              const hasValue = balance > 0
              return (
                <Card
                  key={fx.code}
                  className={`transition-opacity ${hasValue ? '' : 'opacity-50'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-lg">{fx.flag}</span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      hasValue ? 'bg-primary-100 text-primary' : 'bg-gray-100 text-gray-400'
                    }`}>
                      {fx.code}
                    </span>
                  </div>
                  {isLoading ? (
                    <div className="h-6 bg-gray-200 rounded animate-pulse" />
                  ) : (
                    <p className={`text-xl font-bold ${hasValue ? 'text-gray-900' : 'text-gray-400'}`}>
                      {fx.symbol}{balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">
                    {hasValue ? 'Current balance' : 'No holdings'}
                  </p>
                </Card>
              )
            })}
          </div>
        </div>

        {/* ── Quick actions (admin / accountant only) ──────────────────────── */}
        <CanWrite>
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Quick Actions
            </h2>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setShowAddInflow(true)}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-success rounded-xl hover:bg-green-700 transition-colors shadow-sm"
              >
                <PlusCircle className="w-4 h-4" />
                Add Inflow
              </button>
              <button
                onClick={() => setShowAddOutflow(true)}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-danger rounded-xl hover:bg-red-700 transition-colors shadow-sm"
              >
                <MinusCircle className="w-4 h-4" />
                Add Outflow
              </button>
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors shadow-sm"
              >
                <FileSpreadsheet className="w-4 h-4" />
                Import Excel
              </button>
            </div>
          </div>
        </CanWrite>

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
