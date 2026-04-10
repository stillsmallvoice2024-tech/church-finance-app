export type UserRole = 'admin' | 'finance_manager' | 'viewer'

export interface UserProfile {
  id: string
  email: string
  full_name: string
  role: UserRole
  avatar_url?: string
  created_at: string
}

export type Currency = 'NGN' | 'USD' | 'GBP' | 'EUR'

export type TransactionType = 'inflow' | 'outflow'

export interface Transaction {
  id: string
  date: string
  description: string
  amount: number
  currency: Currency
  category: string
  account_id: string
  type: TransactionType
  reference?: string
  notes?: string
  created_at: string
  updated_at: string
}

export interface Account {
  id: string
  name: string
  type: 'checking' | 'savings' | 'foreign' | 'special'
  balance: number
  currency: Currency
  description?: string
  created_at: string
}

export interface SpecialProject {
  id: string
  name: string
  target_amount: number
  current_amount: number
  currency: Currency
  start_date: string
  end_date?: string
  status: 'active' | 'completed' | 'paused'
  description?: string
}

export interface ForeignCurrencyHolding {
  id: string
  currency: Currency
  amount: number
  exchange_rate: number
  ngn_equivalent: number
  last_updated: string
}

export interface IntraFlowTransaction {
  id: string
  from_account_id: string
  to_account_id: string
  from_account_name: string
  to_account_name: string
  amount: number
  currency: Currency
  description: string
  date: string
  created_at: string
}
