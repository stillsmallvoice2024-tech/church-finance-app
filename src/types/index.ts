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

export type ReportBasis = 'transaction_date' | 'recorded_at'

/** Discriminated row type within a report group/subgroup */
export type ReportRowType = 'category' | 'inflow_type' | 'transaction_type'

export interface ReportItem {
  id: string
  rowType?: ReportRowType       // defaults to 'category' when absent (backward compat)
  categoryName: string          // category name for category rows; display key for other row types
  displayLabel: string
  portion: ReportPortion
  visible: boolean
  // For inflow_type rows
  incomeTypeId?: string
  // For transaction_type rows
  transactionTypeKey?: string
}

export interface ReportSubgroup {
  id: string
  label: string
  visible: boolean
  items: ReportItem[]
}

export type ReportGroupChild =
  | { kind: 'item'; data: ReportItem }
  | { kind: 'subgroup'; data: ReportSubgroup }

export interface ReportGroup {
  id: string
  label: string
  visible: boolean
  children: ReportGroupChild[]
}

export interface ReportTable {
  id: string
  title: string
  visible: boolean
  groups: ReportGroup[]
  /** When false, excludes this table from the combined grand total. Defaults to true. */
  include_in_combined_total?: boolean
}

export interface ReportLayout {
  /** Multi-table layout (new format) */
  tables?: ReportTable[]
  /** Legacy single-table format — auto-migrated on load */
  groups?: ReportGroup[]
  basis?: ReportBasis
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

/** Operational inflow balance keyed by incomeTypeId or transactionTypeKey */
export type OperationalBalanceMap = Map<string, number>

// ── Dynamic Reports ────────────────────────────────────────────────────────────

export type DynamicReportBlockType = 'text' | 'metric' | 'table'

export interface DynamicReport {
  id: string
  title: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface DynamicReportBlock {
  id: string
  report_id: string
  block_type: DynamicReportBlockType
  position: number
  config_json: Record<string, unknown>
  created_at: string
}

export interface TextBlockConfig {
  text: string
}

export interface MetricBlockConfig {
  fn: 'BALANCE' | 'INFLOWS' | 'OUTFLOWS' | 'NET'
  category?: string
  dateFrom?: string
  dateTo?: string
  label?: string
}

export interface TableBlockConfig {
  categories: string[]
  columns: Array<'inflows' | 'outflows' | 'balance'>
  dateFrom?: string
  dateTo?: string
  label?: string
}
