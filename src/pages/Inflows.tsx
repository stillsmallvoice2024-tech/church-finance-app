import { TrendingUp } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { CurrencyDisplay } from '../components/ui/CurrencyDisplay'
import { DataTable, type Column } from '../components/ui/DataTable'
import { formatDate } from '../utils/formatters'
import type { Currency } from '../types'

interface InflowRecord {
  id: string
  date: string
  description: string
  category: string
  amount: number
  currency: Currency
  reference: string
}

const MOCK_INFLOWS: InflowRecord[] = [
  { id: '1', date: '2024-12-15', description: 'Sunday Service Offering', category: 'Offerings', amount: 850000, currency: 'NGN', reference: 'OFF-2024-1215' },
  { id: '2', date: '2024-12-13', description: 'Christmas Project Donation', category: 'Donations', amount: 500000, currency: 'NGN', reference: 'DON-2024-1213' },
  { id: '3', date: '2024-12-10', description: 'Monthly Tithes Collection', category: 'Tithes', amount: 2300000, currency: 'NGN', reference: 'TTH-2024-1210' },
  { id: '4', date: '2024-12-08', description: 'Special Sunday Offering', category: 'Offerings', amount: 620000, currency: 'NGN', reference: 'OFF-2024-1208' },
  { id: '5', date: '2024-12-01', description: 'Bank Interest — Nov', category: 'Bank Interest', amount: 45200, currency: 'NGN', reference: 'INT-2024-1201' },
]

const columns: Column<InflowRecord>[] = [
  { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
  { key: 'description', header: 'Description' },
  { key: 'category', header: 'Category', render: (r) => <Badge label={r.category} variant="success" /> },
  {
    key: 'amount',
    header: 'Amount',
    render: (r) => <CurrencyDisplay amount={r.amount} currency={r.currency} type="inflow" />,
    className: 'text-right',
  },
  { key: 'reference', header: 'Reference', render: (r) => <span className="font-mono text-xs text-gray-500">{r.reference}</span> },
]

export default function Inflows() {
  const total = MOCK_INFLOWS.reduce((s, r) => s + r.amount, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inflows</h1>
          <p className="text-sm text-gray-500 mt-1">Track all incoming funds and contributions</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-light transition-colors">
          <TrendingUp className="w-4 h-4" />
          Record Inflow
        </button>
      </div>

      {/* Summary card */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Inflows</p>
          <CurrencyDisplay amount={total} currency="NGN" size="lg" className="mt-1 block" />
        </Card>
        <Card>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">This Month</p>
          <CurrencyDisplay amount={4315200} currency="NGN" size="lg" className="mt-1 block" />
        </Card>
        <Card>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Transactions</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{MOCK_INFLOWS.length}</p>
        </Card>
      </div>

      {/* Table */}
      <Card padding={false}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Inflow Records</h2>
        </div>
        <DataTable
          columns={columns}
          data={MOCK_INFLOWS}
          keyExtractor={(r) => r.id}
          emptyMessage="No inflow records yet."
        />
      </Card>
    </div>
  )
}
