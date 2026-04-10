import { TrendingDown } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { CurrencyDisplay } from '../components/ui/CurrencyDisplay'
import { DataTable, type Column } from '../components/ui/DataTable'
import { formatDate } from '../utils/formatters'
import type { Currency } from '../types'

interface OutflowRecord {
  id: string
  date: string
  description: string
  category: string
  amount: number
  currency: Currency
  reference: string
}

const MOCK_OUTFLOWS: OutflowRecord[] = [
  { id: '1', date: '2024-12-14', description: 'Staff Salaries — December', category: 'Salaries', amount: 1200000, currency: 'NGN', reference: 'SAL-2024-1214' },
  { id: '2', date: '2024-12-12', description: 'Electricity & Water Bills', category: 'Utilities', amount: 180000, currency: 'NGN', reference: 'UTL-2024-1212' },
  { id: '3', date: '2024-12-09', description: 'Outreach Programme — Ikeja', category: 'Outreach', amount: 350000, currency: 'NGN', reference: 'OUT-2024-1209' },
  { id: '4', date: '2024-12-06', description: 'Office Supplies', category: 'Office Supplies', amount: 42000, currency: 'NGN', reference: 'OFC-2024-1206' },
  { id: '5', date: '2024-12-03', description: 'Building Maintenance', category: 'Maintenance', amount: 280000, currency: 'NGN', reference: 'MNT-2024-1203' },
]

const columns: Column<OutflowRecord>[] = [
  { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
  { key: 'description', header: 'Description' },
  { key: 'category', header: 'Category', render: (r) => <Badge label={r.category} variant="danger" /> },
  {
    key: 'amount',
    header: 'Amount',
    render: (r) => <CurrencyDisplay amount={r.amount} currency={r.currency} type="outflow" />,
    className: 'text-right',
  },
  { key: 'reference', header: 'Reference', render: (r) => <span className="font-mono text-xs text-gray-500">{r.reference}</span> },
]

export default function Outflows() {
  const total = MOCK_OUTFLOWS.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Outflows</h1>
          <p className="text-sm text-gray-500 mt-1">Track all outgoing payments and expenses</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-danger text-white text-sm font-medium rounded-xl hover:opacity-90 transition-opacity">
          <TrendingDown className="w-4 h-4" />
          Record Outflow
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Outflows</p>
          <CurrencyDisplay amount={total} currency="NGN" size="lg" className="mt-1 block" />
        </Card>
        <Card>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">This Month</p>
          <CurrencyDisplay amount={2052000} currency="NGN" size="lg" className="mt-1 block" />
        </Card>
        <Card>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Transactions</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{MOCK_OUTFLOWS.length}</p>
        </Card>
      </div>

      <Card padding={false}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Outflow Records</h2>
        </div>
        <DataTable
          columns={columns}
          data={MOCK_OUTFLOWS}
          keyExtractor={(r) => r.id}
          emptyMessage="No outflow records yet."
        />
      </Card>
    </div>
  )
}
