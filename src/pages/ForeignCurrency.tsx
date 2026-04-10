import { Globe } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { DataTable, type Column } from '../components/ui/DataTable'
import { formatCurrency, formatDate } from '../utils/formatters'
import type { ForeignCurrencyHolding, Currency } from '../types'

const MOCK_HOLDINGS: ForeignCurrencyHolding[] = [
  { id: '1', currency: 'USD', amount: 15400, exchange_rate: 1580, ngn_equivalent: 24332000, last_updated: '2024-12-15' },
  { id: '2', currency: 'GBP', amount: 4200, exchange_rate: 2010, ngn_equivalent: 8442000, last_updated: '2024-12-15' },
  { id: '3', currency: 'EUR', amount: 2800, exchange_rate: 1690, ngn_equivalent: 4732000, last_updated: '2024-12-15' },
]

const CURRENCY_FLAGS: Record<Currency, string> = {
  NGN: '🇳🇬',
  USD: '🇺🇸',
  GBP: '🇬🇧',
  EUR: '🇪🇺',
}

const columns: Column<ForeignCurrencyHolding>[] = [
  {
    key: 'currency',
    header: 'Currency',
    render: (r) => (
      <div className="flex items-center gap-2">
        <span className="text-xl">{CURRENCY_FLAGS[r.currency]}</span>
        <span className="font-semibold text-gray-800">{r.currency}</span>
      </div>
    ),
  },
  {
    key: 'amount',
    header: 'Foreign Amount',
    render: (r) => (
      <span className="font-mono font-medium text-gray-800">
        {formatCurrency(r.amount, r.currency)}
      </span>
    ),
  },
  {
    key: 'exchange_rate',
    header: 'Rate (NGN)',
    render: (r) => (
      <span className="font-mono text-gray-600">
        ₦{r.exchange_rate.toLocaleString()}
      </span>
    ),
  },
  {
    key: 'ngn_equivalent',
    header: 'NGN Equivalent',
    render: (r) => (
      <span className="font-mono font-semibold text-gray-900">
        {formatCurrency(r.ngn_equivalent, 'NGN')}
      </span>
    ),
  },
  {
    key: 'last_updated',
    header: 'Last Updated',
    render: (r) => <span className="text-gray-500">{formatDate(r.last_updated)}</span>,
  },
]

export default function ForeignCurrency() {
  const totalNGN = MOCK_HOLDINGS.reduce((s, h) => s + h.ngn_equivalent, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Foreign Currency</h1>
        <p className="text-sm text-gray-500 mt-1">Foreign currency holdings and exchange rates</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary-100">
              <Globe className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-xs text-gray-500 font-medium">Total NGN Value</p>
              <p className="text-lg font-bold text-gray-900 mt-0.5">
                {formatCurrency(totalNGN, 'NGN').replace('.00', '')}
              </p>
            </div>
          </div>
        </Card>
        {MOCK_HOLDINGS.map((h) => (
          <Card key={h.id}>
            <div className="flex items-center gap-3">
              <span className="text-3xl">{CURRENCY_FLAGS[h.currency]}</span>
              <div>
                <p className="text-xs text-gray-500 font-medium">{h.currency} Holdings</p>
                <p className="text-lg font-bold text-gray-900 mt-0.5">
                  {formatCurrency(h.amount, h.currency)}
                </p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card padding={false}>
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">Holdings Summary</h2>
        </div>
        <DataTable
          columns={columns}
          data={MOCK_HOLDINGS}
          keyExtractor={(r) => r.id}
          emptyMessage="No foreign currency holdings recorded."
        />
      </Card>
    </div>
  )
}
