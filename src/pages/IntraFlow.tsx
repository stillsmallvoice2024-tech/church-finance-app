import { ArrowLeftRight } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { CurrencyDisplay } from '../components/ui/CurrencyDisplay'
import { DataTable, type Column } from '../components/ui/DataTable'
import { formatDate } from '../utils/formatters'
import type { IntraFlowTransaction } from '../types'

const MOCK_FLOWS: IntraFlowTransaction[] = [
  { id: '1', date: '2024-12-14', from_account_id: '1', to_account_id: '2', from_account_name: 'Main Operating Account', to_account_name: 'Savings Reserve', amount: 2000000, currency: 'NGN', description: 'Monthly savings transfer', created_at: '2024-12-14' },
  { id: '2', date: '2024-12-10', from_account_id: '1', to_account_id: '4', from_account_name: 'Main Operating Account', to_account_name: 'Building Project Fund', amount: 1500000, currency: 'NGN', description: 'Building fund allocation — Dec', created_at: '2024-12-10' },
  { id: '3', date: '2024-11-30', from_account_id: '2', to_account_id: '1', from_account_name: 'Savings Reserve', to_account_name: 'Main Operating Account', amount: 500000, currency: 'NGN', description: 'Emergency operational transfer', created_at: '2024-11-30' },
]

const columns: Column<IntraFlowTransaction>[] = [
  { key: 'date', header: 'Date', render: (r) => formatDate(r.date) },
  {
    key: 'from',
    header: 'From Account',
    render: (r) => <span className="font-medium text-danger">{r.from_account_name}</span>,
  },
  {
    key: 'arrow',
    header: '',
    render: () => <ArrowLeftRight className="w-4 h-4 text-gray-400" />,
    className: 'w-8',
  },
  {
    key: 'to',
    header: 'To Account',
    render: (r) => <span className="font-medium text-success">{r.to_account_name}</span>,
  },
  { key: 'description', header: 'Description', render: (r) => <span className="text-gray-500">{r.description}</span> },
  {
    key: 'amount',
    header: 'Amount',
    render: (r) => <CurrencyDisplay amount={r.amount} currency={r.currency} />,
  },
]

export default function IntraFlow() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Intra-Account Flows</h1>
          <p className="text-sm text-gray-500 mt-1">Internal transfers between church accounts</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-light transition-colors">
          <ArrowLeftRight className="w-4 h-4" />
          New Transfer
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total Transferred</p>
          <CurrencyDisplay amount={MOCK_FLOWS.reduce((s, f) => s + f.amount, 0)} currency="NGN" size="lg" className="mt-1 block" />
        </Card>
        <Card>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">This Month</p>
          <CurrencyDisplay amount={3500000} currency="NGN" size="lg" className="mt-1 block" />
        </Card>
        <Card>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Transfers</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{MOCK_FLOWS.length}</p>
        </Card>
      </div>

      <Card padding={false}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Transfer History</h2>
        </div>
        <DataTable
          columns={columns}
          data={MOCK_FLOWS}
          keyExtractor={(r) => r.id}
          emptyMessage="No intra-account transfers recorded."
        />
      </Card>
    </div>
  )
}
