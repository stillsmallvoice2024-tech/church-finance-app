import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import { TrendingUp, TrendingDown, Wallet, FolderOpen } from 'lucide-react'
import { StatCard } from '../components/ui/StatCard'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { CurrencyDisplay } from '../components/ui/CurrencyDisplay'
import { formatDate, formatCurrencyCompact } from '../utils/formatters'
import type { Currency } from '../types'

// Mock data — replace with Supabase queries
const MONTHLY_DATA = [
  { month: 'Jan', inflows: 4200000, outflows: 2800000 },
  { month: 'Feb', inflows: 3800000, outflows: 3200000 },
  { month: 'Mar', inflows: 5100000, outflows: 3600000 },
  { month: 'Apr', inflows: 4700000, outflows: 3100000 },
  { month: 'May', inflows: 6200000, outflows: 4100000 },
  { month: 'Jun', inflows: 5500000, outflows: 3800000 },
  { month: 'Jul', inflows: 7100000, outflows: 4500000 },
  { month: 'Aug', inflows: 6800000, outflows: 5200000 },
  { month: 'Sep', inflows: 5900000, outflows: 4200000 },
  { month: 'Oct', inflows: 8200000, outflows: 5800000 },
  { month: 'Nov', inflows: 7500000, outflows: 5100000 },
  { month: 'Dec', inflows: 9800000, outflows: 6200000 },
]

const RECENT_TRANSACTIONS = [
  {
    id: '1',
    date: '2024-12-15',
    description: 'Sunday Service Offering',
    amount: 850000,
    type: 'inflow' as const,
    category: 'Offerings',
    currency: 'NGN' as Currency,
  },
  {
    id: '2',
    date: '2024-12-14',
    description: 'Staff Salaries — December',
    amount: 1200000,
    type: 'outflow' as const,
    category: 'Salaries',
    currency: 'NGN' as Currency,
  },
  {
    id: '3',
    date: '2024-12-13',
    description: 'Christmas Project Donation',
    amount: 500000,
    type: 'inflow' as const,
    category: 'Donations',
    currency: 'NGN' as Currency,
  },
  {
    id: '4',
    date: '2024-12-12',
    description: 'Utility Bills',
    amount: 180000,
    type: 'outflow' as const,
    category: 'Utilities',
    currency: 'NGN' as Currency,
  },
  {
    id: '5',
    date: '2024-12-10',
    description: 'Monthly Tithes Collection',
    amount: 2300000,
    type: 'inflow' as const,
    category: 'Tithes',
    currency: 'NGN' as Currency,
  },
]

function yAxisFormatter(value: number) {
  return formatCurrencyCompact(value)
}

function tooltipFormatter(value: number) {
  return formatCurrencyCompact(value)
}

export default function Dashboard() {
  const totalInflows = MONTHLY_DATA.reduce((s, m) => s + m.inflows, 0)
  const totalOutflows = MONTHLY_DATA.reduce((s, m) => s + m.outflows, 0)
  const netBalance = totalInflows - totalOutflows

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Financial overview for 2024</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Inflows (2024)"
          value={formatCurrencyCompact(totalInflows)}
          icon={<TrendingUp className="w-5 h-5 text-success" />}
          iconBgClass="bg-success-light"
          trend={{ value: 12.4, label: 'vs last year' }}
        />
        <StatCard
          title="Total Outflows (2024)"
          value={formatCurrencyCompact(totalOutflows)}
          icon={<TrendingDown className="w-5 h-5 text-danger" />}
          iconBgClass="bg-danger-light"
          trend={{ value: -3.1, label: 'vs last year' }}
        />
        <StatCard
          title="Net Balance"
          value={formatCurrencyCompact(netBalance)}
          icon={<Wallet className="w-5 h-5 text-primary" />}
          iconBgClass="bg-primary-100"
          trend={{ value: 8.7, label: 'vs last year' }}
        />
        <StatCard
          title="Active Projects"
          value="4"
          icon={<FolderOpen className="w-5 h-5 text-accent" />}
          iconBgClass="bg-accent-light"
        />
      </div>

      {/* Chart */}
      <Card>
        <h2 className="text-base font-semibold text-gray-800 mb-4">
          Monthly Inflows vs Outflows
        </h2>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={MONTHLY_DATA} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#065F46" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#065F46" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="outflowGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#991B1B" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#991B1B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6B7280' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={yAxisFormatter} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} width={64} />
              <Tooltip
                formatter={tooltipFormatter}
                contentStyle={{ borderRadius: '0.75rem', border: '1px solid #E5E7EB', fontSize: '13px' }}
              />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '13px' }} />
              <Area
                type="monotone"
                dataKey="inflows"
                name="Inflows"
                stroke="#065F46"
                strokeWidth={2}
                fill="url(#inflowGrad)"
              />
              <Area
                type="monotone"
                dataKey="outflows"
                name="Outflows"
                stroke="#991B1B"
                strokeWidth={2}
                fill="url(#outflowGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Recent transactions */}
      <Card padding={false}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">Recent Transactions</h2>
          <span className="text-xs text-gray-400">Last 5 entries</span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-50">
                {['Date', 'Description', 'Category', 'Amount'].map((h) => (
                  <th
                    key={h}
                    className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {RECENT_TRANSACTIONS.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-6 py-3 text-sm text-gray-500 whitespace-nowrap">
                    {formatDate(tx.date)}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-800">{tx.description}</td>
                  <td className="px-6 py-3">
                    <Badge
                      label={tx.category}
                      variant={tx.type === 'inflow' ? 'success' : 'danger'}
                    />
                  </td>
                  <td className="px-6 py-3 whitespace-nowrap">
                    <CurrencyDisplay
                      amount={tx.amount}
                      currency={tx.currency}
                      type={tx.type}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
