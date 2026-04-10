import { Wallet, Plus } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { CurrencyDisplay } from '../components/ui/CurrencyDisplay'
import type { Account } from '../types'

const MOCK_ACCOUNTS: Account[] = [
  { id: '1', name: 'Main Operating Account', type: 'checking', balance: 12450000, currency: 'NGN', description: 'Primary church account for day-to-day operations', created_at: '2024-01-01' },
  { id: '2', name: 'Savings Reserve', type: 'savings', balance: 8300000, currency: 'NGN', description: 'Emergency and reserve fund', created_at: '2024-01-01' },
  { id: '3', name: 'USD Mission Account', type: 'foreign', balance: 15400, currency: 'USD', description: 'Foreign mission and diaspora contributions', created_at: '2024-01-01' },
  { id: '4', name: 'Building Project Fund', type: 'special', balance: 5600000, currency: 'NGN', description: 'Dedicated for new auditorium construction', created_at: '2024-01-01' },
]

const TYPE_LABELS: Record<Account['type'], string> = {
  checking: 'Checking',
  savings: 'Savings',
  foreign: 'Foreign Currency',
  special: 'Special Project',
}

const TYPE_BADGE: Record<Account['type'], 'primary' | 'success' | 'warning' | 'neutral'> = {
  checking: 'primary',
  savings: 'success',
  foreign: 'warning',
  special: 'neutral',
}

export default function Accounts() {
  const totalNGN = MOCK_ACCOUNTS.filter((a) => a.currency === 'NGN').reduce((s, a) => s + a.balance, 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
          <p className="text-sm text-gray-500 mt-1">Manage all church financial accounts</p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-light transition-colors">
          <Plus className="w-4 h-4" />
          Add Account
        </button>
      </div>

      {/* Summary */}
      <Card>
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-primary-100">
            <Wallet className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Total NGN Holdings</p>
            <CurrencyDisplay amount={totalNGN} currency="NGN" size="lg" className="mt-0.5 block" />
          </div>
        </div>
      </Card>

      {/* Account cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {MOCK_ACCOUNTS.map((account) => (
          <Card key={account.id}>
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-gray-900">{account.name}</h3>
                {account.description && (
                  <p className="text-xs text-gray-500 mt-0.5">{account.description}</p>
                )}
              </div>
              <Badge label={TYPE_LABELS[account.type]} variant={TYPE_BADGE[account.type]} />
            </div>
            <div className="pt-3 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-1">Current Balance</p>
              <CurrencyDisplay amount={account.balance} currency={account.currency} size="lg" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
