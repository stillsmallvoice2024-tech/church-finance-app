export type UserRole = 'admin' | 'accountant' | 'viewer'

export interface UserProfile {
  id: string
  email: string
  full_name: string
  username?: string | null
  role: UserRole
  avatar_url?: string | null
  created_at: string
  updated_at: string
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

// ── Financial Report Types ──────────────────────────────────────────────────────────────────────────────

export type ReportPortion = 'All' | 'Percentage' | 'Specific Seed' | 'Savings'

export interface ReportItem {
  id: string
  categoryName: string
  displayLabel: string
  portion: ReportPortion
  visible: boolean
}

export interface ReportGroup {
  id: string
  label: string
  visible: boolean
  items: ReportItem[]
}

export interface ReportLayout {
  groups: ReportGroup[]
}

export interface ReportTemplate {
  id: string
  name: string
  description?: string
  layout: ReportLayout
  created_by?: string
  created_at: string
  updated_at: string
}

export interface ReportCategoryBalance {
  categoryName: string
  percentageAllocated: number
  specificSeed: number
  savingsNet: number
}
